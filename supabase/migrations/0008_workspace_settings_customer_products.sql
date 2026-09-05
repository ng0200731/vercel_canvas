-- Structured project metadata, ordered workspace settings, generic node presets,
-- and customer-owned garment products.

alter table if exists public.projects
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_name text,
  add column if not exists employee_id text,
  add column if not exists employee_name text,
  add column if not exists employee_title text,
  add column if not exists employee_email text,
  add column if not exists employee_tel text,
  add column if not exists currency_code text,
  add column if not exists currency_name text,
  add column if not exists currency_symbol text,
  add column if not exists destination_country_code text,
  add column if not exists destination_country_name text;

create index if not exists projects_customer_id_idx on public.projects(customer_id);

create table if not exists public.workspace_options (
  id          text not null,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind        text not null check (kind in ('currency', 'destination-country')),
  code        text not null,
  name        text not null,
  symbol      text,
  sort_index  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind, id),
  unique (user_id, kind, code)
);

create index if not exists workspace_options_user_kind_sort_idx
  on public.workspace_options(user_id, kind, sort_index);

drop trigger if exists workspace_options_touch_updated_at on public.workspace_options;
create trigger workspace_options_touch_updated_at
  before update on public.workspace_options
  for each row execute function public.touch_updated_at();

alter table public.workspace_options enable row level security;
drop policy if exists "workspace options are owned by user" on public.workspace_options;
create policy "workspace options are owned by user"
  on public.workspace_options for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.generic_node_definitions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name          text not null,
  image_url     text not null,
  storage_path  text,
  sort_index    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists generic_node_definitions_user_sort_idx
  on public.generic_node_definitions(user_id, sort_index);

drop trigger if exists generic_node_definitions_touch_updated_at on public.generic_node_definitions;
create trigger generic_node_definitions_touch_updated_at
  before update on public.generic_node_definitions
  for each row execute function public.touch_updated_at();

alter table public.generic_node_definitions enable row level security;
drop policy if exists "generic node definitions are owned by user" on public.generic_node_definitions;
create policy "generic node definitions are owned by user"
  on public.generic_node_definitions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

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
  if p_kind not in ('currency', 'destination-country') then
    raise exception 'Invalid workspace option kind.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_options) <> 'array' then
    raise exception 'Workspace options must be an array.' using errcode = '22023';
  end if;

  delete from public.workspace_options
  where user_id = auth.uid() and kind = p_kind;

  insert into public.workspace_options (id, user_id, kind, code, name, symbol, sort_index)
  select
    option_value->>'id',
    auth.uid(),
    p_kind,
    upper(trim(option_value->>'code')),
    trim(option_value->>'name'),
    nullif(trim(option_value->>'symbol'), ''),
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

create or replace function public.reorder_generic_node_definitions(
  p_user_id uuid,
  p_ids text[]
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
    raise exception 'Authentication is required to reorder generic nodes.' using errcode = '28000';
  end if;

  update public.generic_node_definitions definition
  set sort_index = ordered.ordinality - 1
  from unnest(p_ids) with ordinality as ordered(id, ordinality)
  where definition.user_id = auth.uid()
    and definition.id::text = ordered.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'name', name,
        'image_url', image_url,
        'storage_path', storage_path,
        'sort_index', sort_index,
        'created_at', created_at,
        'updated_at', updated_at
      ) order by sort_index
    ),
    '[]'::jsonb
  ) into v_result
  from public.generic_node_definitions
  where user_id = auth.uid();

  return v_result;
end;
$$;

grant execute on function public.replace_workspace_options(uuid, text, jsonb) to authenticated;
grant execute on function public.reorder_generic_node_definitions(uuid, text[]) to authenticated;

alter table if exists public.products
  add column if not exists owner_kind text not null default 'supplier',
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table if exists public.products
  drop constraint if exists products_product_type_allowed,
  drop constraint if exists products_owner_kind_allowed,
  drop constraint if exists products_owner_fields_valid,
  drop constraint if exists products_owner_product_type_valid;

alter table if exists public.products
  add constraint products_owner_kind_allowed check (owner_kind in ('supplier', 'customer')),
  add constraint products_owner_fields_valid check (
    (owner_kind = 'supplier' and customer_id is null and project_id is null)
    or
    (owner_kind = 'customer' and supplier_id is null and customer_id is not null and project_id is not null)
  ),
  add constraint products_product_type_allowed check (
    product_type = any(array[
      'woven-label', 'wash-care-label', 'hang-tag', 'heat-transfer', 'elastic',
      'drawcord', 'metal', 'button', 'pu-patch', 'embroidery-patch',
      'silicon-patch', 'thread', 'polybag',
      'shirt', 'blouse', 't-shirt', 'sweater', 'tank-top', 'cardigan',
      'pants', 'jeans', 'skirt', 'shorts', 'leggings', 'trousers',
      'dress', 'jumpsuit', 'romper', 'overalls',
      'coat', 'jacket', 'hoodie', 'raincoat', 'parka', 'blazer',
      'bra', 'briefs', 'boxers', 'undershirt', 'socks', 'corset',
      'swimsuit', 'uniform', 'apron', 'scrub', 'sportswear'
    ]::text[])
  ),
  add constraint products_owner_product_type_valid check (
    (
      owner_kind = 'supplier' and product_type = any(array[
        'woven-label', 'wash-care-label', 'hang-tag', 'heat-transfer', 'elastic',
        'drawcord', 'metal', 'button', 'pu-patch', 'embroidery-patch',
        'silicon-patch', 'thread', 'polybag'
      ]::text[])
    ) or (
      owner_kind = 'customer' and product_type = any(array[
        'shirt', 'blouse', 't-shirt', 'sweater', 'tank-top', 'cardigan',
        'pants', 'jeans', 'skirt', 'shorts', 'leggings', 'trousers',
        'dress', 'jumpsuit', 'romper', 'overalls',
        'coat', 'jacket', 'hoodie', 'raincoat', 'parka', 'blazer',
        'bra', 'briefs', 'boxers', 'undershirt', 'socks', 'corset',
        'swimsuit', 'uniform', 'apron', 'scrub', 'sportswear'
      ]::text[])
    )
  );

create index if not exists products_customer_id_idx on public.products(customer_id);
create index if not exists products_project_id_idx on public.products(project_id);
create index if not exists products_owner_kind_idx on public.products(owner_kind);

create or replace function public.upsert_workspace_product_with_variants(
  p_product_id uuid,
  p_user_id uuid,
  p_owner_kind text,
  p_supplier_id uuid,
  p_customer_id uuid,
  p_project_id uuid,
  p_product_type text,
  p_subject text,
  p_detail text,
  p_variants jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product_id uuid := coalesce(p_product_id, gen_random_uuid());
  v_variants jsonb := coalesce(p_variants, '[]'::jsonb);
  v_first_variant jsonb;
  v_result jsonb;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'Authentication is required to save a product.' using errcode = '28000';
  end if;
  if p_product_id is not null and not exists (
    select 1 from public.products where id = p_product_id and user_id = auth.uid()
  ) then
    raise exception 'Product not found or not owned by current user.' using errcode = 'P0002';
  end if;
  if p_owner_kind = 'supplier' and not exists (
    select 1 from public.suppliers where id = p_supplier_id and user_id = auth.uid()
  ) then
    raise exception 'Supplier not found or not owned by current user.' using errcode = 'P0002';
  end if;
  if p_owner_kind = 'customer' and not exists (
    select 1 from public.customers where id = p_customer_id and user_id = auth.uid()
  ) then
    raise exception 'Customer not found or not owned by current user.' using errcode = 'P0002';
  end if;
  if p_owner_kind = 'customer' and not exists (
    select 1 from public.projects
    where id = p_project_id and user_id = auth.uid() and customer_id = p_customer_id
  ) then
    raise exception 'Choose a project for this customer.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) = 0 then
    raise exception 'Product variants must be a non-empty JSON array.' using errcode = '22023';
  end if;

  select value into v_first_variant
  from jsonb_array_elements(v_variants) with ordinality as variants(value, ordinality)
  order by ordinality limit 1;

  insert into public.products (
    id, user_id, owner_kind, supplier_id, customer_id, project_id, product_type,
    subject, detail, material, color_notes, parameters, unit_price, price_unit,
    image_name, image_url, image_storage_path
  ) values (
    v_product_id, auth.uid(), p_owner_kind,
    case when p_owner_kind = 'supplier' then p_supplier_id else null end,
    case when p_owner_kind = 'customer' then p_customer_id else null end,
    case when p_owner_kind = 'customer' then p_project_id else null end,
    p_product_type, trim(p_subject), trim(p_detail),
    trim(coalesce(v_first_variant->>'material', '')),
    trim(coalesce(v_first_variant->>'colorNotes', '')),
    case when jsonb_typeof(v_first_variant->'parameters') = 'object'
      then v_first_variant->'parameters' else '{}'::jsonb end,
    coalesce(nullif(trim(v_first_variant->>'unitPrice'), ''), '0'),
    coalesce(nullif(trim(v_first_variant->>'priceUnit'), ''), 'per pc'),
    nullif(v_first_variant->'image'->>'name', ''),
    nullif(v_first_variant->'image'->>'url', ''),
    nullif(v_first_variant->'image'->>'storagePath', '')
  )
  on conflict (id) do update set
    owner_kind = excluded.owner_kind,
    supplier_id = excluded.supplier_id,
    customer_id = excluded.customer_id,
    project_id = excluded.project_id,
    product_type = excluded.product_type,
    subject = excluded.subject,
    detail = excluded.detail,
    material = excluded.material,
    color_notes = excluded.color_notes,
    parameters = excluded.parameters,
    unit_price = excluded.unit_price,
    price_unit = excluded.price_unit,
    image_name = excluded.image_name,
    image_url = excluded.image_url,
    image_storage_path = excluded.image_storage_path
  where products.user_id = auth.uid();

  delete from public.product_variants where product_id = v_product_id;

  insert into public.product_variants (
    id, product_id, user_id, sort_index, material, color_notes, parameters,
    unit_price, price_unit, image_name, image_url, image_storage_path
  )
  select
    trim(coalesce(variant_value->>'id', format('variant-%s', ordinality))),
    v_product_id,
    auth.uid(),
    coalesce((variant_value->>'sortIndex')::integer, (ordinality - 1)::integer),
    trim(coalesce(variant_value->>'material', '')),
    trim(coalesce(variant_value->>'colorNotes', '')),
    case when jsonb_typeof(variant_value->'parameters') = 'object'
      then variant_value->'parameters' else '{}'::jsonb end,
    coalesce(nullif(trim(variant_value->>'unitPrice'), ''), '0'),
    coalesce(nullif(trim(variant_value->>'priceUnit'), ''), 'per pc'),
    nullif(variant_value->'image'->>'name', ''),
    nullif(variant_value->'image'->>'url', ''),
    nullif(variant_value->'image'->>'storagePath', '')
  from jsonb_array_elements(v_variants) with ordinality as variants(variant_value, ordinality);

  select jsonb_build_object(
    'id', p.id,
    'owner_kind', p.owner_kind,
    'supplier_id', p.supplier_id,
    'customer_id', p.customer_id,
    'project_id', p.project_id,
    'product_type', p.product_type,
    'subject', p.subject,
    'detail', p.detail,
    'material', p.material,
    'color_notes', p.color_notes,
    'parameters', p.parameters,
    'unit_price', p.unit_price,
    'price_unit', p.price_unit,
    'image_name', p.image_name,
    'image_url', p.image_url,
    'image_storage_path', p.image_storage_path,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'product_variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'sort_index', v.sort_index,
        'material', v.material,
        'color_notes', v.color_notes,
        'parameters', v.parameters,
        'unit_price', v.unit_price,
        'price_unit', v.price_unit,
        'image_name', v.image_name,
        'image_url', v.image_url,
        'image_storage_path', v.image_storage_path
      ) order by v.sort_index)
      from public.product_variants v where v.product_id = p.id
    ), '[]'::jsonb)
  ) into v_result
  from public.products p
  where p.id = v_product_id and p.user_id = auth.uid();

  return v_result;
end;
$$;

grant execute on function public.upsert_workspace_product_with_variants(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text, jsonb
) to authenticated;

notify pgrst, 'reload schema';
