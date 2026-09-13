import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupplerNode } from "@/components/canvas/nodes/suppler-node";

vi.mock("@/components/canvas/canvas-context", () => ({
  useCanvasActions: () => ({
    updateNodeData: vi.fn(),
    deleteNode: vi.fn(),
    getNodeConnectionCount: () => 0,
    resizeNode: vi.fn(),
  }),
  useConnectionHighlight: () => null,
  useGroupAccent: () => null,
}));

vi.mock("@/lib/hooks/use-workspace-records", () => ({
  useSuppliers: () => ({ data: [], isLoading: false, error: null }),
  useProducts: () => ({ data: [], isLoading: false, error: null }),
  useUpsertProduct: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/components/canvas/nodes/delete-button", () => ({
  NodeDeleteButton: () => null,
}));
vi.mock("@/components/canvas/nodes/port", () => ({
  InputPort: () => null,
  OutputPort: () => null,
}));
vi.mock("@/components/canvas/nodes/resize-handle", () => ({
  ResizeHandle: () => null,
}));

// Stub the real management dialog so the test exercises the node's own wiring:
// one trigger that opens the dialog. The engine switcher lives inside the real
// dialog and is covered by supplier-image-management-dialog.test.tsx.
vi.mock("@/components/canvas/supplier-image-management-dialog", () => ({
  SupplierImageManagementDialog: ({
    engine,
    trigger,
  }: {
    engine: string;
    trigger: React.ReactElement;
  }) => {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <div onClick={() => setOpen(true)}>{trigger}</div>
        {open ? (
          <div role="dialog" data-engine={engine}>
            <p>management dialog for {engine}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close management dialog">
              Close
            </button>
          </div>
        ) : null}
      </div>
    );
  },
}));

// The product image browser only shows when a supplier is selected; keep it a
// no-op stub so it can never affect the search-trigger assertions.
vi.mock("@/components/product-image-browser-dialog", () => ({
  ProductImageBrowserDialog: () => null,
}));

const nodeData = {} as unknown as Parameters<typeof SupplerNode>[0]["data"];

function renderNode() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  void act(() => {
    root.render(
      <SupplerNode
        id="supplier-1"
        type="suppler"
        data={nodeData}
        selectable
        deletable
        draggable
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        selected={false}
        dragging={false}
        zIndex={0}
      />,
    );
  });
  return { container, root };
}

describe("SupplerNode search trigger", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a single consolidated search trigger instead of several per-engine buttons", async () => {
    const { root } = renderNode();
    await act(async () => {
      root.render(
        <SupplerNode
          id="supplier-1"
          type="suppler"
          data={nodeData}
          selectable
          deletable
          draggable
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={false}
          dragging={false}
          zIndex={0}
        />,
      );
    });

    const triggers = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Search similar supplier product images"]',
      ),
    );
    expect(triggers).toHaveLength(1);

    // No leftover per-engine aria-labels from the old multi-button layout.
    expect(document.querySelector<HTMLButtonElement>('button[aria-label*="Milvus"]')).toBeNull();
  });

  it("opens the image search dialog from the single trigger", async () => {
    const { root } = renderNode();
    await act(async () => {
      root.render(
        <SupplerNode
          id="supplier-1"
          type="suppler"
          data={nodeData}
          selectable
          deletable
          draggable
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={false}
          dragging={false}
          zIndex={0}
        />,
      );
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Search similar supplier product images"]',
    );
    await act(async () => {
      trigger?.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});