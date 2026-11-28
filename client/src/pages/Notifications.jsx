import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/Shell';
import Icon from '../components/Icon';
import { Avatar, Button, EmptyState, Skeleton } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useUi } from '../contexts/UiContext';
import { displayName, timeAgo } from '../lib/format';
import { fetchFollowing, fetchNotifications, markAllNotificationsRead, setFollow } from '../services/data';

/** Petite pastille en bas de la photo : icône + couleur du type (comme sur les autres réseaux). */
const TYPE = {
  follow: { icon: 'person_add', tone: 'follow' },
  encouragement: { icon: 'local_fire_department', tone: 'fire' },
  comment: { icon: 'chat_bubble', tone: 'violet' },
  announcement_reply: { icon: 'chat_bubble', tone: 'violet' },
  message: { icon: 'mail', tone: 'violet' },
  milestone: { icon: 'task_alt', tone: 'success' },
  fata: { icon: 'emoji_events', tone: 'gold' },
  stream: { icon: 'sensors', tone: 'live' },
  live: { icon: 'sensors', tone: 'live' },
  live_start: { icon: 'sensors', tone: 'live' },
  collaboration: { icon: 'handshake', tone: 'success' },
  badge: { icon: 'verified', tone: 'gold' },
  payment: { icon: 'payments', tone: 'success' },
};
const typeOf = (n) => TYPE[n.type] || { icon: 'notifications', tone: 'violet' };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Lien interne de la notification (y compris les anciens formats de l'ancienne interface). */
function target(n) {
  const link = String(n.link || '');
  const id = link.match(UUID)?.[0];
  if (/^\/?(stream|live)\b|stream\.html/.test(link) && id) return `/live/${id}`;
  if (/^\/?profile\b|profile\.html/.test(link) && id) return `/u/${id}`;
  if (/content=|\/share\//.test(link) && id) return `/share/${id}`;
  if (link.startsWith('/')) return link;
  const legacyPage = link.match(/^(?:https?:\/\/[^/]+)?\/?([a-z-]+)\.html(\?.*)?$/i);
  if (legacyPage) return `/${legacyPage[1] === 'index' ? '' : legacyPage[1]}${legacyPage[2] || ''}`;
  if (n.type === 'fata') return '/fata';
  if (n.actor?.id) return `/u/${n.actor.id}`;
  return null;
}

/** Met le nom de l'auteur en gras dans le message (« Amani a commencé à vous suivre »). */
function Message({ n }) {
  const text = n.message || n.title || 'Nouvelle activité';
  const name = n.actor ? displayName(n.actor) : null;
  const raw = String(n.actor?.name || '').trim();
  const who = [name, raw].find((v) => v && text.startsWith(v));
  if (!who) return <span>{text}</span>;
  return (
    <span>
      <strong>{who}</strong>
      {text.slice(who.length)}
    </span>
  );
}

function bucket(date) {
  const d = Date.parse(date || '');
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (d >= start.getTime()) return 'Aujourd’hui';
  if (d >= start.getTime() - 6 * 864e5) return 'Cette semaine';
  return 'Plus tôt';
}

export default function Notifications() {
  const { user } = useAuth();
  const { toast } = useUi();
  const [items, setItems] = useState(null);
  const [following, setFollowing] = useState(new Set());
  const [tab, setTab] = useState('all');

  useEffect(() => {
    fetchNotifications(user.id)
      .then(setItems)
      .catch(() => setItems([]));
    fetchFollowing(user.id)
      .then((ids) => setFollowing(new Set(ids)))
      .catch(() => {});
  }, [user.id]);

  const unread = (items || []).filter((n) => !n.read).length;
  const shown = useMemo(() => {
    const list = (items || []).filter((n) => tab === 'all' || (tab === 'unread' ? !n.read : n.type === 'follow'));
    const groups = [];
    for (const n of list) {
      const b = bucket(n.created_at);
      if (!groups.length || groups[groups.length - 1][0] !== b) groups.push([b, []]);
      groups[groups.length - 1][1].push(n);
    }
    return groups;
  }, [items, tab]);

  async function readAll() {
    await markAllNotificationsRead(user.id);
    setItems((list) => list.map((n) => ({ ...n, read: true })));
  }

  async function followBack(e, actor) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await setFollow(user.id, actor.id, true);
      setFollowing((s) => new Set([...s, actor.id]));
      toast('success', `Vous suivez ${displayName(actor)}`);
    } catch (err) {
      toast('error', 'Action impossible', err.message);
    }
  }

  return (
    <>
      <TopBar
        title="Notifications"
        actions={
          unread > 0 && (
            <Button size="sm" variant="ghost" icon="done_all" onClick={readAll}>
              Tout lire
            </Button>
          )
        }
      />
      <main className="main">
        <div className="chip-row" role="tablist" aria-label="Filtrer les notifications" style={{ marginBottom: 12 }}>
          {[
            ['all', 'Toutes'],
            ['unread', `Non lues${unread ? ` (${unread})` : ''}`],
            ['follow', 'Abonnés'],
          ].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`chip${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>

        {items === null ? (
          <div className="stack">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={68} radius={14} />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState art="empty" icon="notifications" title="Tout est calme" text="Les encouragements, abonnements et lives apparaîtront ici." />
        ) : (
          shown.map(([label, list]) => (
            <section key={label} className="notif-group">
              <h2 className="notif-group-title">{label}</h2>
              <div className="list card notif-list">
                {list.map((n) => {
                  const to = target(n);
                  const t = typeOf(n);
                  const canFollowBack = n.type === 'follow' && n.actor && !following.has(n.actor.id) && n.actor.id !== user.id;
                  const inner = (
                    <>
                      <span className="notif-face">
                        {n.actor ? (
                          <Avatar user={n.actor} size={52} />
                        ) : (
                          <span className={`notif-face-icon is-${t.tone}`}>
                            <Icon name={t.icon} filled />
                          </span>
                        )}
                        {n.actor && (
                          <span className={`notif-type is-${t.tone}`} aria-hidden="true">
                            <Icon name={t.icon} size={13} filled />
                          </span>
                        )}
                      </span>
                      <span className="grow notif-text">
                        <Message n={n} />
                        <span className="sub">{timeAgo(n.created_at)}</span>
                      </span>
                      {canFollowBack ? (
                        <button className="btn btn--sm btn--primary notif-follow" onClick={(e) => followBack(e, n.actor)}>
                          Suivre en retour
                        </button>
                      ) : (
                        !n.read && <span className="notif-dot" aria-label="Non lue" />
                      )}
                    </>
                  );
                  const cls = `list-item notif-item${n.read ? '' : ' is-unread'}`;
                  return to ? (
                    <Link key={n.id} to={to} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={n.id} className={cls}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>
    </>
  );
}
