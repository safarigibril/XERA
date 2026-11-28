/**
 * Algorithme du fil XERA1 — reprise de js/app-supabase.js
 * (scoreImmersiveContent, computeOpportunityRoleBoost, buildAuthorScoreMapFromContents,
 * loadImmersivePrefs + décroissance temporelle, updateImmersivePrefs,
 * recordSearchPreference, interleaveByUser).
 * Les préférences restent dans la même clé locale que l'ancienne interface
 * (immersive_prefs_v1:<userId>) : l'apprentissage déjà acquis est conservé.
 */

const PLAN_BOOST = { pro: 5, medium: 1.5, standard: 1.125 };

const empty = () => ({ types: {}, states: {}, users: {}, tags: {}, queries: {}, seen: {}, updatedAt: Date.now(), interactionCount: 0 });
const key = (userId) => (userId ? `immersive_prefs_v1:${userId}` : 'immersive_prefs_v1:guest');

function decayMap(map, factor, floor) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    const next = v * factor;
    if (Math.abs(next) >= floor) out[k] = next;
  }
  return out;
}

function prune(obj, max) {
  const keys = Object.keys(obj || {});
  if (keys.length <= max) return obj;
  keys.sort((a, b) => (obj[b] || 0) - (obj[a] || 0));
  return Object.fromEntries(keys.slice(0, max).map((k) => [k, obj[k]]));
}

function pruneSeen(seen, max = 600) {
  const entries = Object.entries(seen || {});
  if (entries.length <= max) return seen;
  entries.sort((a, b) => (a[1] || 0) - (b[1] || 0));
  return Object.fromEntries(entries.slice(entries.length - max));
}

function save(userId, prefs) {
  try {
    localStorage.setItem(key(userId), JSON.stringify({ ...prefs, seen: pruneSeen(prefs.seen), lastInteractionTime: prefs.lastInteractionTime }));
  } catch {
    /* stockage indisponible : l'apprentissage reprendra plus tard */
  }
}

/** Charge les préférences et applique la décroissance (demi-vie adaptative). */
export function loadPrefs(userId) {
  let prefs;
  try {
    const raw = localStorage.getItem(key(userId));
    prefs = raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
  const now = Date.now();
  const elapsed = Math.max(0, now - (Number(prefs.updatedAt) || now));
  if (elapsed < 3 * 3600e3) return prefs;
  const n = prefs.interactionCount || 0;
  const diversity = prefs.diversityScore || 0.5;
  let halfLife = 25;
  if (diversity > 0.7 && n > 100) halfLife = 16;
  else if (n < 20) halfLife = 28;
  else if (n > 300) halfLife = 18;
  const factor = 0.5 ** (elapsed / 864e5 / halfLife);
  const floor = 0.008;
  const decayed = {
    ...prefs,
    types: decayMap(prefs.types, factor, floor),
    states: decayMap(prefs.states, factor, floor),
    users: decayMap(prefs.users, factor, floor),
    tags: decayMap(prefs.tags, factor, floor),
    queries: decayMap(prefs.queries, factor, floor),
    updatedAt: now,
  };
  save(userId, decayed);
  return decayed;
}

const bump = (map, k, v) => {
  if (k) map[k] = (map[k] || 0) + v;
};

function adaptiveWeight(prefs, action) {
  const base = { like: 2.8, dislike: -2.0, view: 0.5 }[action] ?? 0.8;
  const days = (Date.now() - (prefs.lastInteractionTime || Date.now())) / 864e5;
  const recency = days < 1 ? 1.2 : days < 7 ? 1.1 : days > 30 ? 0.9 : 1;
  const engagement = Math.min(1.3, 1 + (prefs.interactionCount || 0) / 500);
  return base * recency * engagement;
}

/** Apprentissage : encouragement (« like »), vue prolongée (« view »). */
export function recordInteraction(userId, content, action) {
  if (!content) return;
  const prefs = loadPrefs(userId);
  const w = adaptiveWeight(prefs, action);
  bump(prefs.types, content.type, w);
  bump(prefs.states, content.state, w * 0.7);
  bump(prefs.users, content.user_id, w);
  (content.tags || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean).forEach((t) => bump(prefs.tags, t, w));
  prefs.seen[content.id] = Date.now();
  prefs.interactionCount = (prefs.interactionCount || 0) + 1;
  prefs.lastInteractionTime = Date.now();
  prefs.tags = prune(prefs.tags, 200);
  prefs.users = prune(prefs.users, 200);
  save(userId, prefs);
}

/** Recherche : les mots tapés deviennent des intérêts (recordSearchPreference). */
export function recordSearch(userId, query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9À-ÿ]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  if (!tokens.length) return;
  const prefs = loadPrefs(userId);
  tokens.forEach((t) => {
    bump(prefs.tags, t, 0.9);
    bump(prefs.queries, t, 1.1);
  });
  prefs.tags = prune(prefs.tags, 120);
  prefs.queries = prune(prefs.queries, 120);
  save(userId, prefs);
}

function roleBoost(content, role) {
  const arc = content.arcs || {};
  const intents = Array.isArray(arc.opportunity_intents) ? arc.opportunity_intents : [];
  const stage = String(arc.stage_level || '').toLowerCase();
  const recruit = intents.includes('open_to_recruit');
  const invest = intents.includes('cherche_investissement');
  const collab = intents.includes('cherche_collab');
  let b = 0;
  if (content.arc_id) b += intents.length === 0 ? 0.18 : 0.06;
  if (role === 'recruiter') {
    if (recruit) b += 2.35;
    if (collab) b += 0.7;
    if (invest) b += 0.25;
    if (['prototype', 'demo', 'beta', 'release'].includes(stage)) b += 0.42;
    return b;
  }
  if (role === 'investor') {
    if (invest) b += 2.45;
    if (collab) b += 0.25;
    if (recruit) b += 0.2;
    if (stage === 'prototype') b += 0.4;
    if (['demo', 'beta', 'release'].includes(stage)) b += 0.72;
    return b;
  }
  if (collab) b += 0.22;
  if (recruit) b += 0.12;
  if (invest) b += 0.08;
  if (stage === 'demo' || stage === 'release') b += 0.2;
  return b;
}

function viewerRole(user) {
  const raw = String(user?.account_subtype || '').toLowerCase();
  if (raw === 'recruiter' || raw === 'recruteur') return 'recruiter';
  if (raw === 'investor' || raw === 'investisseur') return 'investor';
  return 'fan';
}

function authorScores(items) {
  const stats = new Map();
  for (const c of items) {
    const s = stats.get(c.user_id) || { views: 0, enc: 0, posts: 0 };
    s.views += Number(c.views) || 0;
    s.enc += Number(c.encouragements_count) || 0;
    s.posts += 1;
    stats.set(c.user_id, s);
  }
  const out = new Map();
  for (const [id, s] of stats) out.set(id, Math.max(0, Math.min(5, Math.log1p(s.views) * 0.55 + Math.log1p(s.enc) * 1.25 + Math.log1p(s.posts) * 0.35)));
  return out;
}

/**
 * Re-classement « diversifié » : on prend toujours la meilleure preuve restante,
 * mais un même auteur ne revient pas avant 3 cartes et chaque nouvelle preuve
 * d'un auteur déjà montré perd 30 %. Garde l'ordre de pertinence (l'ancien
 * tourniquet auteur par auteur le cassait) tout en évitant les rafales.
 */
function diversify(scored) {
  const pool = [...scored];
  const out = [];
  const shown = new Map();
  while (pool.length) {
    let best = -1;
    let bestScore = -Infinity;
    const recent = out.slice(-3).map((c) => c.user_id);
    for (let i = 0; i < pool.length; i++) {
      const { c, score } = pool[i];
      const repeat = shown.get(c.user_id) || 0;
      let s = score * 0.7 ** repeat;
      if (recent.includes(c.user_id)) s -= 1000; // en dernier recours seulement
      // Varier les formats : pas trois textes seuls d'affilée.
      const lastTwo = out.slice(-2);
      if (lastTwo.length === 2 && lastTwo.every((x) => x.type === c.type)) s *= 0.9;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    const [{ c }] = pool.splice(best, 1);
    out.push(c);
    shown.set(c.user_id, (shown.get(c.user_id) || 0) + 1);
  }
  return out;
}

/**
 * Classe les preuves du fil « Pour vous ».
 * @param {object[]} items  lignes content (avec users et arcs joints)
 * @param {object} ctx      { user, followedIds:Set, badgeSets }
 *
 * Signaux (ADN XERA : la régularité et la progression comptent plus que la viralité) :
 *  - fraîcheur (demi-vie ~2 jours) ;
 *  - engagement total ET vitesse (encouragements par heure : ce qui monte maintenant) ;
 *  - relation (abonnements, auteurs souvent encouragés) ;
 *  - régularité du bâtisseur (preuve rattachée à un ARC, numéro de jour, élan du profil) ;
 *  - qualité (média, texte détaillé, validation par une page pro, créateur vérifié) ;
 *  - goûts appris (formats, états, auteurs, hashtags, recherches), y compris les
 *    signaux négatifs (« masquer », « ne plus voir ») ;
 *  - découverte : un coup de pouce aux preuves toutes neuves de nouveaux créateurs ;
 *  - déjà vu → descend ; ses propres preuves → plus bas.
 */
export function rankFeed(items, { user, followedIds = new Set(), badgeSets } = {}) {
  const isFata = (id) => Boolean(badgeSets?.fata?.has(id));
  if (!items.length) return [];
  const prefs = loadPrefs(user?.id);
  const authors = authorScores(items);
  const role = viewerRole(user);
  const now = Date.now();
  const topQueries = Object.entries(prefs.queries || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  const coldStart = (prefs.interactionCount || 0) < 15;

  const scored = items.map((c) => {
    const ageH = Math.max(0, (now - Date.parse(c.created_at || now)) / 36e5);
    const enc = Number(c.encouragements_count) || 0;
    const views = Number(c.views) || 0;
    const recency = Math.exp(-ageH / 60);
    const engagement = Math.min(4.2, Math.log1p(enc) * 1.15 + Math.log1p(views) * 0.42) * (0.6 + recency * 0.4);
    const velocity = Math.min(2.5, Math.log1p((enc * 3 + views * 0.15) / (ageH + 2)) * 1.6);
    const follow = followedIds.has(c.user_id) ? 2 : 0;
    const verified = badgeSets && (badgeSets.creators.has(c.user_id) || badgeSets.staff.has(c.user_id)) ? 1.2 : 0;
    const validation = c.is_validated_pro ? 2.2 : 0;
    const author = (authors.get(c.user_id) || 0) * 0.6;
    // Régularité : une preuve « Jour N » d'un ARC raconte une progression.
    const consistency = (c.arc_id ? 0.35 : 0) + (Number(c.day_number) > 1 ? Math.min(0.6, Math.log1p(c.day_number) * 0.18) : 0) + Math.min(0.8, Number(c.users?.momentum_score || 0) * 0.08);
    const quality = (c.media_url || c.media_urls?.length ? 0.45 : 0) + (String(c.description || '').length > 140 ? 0.25 : 0) + (c.title ? 0.05 : 0);
    const tags = (c.tags || []).map((t) => String(t).toLowerCase());
    const typePref = (prefs.types[c.type] || 0) * 0.45;
    const statePref = (prefs.states[c.state] || 0) * 0.25;
    const userPref = (prefs.users[c.user_id] || 0) * 0.7;
    const tagPref = tags.reduce((n, t) => n + (prefs.tags[t] || 0) * 0.55, 0);
    const text = `${c.title || ''} ${c.description || ''}`.toLowerCase();
    const queryPref = topQueries.reduce((n, [tok, sc]) => n + (text.includes(tok) || tags.includes(tok) ? sc * 0.35 : 0), 0);
    const seenAt = prefs.seen?.[c.id];
    const seen = seenAt ? (now - seenAt < 864e5 ? 1.6 : 0.6) : 0;
    const discovery = ageH < 8 && enc < 3 && !follow ? 0.7 : 0;
    const own = user && c.user_id === user.id ? 2.5 : 0;
    const taste = coldStart ? (typePref + statePref + userPref + tagPref) * 0.5 : typePref + statePref + userPref + tagPref + queryPref;
    const base = recency * 2.2 + engagement + velocity + follow + verified + validation + author + consistency + quality + roleBoost(c, role) + taste + discovery - seen - own;
    // Lauréats Fata ×5 ; plan du créateur (visibilité promise par les abonnements).
    const plan = String(c.users?.plan || '').toLowerCase();
    const planBoost = c.users?.plan_status === 'active' ? PLAN_BOOST[plan] || 1 : 1;
    const score = (base + Math.random() * 0.08) * (isFata(c.user_id) ? 5 : 1) * planBoost;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return diversify(scored);
}
