-- Add the operator's preferred remote SMTP provider to the app_settings
-- whitelist. Mirrors 0020_app_settings.sql but only touches the CHECK, so the
-- existing per-user PK, RLS policy, and updated_at trigger are preserved.
alter table public.app_settings
  drop constraint app_settings_key_check;

alter table public.app_settings
  add constraint app_settings_key_check
  check (key in ('gemini-match-min-cosine', 'preferred-smtp-provider'));

notify pgrst, 'reload schema';
