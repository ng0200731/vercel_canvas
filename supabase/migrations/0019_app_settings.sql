-- Scalar per-user application settings (live, UI-editable overrides of
-- server env defaults such as GEMINI_MATCH_MIN_COSINE). One row per (user, key).
-- The CHECK on `key` is the whitelist of supported settings; adding a new
-- setting means extending this CHECK and the matching zod schema in code.

create table if not exists public.app_settings (
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  check (key in ('gemini-match-min-cosine'))
);

alter table public.app_settings enable row level security;
drop policy if exists "app settings are owned by user" on public.app_settings;
create policy "app settings are owned by user"
  on public.app_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';
