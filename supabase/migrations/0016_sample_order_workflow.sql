-- Durable supplier purchase orders, progress updates, and physical-sample approval.

create table if not exists public.sample_orders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade default auth.uid(),
  canvas_send_id        uuid references public.canvas_sends(id) on delete set null,
  canvas_id             uuid references public.canvases(id) on delete set null,
  project_id            uuid references public.projects(id) on delete set null,
  supplier_id           uuid references public.suppliers(id) on delete set null,
  sequence              text not null check (sequence ~ '^CA[0-9]{6}$'),
  recipient_email       text not null,
  approver_email        text not null,
  snapshot              jsonb not null,
  supplier_token_hash   text not null unique,
  email_status          text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  email_error           text,
  delivery_count        integer not null default 1 check (delivery_count >= 0),
  purchase_sent_at      timestamptz,
  current_stage         text check (current_stage in ('pmc', 'purchase', 'production', 'quality_control', 'package', 'shipment', 'invoice')),
  current_payload       jsonb,
  latest_update_at      timestamptz,
  approval_status       text not null default 'not_requested' check (approval_status in ('not_requested', 'pending', 'approved', 'rejected')),
  approval_token_hash   text unique,
  approval_email_status text check (approval_email_status in ('pending', 'sent', 'failed')),
  approval_error        text,
  approval_sent_at      timestamptz,
  approval_responded_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sample_orders_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint sample_orders_payload_object check (current_payload is null or jsonb_typeof(current_payload) = 'object')
);

create unique index if not exists sample_orders_send_supplier_unique
  on public.sample_orders(canvas_send_id, supplier_id)
  where canvas_send_id is not null and supplier_id is not null;
create index if not exists sample_orders_user_updated_idx on public.sample_orders(user_id, updated_at desc);
create index if not exists sample_orders_sequence_idx on public.sample_orders(sequence);
create index if not exists sample_orders_supplier_token_idx on public.sample_orders(supplier_token_hash);
create index if not exists sample_orders_approval_token_idx on public.sample_orders(approval_token_hash);

create table if not exists public.sample_order_updates (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.sample_orders(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  stage      text not null check (stage in ('pmc', 'purchase', 'production', 'quality_control', 'package', 'shipment', 'invoice')),
  payload    jsonb not null,
  source     text not null default 'supplier_web' check (source in ('supplier_web', 'demo')),
  created_at timestamptz not null default now(),
  constraint sample_order_updates_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists sample_order_updates_order_created_idx
  on public.sample_order_updates(order_id, created_at desc);

drop trigger if exists sample_orders_touch_updated_at on public.sample_orders;
create trigger sample_orders_touch_updated_at
  before update on public.sample_orders
  for each row execute function public.touch_updated_at();

alter table public.sample_orders enable row level security;
alter table public.sample_order_updates enable row level security;

drop policy if exists "sample orders are owned by user" on public.sample_orders;
create policy "sample orders are owned by user" on public.sample_orders for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "sample order updates are owned by user" on public.sample_order_updates;
create policy "sample order updates are owned by user" on public.sample_order_updates for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.get_sample_order_public(p_token_hash text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'id', so.id,
    'sequence', so.sequence,
    'snapshot', so.snapshot,
    'current_stage', so.current_stage,
    'current_payload', so.current_payload,
    'approval_status', so.approval_status,
    'purchase_sent_at', so.purchase_sent_at,
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sou.id,
        'stage', sou.stage,
        'payload', sou.payload,
        'created_at', sou.created_at
      ) order by sou.created_at desc)
      from public.sample_order_updates sou where sou.order_id = so.id
    ), '[]'::jsonb)
  )
  from public.sample_orders so
  where so.supplier_token_hash = p_token_hash
  limit 1;
$$;

create or replace function public.submit_sample_order_update(
  p_token_hash text,
  p_stage text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.sample_orders%rowtype;
  v_update_id uuid;
begin
  if p_stage not in ('pmc', 'purchase', 'production', 'quality_control', 'package', 'shipment', 'invoice') then
    raise exception 'Invalid sample stage.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload->>'stage' <> p_stage then
    raise exception 'Invalid sample update payload.' using errcode = '22023';
  end if;

  select * into v_order from public.sample_orders where supplier_token_hash = p_token_hash for update;
  if v_order.id is null then
    raise exception 'Sample order link was not found.' using errcode = 'P0002';
  end if;

  insert into public.sample_order_updates(order_id, user_id, stage, payload, source)
  values (v_order.id, v_order.user_id, p_stage, p_payload, 'supplier_web') returning id into v_update_id;

  update public.sample_orders
  set current_stage = p_stage,
      current_payload = p_payload,
      latest_update_at = now(),
      approval_status = case
        when p_stage = 'shipment' and approval_status <> 'approved' then 'pending'
        else approval_status
      end,
      approval_token_hash = case
        when p_stage = 'shipment' and approval_status <> 'approved' then null
        else approval_token_hash
      end
  where id = v_order.id;

  return jsonb_build_object(
    'orderId', v_order.id,
    'updateId', v_update_id,
    'sequence', v_order.sequence,
    'approverEmail', v_order.approver_email,
    'recipientEmail', v_order.recipient_email,
    'snapshot', v_order.snapshot,
    'needsApproval', p_stage = 'shipment' and v_order.approval_status <> 'approved'
  );
end;
$$;

create or replace function public.respond_sample_order_approval(p_token_hash text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.sample_orders%rowtype;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid approval response.' using errcode = '22023';
  end if;
  select * into v_order from public.sample_orders where approval_token_hash = p_token_hash for update;
  if v_order.id is null then
    raise exception 'Approval link was not found.' using errcode = 'P0002';
  end if;
  if v_order.approval_status <> 'pending' then
    return jsonb_build_object('sequence', v_order.sequence, 'status', v_order.approval_status, 'alreadyResponded', true);
  end if;
  update public.sample_orders
  set approval_status = p_status, approval_responded_at = now()
  where id = v_order.id;
  return jsonb_build_object('sequence', v_order.sequence, 'status', p_status, 'alreadyResponded', false);
end;
$$;

grant execute on function public.get_sample_order_public(text) to anon, authenticated;
grant execute on function public.submit_sample_order_update(text, text, jsonb) to anon, authenticated;
grant execute on function public.respond_sample_order_approval(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
