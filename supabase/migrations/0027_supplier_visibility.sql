-- Admin-controlled supplier visibility.
--
-- Adds an admin-only ON/OFF toggle (is_shared) per supplier. New suppliers
-- default to OFF. When ON, every regular (level-1) user can VIEW the supplier
-- (company + employees) but cannot edit or delete it; writes stay owner/admin-only.
--
-- Enforcement is via RLS + a SECURITY DEFINER helper (set_supplier_shared), so no
-- client code can forge the toggle — mirroring the is_admin() idiom in 0025.
--
-- Idempotent: safe to run more than once.

-- ── 1. Visibility flag (default false ⇒ new suppliers are OFF) ───────────────
alter table public.suppliers
  add column if not exists is_shared boolean not null default false;

comment on column public.suppliers.is_shared is
  'Admin toggle: when true, all regular users can view this supplier (read-only).';

create index if not exists suppliers_is_shared_idx
  on public.suppliers(is_shared);

-- ── 2. Suppliers RLS: split the owner-or-admin ALL policy into read + write ──
-- Read: owner OR admin OR shared-to-users.
-- Write: owner OR admin (unchanged — keeps edit/delete admin/owner-only).
drop policy if exists "suppliers are owned by user" on public.suppliers;

create policy "suppliers are visible to owner, admin, or shared"
  on public.suppliers for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or is_shared
  );

create policy "suppliers are editable by owner or admin"
  on public.suppliers for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ── 3. supplier_employees RLS: allow reading shared suppliers' employees ─────
drop policy if exists "supplier employees are owned by user" on public.supplier_employees;

create policy "supplier employees visible when supplier is visible"
  on public.supplier_employees for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.suppliers s
      where s.id = supplier_employees.supplier_id and s.is_shared
    )
  );

create policy "supplier employees are editable by owner or admin"
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

-- ── 4. SECURITY DEFINER RPC: only an admin may flip the toggle ──────────────
create or replace function public.set_supplier_shared(
  p_supplier_id uuid,
  p_shared boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    update public.suppliers set is_shared = p_shared where id = p_supplier_id;
  end if;
end;
$$;

grant execute on function public.set_supplier_shared(uuid, boolean)
  to authenticated;

notify pgrst, 'reload schema';