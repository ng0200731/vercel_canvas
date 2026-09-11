import { DEFAULT_EDGE_COLOR, EDGE_WIDTH } from "./ports";
import { createNode } from "./registry";
import type { CanvasContent } from "./types";

/** Create the linked graph shown to regular users on a new canvas. */
export function createRegularUserCanvasContent(): CanvasContent {
  const customer = createNode("product", { x: 0, y: 0 });
  const generate = createNode("generate", { x: 320, y: 0 });
  const output = createNode("imageOutput", { x: 640, y: 0 });
  const edge = (source: string, target: string) => ({
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "deletable" as const,
    style: { stroke: DEFAULT_EDGE_COLOR, strokeWidth: EDGE_WIDTH },
  });
  return { nodes: [customer, generate, output], edges: [edge(customer.id, generate.id), edge(generate.id, output.id)] };
}
