import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierImageManagementDialog } from "@/components/canvas/supplier-image-management-dialog";
import { SUPPLIER_MATCH_ENGINES } from "@/lib/supplier-image-match";

vi.mock("@/lib/hooks/use-supplier-image-match", () => ({
  useSupplierImageMatch: () => ({
    reset: vi.fn(),
    mutateAsync: vi.fn(),
    data: null,
    isPending: false,
    error: null,
    isError: false,
  }),
}));

vi.mock("@/lib/hooks/use-workspace-records", () => ({
  useUpsertProduct: () => ({ mutateAsync: vi.fn() }),
}));

function renderDialog() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  void act(() => {
    root.render(
      <SupplierImageManagementDialog
        products={[]}
        suppliers={[]}
        currentSupplierId={null}
        onSelect={vi.fn()}
        trigger={
          <button type="button" aria-label="Open image search">
            Open search
          </button>
        }
      />,
    );
  });
  return { container, root };
}

describe("SupplierImageManagementDialog engine switcher", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("starts on the default engine and opens from its trigger", async () => {
    const { root } = renderDialog();
    await act(async () => {
      root.render(
        <SupplierImageManagementDialog
          products={[]}
          suppliers={[]}
          currentSupplierId={null}
          onSelect={vi.fn()}
          trigger={
            <button type="button" aria-label="Open image search">
              Open search
            </button>
          }
        />,
      );
    });

    const openButton = document.querySelector<HTMLButtonElement>('button[aria-label="Open image search"]');
    await act(async () => {
      openButton?.click();
    });

    // Default engine is Picture Sherlock.
    const title = document.querySelector<HTMLElement>("[data-slot='dialog-title']");
    expect(title?.textContent).toContain("Search similar supplier images");
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Change image search engine"]'),
    ).not.toBeNull();
  });

  it("lists every engine and switching updates the dialog title", async () => {
    const { root } = renderDialog();
    await act(async () => {
      root.render(
        <SupplierImageManagementDialog
          products={[]}
          suppliers={[]}
          currentSupplierId={null}
          onSelect={vi.fn()}
          trigger={
            <button type="button" aria-label="Open image search">
              Open search
            </button>
          }
        />,
      );
    });

    const openButton = document.querySelector<HTMLButtonElement>('button[aria-label="Open image search"]');
    await act(async () => {
      openButton?.click();
    });

    const engineTrigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Change image search engine"]',
    );
    await act(async () => {
      engineTrigger?.click();
    });

    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(menuItems.length).toBeGreaterThanOrEqual(SUPPLIER_MATCH_ENGINES.length);

    const milvusItem = menuItems.find((item) => item.textContent?.includes("Milvus"));
    expect(milvusItem).toBeDefined();
    await act(async () => {
      (milvusItem as HTMLElement)?.click();
    });

    const title = document.querySelector<HTMLElement>("[data-slot='dialog-title']");
    expect(title?.textContent).toContain("Search similar images with Milvus");
  });
});