import "server-only";

import { randomUUID } from "node:crypto";

import { ensureLocalProfile, query, queryOne, withTransaction } from "@/lib/db/client";
import { localUserId } from "@/lib/env";
import {
  customerRecordInputSchema,
  normalizeProductRecord,
  normalizeSupplierProductTypes,
  productRecordInputSchema,
  supplierRecordInputSchema,
  type CustomerRecord,
  type ProductRecord,
  type SupplierRecord,
} from "@/lib/workspace-records";
import {
  defaultWorkspaceOptions,
  genericNodeDefinitionInputSchema,
  genericNodeDefinitionSchema,
  workspaceOptionListSchema,
  type GenericNodeDefinition,
  type WorkspaceOption,
  type WorkspaceOptionKind,
} from "@/lib/workspace-settings";

import type { WorkspaceRecordStore } from "./workspaceRecordStore";

interface CustomerRow {
  id: string;
  company_name: string;
  email_domain_suffix: string;
  customer_type: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EmployeeRow {
  id: string;
  user_name: string;
  email_prefix: string;
  title: string;
  tel: string;
  sort_index: number;
}

interface SupplierRow {
  id: string;
  company_name: string;
  email_domain_suffix: string;
  product_types: string[];
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProductRow {
  id: string;
  owner_kind: "supplier" | "customer";
  supplier_id: string | null;
  customer_id: string | null;
  project_id: string | null;
  product_type: string;
  subject: string;
  detail: string;
  material: string | null;
  color_notes: string | null;
  parameters: unknown;
  unit_price: string | null;
  price_unit: string | null;
  image_name: string | null;
  image_url: string | null;
  image_storage_path: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProductVariantRow {
  id: string;
  sort_index: number;
  material: string | null;
  color_notes: string | null;
  parameters: unknown;
  unit_price: string | null;
  price_unit: string | null;
  image_name: string | null;
  image_url: string | null;
  image_storage_path: string | null;
}

interface WorkspaceOptionRow {
  id: string;
  kind: WorkspaceOptionKind;
  code: string;
  name: string;
  symbol: string | null;
  is_favorite: boolean | null;
  sort_index: number;
}

interface GenericNodeRow {
  id: string;
  name: string;
  image_url: string;
  storage_path: string | null;
  images: unknown;
  sort_index: number;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapEmployees(rows: EmployeeRow[]) {
  return [...rows]
    .sort((a, b) => a.sort_index - b.sort_index)
    .map((row) => ({
      id: row.id,
      userName: row.user_name,
      emailPrefix: row.email_prefix,
      title: row.title,
      tel: row.tel,
    }));
}

function mapCustomer(row: CustomerRow, employees: EmployeeRow[]): CustomerRecord {
  return {
    id: row.id,
    company: {
      companyName: row.company_name,
      emailDomainSuffix: row.email_domain_suffix,
      type: row.customer_type,
    },
    employees: mapEmployees(employees),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapSupplier(row: SupplierRow, employees: EmployeeRow[]): SupplierRecord {
  return {
    id: row.id,
    company: {
      companyName: row.company_name,
      emailDomainSuffix: row.email_domain_suffix,
      productTypes: normalizeSupplierProductTypes(row.product_types ?? []),
    },
    employees: mapEmployees(employees),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapProduct(row: ProductRow, variants: ProductVariantRow[]): ProductRecord {
  return normalizeProductRecord({
    id: row.id,
    ownerKind: row.owner_kind,
    supplierId: row.supplier_id,
    customerId: row.customer_id,
    projectId: row.project_id,
    productType: row.product_type,
    subject: row.subject,
    detail: row.detail,
    material: row.material,
    colorNotes: row.color_notes,
    parameters: row.parameters,
    unitPrice: row.unit_price,
    priceUnit: row.price_unit,
    image:
      row.image_name && row.image_url
        ? {
            name: row.image_name,
            url: row.image_url,
            storagePath: row.image_storage_path,
          }
        : null,
    variants:
      variants.length > 0
        ? variants.map((variant) => ({
            id: variant.id,
            sortIndex: variant.sort_index,
            material: variant.material ?? "",
            colorNotes: variant.color_notes ?? "",
            parameters: variant.parameters,
            unitPrice: variant.unit_price,
            priceUnit: variant.price_unit,
            image:
              variant.image_name && variant.image_url
                ? {
                    name: variant.image_name,
                    url: variant.image_url,
                    storagePath: variant.image_storage_path,
                  }
                : null,
          }))
        : undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapWorkspaceOption(row: WorkspaceOptionRow): WorkspaceOption {
  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    isFavorite: row.is_favorite ?? false,
    sortIndex: row.sort_index,
  };
}

function mapGenericNode(row: GenericNodeRow): GenericNodeDefinition {
  return genericNodeDefinitionSchema.parse({
    id: row.id,
    name: row.name,
    images: row.images,
    imageUrl: row.image_url,
    storagePath: row.storage_path,
    sortIndex: row.sort_index,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

async function loadCustomerEmployees(customerId: string): Promise<EmployeeRow[]> {
  return query<EmployeeRow>(
    `SELECT id, user_name, email_prefix, title, tel, sort_index
     FROM public.customer_employees
     WHERE customer_id = $1
     ORDER BY sort_index ASC`,
    [customerId],
  );
}

async function loadSupplierEmployees(supplierId: string): Promise<EmployeeRow[]> {
  return query<EmployeeRow>(
    `SELECT id, user_name, email_prefix, title, tel, sort_index
     FROM public.supplier_employees
     WHERE supplier_id = $1
     ORDER BY sort_index ASC`,
    [supplierId],
  );
}

async function loadProductVariants(productId: string): Promise<ProductVariantRow[]> {
  return query<ProductVariantRow>(
    `SELECT id, sort_index, material, color_notes, parameters, unit_price, price_unit,
            image_name, image_url, image_storage_path
     FROM public.product_variants
     WHERE product_id = $1
     ORDER BY sort_index ASC`,
    [productId],
  );
}

export function createPostgresWorkspaceRecordStore(): WorkspaceRecordStore {
  return {
    async listCustomers() {
      await ensureLocalProfile();
      const rows = await query<CustomerRow>(
        `SELECT id, company_name, email_domain_suffix, customer_type, created_at, updated_at
         FROM public.customers
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [localUserId],
      );
      return Promise.all(
        rows.map(async (row) => mapCustomer(row, await loadCustomerEmployees(row.id))),
      );
    },

    async upsertCustomer(id, input) {
      await ensureLocalProfile();
      const parsed = customerRecordInputSchema.parse(input);
      const customerId = id ?? randomUUID();

      return withTransaction(async (client) => {
        if (id) {
          const owned = await client.query(
            `SELECT id FROM public.customers WHERE id = $1 AND user_id = $2`,
            [id, localUserId],
          );
          if (owned.rows.length === 0) throw new Error("Customer not found");
        }

        const result = await client.query<CustomerRow>(
          `INSERT INTO public.customers (
             id, user_id, company_name, email_domain_suffix, customer_type
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             company_name = EXCLUDED.company_name,
             email_domain_suffix = EXCLUDED.email_domain_suffix,
             customer_type = EXCLUDED.customer_type,
             updated_at = now()
           RETURNING id, company_name, email_domain_suffix, customer_type, created_at, updated_at`,
          [
            customerId,
            localUserId,
            parsed.company.companyName,
            parsed.company.emailDomainSuffix,
            parsed.company.type,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Failed to save customer");

        await client.query(`DELETE FROM public.customer_employees WHERE customer_id = $1`, [
          customerId,
        ]);

        for (let i = 0; i < parsed.employees.length; i += 1) {
          const employee = parsed.employees[i];
          await client.query(
            `INSERT INTO public.customer_employees (
               id, customer_id, user_id, user_name, email_prefix, title, tel, sort_index
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              employee.id,
              customerId,
              localUserId,
              employee.userName,
              employee.emailPrefix,
              employee.title,
              employee.tel,
              i,
            ],
          );
        }

        const employees = await client.query<EmployeeRow>(
          `SELECT id, user_name, email_prefix, title, tel, sort_index
           FROM public.customer_employees
           WHERE customer_id = $1
           ORDER BY sort_index ASC`,
          [customerId],
        );
        return mapCustomer(row, employees.rows);
      });
    },

    async listSuppliers() {
      await ensureLocalProfile();
      const rows = await query<SupplierRow>(
        `SELECT id, company_name, email_domain_suffix, product_types, created_at, updated_at
         FROM public.suppliers
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [localUserId],
      );
      return Promise.all(
        rows.map(async (row) => mapSupplier(row, await loadSupplierEmployees(row.id))),
      );
    },

    async upsertSupplier(id, input) {
      await ensureLocalProfile();
      const parsed = supplierRecordInputSchema.parse(input);
      const supplierId = id ?? randomUUID();

      return withTransaction(async (client) => {
        if (id) {
          const owned = await client.query(
            `SELECT id FROM public.suppliers WHERE id = $1 AND user_id = $2`,
            [id, localUserId],
          );
          if (owned.rows.length === 0) throw new Error("Supplier not found");
        }

        const result = await client.query<SupplierRow>(
          `INSERT INTO public.suppliers (
             id, user_id, company_name, email_domain_suffix, product_types
           ) VALUES ($1, $2, $3, $4, $5::text[])
           ON CONFLICT (id) DO UPDATE SET
             company_name = EXCLUDED.company_name,
             email_domain_suffix = EXCLUDED.email_domain_suffix,
             product_types = EXCLUDED.product_types,
             updated_at = now()
           RETURNING id, company_name, email_domain_suffix, product_types, created_at, updated_at`,
          [
            supplierId,
            localUserId,
            parsed.company.companyName,
            parsed.company.emailDomainSuffix,
            parsed.company.productTypes,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Failed to save supplier");

        await client.query(`DELETE FROM public.supplier_employees WHERE supplier_id = $1`, [
          supplierId,
        ]);

        for (let i = 0; i < parsed.employees.length; i += 1) {
          const employee = parsed.employees[i];
          await client.query(
            `INSERT INTO public.supplier_employees (
               id, supplier_id, user_id, user_name, email_prefix, title, tel, sort_index
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              employee.id,
              supplierId,
              localUserId,
              employee.userName,
              employee.emailPrefix,
              employee.title,
              employee.tel,
              i,
            ],
          );
        }

        const employees = await client.query<EmployeeRow>(
          `SELECT id, user_name, email_prefix, title, tel, sort_index
           FROM public.supplier_employees
           WHERE supplier_id = $1
           ORDER BY sort_index ASC`,
          [supplierId],
        );
        return mapSupplier(row, employees.rows);
      });
    },

    async deleteSuppliers(ids) {
      if (ids.length === 0) return;
      await ensureLocalProfile();
      await query(`DELETE FROM public.suppliers WHERE user_id = $1 AND id = ANY($2::uuid[])`, [
        localUserId,
        ids,
      ]);
    },

    async listProducts() {
      await ensureLocalProfile();
      const rows = await query<ProductRow>(
        `SELECT id, owner_kind, supplier_id, customer_id, project_id, product_type, subject, detail,
                material, color_notes, parameters, unit_price, price_unit, image_name, image_url,
                image_storage_path, created_at, updated_at
         FROM public.products
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [localUserId],
      );
      return Promise.all(
        rows.map(async (row) => mapProduct(row, await loadProductVariants(row.id))),
      );
    },

    async upsertProduct(id, input) {
      await ensureLocalProfile();
      const parsed = productRecordInputSchema.parse(input);
      const productId = id ?? randomUUID();
      const first = parsed.variants[0];
      if (!first) throw new Error("Product variants must be a non-empty array.");

      return withTransaction(async (client) => {
        if (id) {
          const owned = await client.query(
            `SELECT id FROM public.products WHERE id = $1 AND user_id = $2`,
            [id, localUserId],
          );
          if (owned.rows.length === 0) throw new Error("Product not found");
        }

        const result = await client.query<ProductRow>(
          `INSERT INTO public.products (
             id, user_id, owner_kind, supplier_id, customer_id, project_id, product_type,
             subject, detail, material, color_notes, parameters, unit_price, price_unit,
             image_name, image_url, image_storage_path
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12::jsonb, $13, $14,
             $15, $16, $17
           )
           ON CONFLICT (id) DO UPDATE SET
             owner_kind = EXCLUDED.owner_kind,
             supplier_id = EXCLUDED.supplier_id,
             customer_id = EXCLUDED.customer_id,
             project_id = EXCLUDED.project_id,
             product_type = EXCLUDED.product_type,
             subject = EXCLUDED.subject,
             detail = EXCLUDED.detail,
             material = EXCLUDED.material,
             color_notes = EXCLUDED.color_notes,
             parameters = EXCLUDED.parameters,
             unit_price = EXCLUDED.unit_price,
             price_unit = EXCLUDED.price_unit,
             image_name = EXCLUDED.image_name,
             image_url = EXCLUDED.image_url,
             image_storage_path = EXCLUDED.image_storage_path,
             updated_at = now()
           RETURNING id, owner_kind, supplier_id, customer_id, project_id, product_type, subject, detail,
                     material, color_notes, parameters, unit_price, price_unit, image_name, image_url,
                     image_storage_path, created_at, updated_at`,
          [
            productId,
            localUserId,
            parsed.ownerKind,
            parsed.ownerKind === "supplier" ? (parsed.supplierId ?? null) : null,
            parsed.ownerKind === "customer" ? (parsed.customerId ?? null) : null,
            null,
            parsed.productType,
            parsed.subject,
            parsed.detail,
            first.material,
            first.colorNotes,
            JSON.stringify(first.parameters ?? {}),
            first.unitPrice,
            first.priceUnit,
            first.image.name,
            first.image.url,
            first.image.storagePath,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Failed to save product");

        await client.query(`DELETE FROM public.product_variants WHERE product_id = $1`, [productId]);

        for (const variant of parsed.variants) {
          await client.query(
            `INSERT INTO public.product_variants (
               id, product_id, user_id, sort_index, material, color_notes, parameters,
               unit_price, price_unit, image_name, image_url, image_storage_path
             ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
            [
              variant.id,
              productId,
              localUserId,
              variant.sortIndex,
              variant.material,
              variant.colorNotes,
              JSON.stringify(variant.parameters ?? {}),
              variant.unitPrice,
              variant.priceUnit,
              variant.image.name,
              variant.image.url,
              variant.image.storagePath,
            ],
          );
        }

        const variants = await client.query<ProductVariantRow>(
          `SELECT id, sort_index, material, color_notes, parameters, unit_price, price_unit,
                  image_name, image_url, image_storage_path
           FROM public.product_variants
           WHERE product_id = $1
           ORDER BY sort_index ASC`,
          [productId],
        );
        return mapProduct(row, variants.rows);
      });
    },

    async deleteProducts(ids) {
      if (ids.length === 0) return;
      await ensureLocalProfile();
      await query(`DELETE FROM public.products WHERE user_id = $1 AND id = ANY($2::uuid[])`, [
        localUserId,
        ids,
      ]);
    },

    async getProduct(productId) {
      await ensureLocalProfile();
      const row = await queryOne<ProductRow>(
        `SELECT id, owner_kind, supplier_id, customer_id, project_id, product_type, subject, detail,
                material, color_notes, parameters, unit_price, price_unit, image_name, image_url,
                image_storage_path, created_at, updated_at
         FROM public.products
         WHERE id = $1 AND user_id = $2`,
        [productId, localUserId],
      );
      if (!row) return null;
      return mapProduct(row, await loadProductVariants(row.id));
    },

    async listWorkspaceOptions(kind) {
      await ensureLocalProfile();
      const rows = await query<WorkspaceOptionRow>(
        `SELECT id, kind, code, name, symbol, is_favorite, sort_index
         FROM public.workspace_options
         WHERE user_id = $1 AND kind = $2
         ORDER BY sort_index ASC`,
        [localUserId, kind],
      );
      if (rows.length === 0) return defaultWorkspaceOptions(kind);
      return rows.map(mapWorkspaceOption);
    },

    async replaceWorkspaceOptions(kind, options) {
      await ensureLocalProfile();
      const parsed = workspaceOptionListSchema.parse(options).map((option, sortIndex) => ({
        ...option,
        sortIndex,
      }));
      if (parsed.some((option) => option.kind !== kind)) {
        throw new Error("Workspace option kind does not match the requested setting.");
      }

      return withTransaction(async (client) => {
        await client.query(
          `DELETE FROM public.workspace_options WHERE user_id = $1 AND kind = $2`,
          [localUserId, kind],
        );
        for (const option of parsed) {
          await client.query(
            `INSERT INTO public.workspace_options (
               id, user_id, kind, code, name, symbol, is_favorite, sort_index
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              option.id,
              localUserId,
              kind,
              option.code,
              option.name,
              option.symbol,
              option.isFavorite ?? false,
              option.sortIndex,
            ],
          );
        }
        const rows = await client.query<WorkspaceOptionRow>(
          `SELECT id, kind, code, name, symbol, is_favorite, sort_index
           FROM public.workspace_options
           WHERE user_id = $1 AND kind = $2
           ORDER BY sort_index ASC`,
          [localUserId, kind],
        );
        return rows.rows.map(mapWorkspaceOption);
      });
    },

    async listGenericNodeDefinitions() {
      await ensureLocalProfile();
      const rows = await query<GenericNodeRow>(
        `SELECT id, name, image_url, storage_path, images, sort_index, created_at, updated_at
         FROM public.generic_node_definitions
         WHERE user_id = $1
         ORDER BY sort_index ASC`,
        [localUserId],
      );
      return rows.map(mapGenericNode);
    },

    async upsertGenericNodeDefinition(id, input) {
      await ensureLocalProfile();
      const parsed = genericNodeDefinitionInputSchema.parse(input);
      const existing = await this.listGenericNodeDefinitions();
      const current = id ? existing.find((record) => record.id === id) : null;
      const definitionId = current?.id ?? id ?? randomUUID();
      const primaryImage = parsed.images[0];
      if (!primaryImage) throw new Error("Generic node requires at least one image.");

      const row = await queryOne<GenericNodeRow>(
        `INSERT INTO public.generic_node_definitions (
           id, user_id, name, image_url, storage_path, images, sort_index
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           image_url = EXCLUDED.image_url,
           storage_path = EXCLUDED.storage_path,
           images = EXCLUDED.images,
           updated_at = now()
         RETURNING id, name, image_url, storage_path, images, sort_index, created_at, updated_at`,
        [
          definitionId,
          localUserId,
          parsed.name,
          primaryImage.url,
          primaryImage.storagePath,
          JSON.stringify(parsed.images),
          current?.sortIndex ?? existing.length,
        ],
      );
      if (!row) throw new Error("Failed to save generic node definition");
      return mapGenericNode(row);
    },

    async deleteGenericNodeDefinition(id) {
      await ensureLocalProfile();
      await query(
        `DELETE FROM public.generic_node_definitions WHERE id = $1 AND user_id = $2`,
        [id, localUserId],
      );
    },

    async reorderGenericNodeDefinitions(orderedIds) {
      await ensureLocalProfile();
      return withTransaction(async (client) => {
        for (let i = 0; i < orderedIds.length; i += 1) {
          await client.query(
            `UPDATE public.generic_node_definitions
             SET sort_index = $3, updated_at = now()
             WHERE id = $1 AND user_id = $2`,
            [orderedIds[i], localUserId, i],
          );
        }
        const rows = await client.query<GenericNodeRow>(
          `SELECT id, name, image_url, storage_path, images, sort_index, created_at, updated_at
           FROM public.generic_node_definitions
           WHERE user_id = $1
           ORDER BY sort_index ASC`,
          [localUserId],
        );
        return rows.rows.map(mapGenericNode);
      });
    },

    async getAppSetting(key) {
      await ensureLocalProfile();
      const row = await queryOne<{ value: unknown }>(
        `SELECT value FROM public.app_settings WHERE user_id = $1 AND key = $2`,
        [localUserId, key],
      );
      return row?.value ?? null;
    },

    async setAppSetting(key, value) {
      await ensureLocalProfile();
      await query(
        `INSERT INTO public.app_settings (user_id, key, value, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [localUserId, key, JSON.stringify(value)],
      );
    },
  };
}
