-- Adds the 'painted' node type to the canvas_nodes type allow-list.
-- Drop + re-add the constraint so the CHECK matches the current full list
-- (same pattern as 0009_canvas_product_node.sql). 'g2' is also carried over;
-- it was previously only added on the local Postgres schema, not the cloud one.
alter table public.canvas_nodes
  drop constraint if exists canvas_nodes_type_check;

alter table public.canvas_nodes
  add constraint canvas_nodes_type_check check (
    type in (
      'note',
      'image',
      'group',
      'imageInput',
      'generate',
      'imageOutput',
      'suppler',
      'product',
      'action',
      'pantone',
      'g2',
      'painted'
    )
  );
