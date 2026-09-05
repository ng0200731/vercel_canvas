-- Canvas send approvals, sequence IDs, and public scan snapshots.

alter table public.canvases
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'awaiting_approval', 'approved', 'rejected'));

create sequence if not exists public.canvas_send_sequence start 1;

create table if not exists public.canvas_sends (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade default auth.uid(),
  canvas_id          uuid not null references public.canvases(id) on delete cascade,
  sequence           text not null unique default ('CA' || lpad(nextval('public.canvas_send_sequence')::text, 6, '0')),
  status             text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'approved', 'rejected')),
  recipient_email    text not null,
  approval_token     text not null unique,
  report_url         text not null,
  approval_url       text not null,
  rejection_url      text not null,
  qr_code_data_url   text,
  selected_image_ids text[] not null default array[]::text[],
  report_snapshot    jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  responded_at       timestamptz
);

create index if not exists canvas_sends_user_id_idx on public.canvas_sends(user_id);
create index if not exists canvas_sends_canvas_id_idx on public.canvas_sends(canvas_id);
create index if not exists canvas_sends_sequence_idx on public.canvas_sends(sequence);
create index if not exists canvas_sends_approval_token_idx on public.canvas_sends(approval_token);

alter table public.canvas_sends enable row level security;

drop policy if exists "canvas sends are owned by user" on public.canvas_sends;
create policy "canvas sends are owned by user"
  on public.canvas_sends for all
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.canvases c
      where c.id = canvas_sends.canvas_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.canvases c
      where c.id = canvas_sends.canvas_id
        and c.user_id = auth.uid()
    )
  );

create or replace function public.respond_canvas_send(
  p_token text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canvas_id uuid;
  v_sequence text;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid canvas send response.'
      using errcode = '22023';
  end if;

  update public.canvas_sends
  set status = p_status,
      responded_at = now()
  where approval_token = p_token
  returning canvas_id, sequence into v_canvas_id, v_sequence;

  if v_canvas_id is null then
    raise exception 'Canvas send link was not found.'
      using errcode = 'P0002';
  end if;

  update public.canvases
  set status = p_status,
      updated_at = now()
  where id = v_canvas_id;

  return jsonb_build_object(
    'canvasId', v_canvas_id,
    'sequence', v_sequence,
    'status', p_status
  );
end;
$$;

create or replace function public.get_canvas_send_public(
  p_sequence text,
  p_token text
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'sequence', cs.sequence,
    'status', cs.status,
    'recipient_email', cs.recipient_email,
    'report_snapshot', cs.report_snapshot,
    'created_at', cs.created_at,
    'responded_at', cs.responded_at,
    'canvases', jsonb_build_object(
      'name', c.name,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'content', c.content,
      'projects', jsonb_build_object(
        'name', p.name,
        'customer_name', p.customer_name,
        'employee_name', p.employee_name,
        'employee_title', p.employee_title,
        'employee_email', p.employee_email,
        'employee_tel', p.employee_tel
      )
    )
  )
  from public.canvas_sends cs
  join public.canvases c on c.id = cs.canvas_id
  left join public.projects p on p.id = c.project_id
  where cs.sequence = p_sequence
    and cs.approval_token = p_token
  limit 1;
$$;

grant execute on function public.respond_canvas_send(text, text) to anon, authenticated;
grant execute on function public.get_canvas_send_public(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
