-- Read-only product visibility for shared suppliers.
--
-- Migration 0027 let every regular (level-1) user VIEW suppliers (and their
-- employees) that an admin toggled as shared (is_shared = true), but NOT edit
-- or delete them. This migration extends the same read-only visibility to the
-- PRODUCTS owned by those suppliers and to their product_variants.
--
-- Writes stay owner/admin-only (mirroring 0027 / 0025). No client code can
-- forge a read: visibility is enforced purely by RLS, keyed off
-- suppliers.is_shared, which only the admin's SECURITY DEFINER can flip.
--
-- Idempotent: safe to run more than once.

-- ── 1. products: split the owner-or-admin ALL policy into read + write ──────
-- Read: owner OR admin OR owns nothing but belongs to a shared supplier.
-- Write: owner OR admin (unchanged — keeps edit/delete admin/owner-only).
drop policy if exists "products are owned by user" on public.products;

create policy "products are visible to owner, admin, or shared supplier"
  on public.products for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      owner_kind = 'supplier'
      and exists (
        select 1 from public.suppliers s
        where s.id = products.supplier_id and s.is_shared
      )
    )
  );

create policy "products are editable by owner or admin"
  on public.products for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ── 2. product_variants: allow reading variants of shared suppliers' products
drop policy if exists "product variants are owned by user" on public.product_variants;

create policy "product variants visible when owner, admin, or shared supplier"
  on public.product_variants for select
  using (
    (user_id = auth.uid() or public.is_admin())
    or exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and (
          p.user_id = auth.uid()
          or public.is_admin()
          or (
            p.owner_kind = 'supplier'
            and exists (
              select 1 from public.suppliers s
              where s.id = p.supplier_id and s.is_shared
            )
          )
        )
    )
  );

create policy "product variants are editable by owner or admin"
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

notify pgrst, 'reload schema';