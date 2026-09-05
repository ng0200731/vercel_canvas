-- Structured workspace records for customers, suppliers, and products.

create table if not exists public.customers (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade default auth.uid(),
  company_name        text not null,
  email_domain_suffix text not null,
  customer_type       text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists customers_user_id_idx on public.customers(user_id);
create index if not exists customers_company_name_idx on public.customers(company_name);

create table if not exists public.customer_employees (
  id           text not null,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  user_name    text not null,
  email_prefix text not null,
  title        text not null,
  tel          text not null,
  sort_index   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (customer_id, id)
);

create index if not exists customer_employees_user_id_idx
  on public.customer_employees(user_id);
create index if not exists customer_employees_customer_sort_idx
  on public.customer_employees(customer_id, sort_index);

create table if not exists public.suppliers (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade default auth.uid(),
  company_name        text not null,
  email_domain_suffix text not null,
  product_types       text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint suppliers_product_types_not_empty check (cardinality(product_types) > 0),
  constraint suppliers_product_types_allowed check (
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
  )
);

create index if not exists suppliers_user_id_idx on public.suppliers(user_id);
create index if not exists suppliers_company_name_idx on public.suppliers(company_name);
create index if not exists suppliers_product_types_idx
  on public.suppliers using gin(product_types);

create table if not exists public.supplier_employees (
  id           text not null,
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  user_name    text not null,
  email_prefix text not null,
  title        text not null,
  tel          text not null,
  sort_index   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (supplier_id, id)
);

create index if not exists supplier_employees_user_id_idx
  on public.supplier_employees(user_id);
create index if not exists supplier_employees_supplier_sort_idx
  on public.supplier_employees(supplier_id, sort_index);

create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_type       text not null default 'woven-label',
  subject            text not null,
  detail             text not null,
  material           text not null,
  color_notes        text not null,
  parameters         jsonb not null default '{}'::jsonb,
  unit_price         text not null default '0',
  price_unit         text not null default 'per pc',
  image_name         text,
  image_url          text,
  image_storage_path text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint products_product_type_allowed check (
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
  constraint products_parameters_object check (jsonb_typeof(parameters) = 'object')
);

create index if not exists products_user_id_idx on public.products(user_id);
create index if not exists products_subject_idx on public.products(subject);
create index if not exists products_product_type_idx on public.products(product_type);

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
  before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists customer_employees_touch_updated_at on public.customer_employees;
create trigger customer_employees_touch_updated_at
  before update on public.customer_employees
  for each row execute function public.touch_updated_at();

drop trigger if exists suppliers_touch_updated_at on public.suppliers;
create trigger suppliers_touch_updated_at
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

drop trigger if exists supplier_employees_touch_updated_at on public.supplier_employees;
create trigger supplier_employees_touch_updated_at
  before update on public.supplier_employees
  for each row execute function public.touch_updated_at();

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

alter table public.customers enable row level security;
alter table public.customer_employees enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_employees enable row level security;
alter table public.products enable row level security;

drop policy if exists "customers are owned by user" on public.customers;
create policy "customers are owned by user"
  on public.customers for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "customer employees are owned by user" on public.customer_employees;
create policy "customer employees are owned by user"
  on public.customer_employees for all
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.customers c
      where c.id = customer_employees.customer_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.customers c
      where c.id = customer_employees.customer_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "suppliers are owned by user" on public.suppliers;
create policy "suppliers are owned by user"
  on public.suppliers for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "supplier employees are owned by user" on public.supplier_employees;
create policy "supplier employees are owned by user"
  on public.supplier_employees for all
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.suppliers s
      where s.id = supplier_employees.supplier_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.suppliers s
      where s.id = supplier_employees.supplier_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "products are owned by user" on public.products;
create policy "products are owned by user"
  on public.products for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.upsert_customer_record(
  p_customer_id uuid,
  p_user_id uuid,
  p_company_name text,
  p_email_domain_suffix text,
  p_customer_type text,
  p_employees jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_customer_id uuid := coalesce(p_customer_id, gen_random_uuid());
  v_employees jsonb := coalesce(p_employees, '[]'::jsonb);
  v_result jsonb;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'Authentication is required to save a customer.'
      using errcode = '28000';
  end if;

  if jsonb_typeof(v_employees) <> 'array' or jsonb_array_length(v_employees) = 0 then
    raise exception 'Customer employees must be a non-empty JSON array.'
      using errcode = '22023';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and user_id = auth.uid()
  ) then
    raise exception 'Customer not found or not owned by current user.'
      using errcode = 'P0002';
  end if;

  insert into public.customers (
    id,
    user_id,
    company_name,
    email_domain_suffix,
    customer_type
  )
  values (
    v_customer_id,
    auth.uid(),
    trim(p_company_name),
    lower(trim(p_email_domain_suffix)),
    trim(p_customer_type)
  )
  on conflict (id) do update
  set company_name = excluded.company_name,
      email_domain_suffix = excluded.email_domain_suffix,
      customer_type = excluded.customer_type
  where customers.user_id = auth.uid();

  delete from public.customer_employees where customer_id = v_customer_id;

  insert into public.customer_employees (
    id,
    customer_id,
    user_id,
    user_name,
    email_prefix,
    title,
    tel,
    sort_index
  )
  select
    employee_value->>'id',
    v_customer_id,
    auth.uid(),
    trim(employee_value->>'userName'),
    lower(trim(employee_value->>'emailPrefix')),
    trim(employee_value->>'title'),
    trim(employee_value->>'tel'),
    (ordinality - 1)::integer
  from jsonb_array_elements(v_employees) with ordinality as employees(employee_value, ordinality);

  select jsonb_build_object(
    'id', c.id,
    'company_name', c.company_name,
    'email_domain_suffix', c.email_domain_suffix,
    'customer_type', c.customer_type,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'employees', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'user_name', e.user_name,
            'email_prefix', e.email_prefix,
            'title', e.title,
            'tel', e.tel,
            'sort_index', e.sort_index
          )
          order by e.sort_index
        )
        from public.customer_employees e
        where e.customer_id = c.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.customers c
  where c.id = v_customer_id
    and c.user_id = auth.uid();

  return v_result;
end;
$$;

create or replace function public.upsert_supplier_record(
  p_supplier_id uuid,
  p_user_id uuid,
  p_company_name text,
  p_email_domain_suffix text,
  p_product_types text[],
  p_employees jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_supplier_id uuid := coalesce(p_supplier_id, gen_random_uuid());
  v_employees jsonb := coalesce(p_employees, '[]'::jsonb);
  v_result jsonb;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'Authentication is required to save a supplier.'
      using errcode = '28000';
  end if;

  if cardinality(p_product_types) = 0 then
    raise exception 'Supplier product types are required.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_employees) <> 'array' or jsonb_array_length(v_employees) = 0 then
    raise exception 'Supplier employees must be a non-empty JSON array.'
      using errcode = '22023';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and user_id = auth.uid()
  ) then
    raise exception 'Supplier not found or not owned by current user.'
      using errcode = 'P0002';
  end if;

  insert into public.suppliers (
    id,
    user_id,
    company_name,
    email_domain_suffix,
    product_types
  )
  values (
    v_supplier_id,
    auth.uid(),
    trim(p_company_name),
    lower(trim(p_email_domain_suffix)),
    p_product_types
  )
  on conflict (id) do update
  set company_name = excluded.company_name,
      email_domain_suffix = excluded.email_domain_suffix,
      product_types = excluded.product_types
  where suppliers.user_id = auth.uid();

  delete from public.supplier_employees where supplier_id = v_supplier_id;

  insert into public.supplier_employees (
    id,
    supplier_id,
    user_id,
    user_name,
    email_prefix,
    title,
    tel,
    sort_index
  )
  select
    employee_value->>'id',
    v_supplier_id,
    auth.uid(),
    trim(employee_value->>'userName'),
    lower(trim(employee_value->>'emailPrefix')),
    trim(employee_value->>'title'),
    trim(employee_value->>'tel'),
    (ordinality - 1)::integer
  from jsonb_array_elements(v_employees) with ordinality as employees(employee_value, ordinality);

  select jsonb_build_object(
    'id', s.id,
    'company_name', s.company_name,
    'email_domain_suffix', s.email_domain_suffix,
    'product_types', s.product_types,
    'created_at', s.created_at,
    'updated_at', s.updated_at,
    'employees', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'user_name', e.user_name,
            'email_prefix', e.email_prefix,
            'title', e.title,
            'tel', e.tel,
            'sort_index', e.sort_index
          )
          order by e.sort_index
        )
        from public.supplier_employees e
        where e.supplier_id = s.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.suppliers s
  where s.id = v_supplier_id
    and s.user_id = auth.uid();

  return v_result;
end;
$$;

grant execute on function public.upsert_customer_record(uuid, uuid, text, text, text, jsonb)
  to authenticated;
grant execute on function public.upsert_supplier_record(uuid, uuid, text, text, text[], jsonb)
  to authenticated;
