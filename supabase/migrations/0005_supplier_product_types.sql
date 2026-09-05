-- Expand supplier product type options.

alter table if exists public.suppliers
  drop constraint if exists suppliers_product_types_allowed;

update public.suppliers
set product_types = coalesce(
  (
    select array_agg(distinct normalized.product_type)
    from unnest(product_types) as current_product_type(product_type)
    cross join lateral (
      select case current_product_type.product_type
        when 'label' then 'woven-label'
        when 'tag' then 'hang-tag'
        when 'zipper' then 'metal'
        when 'snap' then 'button'
        else current_product_type.product_type
      end
    ) as normalized(product_type)
    where normalized.product_type = any(array[
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
  array['woven-label']::text[]
);

alter table if exists public.suppliers
  add constraint suppliers_product_types_allowed check (
    product_types <@ array[
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
    ]::text[]
  );
