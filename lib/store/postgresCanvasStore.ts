import "server-only";

import { EMPTY_CANVAS_CONTENT, type CanvasContent } from "@/lib/nodes/types";
import {
  parseCanvasContent,
  parseCanvasEdge,
  parseCanvasNode,
  safeParseCanvasContent,
} from "@/lib/nodes/validation";
import { mergeProjectMetadata, type ProjectMetadata } from "@/lib/project-metadata";
import { ensureLocalProfile, query, queryOne, withTransaction } from "@/lib/db/client";
import { localUserId } from "@/lib/env";
import {
  deleteLocalSampleOrder,
  listLocalSampleOrders,
  rotateLocalSampleOrderToken,
  updateLocalSampleOrderEmail,
  upsertLocalSampleOrder,
} from "@/lib/sample-order-postgres";
import type { SampleOrder } from "@/lib/sample-orders";

import type {
  Canvas,
  CanvasSendRecord,
  CanvasStatus,
  CanvasStore,
  CreateCanvasInput,
  CreateCanvasSendInput,
  CreateProjectInput,
  ImageRecord,
  Project,
  ProjectUpdate,
  RecordImageInput,
  UpdateCanvasSendInput,
} from "./canvasStore";

const PRODUCT_NODE_COMPAT_TYPE_KEY = "__canvasNodeType";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  customer_id: string | null;
  customer_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
  employee_title: string | null;
  employee_email: string | null;
  employee_tel: string | null;
  currency_code: string | null;
  currency_name: string | null;
  currency_symbol: string | null;
  destination_country_code: string | null;
  destination_country_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CanvasRow {
  id: string;
  project_id: string;
  name: string;
  content: unknown;
  status: CanvasStatus | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CanvasNodeRow {
  id: string;
  type: string;
  position: unknown;
  data: unknown;
  parent_id: string | null;
  raw: unknown;
  sort_index: number;
}

interface CanvasEdgeRow {
  id: string;
  source: string;
  target: string;
  source_handle: string | null;
  target_handle: string | null;
  type: string | null;
  data: unknown;
  raw: unknown;
  sort_index: number;
}

interface ImageRow {
  id: string;
  canvas_id: string | null;
  source: "upload" | "generated";
  url: string;
  storage_path: string | null;
  prompt: string | null;
  model: string | null;
  model_details: {
    model?: string | null;
    size?: string | null;
    resolution?: string | null;
    outputFormat?: string | null;
    output_format?: string | null;
    durationMs?: number | null;
    duration_ms?: number | null;
  } | null;
  created_at: Date | string;
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
  created_at: Date | string;
  responded_at: Date | string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mapProject(row: ProjectRow): Project {
  const metadata = mergeProjectMetadata(
    {
      customerId: row.customer_id,
      customerName: row.customer_name,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      employeeTitle: row.employee_title,
      employeeEmail: row.employee_email,
      employeeTel: row.employee_tel,
      currencyCode: row.currency_code,
      currencyName: row.currency_name,
      currencySymbol: row.currency_symbol,
      destinationCountryCode: row.destination_country_code,
      destinationCountryName: row.destination_country_name,
    },
    row.description,
  );
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ...metadata,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
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

function mapCanvas(row: CanvasRow, content?: CanvasContent): Canvas {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    content: content ?? safeParseCanvasContent(row.content),
    status: row.status ?? "draft",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapCanvasSend(row: CanvasSendRow): CanvasSendRecord {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    sequence: row.sequence,
    status: row.status,
    recipientEmail: row.recipient_email,
    reportUrl: row.report_url,
    approvalUrl: row.approval_url,
    rejectionUrl: row.rejection_url,
    qrCodeDataUrl: row.qr_code_data_url,
    selectedImageIds: row.selected_image_ids ?? [],
    reportSnapshot: row.report_snapshot,
    createdAt: toIso(row.created_at),
    respondedAt: row.responded_at ? toIso(row.responded_at) : null,
  };
}

function mapImage(row: ImageRow): ImageRecord {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    source: row.source,
    url: row.url,
    storagePath: row.storage_path,
    prompt: row.prompt,
    model: row.model,
    modelDetails: row.model_details
      ? {
          model: row.model_details.model ?? row.model ?? "",
          size: row.model_details.size ?? null,
          resolution: row.model_details.resolution ?? null,
          outputFormat: row.model_details.outputFormat ?? row.model_details.output_format ?? null,
          durationMs: row.model_details.durationMs ?? row.model_details.duration_ms ?? null,
        }
      : null,
    createdAt: toIso(row.created_at),
  };
}

function buildNodeFromRow(row: CanvasNodeRow) {
  const node: Record<string, unknown> = isRecord(row.raw) ? { ...row.raw } : {};
  const data = isRecord(row.data) ? row.data : {};
  const type =
    row.type === "suppler" && data[PRODUCT_NODE_COMPAT_TYPE_KEY] === "product"
      ? "product"
      : row.type;

  node.id = row.id;
  node.type = type;
  node.position = row.position;
  node.data = data;
  if (row.parent_id) node.parentId = row.parent_id;
  else delete node.parentId;
  return parseCanvasNode(node);
}

function buildEdgeFromRow(row: CanvasEdgeRow) {
  const edge: Record<string, unknown> = isRecord(row.raw) ? { ...row.raw } : {};
  edge.id = row.id;
  edge.source = row.source;
  edge.target = row.target;
  edge.data = isRecord(row.data) ? row.data : {};
  if (row.type) edge.type = row.type;
  else delete edge.type;
  if (row.source_handle) edge.sourceHandle = row.source_handle;
  else delete edge.sourceHandle;
  if (row.target_handle) edge.targetHandle = row.target_handle;
  else delete edge.targetHandle;
  return parseCanvasEdge(edge);
}

async function loadCanvasContent(canvasId: string, mirrorContent: unknown): Promise<CanvasContent> {
  const [nodes, edges] = await Promise.all([
    query<CanvasNodeRow>(
      `SELECT id, type, position, data, parent_id, raw, sort_index
       FROM public.canvas_nodes
       WHERE canvas_id = $1
       ORDER BY sort_index ASC`,
      [canvasId],
    ),
    query<CanvasEdgeRow>(
      `SELECT id, source, target, source_handle, target_handle, type, data, raw, sort_index
       FROM public.canvas_edges
       WHERE canvas_id = $1
       ORDER BY sort_index ASC`,
      [canvasId],
    ),
  ]);

  if (nodes.length > 0 || edges.length > 0) {
    return {
      nodes: nodes.map(buildNodeFromRow),
      edges: edges.map(buildEdgeFromRow),
    };
  }
  return safeParseCanvasContent(mirrorContent);
}

async function replaceCanvasGraph(canvasId: string, content: CanvasContent, userId: string) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE public.canvases
       SET content = $2::jsonb, updated_at = now()
       WHERE id = $1 AND user_id = $3`,
      [canvasId, JSON.stringify(content), userId],
    );
    await client.query(`DELETE FROM public.canvas_edges WHERE canvas_id = $1`, [canvasId]);
    await client.query(`DELETE FROM public.canvas_nodes WHERE canvas_id = $1`, [canvasId]);

    for (let i = 0; i < content.nodes.length; i += 1) {
      const node = content.nodes[i] as Record<string, unknown>;
      const type = String(node.type ?? "note");
      const position = node.position ?? { x: 0, y: 0 };
      const data = (node.data as Record<string, unknown>) ?? {};
      const parentId =
        typeof node.parentId === "string" && node.parentId.length > 0 ? node.parentId : null;
      await client.query(
        `INSERT INTO public.canvas_nodes
          (canvas_id, user_id, id, type, position, data, parent_id, raw, sort_index)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9)`,
        [
          canvasId,
          userId,
          String(node.id),
          type,
          JSON.stringify(position),
          JSON.stringify(data),
          parentId,
          JSON.stringify(node),
          i,
        ],
      );
    }

    for (let i = 0; i < content.edges.length; i += 1) {
      const edge = content.edges[i] as Record<string, unknown>;
      await client.query(
        `INSERT INTO public.canvas_edges
          (canvas_id, user_id, id, source, target, source_handle, target_handle, type, data, raw, sort_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`,
        [
          canvasId,
          userId,
          String(edge.id),
          String(edge.source),
          String(edge.target),
          typeof edge.sourceHandle === "string" ? edge.sourceHandle : null,
          typeof edge.targetHandle === "string" ? edge.targetHandle : null,
          typeof edge.type === "string" ? edge.type : null,
          JSON.stringify((edge.data as Record<string, unknown>) ?? {}),
          JSON.stringify(edge),
          i,
        ],
      );
    }
  });
}

export function createPostgresCanvasStore(): CanvasStore {
  return {
    async listProjects() {
      await ensureLocalProfile();
      const rows = await query<ProjectRow>(
        `SELECT id, name, description, customer_id, customer_name, employee_id, employee_name,
                employee_title, employee_email, employee_tel, currency_code, currency_name,
                currency_symbol, destination_country_code, destination_country_name,
                created_at, updated_at
         FROM public.projects
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [localUserId],
      );
      return rows.map(mapProject);
    },

    async getProject(id) {
      await ensureLocalProfile();
      const row = await queryOne<ProjectRow>(
        `SELECT id, name, description, customer_id, customer_name, employee_id, employee_name,
                employee_title, employee_email, employee_tel, currency_code, currency_name,
                currency_symbol, destination_country_code, destination_country_name,
                created_at, updated_at
         FROM public.projects
         WHERE id = $1 AND user_id = $2`,
        [id, localUserId],
      );
      return row ? mapProject(row) : null;
    },

    async createProject(input: CreateProjectInput) {
      await ensureLocalProfile();
      const description = input.description?.trim() ?? null;
      const metadata = mergeProjectMetadata(input, description);
      const cols = metadataColumns(metadata);
      const row = await queryOne<ProjectRow>(
        `INSERT INTO public.projects (
           user_id, name, description,
           customer_id, customer_name, employee_id, employee_name, employee_title,
           employee_email, employee_tel, currency_code, currency_name, currency_symbol,
           destination_country_code, destination_country_name
         ) VALUES (
           $1, $2, $3,
           $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13,
           $14, $15
         )
         RETURNING id, name, description, customer_id, customer_name, employee_id, employee_name,
                   employee_title, employee_email, employee_tel, currency_code, currency_name,
                   currency_symbol, destination_country_code, destination_country_name,
                   created_at, updated_at`,
        [
          localUserId,
          input.name.trim(),
          description,
          cols.customer_id,
          cols.customer_name,
          cols.employee_id,
          cols.employee_name,
          cols.employee_title,
          cols.employee_email,
          cols.employee_tel,
          cols.currency_code,
          cols.currency_name,
          cols.currency_symbol,
          cols.destination_country_code,
          cols.destination_country_name,
        ],
      );
      if (!row) throw new Error("Failed to create project");
      return mapProject(row);
    },

    async updateProject(id, input: ProjectUpdate) {
      await ensureLocalProfile();
      const current = await this.getProject(id);
      if (!current) throw new Error("Project not found");
      const description =
        input.description !== undefined ? input.description : current.description;
      const metadata = mergeProjectMetadata({ ...current, ...input }, description);
      const cols = metadataColumns(metadata);
      const row = await queryOne<ProjectRow>(
        `UPDATE public.projects SET
           name = $3,
           description = $4,
           customer_id = $5,
           customer_name = $6,
           employee_id = $7,
           employee_name = $8,
           employee_title = $9,
           employee_email = $10,
           employee_tel = $11,
           currency_code = $12,
           currency_name = $13,
           currency_symbol = $14,
           destination_country_code = $15,
           destination_country_name = $16,
           updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING id, name, description, customer_id, customer_name, employee_id, employee_name,
                   employee_title, employee_email, employee_tel, currency_code, currency_name,
                   currency_symbol, destination_country_code, destination_country_name,
                   created_at, updated_at`,
        [
          id,
          localUserId,
          input.name !== undefined ? input.name : current.name,
          description,
          cols.customer_id,
          cols.customer_name,
          cols.employee_id,
          cols.employee_name,
          cols.employee_title,
          cols.employee_email,
          cols.employee_tel,
          cols.currency_code,
          cols.currency_name,
          cols.currency_symbol,
          cols.destination_country_code,
          cols.destination_country_name,
        ],
      );
      if (!row) throw new Error("Project not found");
      return mapProject(row);
    },

    async deleteProject(id) {
      await ensureLocalProfile();
      await query(`DELETE FROM public.projects WHERE id = $1 AND user_id = $2`, [id, localUserId]);
    },

    async listCanvases(projectId) {
      await ensureLocalProfile();
      const rows = await query<CanvasRow>(
        `SELECT id, project_id, name, content, status, created_at, updated_at
         FROM public.canvases
         WHERE project_id = $1 AND user_id = $2
         ORDER BY updated_at DESC`,
        [projectId, localUserId],
      );
      return Promise.all(
        rows.map(async (row) => mapCanvas(row, await loadCanvasContent(row.id, row.content))),
      );
    },

    async getCanvas(id) {
      await ensureLocalProfile();
      const row = await queryOne<CanvasRow>(
        `SELECT id, project_id, name, content, status, created_at, updated_at
         FROM public.canvases
         WHERE id = $1 AND user_id = $2`,
        [id, localUserId],
      );
      if (!row) return null;
      return mapCanvas(row, await loadCanvasContent(row.id, row.content));
    },

    async createCanvas(input: CreateCanvasInput) {
      await ensureLocalProfile();
      const row = await queryOne<CanvasRow>(
        `INSERT INTO public.canvases (project_id, user_id, name, content, status)
         VALUES ($1, $2, $3, $4::jsonb, 'draft')
         RETURNING id, project_id, name, content, status, created_at, updated_at`,
        [input.projectId, localUserId, input.name.trim(), JSON.stringify(input.content ?? EMPTY_CANVAS_CONTENT)],
      );
      if (!row) throw new Error("Failed to create canvas");
      return mapCanvas(row, input.content ?? EMPTY_CANVAS_CONTENT);
    },

    async renameCanvas(id, name) {
      await ensureLocalProfile();
      const row = await queryOne<CanvasRow>(
        `UPDATE public.canvases
         SET name = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING id, project_id, name, content, status, created_at, updated_at`,
        [id, localUserId, name.trim()],
      );
      if (!row) throw new Error("Canvas not found");
      return mapCanvas(row);
    },

    async saveCanvasContent(id, content) {
      await ensureLocalProfile();
      const valid = parseCanvasContent(content);
      const owned = await queryOne<{ id: string }>(
        `SELECT id FROM public.canvases WHERE id = $1 AND user_id = $2`,
        [id, localUserId],
      );
      if (!owned) throw new Error("Canvas not found");
      await replaceCanvasGraph(id, valid, localUserId);
    },

    async updateCanvasStatus(id, status: CanvasStatus) {
      await ensureLocalProfile();
      const row = await queryOne<CanvasRow>(
        `UPDATE public.canvases
         SET status = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING id, project_id, name, content, status, created_at, updated_at`,
        [id, localUserId, status],
      );
      if (!row) throw new Error("Canvas not found");
      return mapCanvas(row);
    },

    async deleteCanvas(id) {
      await ensureLocalProfile();
      await query(`DELETE FROM public.canvases WHERE id = $1 AND user_id = $2`, [id, localUserId]);
    },

    async listCanvasSends(canvasId) {
      await ensureLocalProfile();
      const rows = await query<CanvasSendRow>(
        `SELECT id, canvas_id, sequence, status, recipient_email, report_url, approval_url,
                rejection_url, qr_code_data_url, selected_image_ids, report_snapshot,
                created_at, responded_at
         FROM public.canvas_sends
         WHERE canvas_id = $1 AND user_id = $2
         ORDER BY created_at DESC`,
        [canvasId, localUserId],
      );
      return rows.map(mapCanvasSend);
    },

    async createCanvasSend(input: CreateCanvasSendInput) {
      await ensureLocalProfile();
      const row = await queryOne<CanvasSendRow>(
        `INSERT INTO public.canvas_sends (
           user_id, canvas_id, status, recipient_email, approval_token,
           report_url, approval_url, rejection_url, qr_code_data_url,
           selected_image_ids, report_snapshot
         ) VALUES (
           $1, $2, 'awaiting_approval', $3, $4,
           $5, $6, $7, $8,
           $9::text[], $10::jsonb
         )
         RETURNING id, canvas_id, sequence, status, recipient_email, report_url, approval_url,
                   rejection_url, qr_code_data_url, selected_image_ids, report_snapshot,
                   created_at, responded_at`,
        [
          localUserId,
          input.canvasId,
          input.recipientEmail,
          input.approvalToken,
          input.reportUrl,
          input.approvalUrl,
          input.rejectionUrl,
          input.qrCodeDataUrl ?? null,
          input.selectedImageIds,
          JSON.stringify(input.reportSnapshot ?? {}),
        ],
      );
      if (!row) throw new Error("Failed to create canvas send");
      return mapCanvasSend(row);
    },

    async updateCanvasSend(id, input: UpdateCanvasSendInput) {
      await ensureLocalProfile();
      const row = await queryOne<CanvasSendRow>(
        `UPDATE public.canvas_sends SET
           report_url = COALESCE($3, report_url),
           approval_url = COALESCE($4, approval_url),
           rejection_url = COALESCE($5, rejection_url),
           qr_code_data_url = CASE WHEN $6::boolean THEN $7 ELSE qr_code_data_url END,
           report_snapshot = CASE WHEN $8::boolean THEN $9::jsonb ELSE report_snapshot END
         WHERE id = $1 AND user_id = $2
         RETURNING id, canvas_id, sequence, status, recipient_email, report_url, approval_url,
                   rejection_url, qr_code_data_url, selected_image_ids, report_snapshot,
                   created_at, responded_at`,
        [
          id,
          localUserId,
          input.reportUrl ?? null,
          input.approvalUrl ?? null,
          input.rejectionUrl ?? null,
          input.qrCodeDataUrl !== undefined,
          input.qrCodeDataUrl ?? null,
          input.reportSnapshot !== undefined,
          input.reportSnapshot !== undefined ? JSON.stringify(input.reportSnapshot) : null,
        ],
      );
      if (!row) throw new Error("Canvas send record not found");
      return mapCanvasSend(row);
    },

    async listSampleOrders() {
      await ensureLocalProfile();
      return await listLocalSampleOrders();
    },
    async upsertSampleOrder(input) {
      await ensureLocalProfile();
      return await upsertLocalSampleOrder(input);
    },
    async updateSampleOrderEmail(id, input) {
      await ensureLocalProfile();
      return await updateLocalSampleOrderEmail(id, input);
    },
    async rotateSampleOrderToken(id, input) {
      await ensureLocalProfile();
      return await rotateLocalSampleOrderToken(id, input);
    },
    async deleteSampleOrder(id) {
      await ensureLocalProfile();
      await deleteLocalSampleOrder(id);
    },
    async generateDemoSampleOrders(): Promise<SampleOrder[]> {
      throw new Error("Demo sample orders are available only in browser local mode.");
    },

    async listImages(canvasId) {
      await ensureLocalProfile();
      const rows = await query<ImageRow>(
        `SELECT id, canvas_id, source, url, storage_path, prompt, model, model_details, created_at
         FROM public.images
         WHERE canvas_id = $1 AND user_id = $2 AND source = 'generated'
         ORDER BY created_at DESC`,
        [canvasId, localUserId],
      );
      return rows.map(mapImage);
    },

    async recordImage(input: RecordImageInput) {
      await ensureLocalProfile();
      const modelDetails = input.modelDetails
        ? {
            model: input.modelDetails.model,
            size: input.modelDetails.size,
            resolution: input.modelDetails.resolution,
            output_format: input.modelDetails.outputFormat,
            duration_ms: input.modelDetails.durationMs ?? null,
          }
        : null;
      const row = await queryOne<ImageRow>(
        `INSERT INTO public.images (
           user_id, canvas_id, source, url, storage_path, prompt, model, model_details
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, canvas_id, source, url, storage_path, prompt, model, model_details, created_at`,
        [
          localUserId,
          input.canvasId ?? null,
          input.source,
          input.url,
          input.storagePath ?? null,
          input.prompt ?? null,
          input.model ?? null,
          modelDetails ? JSON.stringify(modelDetails) : null,
        ],
      );
      if (!row) throw new Error("Failed to record image");
      return mapImage(row);
    },
  };
}
