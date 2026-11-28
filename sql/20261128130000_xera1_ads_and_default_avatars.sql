-- XERA1 : publicités maison (créées par le super admin, affichées dans le fil)
-- + avatar par défaut aléatoire à l'inscription.

-- ------------------------------------------------------------------ Publicités
CREATE TABLE IF NOT EXISTS public.xera_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 1500),
  image_url text,
  cta_label text NOT NULL DEFAULT 'En savoir plus' CHECK (char_length(cta_label) <= 40),
  cta_url text CHECK (cta_url IS NULL OR cta_url ~* '^(https?://|/)'),
  advertiser_name text NOT NULL DEFAULT 'XERA1' CHECK (char_length(advertiser_name) <= 80),
  advertiser_avatar text,
  tagline text CHECK (char_length(tagline) <= 80),
  theme text NOT NULL DEFAULT 'violet' CHECK (theme IN ('violet','gold','success','pause','mono')),
  layout text NOT NULL DEFAULT 'image' CHECK (layout IN ('image','banner','text')),
  every_n int NOT NULL DEFAULT 6 CHECK (every_n BETWEEN 3 AND 50),
  priority int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  impressions int NOT NULL DEFAULT 0,
  clicks int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.xera_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xera_ads_public_read" ON public.xera_ads;
CREATE POLICY "xera_ads_public_read" ON public.xera_ads FOR SELECT
  USING (
    (is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()))
    OR public.rize_is_super_admin()
  );
DROP POLICY IF EXISTS "xera1_super_admin_all" ON public.xera_ads;
CREATE POLICY "xera1_super_admin_all" ON public.xera_ads FOR ALL TO authenticated
  USING (public.rize_is_super_admin()) WITH CHECK (public.rize_is_super_admin());

GRANT SELECT ON public.xera_ads TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.xera_ads TO authenticated;

DROP TRIGGER IF EXISTS update_xera_ads_updated_at ON public.xera_ads;
CREATE TRIGGER update_xera_ads_updated_at BEFORE UPDATE ON public.xera_ads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Compteurs (vue / clic) sans ouvrir l'écriture de la table.
CREATE OR REPLACE FUNCTION public.xera_ad_track(p_ad_id uuid, p_kind text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.xera_ads
     SET impressions = impressions + CASE WHEN p_kind = 'view' THEN 1 ELSE 0 END,
         clicks      = clicks      + CASE WHEN p_kind = 'click' THEN 1 ELSE 0 END
   WHERE id = p_ad_id AND is_active;
$$;
REVOKE ALL ON FUNCTION public.xera_ad_track(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.xera_ad_track(uuid, text) TO anon, authenticated;

-- ------------------------------------------------------------------ Avatars
-- 24 avatars XERA1 servis par le site (client/public/avatars).
CREATE OR REPLACE FUNCTION public.xera_random_avatar()
RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'https://xera1.xyz/avatars/' ||
    (ARRAY['xera-p01','xera-p02','xera-p03','xera-p04','xera-p05','xera-p06','xera-p07','xera-p08',
           'xera-p09','xera-p10','xera-p11','xera-p12','xera-p13','xera-p14','xera-p15','xera-p16',
           'xera-a01','xera-a02','xera-a03','xera-a04','xera-a05','xera-a06','xera-a07','xera-a08'])
    [1 + floor(random() * 24)::int] || '.webp';
$$;

CREATE OR REPLACE FUNCTION public.users_default_avatar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.avatar IS NULL OR btrim(NEW.avatar) = '' THEN
    NEW.avatar := public.xera_random_avatar();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_users_default_avatar ON public.users;
CREATE TRIGGER trg_users_default_avatar BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_default_avatar();
