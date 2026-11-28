import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/Shell';
import Icon from '../components/Icon';
import ContentCard from '../components/ContentCard';
import AdCard from '../components/AdCard';
import { Avatar, CardSkeleton, EmptyState, IconLink } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useUi } from '../contexts/UiContext';
import { fetchEncouraged, fetchFeed, fetchFollowing } from '../services/data';
import { useUnread } from '../hooks/useUnread';
import Landing from './Landing';
import LiveRail from '../components/LiveRail';
import Announcements from '../components/Announcements';
import { rankFeed } from '../services/feedAlgo';
import { loadBadgeSets } from '../services/badges';
import { countNewer, feedPrefs, fetchActiveAds, fetchFeedPage, fetchSavedContent, interleaveAds } from '../services/feed';
import { displayName } from '../lib/format';

/** Filtres du fil. `ranked` : classé par l'algorithme XERA1 (sinon chronologique). */
const FILTERS = [
  { key: 'all', label: 'Pour vous', icon: 'dynamic_feed', ranked: true },
  { key: 'recent', label: 'Récent', icon: 'schedule' },
  { key: 'following', label: 'Abonnements', icon: 'group', auth: true },
  { key: 'success', label: '#Victoire', icon: 'trending_up' },
  { key: 'failure', label: '#Bloqué', icon: 'report' },
  { key: 'pause', label: '#Pause', icon: 'pause_circle' },
  { key: 'video', label: 'Vidéos', icon: 'movie' },
  { key: 'saved', label: 'Enregistrés', icon: 'bookmark', auth: true },
];
const PAGE = 20;

export default function Home() {
  const { user: me, loading } = useAuth();
  if (loading) return <main className="main" aria-busy="true" />;
  if (!me) return <Landing />;
  return <Feed />;
}

/** Bloc « Quoi de neuf ? » en tête du fil (façon LinkedIn, vocabulaire XERA1). */
function Composer({ user }) {
  return (
    <section className="card feed-composer">
      <div className="feed-composer-top">
        <Link to={`/u/${user.id}`} aria-label="Mon profil">
          <Avatar user={user} size={46} />
        </Link>
        <Link to="/creer/preuve" className="feed-composer-input">
          Qu’avez-vous construit aujourd’hui, {displayName(user).split(' ')[0]} ?
        </Link>
      </div>
      <div className="feed-composer-actions">
        <Link to="/creer/preuve" className="feed-composer-action is-success">
          <Icon name="trending_up" /> Preuve du jour
        </Link>
        <Link to="/creer/preuve" className="feed-composer-action is-media">
          <Icon name="photo_library" /> Photo / vidéo
        </Link>
        <Link to="/creer/arc" className="feed-composer-action is-arc">
          <Icon name="flag" /> Nouvel ARC
        </Link>
        <Link to="/live/nouveau" className="feed-composer-action is-live">
          <Icon name="live_tv" /> Live
        </Link>
      </div>
    </section>
  );
}

function Feed() {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useUi();
  const unread = useUnread(user);
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [encouraged, setEncouraged] = useState(new Set());
  const [ads, setAds] = useState([]);
  const [hiddenAds, setHiddenAds] = useState(new Set());
  const [fresh, setFresh] = useState(0);
  const [reload, setReload] = useState(0);
  const followed = useRef([]);
  const sentinel = useRef();
  const topRef = useRef();
  const newestAt = useRef(null);
  const meta = FILTERS.find((f) => f.key === filter) || FILTERS[0];

  /** Retire du fil ce que l'utilisateur a masqué (preuves, auteurs). */
  const visible = useCallback(
    (list) => {
      const hidden = feedPrefs.hidden(userId);
      const muted = feedPrefs.muted(userId);
      return list.filter((c) => !hidden.has(c.id) && !muted.has(c.user_id));
    },
    [userId],
  );

  const withEncouraged = useCallback(
    async (list) => {
      if (!userId || !list.length) return;
      const set = await fetchEncouraged(userId, list.map((c) => c.id));
      setEncouraged((prev) => new Set([...prev, ...set]));
    },
    [userId],
  );

  // Publicités XERA1 actives (une fois).
  useEffect(() => {
    fetchActiveAds().then(setAds).catch(() => setAds([]));
  }, []);

  // Première page (à chaque filtre).
  useEffect(() => {
    let alive = true;
    setItems(null);
    setFresh(0);
    setHasMore(false);
    (async () => {
      try {
        let list;
        let raw;
        if (filter === 'saved') {
          raw = await fetchSavedContent(userId);
          list = raw;
        } else if (filter === 'following') {
          followed.current = userId ? await fetchFollowing(userId) : [];
          raw = followed.current.length ? await fetchFeedPage({ userIds: followed.current, limit: PAGE }) : [];
          list = visible(raw);
        } else if (filter === 'all') {
          // « Pour vous » : plus de candidats, classés par l'algorithme XERA1.
          // Candidats : les 60 plus récentes + ce qui marche cette semaine + les dernières des abonnements.
          const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
          const [recent, follows, badgeSets, trending] = await Promise.all([
            fetchFeedPage({ limit: 60 }),
            userId ? fetchFollowing(userId) : [],
            loadBadgeSets(),
            fetchFeed({ order: 'top', since: weekAgo, limit: 30 }).catch(() => []),
          ]);
          const fromFollows = follows.length ? await fetchFeedPage({ userIds: follows.slice(0, 200), limit: 30 }).catch(() => []) : [];
          followed.current = follows;
          raw = recent;
          const pool = [...new Map([...recent, ...trending, ...fromFollows].map((c) => [c.id, c])).values()];
          list = rankFeed(visible(pool), { user, followedIds: new Set(follows), badgeSets });
        } else {
          raw = await fetchFeedPage({ filter: filter === 'recent' ? 'all' : filter, limit: PAGE });
          list = visible(raw);
        }
        if (!alive) return;
        setItems(list);
        const oldest = raw[raw.length - 1]?.created_at || null;
        newestAt.current = raw.reduce((m, c) => (!m || c.created_at > m ? c.created_at : m), null);
        setCursor(oldest);
        setHasMore(filter !== 'saved' && raw.length >= (filter === 'all' ? 60 : PAGE));
        withEncouraged(list);
      } catch {
        if (alive) {
          setItems([]);
          toast('error', 'Fil indisponible', 'Vérifiez votre connexion puis réessayez.');
        }
      }
    })();
    return () => {
      alive = false;
    };
    // `user` complet volontairement exclu : seul l'identifiant compte (évite de
    // recharger tout le fil à chaque mise à jour du profil).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, userId, reload]);

  // Pages suivantes (défilement infini).
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursor) return;
    setLoadingMore(true);
    try {
      const f = filter === 'all' || filter === 'recent' ? 'all' : filter;
      const raw = await fetchFeedPage({ filter: f, before: cursor, limit: PAGE, userIds: filter === 'following' ? followed.current : undefined });
      const seen = new Set((items || []).map((c) => c.id));
      const next = visible(raw).filter((c) => !seen.has(c.id));
      setItems((prev) => [...(prev || []), ...next]);
      setCursor(raw[raw.length - 1]?.created_at || null);
      setHasMore(raw.length >= PAGE);
      withEncouraged(next);
    } catch {
      toast('error', 'Chargement impossible', 'Réessayez dans un instant.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, cursor, filter, items, visible, withEncouraged, toast]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && loadMore(), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  // Nouvelles preuves publiées pendant la lecture (toutes les 60 s, onglet visible).
  useEffect(() => {
    if (filter === 'saved') return undefined;
    const t = setInterval(async () => {
      if (document.hidden || !newestAt.current) return;
      setFresh(await countNewer(newestAt.current).catch(() => 0));
    }, 60000);
    return () => clearInterval(t);
  }, [filter, items]);

  // Masquer / ne plus voir depuis une carte : on nettoie le reste du fil.
  const onHide = useCallback(
    (content, why) => {
      if (why === 'muted') setItems((prev) => (prev || []).filter((c) => c.user_id !== content.user_id));
      else setItems((prev) => (prev || []).filter((c) => c.id !== content.id));
    },
    [],
  );

  function showFresh() {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setReload((r) => r + 1);
  }

  const rows = useMemo(() => {
    if (!items) return [];
    const liveAds = filter === 'saved' ? [] : ads.filter((a) => !hiddenAds.has(a.id));
    return interleaveAds(items, liveAds);
  }, [items, ads, hiddenAds, filter]);

  const empty = {
    following: ['group_add', 'Rien de neuf chez vos abonnements', 'Suivez des bâtisseurs depuis Explorer pour voir leurs avancées ici.'],
    saved: ['bookmark', 'Aucune preuve enregistrée', 'Touchez l’icône signet d’une preuve pour la retrouver ici.'],
    video: ['movie', 'Aucune vidéo pour le moment', 'Montrez votre projet en mouvement : publiez une preuve vidéo.'],
  }[filter] || ['auto_awesome', 'Aucune preuve pour le moment', 'Soyez le premier à partager votre progression.'];

  return (
    <>
      <TopBar
        brand
        title="Accueil"
        actions={
          <>
            <IconLink to="/explorer" icon="search" label="Rechercher" className="mobile-only" />
            <IconLink to="/notifications" icon="notifications" label="Notifications" badge={unread.notifications} className="mobile-only" />
          </>
        }
      />
      <main className="main feed">
        <div ref={topRef} className="feed-head">
          <Composer user={user} />

          <Link to="/fata" className="fata-strip">
            <img src="/icons/fata.webp" alt="" />
            <div className="grow">
              <strong>Challenge Fata × XERA1</strong>
              <span>Trois actions sur XERA1, 6 mois de Fata Pro et un badge à la clé.</span>
            </div>
            <Icon name="chevron_right" />
          </Link>

          <Announcements />
          <LiveRail />

          <div className="feed-filters">
            <div className="chip-row" role="tablist" aria-label="Filtrer le fil">
              {FILTERS.filter((f) => !f.auth || user).map((f) => (
                <button key={f.key} role="tab" aria-selected={filter === f.key} className={`chip${filter === f.key ? ' is-active' : ''} chip--${f.key}`} onClick={() => setFilter(f.key)}>
                  <Icon name={f.icon} filled={filter === f.key} />
                  {f.label}
                </button>
              ))}
            </div>
            <button className="icon-btn feed-refresh" onClick={() => setReload((r) => r + 1)} aria-label="Actualiser le fil" title="Actualiser">
              <Icon name="refresh" />
            </button>
          </div>
          {meta.ranked && <p className="feed-hint"><Icon name="insights" size={15} /> Classé pour vous selon vos encouragements, vos abonnements et l’élan des projets.</p>}
        </div>

        {fresh > 0 && (
          <button className="feed-fresh" onClick={showFresh}>
            <Icon name="arrow_upward" size={18} /> {fresh > 9 ? '9+' : fresh} nouvelle{fresh > 1 ? 's' : ''} preuve{fresh > 1 ? 's' : ''}
          </button>
        )}

        {items === null ? (
          <div className="stack">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            art="empty"
            icon={empty[0]}
            title={empty[1]}
            text={empty[2]}
            action={
              filter !== 'saved' && (
                <Link to="/creer/preuve" className="btn btn--primary">
                  <Icon name="add" /> Publier une preuve
                </Link>
              )
            }
          />
        ) : (
          <div className="feed-list">
            {rows.map((row, i) =>
              row.kind === 'ad' ? (
                <AdCard key={row.key} ad={row.ad} onHide={(ad) => setHiddenAds((s) => new Set([...s, ad.id]))} />
              ) : (
                <ContentCard key={row.key} content={row.content} index={i} encouraged={encouraged.has(row.content.id)} onHide={onHide} />
              ),
            )}
          </div>
        )}

        {hasMore && (
          <div ref={sentinel} className="feed-more">
            {loadingMore ? <span className="spinner" /> : <button className="btn btn--sm" onClick={loadMore}>Voir plus de preuves</button>}
          </div>
        )}
        {items?.length > 0 && !hasMore && filter !== 'saved' && (
          <div className="feed-end">
            <span className="feed-end-line" />
            <span>
              <Icon name="task_alt" size={16} /> Vous êtes à jour
            </span>
            <span className="feed-end-line" />
          </div>
        )}
      </main>
    </>
  );
}
