import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { AD_THEMES, trackAd } from '../services/feed';

const host = (url) => {
  try {
    return url?.startsWith('/') ? 'xera1.xyz' : new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Visuel de repli (sans image) : dégradé du thème + trajectoire XERA1 qui monte. */
function AdArt({ ad, theme }) {
  return (
    <div className="ad-art" style={{ '--ad-a': theme.a, '--ad-b': theme.b }}>
      <svg viewBox="0 0 600 260" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="0,150 90,138 170,126 250,92 330,100 410,66 490,48 600,18" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        {[[90, 138], [250, 92], [410, 66], [600, 18]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="8" fill="#fff" opacity=".85" />
        ))}
      </svg>
      <div className="ad-art-text">
        <span className="ad-art-eyebrow">{ad.tagline || 'XERA1'}</span>
        <strong>{ad.title}</strong>
      </div>
    </div>
  );
}

/**
 * Publicité XERA1 dans le fil, mise en page façon LinkedIn (en-tête annonceur,
 * texte, grand visuel, barre titre + bouton) avec l'ADN XERA1 (liseré d'état,
 * trajectoire, noir profond). `preview` = aperçu dans l'admin (pas de compteurs).
 */
export default function AdCard({ ad, preview = false, onHide }) {
  const theme = AD_THEMES[ad.theme] || AD_THEMES.violet;
  const ref = useRef();
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const long = (ad.body || '').length > 200;

  useEffect(() => {
    if (preview || !ad.id || !ref.current || !('IntersectionObserver' in window)) return undefined;
    let t;
    const io = new IntersectionObserver(
      ([e]) => {
        clearTimeout(t);
        if (e.isIntersecting) t = setTimeout(() => (trackAd(ad.id, 'view'), io.disconnect()), 1000);
      },
      { threshold: 0.5 },
    );
    io.observe(ref.current);
    return () => (clearTimeout(t), io.disconnect());
  }, [ad.id, preview]);

  const href = ad.cta_url || null;
  const external = href && !href.startsWith('/');
  const click = () => !preview && trackAd(ad.id, 'click');
  const Cta = ({ className, children }) =>
    href ? (
      <a className={className} href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer sponsored' : undefined} onClick={click}>
        {children}
      </a>
    ) : (
      <span className={className}>{children}</span>
    );

  return (
    <article ref={ref} className={`post card ad-card is-${ad.layout || 'image'}`} style={{ '--state': theme.a }} aria-label={`Publicité : ${ad.title}`}>
      <header className="post-head">
        <span className="ad-logo" style={{ '--ad-a': theme.a, '--ad-b': theme.b }}>
          {ad.advertiser_avatar ? <img src={ad.advertiser_avatar} alt="" /> : <img src="/icons/logo.png" alt="" />}
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <span className="post-author">{ad.advertiser_name || 'XERA1'}</span>
          <div className="post-meta">
            <span className="ad-tag">Sponsorisé</span>
            {ad.tagline && <span aria-hidden="true">·</span>}
            {ad.tagline && <span className="ad-tagline">{ad.tagline}</span>}
          </div>
        </div>
        {!preview && (
          <div className="ad-menu-wrap">
            <button className="icon-btn" aria-label="Options de la publicité" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <Icon name="more_horiz" />
            </button>
            {menu && (
              <div className="post-menu" role="menu">
                <button role="menuitem" onClick={() => (setMenu(false), onHide?.(ad))}>
                  <Icon name="visibility_off" /> Masquer cette publicité
                </button>
                <span className="post-menu-note">Publicité de l’équipe XERA1</span>
              </div>
            )}
          </div>
        )}
      </header>

      {ad.body && ad.layout !== 'banner' && (
        <div className="post-body">
          <p className={long && !expanded ? 'clamp' : ''}>{ad.body}</p>
          {long && (
            <button className="more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Voir moins' : 'Voir plus'}
            </button>
          )}
        </div>
      )}

      {ad.layout !== 'text' && (
        <Cta className="ad-visual">
          {ad.image_url ? <img src={ad.image_url} alt="" loading="lazy" /> : <AdArt ad={ad} theme={theme} />}
        </Cta>
      )}

      <div className="ad-bar">
        <div className="grow" style={{ minWidth: 0 }}>
          <strong className="ad-title">{ad.title}</strong>
          {href && <span className="ad-host">{host(href)}</span>}
        </div>
        {href && (
          <Cta className="btn btn--sm ad-cta">
            {ad.cta_label || 'En savoir plus'}
            <Icon name={external ? 'open_in_new' : 'arrow_forward'} size={16} />
          </Cta>
        )}
      </div>
    </article>
  );
}
