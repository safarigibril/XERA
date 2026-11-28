-- XERA1 : le super admin (public.rize_is_super_admin()) peut gérer toutes les
-- tables de la plateforme. Avant, ~70 tables n'avaient aucune règle pour lui
-- (ARC, pages pro, lives, notifications, paiements, partenaires…) : ses
-- actions étaient refusées ou n'affectaient aucune ligne.
-- Exclues volontairement (vie privée / secrets) : messages privés (dm_*),
-- jetons OAuth, jetons push.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'arc_collaboration_slots','arc_collaborations','arc_followers','arc_inspirations',
    'arc_milestone_validations','arc_witnesses','arcs','bot_control','bots','commissions',
    'content_encouragements','creator_payout_settings','creator_wallets','dm_reports',
    'donations','fata_activity_log','fata_alerts','fata_challenges_config','fata_linkages',
    'fata_qualifications','feedback_inbox','messages','monetization_audit_logs','notifications',
    'page_followers','partner_affiliations','partner_audit_log','partner_codes',
    'partner_commissions','partner_discount_codes','partner_page_memberships',
    'partner_payout_commissions','partner_payout_settings','partner_payouts',
    'partner_referrals','partners','payouts','professional_certifications',
    'professional_cta_leads','professional_page_followers','professional_pages','promo_codes',
    'proof_cards','social_growth_events','stream_messages','stream_viewers',
    'streaming_sessions','subscription_discount_code_redemptions','subscription_discount_codes',
    'subscriptions','transactions','user_blocks','user_streaks','user_subscriptions',
    'verification_requests','verified_badges','video_payouts','video_views',
    'withdrawal_requests','work_items','daily_metrics'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "xera1_super_admin_all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "xera1_super_admin_all" ON public.%I FOR ALL TO authenticated USING (public.rize_is_super_admin()) WITH CHECK (public.rize_is_super_admin())', t);
  END LOOP;
END $$;

-- feedback_inbox : l'admin doit pouvoir marquer / supprimer (privilèges manquants).
GRANT UPDATE, DELETE ON public.feedback_inbox TO authenticated;

-- Fichiers du bucket public « media » : l'admin peut supprimer / remplacer
-- n'importe quel fichier (modération).
DROP POLICY IF EXISTS "xera1_super_admin_media" ON storage.objects;
CREATE POLICY "xera1_super_admin_media" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'media' AND public.rize_is_super_admin())
  WITH CHECK (bucket_id = 'media' AND public.rize_is_super_admin());
