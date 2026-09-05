-- Add configurable supplier product type dropdown settings.

alter table if exists public.workspace_options
  drop constraint if exists workspace_options_kind_check;

alter table if exists public.workspace_options
  add constraint workspace_options_kind_check
  check (kind in ('currency', 'destination-country', 'address-book', 'supplier-product-type'));

create or replace function public.replace_workspace_options(
  p_user_id uuid,
  p_kind text,
  p_options jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'Authentication is required to save settings.' using errcode = '28000';
  end if;
  if p_kind not in ('currency', 'destination-country', 'address-book', 'supplier-product-type') then
    raise exception 'Invalid workspace option kind.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_options) <> 'array' then
    raise exception 'Workspace options must be an array.' using errcode = '22023';
  end if;

  delete from public.workspace_options
  where user_id = auth.uid() and kind = p_kind;

  insert into public.workspace_options (id, user_id, kind, code, name, symbol, is_favorite, sort_index)
  select
    option_value->>'id',
    auth.uid(),
    p_kind,
    case
      when p_kind = 'currency' then upper(trim(option_value->>'code'))
      when p_kind = 'address-book' then lower(trim(option_value->>'code'))
      else lower(regexp_replace(trim(option_value->>'code'), '\s+', '-', 'g'))
    end,
    trim(option_value->>'name'),
    nullif(trim(option_value->>'symbol'), ''),
    coalesce((option_value->>'isFavorite')::boolean, false),
    (ordinality - 1)::integer
  from jsonb_array_elements(p_options) with ordinality as options(option_value, ordinality);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'kind', kind,
        'code', code,
        'name', name,
        'symbol', symbol,
        'is_favorite', is_favorite,
        'sort_index', sort_index
      ) order by sort_index
    ),
    '[]'::jsonb
  ) into v_result
  from public.workspace_options
  where user_id = auth.uid() and kind = p_kind;

  return v_result;
end;
$$;
