import { useRef, useState } from 'react';
import Icon from './Icon';
import { IconButton } from './ui';
import { uploadMedia } from '../services/data';
import { LIMITS, formatBytes } from '../lib/compress';
import { useAuth } from '../contexts/AuthContext';
import { useUi } from '../contexts/UiContext';

/** Choix d'une image/vidéo, envoi vers Supabase Storage et aperçu. */
export default function MediaPicker({ value, onChange, folder = 'content', label = 'Ajouter une photo ou une vidéo' }) {
  const { user } = useAuth();
  const { toast } = useUi();
  const input = useRef();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null);

  async function handle(file) {
    if (!file) return;
    setBusy(true);
    setProgress(null);
    try {
      const big = file.type.startsWith('video/') && file.size > LIMITS.videoMaxBytes;
      if (big) toast('info', 'Compression de la vidéo', `${formatBytes(file.size)} : elle est compressée avant l’envoi, gardez la page ouverte.`);
      onChange(await uploadMedia(user.id, file, folder, { onProgress: big ? setProgress : undefined }));
    } catch (error) {
      toast('error', 'Envoi impossible', error.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (value?.url) {
    return (
      <div className="media-preview">
        {value.type === 'video' ? <video src={value.url} controls playsInline /> : <img src={value.url} alt="Aperçu" />}
        <IconButton icon="close" label="Retirer le média" onClick={() => onChange(null)} type="button" />
      </div>
    );
  }

  return (
    <div
      className={`dropzone${over ? ' is-over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files?.[0]);
      }}
    >
      {busy ? <span className="spinner" style={{ width: 30, height: 30 }} /> : <Icon name="add_photo_alternate" />}
      <strong>{busy ? (progress != null ? `Compression… ${Math.round(progress * 100)} %` : 'Envoi en cours…') : label}</strong>
      <span style={{ fontSize: 12.5 }}>Photo (compressée automatiquement) ou vidéo jusqu’à {formatBytes(LIMITS.videoMaxBytes)}, plus lourde = compressée</span>
      <input ref={input} type="file" accept="image/*,video/*" hidden onChange={(e) => handle(e.target.files?.[0])} />
    </div>
  );
}
