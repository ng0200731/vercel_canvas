-- Public token-gated canvas send scan/approval RPCs.
-- Safe to run more than once.

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
