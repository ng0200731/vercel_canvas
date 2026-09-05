-- Multiple ordered images per generic node definition. The legacy image
-- columns remain populated so older clients and existing rows stay readable.

alter table if exists public.generic_node_definitions
  add column if not exists images jsonb not null default '[]'::jsonb;

update public.generic_node_definitions
set images = jsonb_build_array(
  jsonb_build_object(
    'id', id::text || ':image:0',
    'name', 'Image 1',
    'url', image_url,
    'storagePath', storage_path
  )
)
where jsonb_typeof(images) <> 'array'
   or jsonb_array_length(images) = 0;

alter table if exists public.generic_node_definitions
  drop constraint if exists generic_node_definitions_images_is_array;

alter table if exists public.generic_node_definitions
  add constraint generic_node_definitions_images_is_array
  check (jsonb_typeof(images) = 'array');

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
        'images', images,
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

grant execute on function public.reorder_generic_node_definitions(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
