-- Make canvas send approve/reject links one-time use.
-- Re-clicking an already answered link returns the current status without
-- changing canvas_sends or canvases again.

create or replace function public.respond_canvas_send(
  p_status text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canvas_id uuid;
  v_sequence text;
  v_current_status text;
  v_responded_at timestamptz;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid canvas send response.'
      using errcode = '22023';
  end if;

  select canvas_id, sequence, status, responded_at
  into v_canvas_id, v_sequence, v_current_status, v_responded_at
  from public.canvas_sends
  where approval_token = p_token;

  if v_canvas_id is null then
    raise exception 'Canvas send link was not found.'
      using errcode = 'P0002';
  end if;

  if v_current_status <> 'awaiting_approval' then
    return jsonb_build_object(
      'canvasId', v_canvas_id,
      'sequence', v_sequence,
      'status', v_current_status,
      'alreadyResponded', true,
      'respondedAt', v_responded_at
    );
  end if;

  update public.canvas_sends
  set status = p_status,
      responded_at = now()
  where approval_token = p_token;

  update public.canvases
  set status = p_status,
      updated_at = now()
  where id = v_canvas_id;

  return jsonb_build_object(
    'canvasId', v_canvas_id,
    'sequence', v_sequence,
    'status', p_status,
    'alreadyResponded', false,
    'respondedAt', now()
  );
end;
$$;

grant execute on function public.respond_canvas_send(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
