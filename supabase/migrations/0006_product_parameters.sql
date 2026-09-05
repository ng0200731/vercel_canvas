-- Add product-type-specific parameters and unit pricing.

alter table if exists public.products
  add column if not exists product_type text not null default 'woven-label',
  add column if not exists parameters jsonb not null default '{}'::jsonb,
  add column if not exists unit_price text not null default '0',
  add column if not exists price_unit text not null default 'per pc';

alter table if exists public.products
  drop constraint if exists products_product_type_allowed,
  drop constraint if exists products_parameters_object;

update public.products
set product_type = case product_type
    when 'label' then 'woven-label'
    when 'tag' then 'hang-tag'
    when 'zipper' then 'metal'
    when 'snap' then 'button'
    when 'woven-label' then 'woven-label'
    when 'wash-care-label' then 'wash-care-label'
    when 'hang-tag' then 'hang-tag'
    when 'heat-transfer' then 'heat-transfer'
    when 'elastic' then 'elastic'
    when 'drawcord' then 'drawcord'
    when 'metal' then 'metal'
    when 'button' then 'button'
    when 'pu-patch' then 'pu-patch'
    when 'embroidery-patch' then 'embroidery-patch'
    when 'silicon-patch' then 'silicon-patch'
    when 'thread' then 'thread'
    when 'polybag' then 'polybag'
    else 'woven-label'
  end,
  parameters = case
    when jsonb_typeof(parameters) = 'object' then parameters
    else '{}'::jsonb
  end,
  unit_price = case
    when length(trim(unit_price)) > 0 then unit_price
    else '0'
  end;

update public.products
set price_unit = case
  when product_type in ('elastic', 'drawcord') then 'per meter'
  when product_type = 'thread' then 'per cone'
  when product_type = 'polybag' then 'per bag'
  when length(trim(price_unit)) > 0 then price_unit
  else 'per pc'
end;

alter table if exists public.products
  add constraint products_product_type_allowed check (
    product_type = any(array[
      'woven-label',
      'wash-care-label',
      'hang-tag',
      'heat-transfer',
      'elastic',
      'drawcord',
      'metal',
      'button',
      'pu-patch',
      'embroidery-patch',
      'silicon-patch',
      'thread',
      'polybag'
    ]::text[])
  ),
  add constraint products_parameters_object check (jsonb_typeof(parameters) = 'object');

create index if not exists products_product_type_idx on public.products(product_type);
