-- Normalize supplier-linked product variants while retaining legacy product columns.

alter table if exists public.products
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists products_supplier_id_idx on public.products(supplier_id);

create table if not exists public.product_variants (
  id                 text not null,
  product_id         uuid not null references public.products(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade default auth.uid(),
  sort_index         integer not null default 0,
  material           text not null default '',
  color_notes        text not null default '',
  parameters         jsonb not null default '{}'::jsonb,
  unit_price         text not null default '0',
  price_unit         text not null default 'per pc',
  image_name         text,
  image_url          text,
  image_storage_path text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (product_id, id),
  constraint product_variants_parameters_object check (jsonb_typeof(parameters) = 'object')
);

create index if not exists product_variants_user_id_idx on public.product_variants(user_id);
create index if not exists product_variants_product_sort_idx
  on public.product_variants(product_id, sort_index);

drop trigger if exists product_variants_touch_updated_at on public.product_variants;
create trigger product_variants_touch_updated_at
  before update on public.product_variants
  for each row execute function public.touch_updated_at();

alter table public.product_variants enable row level security;

drop policy if exists "product variants are owned by user" on public.product_variants;
create policy "product variants are owned by user"
  on public.product_variants for all
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.products p
      where p.id = product_variants.product_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.products p
      where p.id = product_variants.product_id
        and p.user_id = auth.uid()
    )
  );

with normalized_products as (
  select
    p.id as product_id,
    p.user_id,
    p.product_type,
    p.material,
    p.color_notes,
    p.parameters,
    p.unit_price,
    p.price_unit,
    p.image_name,
    p.image_url,
    p.image_storage_path
  from public.products p
)
insert into public.product_variants (
  id,
  product_id,
  user_id,
  sort_index,
  material,
  color_notes,
  parameters,
  unit_price,
  price_unit,
  image_name,
  image_url,
  image_storage_path
)
select
  'variant-1',
  product_id,
  user_id,
  0,
  coalesce(material, ''),
  coalesce(color_notes, ''),
  case
    when jsonb_typeof(parameters) = 'object' then parameters
    else '{}'::jsonb
  end,
  case
    when length(trim(coalesce(unit_price, ''))) > 0 then unit_price
    else '0'
  end,
  case
    when length(trim(coalesce(price_unit, ''))) > 0 then price_unit
    when product_type in ('elastic', 'drawcord') then 'per meter'
    when product_type = 'thread' then 'per cone'
    when product_type = 'polybag' then 'per bag'
    else 'per pc'
  end,
  image_name,
  image_url,
  image_storage_path
from normalized_products
where not exists (
  select 1 from public.product_variants variants where variants.product_id = normalized_products.product_id
);

create or replace function public.upsert_product_with_variants(
  p_product_id uuid,
  p_user_id uuid,
  p_supplier_id uuid,
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
    raise exception 'Authentication is required to save a product.'
      using errcode = '28000';
  end if;

  if p_supplier_id is null then
    raise exception 'Supplier is required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.suppliers s
    where s.id = p_supplier_id
      and s.user_id = auth.uid()
  ) then
    raise exception 'Supplier not found or not owned by current user.'
      using errcode = 'P0002';
  end if;

  if jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) = 0 then
    raise exception 'Product variants must be a non-empty JSON array.'
      using errcode = '22023';
  end if;

  if p_product_id is not null and not exists (
    select 1 from public.products where id = p_product_id and user_id = auth.uid()
  ) then
    raise exception 'Product not found or not owned by current user.'
      using errcode = 'P0002';
  end if;

  select value
  into v_first_variant
  from jsonb_array_elements(v_variants) with ordinality as variants(value, ordinality)
  order by ordinality
  limit 1;

  insert into public.products (
    id,
    user_id,
    supplier_id,
    product_type,
    subject,
    detail,
    material,
    color_notes,
    parameters,
    unit_price,
    price_unit,
    image_name,
    image_url,
    image_storage_path
  )
  values (
    v_product_id,
    auth.uid(),
    p_supplier_id,
    p_product_type,
    trim(p_subject),
    trim(p_detail),
    trim(coalesce(v_first_variant->>'material', '')),
    trim(coalesce(v_first_variant->>'colorNotes', '')),
    case
      when jsonb_typeof(v_first_variant->'parameters') = 'object' then v_first_variant->'parameters'
      else '{}'::jsonb
    end,
    case
      when length(trim(coalesce(v_first_variant->>'unitPrice', ''))) > 0 then trim(v_first_variant->>'unitPrice')
      else '0'
    end,
    case
      when length(trim(coalesce(v_first_variant->>'priceUnit', ''))) > 0 then trim(v_first_variant->>'priceUnit')
      else 'per pc'
    end,
    nullif(v_first_variant->'image'->>'name', ''),
    nullif(v_first_variant->'image'->>'url', ''),
    nullif(v_first_variant->'image'->>'storagePath', '')
  )
  on conflict (id) do update
  set supplier_id = excluded.supplier_id,
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
    id,
    product_id,
    user_id,
    sort_index,
    material,
    color_notes,
    parameters,
    unit_price,
    price_unit,
    image_name,
    image_url,
    image_storage_path
  )
  select
    trim(coalesce(variant_value->>'id', format('variant-%s', ordinality))),
    v_product_id,
    auth.uid(),
    coalesce((variant_value->>'sortIndex')::integer, (ordinality - 1)::integer),
    trim(coalesce(variant_value->>'material', '')),
    trim(coalesce(variant_value->>'colorNotes', '')),
    case
      when jsonb_typeof(variant_value->'parameters') = 'object' then variant_value->'parameters'
      else '{}'::jsonb
    end,
    case
      when length(trim(coalesce(variant_value->>'unitPrice', ''))) > 0 then trim(variant_value->>'unitPrice')
      else '0'
    end,
    case
      when length(trim(coalesce(variant_value->>'priceUnit', ''))) > 0 then trim(variant_value->>'priceUnit')
      else 'per pc'
    end,
    nullif(variant_value->'image'->>'name', ''),
    nullif(variant_value->'image'->>'url', ''),
    nullif(variant_value->'image'->>'storagePath', '')
  from jsonb_array_elements(v_variants) with ordinality as variants(variant_value, ordinality);

  select jsonb_build_object(
    'id', p.id,
    'supplier_id', p.supplier_id,
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
    'product_variants', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
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
          )
          order by v.sort_index
        )
        from public.product_variants v
        where v.product_id = p.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.products p
  where p.id = v_product_id
    and p.user_id = auth.uid();

  return v_result;
end;
$$;

grant execute on function public.upsert_product_with_variants(uuid, uuid, uuid, text, text, text, jsonb)
  to authenticated;

-- Ask PostgREST to refresh overloaded function signatures immediately after
-- applying this migration instead of waiting for its schema-cache poll.
notify pgrst, 'reload schema';
