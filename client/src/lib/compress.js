/**
 * Limites et compression des fichiers envoyés (XERA1).
 *
 * Le bucket Supabase « media » refuse tout fichier de plus de 50 Mo : avant,
 * l'appli acceptait jusqu'à 200 Mo et l'envoi échouait (erreur 400). Ici :
 *  - les images sont redimensionnées et réencodées en WebP jusqu'à passer
 *    sous leur limite (rien n'est envoyé en taille d'origine inutilement) ;
 *  - les GIF animés gardent leur animation, avec une limite dédiée ;
 *  - une vidéo trop lourde est réencodée dans le navigateur (720p) ;
 *    si elle reste trop lourde, un message clair l'explique.
 */

const MB = 1024 * 1024;

export const LIMITS = {
  imageMaxBytes: 4 * MB, // après compression
  gifMaxBytes: 8 * MB,
  videoMaxBytes: 48 * MB, // marge sous les 50 Mo du bucket
  videoMaxSeconds: 5 * 60,
  inputMaxBytes: 1024 * MB, // au-delà, on ne tente même pas
};

/** Taille maximale (côté le plus long) selon l'usage. */
const MAX_SIDE = { avatars: 640, banners: 2000, ads: 1600, content: 2048, arcs: 2048, default: 2048 };

export const formatBytes = (n) => (n >= MB ? `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

function rename(file, ext) {
  const base = String(file.name || 'media').replace(/\.[^.]+$/, '') || 'media';
  return `${base}.${ext}`;
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* on tente l'élément <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Compresse une image fixe. Renvoie un File (WebP, ou JPEG si WebP indisponible). */
export async function compressImage(file, { folder = 'content', maxBytes = LIMITS.imageMaxBytes } = {}) {
  let bitmap;
  try {
    bitmap = await decodeImage(file);
  } catch {
    // Format que le navigateur ne sait pas lire (ex. HEIC sur certains appareils).
    if (file.size <= maxBytes) return file;
    throw new Error('Cette photo ne peut pas être lue par le navigateur. Exportez-la en JPG ou PNG puis réessayez.');
  }
  const w0 = bitmap.width || bitmap.naturalWidth;
  const h0 = bitmap.height || bitmap.naturalHeight;
  let side = MAX_SIDE[folder] || MAX_SIDE.default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  let type = 'image/webp';
  let quality = 0.84;
  let out = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, type, quality);
    if (!blob || (type === 'image/webp' && blob.type !== 'image/webp')) {
      type = 'image/jpeg'; // Safari ancien : pas d'encodeur WebP
      blob = await toBlob(canvas, type, quality);
    }
    out = blob;
    if (blob && blob.size <= maxBytes) break;
    if (quality > 0.62) quality -= 0.1;
    else side = Math.round(side * 0.8);
  }
  bitmap.close?.();
  if (!out) throw new Error('Compression de la photo impossible.');
  // Si l'original était déjà plus léger (petite image bien compressée), on le garde.
  if (file.size <= out.size && file.size <= maxBytes && Math.max(w0, h0) <= (MAX_SIDE[folder] || MAX_SIDE.default)) return file;
  if (out.size > maxBytes) throw new Error(`Photo trop lourde même compressée (${formatBytes(out.size)}, maximum ${formatBytes(maxBytes)}).`);
  return new File([out], rename(file, type === 'image/webp' ? 'webp' : 'jpg'), { type, lastModified: Date.now() });
}

function videoMeta(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => resolve({ v, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => reject(new Error('Vidéo illisible par le navigateur.'));
  });
}

function pickRecorderType() {
  if (!('MediaRecorder' in window)) return null;
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || null;
}

/**
 * Réencode une vidéo trop lourde (lecture en temps réel → canvas 720p → MediaRecorder).
 * `onProgress(0..1)` permet d'afficher l'avancement.
 */
export async function compressVideo(file, { maxBytes = LIMITS.videoMaxBytes, onProgress } = {}) {
  const mime = pickRecorderType();
  if (!mime || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error(`Vidéo trop lourde (${formatBytes(file.size)}, maximum ${formatBytes(maxBytes)}) et ce navigateur ne sait pas la compresser. Raccourcissez-la ou réduisez sa qualité.`);
  }
  const { v, duration, width, height } = await videoMeta(file);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Durée de la vidéo inconnue.');
  if (duration > LIMITS.videoMaxSeconds) {
    URL.revokeObjectURL(v.src);
    throw new Error(`Vidéo trop longue (${Math.round(duration / 60)} min). Maximum ${LIMITS.videoMaxSeconds / 60} minutes.`);
  }
  const scale = Math.min(1, 1280 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((width * scale) / 2) * 2;
  canvas.height = Math.round((height * scale) / 2) * 2;
  const ctx = canvas.getContext('2d');
  // Débit visé : 85 % de la limite répartis sur la durée (plafonné à 2,5 Mb/s).
  const videoBitsPerSecond = Math.max(350_000, Math.min(2_500_000, Math.floor(((maxBytes * 0.85 * 8) / duration) - 96_000)));

  const stream = canvas.captureStream(30);
  try {
    // Piste audio d'origine, si le navigateur la fournit.
    const src = v.captureStream?.() || v.mozCaptureStream?.();
    src?.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch {
    /* vidéo sans son */
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond, audioBitsPerSecond: 96_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => (rec.onstop = resolve));

  v.muted = false;
  v.volume = 0; // le son est capturé mais pas joué
  v.playsInline = true;
  let raf;
  const draw = () => {
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    onProgress?.(Math.min(0.99, v.currentTime / duration));
    if (!v.ended) raf = requestAnimationFrame(draw);
  };
  rec.start(1000);
  await v.play().catch(async () => {
    v.muted = true;
    await v.play();
  });
  draw();
  await new Promise((resolve) => (v.onended = resolve));
  cancelAnimationFrame(raf);
  rec.stop();
  await done;
  URL.revokeObjectURL(v.src);
  stream.getTracks().forEach((t) => t.stop());
  onProgress?.(1);

  const type = mime.split(';')[0];
  const blob = new Blob(chunks, { type });
  if (blob.size > maxBytes) throw new Error(`Vidéo encore trop lourde après compression (${formatBytes(blob.size)}). Raccourcissez-la.`);
  return new File([blob], rename(file, type === 'video/mp4' ? 'mp4' : 'webm'), { type, lastModified: Date.now() });
}

/**
 * Prépare un fichier avant envoi : vérifie le type, applique les limites et
 * compresse si besoin. Renvoie { file, kind, compressed }.
 */
export async function prepareUpload(file, { folder = 'content', onProgress } = {}) {
  if (!file) throw new Error('Aucun fichier choisi.');
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isImage && !isVideo) throw new Error('Utilisez une photo ou une vidéo.');
  if (file.size > LIMITS.inputMaxBytes) throw new Error(`Fichier beaucoup trop lourd (${formatBytes(file.size)}).`);

  if (isImage) {
    if (file.type === 'image/gif') {
      if (file.size > LIMITS.gifMaxBytes) throw new Error(`GIF trop lourd (${formatBytes(file.size)}, maximum ${formatBytes(LIMITS.gifMaxBytes)}).`);
      return { file, kind: 'image', compressed: false };
    }
    if (file.type === 'image/svg+xml') throw new Error('Les images SVG ne sont pas acceptées.');
    const out = await compressImage(file, { folder });
    return { file: out, kind: 'image', compressed: out !== file };
  }

  if (file.size <= LIMITS.videoMaxBytes) return { file, kind: 'video', compressed: false };
  const out = await compressVideo(file, { onProgress });
  return { file: out, kind: 'video', compressed: true };
}
