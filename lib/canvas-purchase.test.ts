import { describe, expect, it } from "vitest";

import { canvasPurchaseTargets } from "@/lib/canvas-purchase";
import type { Canvas } from "@/lib/store";
import type { ProductRecord, SupplierRecord } from "@/lib/workspace-records";

describe("canvasPurchaseTargets", () => {
  it("groups multiple purchase nodes for one supplier without losing lines", () => {
    const supplier: SupplierRecord = {
      id: "supplier-1",
      company: {
        companyName: "Trim Works",
        emailDomainSuffix: "example.com",
        productTypes: ["woven-label"],
      },
      employees: [
        {
          id: "employee-1",
          userName: "Mina",
          emailPrefix: "mina",
          title: "Coordinator",
          tel: "+86 100",
        },
      ],
      isShared: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const product: ProductRecord = {
      id: "product-1",
      ownerKind: "supplier",
      supplierId: supplier.id,
      customerId: null,
      projectId: null,
      productType: "woven-label",
      subject: "Main label",
      detail: "Recycled yarn",
      variants: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const canvas: Canvas = {
      id: "canvas-1",
      projectId: "project-1",
      name: "Canvas",
      status: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      content: {
        edges: [],
        nodes: ["A", "B"].map((subject, index) => ({
          id: `node-${index}`,
          type: "suppler" as const,
          position: { x: 0, y: 0 },
          data: { supplierId: supplier.id, productId: product.id, productSubject: subject },
        })),
      },
    };
    const targets = canvasPurchaseTargets({ canvas, suppliers: [supplier], products: [product] });
    expect(targets).toHaveLength(1);
    expect(targets[0].lines.map((line) => line.subject)).toEqual(["A", "B"]);
  });
});
