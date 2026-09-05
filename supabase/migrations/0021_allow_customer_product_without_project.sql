-- Customer products may be associated with a customer without a project.
-- Preserve the existing function implementation and only relax its project check.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(p.oid)
    into function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'upsert_workspace_product_with_variants'
    and pg_get_function_identity_arguments(p.oid) =
      'p_product_id uuid, p_user_id uuid, p_owner_kind text, p_supplier_id uuid, p_customer_id uuid, p_project_id uuid, p_product_type text, p_subject text, p_detail text, p_variants jsonb';

  if function_definition is null then
    raise exception 'Expected product upsert function was not found.';
  end if;

  function_definition := replace(
    function_definition,
    'if p_owner_kind = ''customer'' and not exists (',
    'if p_owner_kind = ''customer'' and p_project_id is not null and not exists ('
  );
  execute function_definition;
end;
$$;

notify pgrst, 'reload schema';
