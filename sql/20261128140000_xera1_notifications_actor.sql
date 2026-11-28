-- XERA1 : chaque notification connaît son auteur (actor_id), pour afficher sa
-- photo avec une petite icône du type (abonnement, encouragement, live…),
-- comme sur les autres réseaux. + notification d'encouragement.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

-- Remplissage automatique : l'auteur est la personne connectée qui crée la
-- notification ; sinon on le déduit du lien (profil, live).
CREATE OR REPLACE FUNCTION public.notifications_set_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid; m text;
BEGIN
  IF NEW.actor_id IS NULL THEN
    m := substring(coalesce(NEW.link, '') from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})');
    IF NEW.type = 'follow' AND m IS NOT NULL THEN
      NEW.actor_id := m::uuid;
    ELSIF NEW.type IN ('stream', 'live', 'live_start') AND m IS NOT NULL THEN
      SELECT user_id INTO v FROM public.streaming_sessions WHERE id = m::uuid;
      NEW.actor_id := v;
    END IF;
    IF NEW.actor_id IS NULL AND auth.uid() IS NOT NULL AND auth.uid() <> NEW.user_id THEN
      NEW.actor_id := auth.uid();
    END IF;
    -- Sécurité : l'identifiant doit exister.
    IF NEW.actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.actor_id) THEN
      NEW.actor_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notifications_set_actor ON public.notifications;
CREATE TRIGGER trg_notifications_set_actor BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_set_actor();

-- Anciennes notifications : abonnements et lives (auteur dans le lien).
UPDATE public.notifications n SET actor_id = u.id
  FROM public.users u
 WHERE n.actor_id IS NULL AND n.type = 'follow'
   AND u.id::text = substring(n.link from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})');
UPDATE public.notifications n SET actor_id = s.user_id
  FROM public.streaming_sessions s
 WHERE n.actor_id IS NULL AND n.type IN ('stream', 'live', 'live_start')
   AND s.id::text = substring(n.link from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})');
-- Anciens encouragements : l'encourageur dont le nom ouvre le message.
UPDATE public.notifications n SET actor_id = x.user_id
  FROM (
    SELECT DISTINCT ON (n2.id) n2.id nid, e.user_id
      FROM public.notifications n2
      JOIN public.content_encouragements e
        ON e.content_id::text = substring(n2.link from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
      JOIN public.users u ON u.id = e.user_id
     WHERE n2.type = 'encouragement' AND n2.actor_id IS NULL AND n2.message LIKE u.name || ' %'
  ) x
 WHERE n.id = x.nid;

-- Encourager une preuve prévient son auteur (une seule notification par
-- personne et par preuve, remise en tête si elle ré-encourage).
CREATE OR REPLACE FUNCTION public.toggle_courage(row_id uuid, user_id_param uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
declare
    exists_check boolean;
    new_count integer;
    is_encouraged boolean;
    v_owner uuid;
    v_title text;
    v_name text;
    v_link text;
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and (auth.uid() is null or user_id_param is distinct from auth.uid()) then
        raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;

    select exists(select 1 from content_encouragements where content_id = row_id and user_id = user_id_param) into exists_check;

    if exists_check then
        delete from content_encouragements where content_id = row_id and user_id = user_id_param;
        update content set encouragements_count = greatest(encouragements_count - 1, 0) where id = row_id returning encouragements_count into new_count;
        is_encouraged := false;
    else
        insert into content_encouragements (user_id, content_id) values (user_id_param, row_id);
        update content set encouragements_count = encouragements_count + 1 where id = row_id returning encouragements_count, user_id, title into new_count, v_owner, v_title;
        is_encouraged := true;
        if v_owner is not null and v_owner <> user_id_param then
            select coalesce(nullif(btrim(name), ''), 'Un membre') into v_name from users where id = user_id_param;
            v_link := '/share/' || row_id;
            delete from notifications where user_id = v_owner and type = 'encouragement' and link = v_link and actor_id = user_id_param;
            insert into notifications (user_id, type, message, link, read, actor_id)
            values (v_owner, 'encouragement', v_name || ' a encouragé votre preuve « ' || left(coalesce(v_title, ''), 80) || ' »', v_link, false, user_id_param);
        end if;
    end if;

    return jsonb_build_object('count', new_count, 'encouraged', is_encouraged);
end;
$function$;
