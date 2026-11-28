/**
 * Fil XERA1 : pagination, préférences de lecture (enregistrer, masquer,
 * ne plus voir un auteur), signalement et publicités maison.
 */
import { supabase } from './supabase';
import { DEMO, demoContent } from './demo';
import { fetchFeed } from './data';

// ---------------------------------------------------------------- Pagination

/**
 * Une page du fil. `before` = created_at de la dernière preuve déjà affichée.
 * Filtres : all | success | failure | pause | video | media | following (userIds).
 */
export async function fetchFeedPage({ filter = 'all', before, limit = 20, userIds } = {}) {
  if (DEMO) {
    const list = filter === 'all' || filter === 'following' ? demoContent : demoContent.filter((c) => c.state === filter || (filter === 'video' && c.type === 'video'));
    return before ? [] : list;
  }
  return fetchFeed({ filter, limit, userIds, before });
}

/** Nombre de preuves publiées après `since` (bandeau « nouvelles preuves »). */
export async function countNewer(since) {
  if (DEMO || !since) return 0;
  const { count } = await supabase.from('content').select('id', { count: 'exact', head: true }).eq('is_deleted', false).gt('created_at', since);
  return count || 0;
}

// ---------------------------------------------------------------- Préférences locales

const store = {
  read(key) {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch {
      return new Set();
    }
  },
  write(key, set) {
    try {
      localStorage.setItem(key, JSON.stringify([...set].slice(-800)));
    } catch {
      /* stockage indisponible : préférence non conservée */
    }
  },
};
const k = (userId, name) => `xera1-feed-${name}:${userId || 'guest'}`;

export const feedPrefs = {
  saved: (userId) => store.read(k(userId, 'saved')),
  hidden: (userId) => store.read(k(userId, 'hidden')),
  muted: (userId) => store.read(k(userId, 'muted')),
  toggle(userId, name, id) {
    const set = store.read(k(userId, name));
    const on = !set.has(id);
    if (on) set.add(id);
    else set.delete(id);
    store.write(k(userId, name), set);
    window.dispatchEvent(new CustomEvent('xera1-feed-prefs', { detail: { name, id, on } }));
    return on;
  },
};

/** Preuves enregistrées (rechargées depuis la base, dans l'ordre d'enregistrement). */
export async function fetchSavedContent(userId) {
  const ids = [...feedPrefs.saved(userId)].reverse();
  if (!ids.length) return [];
  if (DEMO) return demoContent.filter((c) => ids.includes(c.id));
  const rows = await fetchFeed({ ids, limit: 100 });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// ---------------------------------------------------------------- Signalement

export const REPORT_REASONS = [
  ['spam', 'Spam ou publicité trompeuse'],
  ['fake', 'Fausse preuve / contenu volé'],
  ['abuse', 'Harcèlement ou propos haineux'],
  ['nsfw', 'Contenu choquant ou inapproprié'],
  ['other', 'Autre raison'],
];

/** Envoie un signalement à l'équipe XERA1 (boîte « Retours » de l'admin). */
export async function reportContent({ userId, content, reason, note }) {
  if (DEMO) return;
  const label = REPORT_REASONS.find(([k2]) => k2 === reason)?.[1] || reason;
  const comment = [`🚩 Signalement de publication (${label})`, `Preuve : ${content.title || '(sans titre)'} — id ${content.id}`, `Auteur : ${content.user_id}`, note ? `Note : ${note}` : null]
    .filter(Boolean)
    .join('\n');
  const { error } = await supabase.from('feedback_inbox').insert({ sender_user_id: userId, mood: 'angry', comment });
  if (error) throw error;
}

// ---------------------------------------------------------------- Publicités XERA1

export const AD_THEMES = {
  violet: { label: 'Violet XERA1', a: '#8b5cf6', b: '#312e81' },
  gold: { label: 'Or', a: '#f5c451', b: '#7c2d12' },
  success: { label: 'Vert avancée', a: '#10b981', b: '#064e3b' },
  pause: { label: 'Indigo', a: '#6366f1', b: '#1e1b4b' },
  mono: { label: 'Noir & blanc', a: '#f5f5f5', b: '#1a1a1a' },
};

export async function fetchActiveAds() {
  if (DEMO) return [];
  const { data } = await supabase.from('xera_ads').select('*').order('priority', { ascending: false }).order('created_at', { ascending: false }).limit(20);
  const now = Date.now();
  // Le super admin lit toutes les pubs (RLS) : on ne garde que celles réellement en ligne.
  return (data || []).filter((a) => a.is_active && (!a.starts_at || Date.parse(a.starts_at) <= now) && (!a.ends_at || Date.parse(a.ends_at) > now));
}

export function trackAd(adId, kind) {
  if (DEMO || !adId) return;
  const key = `xera1-ad-${kind}:${adId}`;
  try {
    if (kind === 'view' && sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    /* compteur au mieux */
  }
  supabase.rpc('xera_ad_track', { p_ad_id: adId, p_kind: kind }).then(() => {});
}

/**
 * Intercale les pubs dans le fil : une pub après chaque bloc de `every_n`
 * preuves, en tournant entre les pubs actives (les plus prioritaires d'abord).
 */
export function interleaveAds(items, ads) {
  if (!ads?.length) return items.map((c) => ({ kind: 'post', key: c.id, content: c }));
  const out = [];
  let since = 0;
  let next = 0;
  items.forEach((c, i) => {
    out.push({ kind: 'post', key: c.id, content: c });
    since += 1;
    const ad = ads[next % ads.length];
    if (since >= (ad.every_n || 6) && i < items.length - 1) {
      out.push({ kind: 'ad', key: `ad-${ad.id}-${i}`, ad });
      since = 0;
      next += 1;
    }
  });
  return out;
}
