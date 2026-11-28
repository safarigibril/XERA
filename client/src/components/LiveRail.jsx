import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from './ui';
import { displayName } from '../lib/format';
import Icon from './Icon';
import { getLiveStreams } from '../services/live';

/** Bandeau des lives en cours (accueil, explorer). Rien n'est affiché sans live. */
export default function LiveRail({ title = 'En direct' }) {
  const [lives, setLives] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => getLiveStreams().then((l) => alive && setLives(l)).catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!lives.length) return null;
  return (
    <section className="live-rail-wrap">
      <div className="section-title" style={{ marginTop: 6 }}>
        <h2>
          <span className="live-dot" /> {title}
        </h2>
      </div>
      <div className="live-stories">
        {lives.map((l) => (
          <Link key={l.id} to={`/live/${l.id}`} className="live-story" title={l.title}>
            <span className="live-story-ring">
              <Avatar user={l.users || {}} size={64} />
            </span>
            <span className="live-story-badge">LIVE</span>
            <span className="live-story-name">{displayName(l.users)}</span>
            <span className="live-story-meta">
              <Icon name="visibility" size={13} /> {l.viewer_count || 0}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
