import Icon from './Icon';

/** Avatars XERA1 fournis (client/public/avatars), aussi attribués au hasard à l'inscription. */
const NAMES = [
  ...Array.from({ length: 16 }, (_, i) => `xera-p${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `xera-a${String(i + 1).padStart(2, '0')}`),
];
export const XERA_AVATARS = NAMES.map((n) => `https://xera1.xyz/avatars/${n}.webp`);

/** En local / aperçu, on sert les fichiers du site lui-même. */
const localSrc = (url) => (typeof window !== 'undefined' && !/xera1\.xyz$/.test(window.location.hostname) ? url.replace('https://xera1.xyz', '') : url);

export const randomXeraAvatar = () => XERA_AVATARS[Math.floor(Math.random() * XERA_AVATARS.length)];

/** Grille de choix d'un avatar XERA1. */
export default function AvatarGallery({ value, onPick }) {
  return (
    <div className="avatar-gallery">
      <div className="avatar-gallery-head">
        <span className="field-label">Ou choisissez un avatar XERA1</span>
        <button type="button" className="avatar-gallery-random" onClick={() => onPick(randomXeraAvatar())}>
          <Icon name="casino" size={18} /> Au hasard
        </button>
      </div>
      <div className="avatar-gallery-grid" role="radiogroup" aria-label="Avatars XERA1">
        {XERA_AVATARS.map((url, i) => {
          const on = value === url;
          return (
            <button
              key={url}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`Avatar ${i + 1}`}
              className={`avatar-gallery-item${on ? ' is-on' : ''}`}
              onClick={() => onPick(url)}
            >
              <img src={localSrc(url)} alt="" loading="lazy" />
              {on && (
                <span className="avatar-gallery-check">
                  <Icon name="check" size={16} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
