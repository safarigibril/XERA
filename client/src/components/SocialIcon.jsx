import Icon from './Icon';

/**
 * Logos officiels des réseaux (Font Awesome Free 6.7.2, licence CC BY 4.0,
 * fichiers dans public/icons/social) + couleur de marque de chaque réseau.
 */
export const SOCIAL_BRANDS = {
  linkedin: { color: '#0A66C2' },
  github: { color: '#24292F', light: '#ffffff' },
  twitter: { color: '#000000', light: '#ffffff' },
  instagram: { color: '#E4405F', gradient: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' },
  tiktok: { color: '#000000', light: '#ffffff' },
  youtube: { color: '#FF0000' },
  facebook: { color: '#1877F2' },
  twitch: { color: '#9146FF' },
  discord: { color: '#5865F2' },
  snapchat: { color: '#FFFC00', fg: '#000000' },
  spotify: { color: '#1DB954' },
  reddit: { color: '#FF4500' },
  pinterest: { color: '#E60023' },
};

/** Pastille ronde aux couleurs du réseau, logo officiel en blanc. */
export default function SocialIcon({ name, size = 36 }) {
  const brand = SOCIAL_BRANDS[name];
  const style = { '--s': `${size}px` };
  if (!brand) {
    return (
      <span className="social-icon is-generic" style={style}>
        <Icon name={name === 'email' ? 'mail' : name === 'site' ? 'language' : 'link'} size={Math.round(size * 0.5)} />
      </span>
    );
  }
  return (
    <span className="social-icon" style={{ ...style, background: brand.gradient || brand.color, '--fg': brand.fg || '#fff' }}>
      <i style={{ WebkitMaskImage: `url(/icons/social/${name}.svg)`, maskImage: `url(/icons/social/${name}.svg)` }} />
    </span>
  );
}
