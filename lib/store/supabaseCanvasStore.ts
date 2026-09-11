import { z } from "zod";

import { EMPTY_CANVAS_CONTENT, NODE_TYPES, type CanvasContent } from "@/lib/nodes/types";
import {
  mergeProjectMetadata,
  serializeLegacyProjectDescription,
  type ProjectMetadata,
} from "@/lib/project-metadata";
import {
  parseCanvasContent,
  parseCanvasEdge,
  parseCanvasNode,
  safeParseCanvasContent,
  xyPositionSchema,
} from "@/lib/nodes/validation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  sampleApprovalStatusSchema,
  sampleEmailStatusSchema,
  sampleOrderSchema,
  sampleOrderSnapshotSchema,
  sampleStageSchema,
  sampleUpdatePayloadSchema,
  type SampleOrder,
} from "@/lib/sample-orders";

import type {
  Canvas,
  CanvasSendRecord,
  CanvasStatus,
  CanvasStore,
  CreateCanvasSendInput,
  CreateCanvasInput,
  CreateProjectInput,
  ImageRecord,
  Project,
  ProjectUpdate,
  RecordImageInput,
  UpdateCanvasSendInput,
} from "./canvasStore";

/**
 * Supabase-backed CanvasStore. Uses the browser client; all access is scoped to
 * the signed-in user via Row Level Security (see supabase/migrations/). Canvas
 * contents are fetched from normalized graph tables, with `canvases.content`
 * kept as a compatibility mirror.
 */

interface ProjectRow {
  id: string;
  user_id?: string | null;
  name: string;
  description: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  employee_title?: string | null;
  employee_email?: string | null;
  employee_tel?: string | null;
  currency_code?: string | null;
  currency_name?: string | null;
  currency_symbol?: string | null;
  destination_country_code?: string | null;
  destination_country_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface CanvasRow {
  id: string;
  project_id: string;
  name: string;
  content: unknown;
  status?: CanvasStatus | null;
  created_at: string;
  updated_at: string;
}

interface CanvasSendRow {
  id: string;
  canvas_id: string;
  sequence: string;
  status: Exclude<CanvasStatus, "draft">;
  recipient_email: string;
  report_url: string;
  approval_url: string;
  rejection_url: string;
  qr_code_data_url: string | null;
  selected_image_ids: string[];
  report_snapshot: unknown;
  created_at: string;
  responded_at: string | null;
}

interface ImageRow {
  id: string;
  canvas_id: string | null;
  source: "upload" | "generated";
  url: string;
  storage_path: string | null;
  prompt: string | null;
  model: string | null;
  model_details?: {
    model?: string | null;
    size?: string | null;
    resolution?: string | null;
    outputFormat?: string | null;
    output_format?: string | null;
    durationMs?: number | null;
    duration_ms?: number | null;
  } | null;
  created_at: string;
}

const projectRowSchema = z.object({
  id: z.string(),
  user_id: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable(),
  customer_id: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  employee_id: z.string().nullable().optional(),
  employee_name: z.string().nullable().optional(),
  employee_title: z.string().nullable().optional(),
  employee_email: z.string().nullable().optional(),
  employee_tel: z.string().nullable().optional(),
  currency_code: z.string().nullable().optional(),
  currency_name: z.string().nullable().optional(),
  currency_symbol: z.string().nullable().optional(),
  destination_country_code: z.string().nullable().optional(),
  destination_country_name: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const canvasRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  content: z.unknown().nullable(),
  status: z.enum(["draft", "awaiting_approval", "approved", "rejected"]).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const canvasSendRowSchema = z.object({
  id: z.string(),
  canvas_id: z.string(),
  sequence: z.string(),
  status: z.enum(["awaiting_approval", "approved", "rejected"]),
  recipient_email: z.string(),
  report_url: z.string(),
  approval_url: z.string(),
  rejection_url: z.string(),
  qr_code_data_url: z.string().nullable(),
  selected_image_ids: z.array(z.string()),
  report_snapshot: z.unknown(),
  created_at: z.string(),
  responded_at: z.string().nullable(),
});

const sampleOrderUpdateRowSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  stage: sampleStageSchema,
  payload: sampleUpdatePayloadSchema,
  source: z.enum(["supplier_web", "demo"]),
  created_at: z.string(),
});

const sampleOrderRowSchema = z.object({
  id: z.string(),
  canvas_send_id: z.string().nullable(),
  canvas_id: z.string().nullable(),
  project_id: z.string().nullable(),
  supplier_id: z.string().nullable(),
  sequence: z.string(),
  recipient_email: z.string(),
  approver_email: z.string(),
  snapshot: sampleOrderSnapshotSchema,
  email_status: sampleEmailStatusSchema,
  email_error: z.string().nullable(),
  delivery_count: z.number(),
  purchase_sent_at: z.string().nullable(),
  current_stage: sampleStageSchema.nullable(),
  current_payload: sampleUpdatePayloadSchema.nullable(),
  latest_update_at: z.string().nullable(),
  approval_status: sampleApprovalStatusSchema,
  approval_email_status: sampleEmailStatusSchema.nullable(),
  approval_error: z.string().nullable(),
  approval_sent_at: z.string().nullable(),
  approval_responded_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  sample_order_updates: z.array(sampleOrderUpdateRowSchema).optional().default([]),
});

const imageRowSchema = z.object({
  id: z.string(),
  canvas_id: z.string().nullable(),
  source: z.enum(["upload", "generated"]),
  url: z.string(),
  storage_path: z.string().nullable(),
  prompt: z.string().nullable(),
  model: z.string().nullable(),
  model_details: z
    .object({
      model: z.string().nullable().optional(),
      size: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
      outputFormat: z.string().nullable().optional(),
      output_format: z.string().nullable().optional(),
      durationMs: z.number().nullable().optional(),
      duration_ms: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  created_at: z.string(),
});

const canvasNodeRowSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  position: xyPositionSchema,
  data: z.record(z.string(), z.unknown()),
  parent_id: z.string().nullable(),
  raw: z.unknown().nullable(),
  sort_index: z.number().int(),
});

const canvasEdgeRowSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  source_handle: z.string().nullable(),
  target_handle: z.string().nullable(),
  type: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  raw: z.unknown().nullable(),
  sort_index: z.number().int(),
});

const PRODUCT_NODE_COMPAT_TYPE_KEY = "__canvasNodeType";

const mapProject = (value: unknown): Project => {
  const r: ProjectRow = projectRowSchema.parse(value);
  const metadata = mergeProjectMetadata(
    {
      customerId: r.customer_id,
      customerName: r.customer_name,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      employeeTitle: r.employee_title,
      employeeEmail: r.employee_email,
      employeeTel: r.employee_tel,
      currencyCode: r.currency_code,
      currencyName: r.currency_name,
      currencySymbol: r.currency_symbol,
      destinationCountryCode: r.destination_country_code,
      destinationCountryName: r.destination_country_name,
    },
    r.description,
  );
  return {
    id: r.id,
    userId: r.user_id ?? null,
    name: r.name,
    description: r.description,
    ...metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

const PROJECT_COLUMNS =
  "id, user_id, name, description, customer_id, customer_name, employee_id, employee_name, employee_title, employee_email, employee_tel, currency_code, currency_name, currency_symbol, destination_country_code, destination_country_name, created_at, updated_at";
const LEGACY_PROJECT_COLUMNS = "id, name, description, created_at, updated_at";

function isProjectMetadataSchemaMismatch(message: string): boolean {
  return [
    "customer_id",
    "customer_name",
    "employee_id",
    "currency_code",
    "destination_country_code",
  ].some((column) => message.includes(column));
}

function metadataColumns(metadata: ProjectMetadata): Record<string, string | null> {
  return {
    customer_id: metadata.customerId,
    customer_name: metadata.customerName,
    employee_id: metadata.employeeId,
    employee_name: metadata.employeeName,
    employee_title: metadata.employeeTitle,
    employee_email: metadata.employeeEmail,
    employee_tel: metadata.employeeTel,
    currency_code: metadata.currencyCode,
    currency_name: metadata.currencyName,
    currency_symbol: metadata.currencySymbol,
    destination_country_code: metadata.destinationCountryCode,
    destination_country_name: metadata.destinationCountryName,
  };
}

const mapCanvas = (value: unknown, content?: CanvasContent): Canvas => {
  const r: CanvasRow = canvasRowSchema.parse(value);
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    content: content ?? safeParseCanvasContent(r.content),
    status: r.status ?? "draft",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

const mapCanvasSend = (value: unknown): CanvasSendRecord => {
  const r: CanvasSendRow = canvasSendRowSchema.parse(value);
  return {
    id: r.id,
    canvasId: r.canvas_id,
    sequence: r.sequence,
    status: r.status,
    recipientEmail: r.recipient_email,
    reportUrl: r.report_url,
    approvalUrl: r.approval_url,
    rejectionUrl: r.rejection_url,
    qrCodeDataUrl: r.qr_code_data_url,
    selectedImageIds: r.selected_image_ids,
    reportSnapshot: r.report_snapshot,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
  };
};

const mapSampleOrder = (value: unknown): SampleOrder => {
  const row = sampleOrderRowSchema.parse(value);
  return sampleOrderSchema.parse({
    id: row.id,
    canvasSendId: row.canvas_send_id,
    canvasId: row.canvas_id,
    projectId: row.project_id,
    supplierId: row.supplier_id,
    sequence: row.sequence,
    recipientEmail: row.recipient_email,
    approverEmail: row.approver_email,
    snapshot: row.snapshot,
    emailStatus: row.email_status,
    emailError: row.email_error,
    deliveryCount: row.delivery_count,
    purchaseSentAt: row.purchase_sent_at,
    currentStage: row.current_stage,
    currentPayload: row.current_payload,
    latestUpdateAt: row.latest_update_at,
    approvalStatus: row.approval_status,
    approvalEmailStatus: row.approval_email_status,
    approvalError: row.approval_error,
    approvalSentAt: row.approval_sent_at,
    approvalRespondedAt: row.approval_responded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updates: row.sample_order_updates.map((update) => ({
      id: update.id,
      orderId: update.order_id,
      stage: update.stage,
      payload: update.payload,
      source: update.source,
      createdAt: update.created_at,
    })),
  });
};

const CANVAS_COLUMNS = "id, project_id, name, content, status, created_at, updated_at";
const LEGACY_CANVAS_COLUMNS = "id, project_id, name, content, created_at, updated_at";
const CANVAS_SEND_COLUMNS =
  "id, canvas_id, sequence, status, recipient_email, report_url, approval_url, rejection_url, qr_code_data_url, selected_image_ids, report_snapshot, created_at, responded_at";
const SAMPLE_ORDER_COLUMNS =
  "id, canvas_send_id, canvas_id, project_id, supplier_id, sequence, recipient_email, approver_email, snapshot, email_status, email_error, delivery_count, purchase_sent_at, current_stage, current_payload, latest_update_at, approval_status, approval_email_status, approval_error, approval_sent_at, approval_responded_at, created_at, updated_at";
const SAMPLE_ORDER_WITH_UPDATES = `${SAMPLE_ORDER_COLUMNS}, sample_order_updates(id, order_id, stage, payload, source, created_at)`;

function isCanvasStatusSchemaMismatch(message: string): boolean {
  return message.includes("status");
}

function isCanvasSendsSchemaMissing(message: string): boolean {
  return (
    message.includes("canvas_sends") ||
    message.includes("Could not find the table") ||
    message.includes("schema cache")
  );
}

function canvasSendsMigrationError(context: string): Error {
  return new Error(
    `${context}: the canvas send approval table is missing. Apply Supabase migration 0010_canvas_send_approvals.sql, then restart or refresh the Supabase schema cache.`,
  );
}

function isSampleOrdersSchemaMissing(message: string): boolean {
  return (
    message.includes("sample_orders") ||
    message.includes("sample_order_updates") ||
    message.includes("Could not find the table") ||
    message.includes("schema cache")
  );
}

function sampleOrdersMigrationError(context: string): Error {
  return new Error(
    `${context}: the Sample Status tables are missing. Apply Supabase migration 0015_sample_order_workflow.sql, then restart or refresh the Supabase schema cache.`,
  );
}

const mapImage = (value: unknown): ImageRecord => {
  const r: ImageRow = imageRowSchema.parse(value);
  return {
    id: r.id,
    canvasId: r.canvas_id,
    source: r.source,
    url: r.url,
    storagePath: r.storage_path,
    prompt: r.prompt,
    model: r.model,
    modelDetails: r.model_details
      ? {
          model: r.model_details.model ?? r.model ?? "",
          size: r.model_details.size ?? null,
          resolution: r.model_details.resolution ?? null,
          outputFormat: r.model_details.outputFormat ?? r.model_details.output_format ?? null,
          durationMs: r.model_details.durationMs ?? r.model_details.duration_ms ?? null,
        }
      : null,
    createdAt: r.created_at,
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function buildNodeFromRow(value: unknown) {
  const row = canvasNodeRowSchema.parse(value);
  const node: Record<string, unknown> = isRecord(row.raw) ? { ...row.raw } : {};
  const type =
    row.type === "suppler" && row.data[PRODUCT_NODE_COMPAT_TYPE_KEY] === "product"
      ? "product"
      : row.type;

  node.id = row.id;
  node.type = type;
  node.position = row.position;
  node.data = row.data;
  if (row.parent_id) {
    node.parentId = row.parent_id;
  } else {
    delete node.parentId;
  }

  return parseCanvasNode(node);
}

function productNodesAsSupplerCompat(content: CanvasContent): CanvasContent {
  return {
    nodes: content.nodes.map((node) =>
      node.type === "product"
        ? {
            ...node,
            type: "suppler",
            data: {
              ...node.data,
              [PRODUCT_NODE_COMPAT_TYPE_KEY]: "product",
            },
          }
        : node,
    ),
    edges: content.edges,
  };
}

function isCanvasNodeTypeConstraintError(message: string): boolean {
  return (
    message.includes("canvas_nodes_type_check") ||
    (message.includes("canvas_nodes") && message.includes("violates check constraint"))
  );
}

function buildEdgeFromRow(value: unknown) {
  const row = canvasEdgeRowSchema.parse(value);
  const edge: Record<string, unknown> = isRecord(row.raw) ? { ...row.raw } : {};

  edge.id = row.id;
  edge.source = row.source;
  edge.target = row.target;
  edge.data = row.data;
  if (row.type) {
    edge.type = row.type;
  } else {
    delete edge.type;
  }
  if (row.source_handle) {
    edge.sourceHandle = row.source_handle;
  } else {
    delete edge.sourceHandle;
  }
  if (row.target_handle) {
    edge.targetHandle = row.target_handle;
  } else {
    delete edge.targetHandle;
  }

  return parseCanvasEdge(edge);
}

function assertNoError<T extends { error: { message: string } | null }>(
  result: T,
  context: string,
): void {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
}

export function createSupabaseCanvasStore(): CanvasStore {
  const supabase = getSupabaseBrowserClient();

  async function getCurrentUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    assertNoError({ error }, "getCurrentUser");
    if (!data.user) throw new Error("Sign in before saving to the database.");
    return data.user.id;
  }

  async function loadCanvasContent(
    canvasId: string,
    mirrorContent: unknown,
  ): Promise<CanvasContent> {
    const [{ data: nodeRows, error: nodeError }, { data: edgeRows, error: edgeError }] =
      await Promise.all([
        supabase
          .from("canvas_nodes")
          .select("id, type, position, data, parent_id, raw, sort_index")
          .eq("canvas_id", canvasId)
          .order("sort_index", { ascending: true }),
        supabase
          .from("canvas_edges")
          .select("id, source, target, source_handle, target_handle, type, data, raw, sort_index")
          .eq("canvas_id", canvasId)
          .order("sort_index", { ascending: true }),
      ]);

    assertNoError({ error: nodeError }, "loadCanvasNodes");
    assertNoError({ error: edgeError }, "loadCanvasEdges");

    const nodes = toUnknownArray(nodeRows).map(buildNodeFromRow);
    const edges = toUnknownArray(edgeRows).map(buildEdgeFromRow);
    if (nodes.length > 0 || edges.length > 0) return { nodes, edges };

    return safeParseCanvasContent(mirrorContent);
  }

  return {
    // ── Projects ────────────────────────────────────────────────────────
    async listProjects() {
      const query = await supabase
        .from("projects")
        .select(PROJECT_COLUMNS)
        .order("updated_at", { ascending: false });
      if (!query.error) return toUnknownArray(query.data).map(mapProject);
      if (!isProjectMetadataSchemaMismatch(query.error.message)) {
        assertNoError({ error: query.error }, "listProjects");
      }
      const legacy = await supabase
        .from("projects")
        .select(LEGACY_PROJECT_COLUMNS)
        .order("updated_at", { ascending: false });
      assertNoError({ error: legacy.error }, "listProjects");
      return toUnknownArray(legacy.data).map(mapProject);
    },

    async getProject(id) {
      const query = await supabase
        .from("projects")
        .select(PROJECT_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (!query.error) return query.data ? mapProject(query.data) : null;
      if (!isProjectMetadataSchemaMismatch(query.error.message)) {
        assertNoError({ error: query.error }, "getProject");
      }
      const legacy = await supabase
        .from("projects")
        .select(LEGACY_PROJECT_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      assertNoError({ error: legacy.error }, "getProject");
      return legacy.data ? mapProject(legacy.data) : null;
    },

    async createProject(input: CreateProjectInput) {
      const userId = await getCurrentUserId();
      const description = input.description?.trim() ?? null;
      const metadata = mergeProjectMetadata(input, description);
      const query = await supabase
        .from("projects")
        .insert({
          user_id: userId,
          name: input.name.trim(),
          description,
          ...metadataColumns(metadata),
        })
        .select(PROJECT_COLUMNS)
        .single();
      if (!query.error) return mapProject(query.data);
      if (!isProjectMetadataSchemaMismatch(query.error.message)) {
        assertNoError({ error: query.error }, "createProject");
      }
      const legacy = await supabase
        .from("projects")
        .insert({
          user_id: userId,
          name: input.name.trim(),
          description: serializeLegacyProjectDescription(metadata),
        })
        .select(LEGACY_PROJECT_COLUMNS)
        .single();
      assertNoError({ error: legacy.error }, "createProject");
      return mapProject(legacy.data);
    },

    async updateProject(id, input: ProjectUpdate) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;
      const current = await this.getProject(id);
      if (!current) throw new Error("Project not found");
      const metadata = mergeProjectMetadata(
        { ...current, ...input },
        input.description ?? current.description,
      );
      Object.assign(patch, metadataColumns(metadata));
      const query = await supabase
        .from("projects")
        .update(patch)
        .eq("id", id)
        .select(PROJECT_COLUMNS)
        .single();
      if (!query.error) return mapProject(query.data);
      if (!isProjectMetadataSchemaMismatch(query.error.message)) {
        assertNoError({ error: query.error }, "updateProject");
      }
      const legacyPatch: Record<string, unknown> = { updated_at: patch.updated_at };
      if (input.name !== undefined) legacyPatch.name = input.name;
      legacyPatch.description = serializeLegacyProjectDescription(metadata);
      const legacy = await supabase
        .from("projects")
        .update(legacyPatch)
        .eq("id", id)
        .select(LEGACY_PROJECT_COLUMNS)
        .single();
      assertNoError({ error: legacy.error }, "updateProject");
      return mapProject(legacy.data);
    },

    async deleteProject(id) {
      // Canvas/image cascade is handled at the DB level (ON DELETE CASCADE).
      const { error } = await supabase.from("projects").delete().eq("id", id);
      assertNoError({ error }, "deleteProject");
    },

    // ── Canvases ────────────────────────────────────────────────────────
    async listCanvases(projectId) {
      const { data, error } = await supabase
        .from("canvases")
        .select(CANVAS_COLUMNS)
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (!error) return toUnknownArray(data).map((row) => mapCanvas(row));
      if (!isCanvasStatusSchemaMismatch(error.message)) assertNoError({ error }, "listCanvases");
      const legacy = await supabase
        .from("canvases")
        .select(LEGACY_CANVAS_COLUMNS)
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      assertNoError({ error: legacy.error }, "listCanvases");
      return toUnknownArray(legacy.data).map((row) => mapCanvas(row));
    },

    async getCanvas(id) {
      const { data, error } = await supabase
        .from("canvases")
        .select(CANVAS_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      let rowData: unknown = data;
      if (error && isCanvasStatusSchemaMismatch(error.message)) {
        const legacy = await supabase
          .from("canvases")
          .select(LEGACY_CANVAS_COLUMNS)
          .eq("id", id)
          .maybeSingle();
        assertNoError({ error: legacy.error }, "getCanvas");
        rowData = legacy.data;
      } else {
        assertNoError({ error }, "getCanvas");
      }
      if (!rowData) return null;
      const row = canvasRowSchema.parse(rowData);
      const content = await loadCanvasContent(row.id, row.content);
      return mapCanvas(row, content);
    },

    async createCanvas(input: CreateCanvasInput) {
      const userId = await getCurrentUserId();
      const { data, error } = await supabase
        .from("canvases")
        .insert({
          project_id: input.projectId,
          user_id: userId,
          name: input.name.trim(),
          content: input.content ?? EMPTY_CANVAS_CONTENT,
          status: "draft",
        })
        .select(CANVAS_COLUMNS)
        .single();
      if (!error) return mapCanvas(data);
      if (!isCanvasStatusSchemaMismatch(error.message)) assertNoError({ error }, "createCanvas");
      const legacy = await supabase
        .from("canvases")
        .insert({
          project_id: input.projectId,
          user_id: userId,
          name: input.name.trim(),
          content: input.content ?? EMPTY_CANVAS_CONTENT,
        })
        .select(LEGACY_CANVAS_COLUMNS)
        .single();
      assertNoError({ error: legacy.error }, "createCanvas");
      return mapCanvas(legacy.data);
    },

    async renameCanvas(id, name) {
      const { data, error } = await supabase
        .from("canvases")
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(CANVAS_COLUMNS)
        .single();
      if (!error) return mapCanvas(data);
      if (!isCanvasStatusSchemaMismatch(error.message)) assertNoError({ error }, "renameCanvas");
      const legacy = await supabase
        .from("canvases")
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(LEGACY_CANVAS_COLUMNS)
        .single();
      assertNoError({ error: legacy.error }, "renameCanvas");
      return mapCanvas(legacy.data);
    },

    async saveCanvasContent(id, content) {
      const validContent = parseCanvasContent(content);
      const { error } = await supabase.rpc("replace_canvas_graph", {
        p_canvas_id: id,
        p_content: validContent,
        p_edges: validContent.edges,
        p_nodes: validContent.nodes,
      });
      if (error && isCanvasNodeTypeConstraintError(error.message)) {
        const compatContent = productNodesAsSupplerCompat(validContent);
        const retry = await supabase.rpc("replace_canvas_graph", {
          p_canvas_id: id,
          p_content: compatContent,
          p_edges: compatContent.edges,
          p_nodes: compatContent.nodes,
        });
        assertNoError(retry, "saveCanvasContent");
        return;
      }
      assertNoError({ error }, "saveCanvasContent");
    },

    async updateCanvasStatus(id, status: CanvasStatus) {
      const { data, error } = await supabase
        .from("canvases")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(CANVAS_COLUMNS)
        .single();
      assertNoError({ error }, "updateCanvasStatus");
      return mapCanvas(data);
    },

    async deleteCanvas(id) {
      const { error } = await supabase.from("canvases").delete().eq("id", id);
      assertNoError({ error }, "deleteCanvas");
    },

    async listCanvasSends(canvasId) {
      const { data, error } = await supabase
        .from("canvas_sends")
        .select(CANVAS_SEND_COLUMNS)
        .eq("canvas_id", canvasId)
        .order("created_at", { ascending: false });
      if (error && isCanvasSendsSchemaMissing(error.message)) return [];
      assertNoError({ error }, "listCanvasSends");
      return z.array(canvasSendRowSchema).parse(data).map(mapCanvasSend);
    },

    async createCanvasSend(input: CreateCanvasSendInput) {
      const userId = await getCurrentUserId();
      const { data, error } = await supabase
        .from("canvas_sends")
        .insert({
          user_id: userId,
          canvas_id: input.canvasId,
          status: "awaiting_approval",
          recipient_email: input.recipientEmail,
          report_url: input.reportUrl,
          approval_token: input.approvalToken,
          approval_url: input.approvalUrl,
          rejection_url: input.rejectionUrl,
          qr_code_data_url: input.qrCodeDataUrl ?? null,
          selected_image_ids: input.selectedImageIds,
          report_snapshot: input.reportSnapshot,
        })
        .select(CANVAS_SEND_COLUMNS)
        .single();
      if (error && isCanvasSendsSchemaMissing(error.message)) {
        throw canvasSendsMigrationError("createCanvasSend");
      }
      assertNoError({ error }, "createCanvasSend");
      return mapCanvasSend(data);
    },

    async updateCanvasSend(id: string, input: UpdateCanvasSendInput) {
      const patch: Record<string, unknown> = {};
      if (input.reportUrl !== undefined) patch.report_url = input.reportUrl;
      if (input.approvalUrl !== undefined) patch.approval_url = input.approvalUrl;
      if (input.rejectionUrl !== undefined) patch.rejection_url = input.rejectionUrl;
      if (input.qrCodeDataUrl !== undefined) patch.qr_code_data_url = input.qrCodeDataUrl;
      if (input.reportSnapshot !== undefined) patch.report_snapshot = input.reportSnapshot;
      const { data, error } = await supabase
        .from("canvas_sends")
        .update(patch)
        .eq("id", id)
        .select(CANVAS_SEND_COLUMNS)
        .single();
      if (error && isCanvasSendsSchemaMissing(error.message)) {
        throw canvasSendsMigrationError("updateCanvasSend");
      }
      assertNoError({ error }, "updateCanvasSend");
      return mapCanvasSend(data);
    },

    // ── Image metadata ──────────────────────────────────────────────────
    async listSampleOrders() {
      const { data, error } = await supabase
        .from("sample_orders")
        .select(SAMPLE_ORDER_WITH_UPDATES)
        .order("updated_at", { ascending: false })
        .order("created_at", { referencedTable: "sample_order_updates", ascending: false });
      if (error && isSampleOrdersSchemaMissing(error.message)) {
        throw sampleOrdersMigrationError("listSampleOrders");
      }
      assertNoError({ error }, "listSampleOrders");
      return z.array(sampleOrderRowSchema).parse(data).map(mapSampleOrder);
    },

    async upsertSampleOrder(input) {
      const userId = await getCurrentUserId();
      const existing = await supabase
        .from("sample_orders")
        .select("id, delivery_count")
        .eq("canvas_send_id", input.canvasSendId)
        .eq("supplier_id", input.supplierId)
        .maybeSingle();
      if (existing.error && isSampleOrdersSchemaMissing(existing.error.message)) {
        throw sampleOrdersMigrationError("findSampleOrder");
      }
      assertNoError({ error: existing.error }, "findSampleOrder");
      const patch = {
        user_id: userId,
        canvas_send_id: input.canvasSendId,
        canvas_id: input.canvasId,
        project_id: input.projectId,
        supplier_id: input.supplierId,
        sequence: input.sequence,
        recipient_email: input.recipientEmail,
        approver_email: input.approverEmail,
        supplier_token_hash: input.supplierTokenHash,
        snapshot: input.snapshot,
        email_status: "pending",
        email_error: null,
        current_stage: "purchase",
        current_payload: null,
      };
      const query = existing.data
        ? supabase
            .from("sample_orders")
            .update({ ...patch, delivery_count: Number(existing.data.delivery_count) + 1 })
            .eq("id", String(existing.data.id))
        : supabase.from("sample_orders").insert({ ...patch, delivery_count: 1 });
      const { data, error } = await query.select(SAMPLE_ORDER_WITH_UPDATES).single();
      if (error && isSampleOrdersSchemaMissing(error.message)) {
        throw sampleOrdersMigrationError("upsertSampleOrder");
      }
      assertNoError({ error }, "upsertSampleOrder");
      return mapSampleOrder(data);
    },

    async updateSampleOrderEmail(id, input) {
      const patch: Record<string, unknown> = {
        email_status: input.status,
        email_error: input.error ?? null,
      };
      if (input.sentAt !== undefined) patch.purchase_sent_at = input.sentAt;
      const { data, error } = await supabase
        .from("sample_orders")
        .update(patch)
        .eq("id", id)
        .select(SAMPLE_ORDER_WITH_UPDATES)
        .single();
      if (error && isSampleOrdersSchemaMissing(error.message)) {
        throw sampleOrdersMigrationError("updateSampleOrderEmail");
      }
      assertNoError({ error }, "updateSampleOrderEmail");
      return mapSampleOrder(data);
    },

    async rotateSampleOrderToken(id, input) {
      const existing = await supabase
        .from("sample_orders")
        .select("delivery_count")
        .eq("id", id)
        .single();
      if (existing.error && isSampleOrdersSchemaMissing(existing.error.message)) {
        throw sampleOrdersMigrationError("findSampleOrder");
      }
      assertNoError({ error: existing.error }, "findSampleOrder");
      const { data, error } = await supabase
        .from("sample_orders")
        .update({
          supplier_token_hash: input.supplierTokenHash,
          email_status: "pending",
          email_error: null,
          delivery_count: Number(existing.data.delivery_count) + 1,
        })
        .eq("id", id)
        .select(SAMPLE_ORDER_WITH_UPDATES)
        .single();
      if (error && isSampleOrdersSchemaMissing(error.message)) {
        throw sampleOrdersMigrationError("rotateSampleOrderToken");
      }
      assertNoError({ error }, "rotateSampleOrderToken");
      return mapSampleOrder(data);
    },

    async deleteSampleOrder(id) {
      const deleteUpdates = await supabase
        .from("sample_order_updates")
        .delete()
        .eq("order_id", id);
      if (deleteUpdates.error && !isSampleOrdersSchemaMissing(deleteUpdates.error.message)) {
        assertNoError({ error: deleteUpdates.error }, "deleteSampleOrderUpdates");
      }
      const { error } = await supabase.from("sample_orders").delete().eq("id", id);
      if (error && isSampleOrdersSchemaMissing(error.message)) {
        throw sampleOrdersMigrationError("deleteSampleOrder");
      }
      assertNoError({ error }, "deleteSampleOrder");
    },

    async generateDemoSampleOrders() {
      throw new Error("Demo sample orders are available only in local mode.");
    },

    async listImages(canvasId: string) {
      const query = await supabase
        .from("images")
        .select(
          "id, canvas_id, source, url, storage_path, prompt, model, model_details, created_at",
        )
        .eq("canvas_id", canvasId)
        .eq("source", "generated")
        .order("created_at", { ascending: false });
      if (query.error?.message.includes("model_details")) {
        const legacy = await supabase
          .from("images")
          .select("id, canvas_id, source, url, storage_path, prompt, model, created_at")
          .eq("canvas_id", canvasId)
          .eq("source", "generated")
          .order("created_at", { ascending: false });
        assertNoError({ error: legacy.error }, "listImages");
        return z.array(imageRowSchema).parse(legacy.data).map(mapImage);
      }
      assertNoError({ error: query.error }, "listImages");
      return z.array(imageRowSchema).parse(query.data).map(mapImage);
    },

    async recordImage(input: RecordImageInput) {
      const userId = await getCurrentUserId();
      const values = {
        user_id: userId,
        canvas_id: input.canvasId ?? null,
        source: input.source,
        url: input.url,
        storage_path: input.storagePath ?? null,
        prompt: input.prompt ?? null,
        model: input.model ?? null,
        model_details: input.modelDetails
          ? {
              model: input.modelDetails.model,
              size: input.modelDetails.size,
              resolution: input.modelDetails.resolution,
              output_format: input.modelDetails.outputFormat,
              duration_ms: input.modelDetails.durationMs ?? null,
            }
          : null,
      };
      const query = await supabase
        .from("images")
        .insert(values)
        .select(
          "id, canvas_id, source, url, storage_path, prompt, model, model_details, created_at",
        )
        .single();
      if (query.error?.message.includes("model_details")) {
        const legacyValues = Object.fromEntries(
          Object.entries(values).filter(([key]) => key !== "model_details"),
        );
        const legacy = await supabase
          .from("images")
          .insert(legacyValues)
          .select("id, canvas_id, source, url, storage_path, prompt, model, created_at")
          .single();
        assertNoError({ error: legacy.error }, "recordImage");
        return mapImage(legacy.data);
      }
      assertNoError({ error: query.error }, "recordImage");
      return mapImage(query.data);
    },
  };
}
