import { describe, expect, it } from "vitest";

import type { GenericNodeDefinition } from "@/lib/workspace-settings";

import { createNode } from "./registry";
import { createRegularUserCanvasContent } from "./starter-canvas";
import {
  createGenericPresetNode,
  paletteEntries,
  parsePaletteDragPayload,
  serializePaletteDragPayload,
  sortGenericNodeDefinitions,
} from "./palette";

function genericDefinition(overrides: Partial<GenericNodeDefinition> = {}): GenericNodeDefinition {
  return {
    id: "generic-1",
    name: "Rib texture",
    images: [
      {
        id: "rib-front",
        name: "rib-front.webp",
        url: "https://example.com/rib.webp",
        storagePath: "user/rib.webp",
      },
      {
        id: "rib-back",
        name: "rib-back.webp",
        url: "https://example.com/rib-back.webp",
        storagePath: "user/rib-back.webp",
      },
    ],
    sortIndex: 0,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("canvas node palette helpers", () => {
  it("provides ordered role-specific palette entries", () => {
    expect(paletteEntries(true).map((entry) => entry.type)).toEqual([
      "imageInput",
      "generate",
      "imageOutput",
      "suppler",
      "product",
      "action",
      "pantone",
      "g2",
      "painted",
    ]);
    expect(paletteEntries(false).map((entry) => entry.type)).toEqual([
      "imageInput",
      "product",
      "suppler",
      "pantone",
      "generate",
      "imageOutput",
    ]);
    expect(paletteEntries(false).find((entry) => entry.type === "product")?.label).toBe("Customer");
    expect(paletteEntries(true).find((entry) => entry.type === "product")?.label).toBe("Product");
  });

  it("creates a linked horizontal regular-user starter graph", () => {
    const first = createRegularUserCanvasContent();
    const second = createRegularUserCanvasContent();
    expect(first.nodes.map((node) => node.type)).toEqual(["imageInput", "generate", "imageOutput"]);
    expect(first.nodes.map((node) => node.position.y)).toEqual([0, 0, 0]);
    expect(first.nodes.map((node) => node.position.x)).toEqual([0, 320, 640]);
    expect(
      first.edges.map(({ source, target, sourceHandle, targetHandle }) => ({
        source,
        target,
        sourceHandle,
        targetHandle,
      })),
    ).toEqual([
      {
        source: first.nodes[0].id,
        target: first.nodes[1].id,
        sourceHandle: "right",
        targetHandle: "left",
      },
      {
        source: first.nodes[1].id,
        target: first.nodes[2].id,
        sourceHandle: "right",
        targetHandle: "left",
      },
    ]);
    expect(new Set(second.nodes.map((node) => node.id))).not.toEqual(
      new Set(first.nodes.map((node) => node.id)),
    );
  });

  it("round-trips validated registered and generic drag payloads", () => {
    const registered = { kind: "registered-node", type: "pantone" } as const;
    const generic = { kind: "generic-preset", definitionId: "generic-1" } as const;

    expect(parsePaletteDragPayload(serializePaletteDragPayload(registered))).toEqual(registered);
    expect(parsePaletteDragPayload(serializePaletteDragPayload(generic))).toEqual(generic);
  });

  it("rejects malformed, incomplete, and unknown drag payloads", () => {
    expect(parsePaletteDragPayload("not-json")).toBeNull();
    expect(parsePaletteDragPayload(JSON.stringify({ kind: "generic-preset" }))).toBeNull();
    expect(
      parsePaletteDragPayload(JSON.stringify({ kind: "registered-node", type: "not-a-node" })),
    ).toBeNull();
  });

  it("creates an image input snapshot from a generic definition", () => {
    const definition = genericDefinition();
    const node = createGenericPresetNode(definition, { x: 24, y: 48 });
    definition.name = "Changed later";
    definition.images[0].url = "https://example.com/changed.webp";

    expect(node).toMatchObject({
      type: "imageInput",
      position: { x: 24, y: 48 },
      data: {
        alias: "Rib texture",
        imageUrl: null,
        storagePath: null,
        genericDefinitionId: "generic-1",
        genericDefinitionName: "Rib texture",
        genericImages: [
          {
            id: "rib-front",
            name: "rib-front.webp",
            url: "https://example.com/rib.webp",
            storagePath: "user/rib.webp",
          },
          {
            id: "rib-back",
            name: "rib-back.webp",
            url: "https://example.com/rib-back.webp",
            storagePath: "user/rib-back.webp",
          },
        ],
        selectedGenericImageId: null,
      },
    });
  });

  it("orders generic definitions by their saved sequence", () => {
    const definitions = [
      genericDefinition({ id: "third", name: "Third", sortIndex: 2 }),
      genericDefinition({ id: "first", name: "First", sortIndex: 0 }),
      genericDefinition({ id: "second", name: "Second", sortIndex: 1 }),
    ];

    expect(sortGenericNodeDefinitions(definitions).map((definition) => definition.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("gives new Pantone nodes a persisted alias", () => {
    expect(createNode("pantone", { x: 0, y: 0 }).data.alias).toBe("pantone");
  });
});
