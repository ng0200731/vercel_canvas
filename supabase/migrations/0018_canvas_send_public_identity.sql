-- Include canonical project/canvas identifiers in token-gated canvas scans.
-- Names and report content remain snapshots; IDs come from the relational
-- canvas -> project foreign-key chain and cannot be forged by the client.

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
      'id', c.id,
      'project_id', c.project_id,
      'name', c.name,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'content', c.content,
      'projects', jsonb_build_object(
        'id', p.id,
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
  join public.projects p on p.id = c.project_id
  where cs.sequence = p_sequence
    and cs.approval_token = p_token
  limit 1;
$$;

grant execute on function public.get_canvas_send_public(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
