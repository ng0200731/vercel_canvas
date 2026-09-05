-- Allow a customer product without a project: drop project_id from the
-- owner-fields constraint. A customer product still requires a customer.
alter table public.products
  drop constraint if exists products_owner_fields_valid;

alter table public.products
  add constraint products_owner_fields_valid check (
    (owner_kind = 'supplier' and customer_id is null and project_id is null and supplier_id is not null)
    or
    (owner_kind = 'customer' and supplier_id is null and customer_id is not null)
  );

notify pgrst, 'reload schema';