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
      'pantone'
    )
  );
