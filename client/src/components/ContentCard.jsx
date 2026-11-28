import { useEffect, useRef, useState } from 'react';
import { recordInteraction } from '../services/feedAlgo';
import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { Avatar, Badge, Button, IconButton, Sheet, UserName } from './ui';
import { compact, displayName, STATE_META, timeAgo } from '../lib/format';
import { countView, deleteContent, isEncouraged, toggleEncouragement, updateContent } from '../services/data';
import { useAuth } from '../contexts/AuthContext';
import { useUi } from '../contexts/UiContext';
import { PUBLIC_SITE } from '../services/api';
import { SUPER_ADMIN_ID, canReceiveSupport } from '../services/badges';
import { openSupport } from '../services/payments';
import { setTraceValidation } from '../services/pages';
import { useMyPages } from '../hooks/useMyPages';
import MediaViewer from './MediaViewer';
import { supabase } from '../services/supabase';
import { REPORT_REASONS, feedPrefs, reportContent } from '../services/feed';

export function StateBadge({ state }) {
  const meta = STATE_META[state];
  if (!meta) return null;
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

/** Hashtags d'état de l'ADN XERA (ancienne interface : #Victoire, #Bloqué, #Pause). */
const STATE_TAG = { success: '#Victoire', failure: '#Bloqué', pause: '#Pause' };

/** Vidéo du fil : se lance en muet quand elle est visible, se met en pause sinon. */
function FeedVideo({ src, poster }) {
  const ref = useRef();
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const v = ref.current;
    if (!v || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: [0, 0.6] },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <div className="post-video">
      <video ref={ref} src={src} poster={poster || undefined} muted={muted} loop playsInline preload="metadata" controls={!muted} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="post-video-sound" onClick={(e) => (e.stopPropagation(), setMuted((m) => !m))} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
        <Icon name={muted ? 'volume_off' : 'volume_up'} size={18} />
      </button>
    </div>
  );
}

/**
 * Carte d'une preuve (trace de progression) dans le fil.
 * `onHide(content, why)` : la carte est retirée du fil (masquée, auteur masqué, supprimée…).
 */
export default function ContentCard({ content, encouraged, milestone, index = 0, allowValidation = false, onHide }) {
  const { user } = useAuth();
  const { toast } = useUi();
  const navigate = useNavigate();
  const [on, setOn] = useState(Boolean(encouraged));
  const [busyEnc, setBusyEnc] = useState(false);

  // État réel relu depuis la base (après actualisation, il reste « encouragé »).
  useEffect(() => {
    if (encouraged !== undefined) {
      setOn(Boolean(encouraged));
      return undefined;
    }
    if (!user) return undefined;
    let alive = true;
    isEncouraged(user.id, content.id).then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, [user, content.id, encouraged]);
  const [count, setCount] = useState(Number(content.encouragements_count ?? content.encouragements ?? 0));
  const [expanded, setExpanded] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(null);
  const [editing, setEditing] = useState(null);
  const [local, setLocal] = useState({});
  const [saved, setSaved] = useState(() => feedPrefs.saved(user?.id).has(content.id));
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);
  const mine = user && user.id === content.user_id && !content.page;
  const isAdmin = user?.id === SUPER_ADMIN_ID;

  function gone(why) {
    setRemoved(true);
    onHide?.(content, why);
  }

  async function saveEdit(e) {
    e.preventDefault();
    try {
      await updateContent(content.id, { title: editing.title.trim(), description: editing.description.trim(), state: editing.state });
      setLocal({ title: editing.title.trim(), description: editing.description.trim(), state: editing.state });
      setEditing(null);
      toast('success', 'Preuve modifiée');
    } catch (err) {
      toast('error', 'Modification impossible', err.message);
    }
  }
  async function remove() {
    setMenu(false);
    if (!window.confirm('Supprimer définitivement cette preuve ? Cette action est irréversible.')) return;
    try {
      await deleteContent(content.id);
      gone('deleted');
      toast('success', 'Preuve supprimée');
    } catch (err) {
      toast('error', 'Suppression impossible', err.message);
    }
  }
  const [validation, setValidation] = useState({ valid: Boolean(content.is_validated_pro), pageId: content.validated_by_page_id || content.validator?.id || null, validator: content.validator || null });
  // Sceau de validation : le propriétaire d'une page pro peut valider la preuve d'un autre membre.
  const myPages = useMyPages(allowValidation && user && content.author_type !== 'PAGE_PRO' && user.id !== content.user_id ? user.id : null);

  async function toggleSeal(page) {
    const granting = !(validation.valid && validation.pageId === page.id);
    try {
      await setTraceValidation(content.id, page.id, granting);
      setValidation(granting ? { valid: true, pageId: page.id, validator: { id: page.id, name: page.name, slug: page.slug } } : { valid: false, pageId: null, validator: null });
      toast('success', granting ? 'Sceau accordé' : 'Validation révoquée', granting ? `Preuve validée par ${page.name}.` : undefined);
    } catch (e) {
      toast('error', 'Action impossible', e.message);
    }
  }

  async function adminHide() {
    setMenu(false);
    const reason = window.prompt('Motif du masquage (visible par l’équipe)');
    if (reason === null) return;
    const { error } = await supabase
      .from('content')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_reason: reason.trim() || null, deleted_by: user.id })
      .eq('id', content.id);
    if (error) return toast('error', 'Masquage impossible', error.message);
    gone('moderated');
    toast('success', 'Contenu masqué', 'Il n’est plus visible publiquement.');
  }
  const isPagePost = content.author_type === 'PAGE_PRO' && content.page;
  const author = isPagePost ? { id: content.page.id, name: content.page.name, avatar: content.page.avatar_url } : content.users || {};
  const authorName = isPagePost ? content.page.name : displayName(content.users);
  const authorLink = isPagePost ? `/page/${content.page.slug || content.page.id}` : `/u/${content.user_id}`;
  const arc = content.arcs;
  const media = content.media_url || content.media_urls?.[0];
  const isVideo = content.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(media || '');
  const long = (content.description || '').length > 220;
  const cardRef = useRef();
  const url = `${PUBLIC_SITE}/share/${content.id}`;

  // Vue prolongée (60 % visible pendant 1,5 s) : signal « view » pour l'algorithme.
  useEffect(() => {
    if (!user || !cardRef.current || !('IntersectionObserver' in window)) return undefined;
    let timer;
    const io = new IntersectionObserver(
      ([e]) => {
        clearTimeout(timer);
        if (e.isIntersecting) {
          timer = setTimeout(() => {
            countView(content.id);
            recordInteraction(user.id, content, 'view');
            io.disconnect();
          }, 1500);
        }
      },
      { threshold: 0.6 },
    );
    io.observe(cardRef.current);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, content.id]);

  async function toggle(force) {
    if (!user) {
      toast('info', 'Connectez-vous', 'Créez un compte pour encourager les bâtisseurs.');
      return;
    }
    if (busyEnc) return;
    const next = force ?? !on;
    if (next === on) return;
    if (next) recordInteraction(user.id, content, 'like');
    setOn(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setBusyEnc(true);
    try {
      const res = await toggleEncouragement(user.id, content.id);
      // La base fait foi : état et total renvoyés par toggle_courage.
      if (res) {
        setOn(res.encouraged);
        setCount(res.count);
      }
    } catch {
      setOn(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      toast('error', 'Action impossible', 'Réessayez dans un instant.');
    } finally {
      setBusyEnc(false);
    }
  }

  /** Double-tap sur le média : encourage (sans jamais retirer l'encouragement). */
  function onMediaTap(open) {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      setBurst((b) => b + 1);
      toggle(true);
      return;
    }
    lastTap.current = now;
    if (open) setTimeout(() => lastTap.current && Date.now() - lastTap.current >= 290 && open(), 300);
  }

  async function share() {
    setMenu(false);
    try {
      if (navigator.share) await navigator.share({ title: content.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('success', 'Lien copié');
      }
    } catch {
      /* partage annulé */
    }
  }
  async function copyLink() {
    setMenu(false);
    try {
      await navigator.clipboard.writeText(url);
      toast('success', 'Lien copié');
    } catch {
      toast('error', 'Copie impossible', url);
    }
  }
  function toggleSaved() {
    setMenu(false);
    const now = feedPrefs.toggle(user?.id, 'saved', content.id);
    setSaved(now);
    toast('success', now ? 'Preuve enregistrée' : 'Retirée des enregistrements', now ? 'Retrouvez-la dans le filtre « Enregistrés ».' : undefined);
  }
  function hidePost() {
    setMenu(false);
    feedPrefs.toggle(user?.id, 'hidden', content.id);
    if (user) recordInteraction(user.id, content, 'dislike');
    gone('hidden');
    toast('success', 'Publication masquée', 'Vous ne la verrez plus dans votre fil.');
  }
  function muteAuthor() {
    setMenu(false);
    feedPrefs.toggle(user?.id, 'muted', content.user_id);
    if (user) {
      recordInteraction(user.id, content, 'dislike');
      recordInteraction(user.id, content, 'dislike');
    }
    gone('muted');
    toast('success', `${authorName} masqué`, 'Ses preuves n’apparaîtront plus dans votre fil.');
  }
  async function sendReport(e) {
    e.preventDefault();
    try {
      await reportContent({ userId: user.id, content, reason: reporting.reason, note: reporting.note.trim() });
      setReporting(null);
      toast('success', 'Signalement envoyé', 'L’équipe XERA1 va examiner cette publication.');
    } catch (err) {
      toast('error', 'Signalement impossible', err.message);
    }
  }

  if (removed) return null;
  content = { ...content, ...local };
  const gallery = [...new Set([media, ...(content.media_urls || [])].filter(Boolean))];
  const tags = [...new Set([...(content.tags || []), ...(content.hashtags || [])].map((t) => String(t || '').replace(/^#/, '').trim()).filter(Boolean))].slice(0, 6);

  return (
    <article ref={cardRef} className={`post card is-${content.state || 'pause'}`} style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
      <header className="post-head">
        <Link to={authorLink} className="row grow" style={{ minWidth: 0 }}>
          <Avatar user={author} size={44} ring={on} />
          <div className="grow" style={{ minWidth: 0 }}>
            {isPagePost ? (
              <span className="row post-author" style={{ gap: 6 }}>
                {author.name}
                {content.page.is_verified && <img src="/icons/verify_page.svg" alt="Page vérifiée" style={{ width: 16, height: 16 }} />}
                <span className="pro-tag">PRO</span>
              </span>
            ) : (
              <UserName user={author} className="post-author" />
            )}
            <div className="post-meta">
              {content.users?.title && !isPagePost && <span className="post-meta-title">{content.users.title}</span>}
              {content.users?.title && !isPagePost && <span aria-hidden="true">·</span>}
              <span>{timeAgo(content.created_at)}</span>
            </div>
          </div>
        </Link>
        {content.day_number != null && content.day_number > 0 && (
          <span className="post-day" title={`Jour ${content.day_number} du projet`}>
            <small>Jour</small>
            {content.day_number}
          </span>
        )}
        <IconButton icon="more_horiz" label="Options de la publication" className="post-more" onClick={() => setMenu(true)} />
      </header>

      <div className="post-statebar">
        <StateBadge state={content.state} />
        {arc?.title && (
          <Link to={`/arc/${arc.id}`} className="post-arc">
            <Icon name="flag" size={16} />
            <span>{arc.title}</span>
            <Icon name="chevron_right" size={16} />
          </Link>
        )}
      </div>

      <div className="post-body">
        {content.title && <h3>{content.title}</h3>}
        {content.description && <p className={long && !expanded ? 'clamp' : ''}>{content.description}</p>}
        {long && (
          <button className="more" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Voir moins' : 'Voir plus'}
          </button>
        )}
        <div className="post-tags">
          {STATE_TAG[content.state] && <span className="post-tag is-state">{STATE_TAG[content.state]}</span>}
          {tags.map((t) => (
            <Link key={t} to={`/explorer?q=${encodeURIComponent(t)}`} className="post-tag">
              #{t}
            </Link>
          ))}
        </div>
        {validation.valid && validation.validator && (
          <Link to={`/page/${validation.validator.slug || validation.validator.id}`} className="post-seal">
            <Icon name="workspace_premium" filled size={18} /> Validé par {validation.validator.name}
          </Link>
        )}
        {milestone && (
          <div className="post-milestone">
            <Icon name="task_alt" filled size={18} /> Jalon validé
          </div>
        )}
      </div>

      {media && (
        <div className={`post-media${gallery.length > 1 && !isVideo ? ' is-gallery' : ''}${gallery.length === 3 && !isVideo ? ' is-three' : ''}`} onClick={isVideo ? () => onMediaTap() : undefined}>
          {isVideo ? (
            <FeedVideo src={media} poster={content.metadata?.poster_url} />
          ) : (
            gallery.slice(0, 4).map((src, i) => (
              <button key={src} type="button" className="post-media-item" onClick={() => onMediaTap(() => setViewer(src))} aria-label="Voir la photo en grand (double-tap pour encourager)">
                <img src={src} alt={content.title || 'Preuve'} loading="lazy" decoding="async" />
                {i === 3 && gallery.length > 4 && <span className="post-media-more">+{gallery.length - 4}</span>}
              </button>
            ))
          )}
          {burst > 0 && (
            <span key={burst} className="post-burst" aria-hidden="true">
              <Icon name="local_fire_department" filled size={84} />
            </span>
          )}
        </div>
      )}

      {myPages.length > 0 && (
        <div className="seal-actions">
          {myPages.map((page) => {
            const sealed = validation.valid && validation.pageId === page.id;
            return (
              <button key={page.id} className={`seal-btn${sealed ? ' is-on' : ''}`} onClick={() => toggleSeal(page)}>
                <Icon name={sealed ? 'remove_done' : 'workspace_premium'} filled={!sealed} size={18} />
                {sealed ? `Révoquer la validation (${page.name})` : `Accorder le sceau de ${page.name}`}
              </button>
            );
          })}
        </div>
      )}
      <MediaViewer src={viewer} alt={content.title} onClose={() => setViewer(null)} />

      {(count > 0 || content.views > 0) && (
        <div className="post-counts">
          {count > 0 && (
            <span>
              <span className="post-counts-fire"><Icon name="local_fire_department" filled size={13} /></span>
              {compact(count)} encouragement{count > 1 ? 's' : ''}
            </span>
          )}
          <span className="grow" />
          {content.views > 0 && <span>{compact(content.views)} vue{content.views > 1 ? 's' : ''}</span>}
        </div>
      )}

      <footer className="post-actions">
        <button className={`react${on ? ' is-on' : ''}`} onClick={() => toggle()} aria-pressed={on}>
          <Icon name="local_fire_department" filled={on} />
          <span>{on ? 'Encouragé' : 'Encourager'}</span>
        </button>
        {arc?.id ? (
          <Link className="react" to={`/arc/${arc.id}`}>
            <Icon name="timeline" />
            <span>Parcours</span>
          </Link>
        ) : (
          <Link className="react" to={authorLink}>
            <Icon name="person" />
            <span>Profil</span>
          </Link>
        )}
        <button className="react react--share" onClick={share} aria-label="Partager">
          <Icon name="ios_share" />
          <span>Partager</span>
        </button>
        <button className={`react react--icon${saved ? ' is-saved' : ''}`} onClick={toggleSaved} aria-pressed={saved} aria-label={saved ? 'Retirer des enregistrements' : 'Enregistrer'}>
          <Icon name="bookmark" filled={saved} />
        </button>
        {!isPagePost && content.users && user?.id !== content.user_id && canReceiveSupport(content.users) && (
          <IconButton
            icon="favorite"
            label="Soutenir ce créateur"
            className="post-support"
            onClick={async () => {
              if (!user) return toast('info', 'Connectez-vous', 'Créez un compte pour soutenir ce créateur.');
              try {
                await openSupport({ creatorId: content.user_id, creatorName: displayName(content.users), onSuccess: () => toast('success', 'Soutien envoyé', 'Merci !') });
              } catch (e) {
                toast('error', 'Soutien indisponible', e.message);
              }
            }}
          />
        )}
      </footer>

      {/* ------------------------------------------------ Options */}
      <Sheet open={menu} onClose={() => setMenu(false)} title="Options">
        <div className="list post-options">
          <button className="list-item" onClick={toggleSaved}>
            <Icon name="bookmark" filled={saved} /> <span className="grow">{saved ? 'Retirer des enregistrements' : 'Enregistrer la preuve'}</span>
          </button>
          <button className="list-item" onClick={copyLink}>
            <Icon name="content_copy" /> <span className="grow">Copier le lien</span>
          </button>
          <button className="list-item" onClick={share}>
            <Icon name="ios_share" /> <span className="grow">Partager…</span>
          </button>
          {arc?.id && (
            <button className="list-item" onClick={() => (setMenu(false), navigate(`/arc/${arc.id}`))}>
              <Icon name="timeline" /> <span className="grow">Voir tout le parcours « {arc.title} »</span>
            </button>
          )}
          <button className="list-item" onClick={() => (setMenu(false), navigate(authorLink))}>
            <Icon name="person" /> <span className="grow">Voir le profil de {authorName}</span>
          </button>
          {mine && (
            <>
              <div className="post-options-sep" />
              <button className="list-item" onClick={() => { setMenu(false); setEditing({ title: content.title || '', description: content.description || '', state: content.state || 'success' }); }}>
                <Icon name="edit" /> <span className="grow">Modifier ma preuve</span>
              </button>
              <button className="list-item is-danger" onClick={remove}>
                <Icon name="delete" /> <span className="grow">Supprimer ma preuve</span>
              </button>
            </>
          )}
          {!mine && user && (
            <>
              <div className="post-options-sep" />
              <button className="list-item" onClick={hidePost}>
                <Icon name="visibility_off" /> <span className="grow">Masquer cette publication</span>
              </button>
              {!isPagePost && (
                <button className="list-item" onClick={muteAuthor}>
                  <Icon name="person_off" /> <span className="grow">Ne plus voir les preuves de {authorName}</span>
                </button>
              )}
              <button className="list-item is-danger" onClick={() => (setMenu(false), setReporting({ reason: 'spam', note: '' }))}>
                <Icon name="flag" /> <span className="grow">Signaler la publication</span>
              </button>
            </>
          )}
          {isAdmin && !mine && (
            <>
              <div className="post-options-sep" />
              <span className="post-options-label">Administration</span>
              <button className="list-item" onClick={adminHide}>
                <Icon name="shield_person" /> <span className="grow">Masquer pour tout le monde (modération)</span>
              </button>
              <button className="list-item is-danger" onClick={remove}>
                <Icon name="delete" /> <span className="grow">Supprimer définitivement</span>
              </button>
            </>
          )}
        </div>
      </Sheet>

      <Sheet open={Boolean(reporting)} onClose={() => setReporting(null)} title="Signaler la publication">
        {reporting && (
          <form className="stack" onSubmit={sendReport}>
            <div className="list">
              {REPORT_REASONS.map(([k, label]) => (
                <label key={k} className="list-item" style={{ cursor: 'pointer' }}>
                  <input type="radio" name="report" checked={reporting.reason === k} onChange={() => setReporting({ ...reporting, reason: k })} />
                  <span className="grow">{label}</span>
                </label>
              ))}
            </div>
            <textarea className="textarea" placeholder="Précisions (facultatif)" maxLength={500} value={reporting.note} onChange={(e) => setReporting({ ...reporting, note: e.target.value })} aria-label="Précisions" />
            <Button variant="primary" block icon="flag">Envoyer le signalement</Button>
          </form>
        )}
      </Sheet>

      {mine && (
        <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title="Modifier la preuve">
          {editing && (
            <form className="stack" onSubmit={saveEdit}>
              <div className="tabs">
                {Object.entries(STATE_META).map(([k, m]) => (
                  <button key={k} type="button" className={`tab${editing.state === k ? ' is-active' : ''}`} onClick={() => setEditing({ ...editing, state: k })}>
                    <Icon name={m.icon} /> {m.label}
                  </button>
                ))}
              </div>
              <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={120} required aria-label="Titre" />
              <textarea className="textarea" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={3000} aria-label="Texte" />
              <Button variant="primary" block icon="save">Enregistrer</Button>
            </form>
          )}
        </Sheet>
      )}
    </article>
  );
}
