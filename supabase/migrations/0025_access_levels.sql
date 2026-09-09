-- Access levels (user / admin) for the canvas workspace.
--
-- Adds a role level to public.profiles:
--   1 = regular user (self-registered): sees/edits only their own data
--   3 = administrator (eric.brilliant@gmail.com): sees, edits, deletes ALL data
--
-- Enforcement is entirely via Row Level Security using a SECURITY DEFINER
-- helper, so no client code, RPC parameter, or stored user metadata can forge
-- a privilege. Ownership stays with each row's user_id; admin gains access by
-- policy override, never by reassigning rows to themselves.
--
-- Idempotent: safe to run more than once.

-- ── 1. Role column on profiles ────────────────────────────────────────────
alter table public.profiles
  add column if not exists access_level smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_access_level_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_access_level_check check (access_level in (1, 3));
  end if;
end $$;

comment on column public.profiles.access_level is
  '1 = user (own data only), 3 = admin (sees/edits/deletes all).';

-- ── 2. SECURITY DEFINER helper: is current user an admin? ─────────────────
-- Marked SECURITY DEFINER + STABLE so policies on any table (including
-- profiles) can call it without recursive-RLS. Reads profiles directly,
-- bypassing RLS for this trusted helper only.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select (p.access_level >= 3)::boolean from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ── 3. Auto-assign correct level at signup (server-side from email) ────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, access_level)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    ),
    case when lower(new.email) = 'eric.brilliant@gmail.com' then 3 else 1 end
  );
  return new;
end;
$$;

-- ── 4. Promote Eric + reassign orphaned rows to him (one-time backfill) ────
do $$
declare
  v_eric uuid;
begin
  select u.id into v_eric
  from auth.users u
  where lower(u.email) = 'eric.brilliant@gmail.com'
  limit 1;

  if v_eric is null then
    raise exception
      'E_ADMIN_MISSING: account eric.brilliant@gmail.com does not exist yet. '
      'Create/sign in that account first, then re-run this migration.';
  end if;

  -- Ensure Eric has a profile row and is level 3.
  insert into public.profiles (id, display_name, access_level)
  values (v_eric, 'eric.brilliant@gmail.com', 3)
  on conflict (id) do update set access_level = 3;

  -- Any row whose owner is not a real auth user is treated as orphaned and
  -- assigned to Eric. (Existing Eric-owned rows are untouched; the policy
  -- override already makes them visible to him.)
  update public.projects                 set user_id = v_eric where user_id not in (select id from auth.users);
  update public.canvases                 set user_id = v_eric where user_id not in (select id from auth.users);
  update public.images                   set user_id = v_eric where user_id not in (select id from auth.users);
  update public.canvas_nodes             set user_id = v_eric where user_id not in (select id from auth.users);
  update public.canvas_edges             set user_id = v_eric where user_id not in (select id from auth.users);
  update public.customers                set user_id = v_eric where user_id not in (select id from auth.users);
  update public.customer_employees       set user_id = v_eric where user_id not in (select id from auth.users);
  update public.suppliers                set user_id = v_eric where user_id not in (select id from auth.users);
  update public.supplier_employees       set user_id = v_eric where user_id not in (select id from auth.users);
  update public.products                 set user_id = v_eric where user_id not in (select id from auth.users);
  update public.product_variants         set user_id = v_eric where user_id not in (select id from auth.users);
  update public.workspace_options        set user_id = v_eric where user_id not in (select id from auth.users);
  update public.generic_node_definitions set user_id = v_eric where user_id not in (select id from auth.users);
  update public.canvas_sends             set user_id = v_eric where user_id not in (select id from auth.users);
  update public.sample_orders            set user_id = v_eric where user_id not in (select id from auth.users);
  update public.sample_order_updates     set user_id = v_eric where user_id not in (select id from auth.users);
  update public.app_settings             set user_id = v_eric where user_id not in (select id from auth.users);
end $$;

-- ── 5. RLS policies: owner OR admin ────────────────────────────────────────
-- Simple-owner tables: USING / WITH CHECK = (user_id = auth.uid() OR is_admin()).
-- Child tables keep the parent-ownership EXISTS check, also admin-augmented.
-- profiles: admin may READ all, but may only WRITE their own row.

-- profiles (row key is id, not user_id)
drop policy if exists "profiles are owned by user" on public.profiles;
create policy "profiles are owned by user"
  on public.profiles for all
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid());

-- projects
drop policy if exists "projects are owned by user" on public.projects;
create policy "projects are owned by user"
  on public.projects for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- canvases
drop policy if exists "canvases are owned by user" on public.canvases;
create policy "canvases are owned by user"
  on public.canvases for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- images
drop policy if exists "images are owned by user" on public.images;
create policy "images are owned by user"
  on public.images for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- canvas_nodes (child of canvases)
drop policy if exists "canvas nodes are owned by user" on public.canvas_nodes;
create policy "canvas nodes are owned by user"
  on public.canvas_nodes for all
  using (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.canvases c
      where c.id = canvas_nodes.canvas_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.canvases c
      where c.id = canvas_nodes.canvas_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  );

-- canvas_edges (child of canvases)
drop policy if exists "canvas edges are owned by user" on public.canvas_edges;
create policy "canvas edges are owned by user"
  on public.canvas_edges for all
  using (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.canvases c
      where c.id = canvas_edges.canvas_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.canvases c
      where c.id = canvas_edges.canvas_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  );

-- customers
drop policy if exists "customers are owned by user" on public.customers;
create policy "customers are owned by user"
  on public.customers for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- customer_employees (child of customers)
drop policy if exists "customer employees are owned by user" on public.customer_employees;
create policy "customer employees are owned by user"
  on public.customer_employees for all
  using (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.customers c
      where c.id = customer_employees.customer_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.customers c
      where c.id = customer_employees.customer_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  );

-- suppliers
drop policy if exists "suppliers are owned by user" on public.suppliers;
create policy "suppliers are owned by user"
  on public.suppliers for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- supplier_employees (child of suppliers)
drop policy if exists "supplier employees are owned by user" on public.supplier_employees;
create policy "supplier employees are owned by user"
  on public.supplier_employees for all
  using (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.suppliers s
      where s.id = supplier_employees.supplier_id
        and (s.user_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.suppliers s
      where s.id = supplier_employees.supplier_id
        and (s.user_id = auth.uid() or public.is_admin())
    )
  );

-- products
drop policy if exists "products are owned by user" on public.products;
create policy "products are owned by user"
  on public.products for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- product_variants (child of products)
drop policy if exists "product variants are owned by user" on public.product_variants;
create policy "product variants are owned by user"
  on public.product_variants for all
  using (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and (p.user_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and (p.user_id = auth.uid() or public.is_admin())
    )
  );

-- workspace_options
drop policy if exists "workspace options are owned by user" on public.workspace_options;
create policy "workspace options are owned by user"
  on public.workspace_options for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- generic_node_definitions
drop policy if exists "generic node definitions are owned by user" on public.generic_node_definitions;
create policy "generic node definitions are owned by user"
  on public.generic_node_definitions for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- canvas_sends (child of canvases)
drop policy if exists "canvas sends are owned by user" on public.canvas_sends;
create policy "canvas sends are owned by user"
  on public.canvas_sends for all
  using (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.canvases c
      where c.id = canvas_sends.canvas_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    (user_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.canvases c
      where c.id = canvas_sends.canvas_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  );

-- sample_orders
drop policy if exists "sample orders are owned by user" on public.sample_orders;
create policy "sample orders are owned by user"
  on public.sample_orders for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- sample_order_updates
drop policy if exists "sample order updates are owned by user" on public.sample_order_updates;
create policy "sample order updates are owned by user"
  on public.sample_order_updates for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- app_settings (primary key is (user_id, key))
drop policy if exists "app settings are owned by user" on public.app_settings;
create policy "app settings are owned by user"
  on public.app_settings for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ── 6. Storage: allow admin to write into any user folder ─────────────────
-- Bucket 'uploads' is public-read (no select policy); writes are scoped to
-- each user's folder. Admin overrides that so they can edit/delete any image.
drop policy if exists "users insert own uploads" on storage.objects;
create policy "users insert own uploads"
  on storage.objects for insert
  with check (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "users update own uploads" on storage.objects;
create policy "users update own uploads"
  on storage.objects for update
  using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "users delete own uploads" on storage.objects;
create policy "users delete own uploads"
  on storage.objects for delete
  using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ── 7. Allow admins to edit any canvas (canvas-graph save path) ────────────
-- The client saves a canvas by id. For a normal user the canvas must be their
-- own; an admin may save any canvas, and inserted nodes/edges inherit the
-- canvas's actual owner so that canvas stays viewable by its level-1 owner too.
create or replace function public.replace_canvas_graph(
  p_canvas_id uuid,
  p_content jsonb,
  p_nodes jsonb default '[]'::jsonb,
  p_edges jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nodes  jsonb := coalesce(p_nodes, '[]'::jsonb);
  v_edges  jsonb := coalesce(p_edges, '[]'::jsonb);
  v_owner  uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save a canvas.'
      using errcode = '28000';
  end if;

  if jsonb_typeof(v_nodes) <> 'array' then
    raise exception 'Canvas nodes must be a JSON array.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_edges) <> 'array' then
    raise exception 'Canvas edges must be a JSON array.'
      using errcode = '22023';
  end if;

  select user_id into v_owner
  from public.canvases
  where id = p_canvas_id
    and (user_id = auth.uid() or public.is_admin());

  if v_owner is null then
    raise exception 'Canvas not found or not owned by current user.'
      using errcode = 'P0002';
  end if;

  update public.canvases
  set content = jsonb_build_object('nodes', v_nodes, 'edges', v_edges)
  where id = p_canvas_id
    and (user_id = auth.uid() or public.is_admin());

  delete from public.canvas_edges where canvas_id = p_canvas_id;
  delete from public.canvas_nodes where canvas_id = p_canvas_id;

  insert into public.canvas_nodes (
    canvas_id, user_id, id, type, position, data, parent_id, raw, sort_index
  )
  select
    p_canvas_id,
    v_owner,
    node_value->>'id',
    node_value->>'type',
    coalesce(node_value->'position', '{"x":0,"y":0}'::jsonb),
    coalesce(node_value->'data', '{}'::jsonb),
    nullif(node_value->>'parentId', ''),
    node_value,
    (ordinality - 1)::integer
  from jsonb_array_elements(v_nodes) with ordinality as nodes(node_value, ordinality);

  insert into public.canvas_edges (
    canvas_id, user_id, id, source, target, source_handle, target_handle, type, data, raw, sort_index
  )
  select
    p_canvas_id,
    v_owner,
    edge_value->>'id',
    edge_value->>'source',
    edge_value->>'target',
    nullif(edge_value->>'sourceHandle', ''),
    nullif(edge_value->>'targetHandle', ''),
    nullif(edge_value->>'type', ''),
    coalesce(edge_value->'data', '{}'::jsonb),
    edge_value,
    (ordinality - 1)::integer
  from jsonb_array_elements(v_edges) with ordinality as edges(edge_value, ordinality);
end;
$$;

grant execute on function public.replace_canvas_graph(uuid, jsonb, jsonb, jsonb)
  to authenticated;

notify pgrst, 'reload schema';