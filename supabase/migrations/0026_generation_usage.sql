-- Lifetime generation-node allowance and account activation state.
-- Regular users receive ten successful generations; level-3 admins are unlimited.

alter table public.profiles
  add column if not exists active boolean not null default true;

create table if not exists public.generation_allowance (
  user_id          uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  generation_limit integer not null default 10 check (generation_limit >= 0),
  updated_at       timestamptz not null default now()
);

create table if not exists public.generation_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  model       text not null,
  prompt      text not null,
  size        text,
  output_url  text not null,
  created_at  timestamptz not null default now()
);

create index if not exists generation_records_user_created_idx
  on public.generation_records(user_id, created_at desc);

alter table public.generation_allowance enable row level security;
alter table public.generation_records enable row level security;

drop policy if exists "generation allowances are owned by user" on public.generation_allowance;
create policy "generation allowances are owned by user"
  on public.generation_allowance for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "generation records are owned by user" on public.generation_records;
create policy "generation records are owned by user"
  on public.generation_records for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop trigger if exists generation_allowance_touch_updated_at on public.generation_allowance;
create trigger generation_allowance_touch_updated_at
  before update on public.generation_allowance
  for each row execute function public.touch_updated_at();

-- Called by the server after a successful provider response. The allowance row
-- is locked before counting, so concurrent requests cannot exceed the limit.
create or replace function public.consume_generation(
  p_user_id uuid,
  p_model text,
  p_prompt text,
  p_size text,
  p_output_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_used integer;
  v_record_id uuid;
begin
  if p_user_id is null then
    raise exception 'A user is required to consume a generation.' using errcode = '28000';
  end if;

  insert into public.generation_allowance (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select generation_limit
    into v_limit
    from public.generation_allowance
   where user_id = p_user_id
   for update;

  select count(*)::integer
    into v_used
    from public.generation_records
   where user_id = p_user_id;

  if v_used >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'used', v_used,
      'remaining', 0,
      'limit', v_limit
    );
  end if;

  insert into public.generation_records (user_id, model, prompt, size, output_url)
  values (p_user_id, coalesce(nullif(trim(p_model), ''), 'unknown'), p_prompt, p_size, p_output_url)
  returning id into v_record_id;

  return jsonb_build_object(
    'allowed', true,
    'id', v_record_id,
    'used', v_used + 1,
    'remaining', greatest(v_limit - v_used - 1, 0),
    'limit', v_limit
  );
end;
$$;

revoke all on function public.consume_generation(uuid, text, text, text, text) from public;
grant execute on function public.consume_generation(uuid, text, text, text, text) to service_role;
notify pgrst, 'reload schema';
