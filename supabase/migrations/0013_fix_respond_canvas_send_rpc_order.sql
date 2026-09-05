-- Recreate respond_canvas_send with the parameter order PostgREST resolves
-- from the API call: p_status, p_token.

drop function if exists public.respond_canvas_send(text, text);

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

grant execute on function public.respond_canvas_send(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
