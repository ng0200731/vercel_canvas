import { z } from "zod";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  customerRecordInputSchema,
  normalizeProductRecord,
  normalizeSupplierProductTypes,
  productRecordInputSchema,
  type ProductRecordInput,
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
} from "@/lib/workspace-settings";

import { localWorkspaceRecordStore } from "./localWorkspaceRecordStore";
import type { WorkspaceRecordStore } from "./workspaceRecordStore";

const employeeRowSchema = z.object({
  id: z.string(),
  user_name: z.string(),
  email_prefix: z.string(),
  title: z.string(),
  tel: z.string(),
  sort_index: z.number().int(),
});

const customerRowSchema = z.object({
  id: z.string(),
  user_id: z.string().nullable().optional(),
  company_name: z.string(),
  email_domain_suffix: z.string(),
  customer_type: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const supplierRowSchema = z.object({
  id: z.string(),
  user_id: z.string().nullable().optional(),
  company_name: z.string(),
  email_domain_suffix: z.string(),
  product_types: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});

const productVariantRowSchema = z.object({
  id: z.string(),
  sort_index: z.number().int(),
  material: z.string().nullable().optional(),
  color_notes: z.string().nullable().optional(),
  parameters: z.unknown().nullable().optional(),
  unit_price: z.string().nullable().optional(),
  price_unit: z.string().nullable().optional(),
  image_name: z.string().nullable(),
  image_url: z.string().nullable(),
  image_storage_path: z.string().nullable(),
});

const productRowSchema = z.object({
  id: z.string(),
  user_id: z.string().nullable().optional(),
  owner_kind: z.enum(["supplier", "customer"]).optional(),
  supplier_id: z.string().nullable().optional(),
  customer_id: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  product_type: z.string().nullable().optional(),
  subject: z.string(),
  detail: z.string(),
  material: z.string().nullable().optional(),
  color_notes: z.string().nullable().optional(),
  parameters: z.unknown().nullable().optional(),
  unit_price: z.string().nullable().optional(),
  price_unit: z.string().nullable().optional(),
  image_name: z.string().nullable(),
  image_url: z.string().nullable(),
  image_storage_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  product_variants: z.array(productVariantRowSchema).optional().default([]),
});

const workspaceOptionRowSchema = z.object({
  id: z.string(),
  kind: z.enum(["currency", "destination-country", "address-book"]),
  code: z.string(),
  name: z.string(),
  symbol: z.string().nullable(),
  is_favorite: z.boolean().nullable().optional(),
  sort_index: z.number().int(),
});

const genericNodeRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  image_url: z.string(),
  storage_path: z.string().nullable(),
  images: z.unknown().optional(),
  sort_index: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

function assertNoError<T extends { error: { message: string } | null }>(
  result: T,
  context: string,
): void {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
}

function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isMissingVariantsRpc(message: string): boolean {
  return (
    (message.includes("upsert_product_with_variants") ||
      message.includes("upsert_workspace_product_with_variants")) &&
    message.includes("schema cache")
  );
}

function isProductSchemaCacheMismatch(message: string): boolean {
  return (
    isMissingVariantsRpc(message) ||
    message.includes("supplier_id") ||
    message.includes("owner_kind") ||
    message.includes("customer_id") ||
    message.includes("project_id") ||
    message.includes("product_variants")
  );
}

function isSettingsSchemaCacheMismatch(message: string): boolean {
  return [
    "workspace_options",
    "generic_node_definitions",
    "replace_workspace_options",
    "reorder_generic_node_definitions",
    "is_favorite",
    "app_settings",
  ].some((name) => message.includes(name));
}

function newestProductsFirst(records: ProductRecord[]): ProductRecord[] {
  return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function mergeProducts(primary: ProductRecord[], secondary: ProductRecord[]): ProductRecord[] {
  const merged = new Map<string, ProductRecord>();
  for (const record of [...secondary, ...primary]) {
    const existing = merged.get(record.id);
    if (!existing || record.updatedAt.localeCompare(existing.updatedAt) > 0) {
      merged.set(record.id, record);
    }
  }
  return newestProductsFirst([...merged.values()]);
}

function mapEmployees(value: unknown) {
  return toUnknownArray(value)
    .map((row) => employeeRowSchema.parse(row))
    .sort((a, b) => a.sort_index - b.sort_index)
    .map((row) => ({
      id: row.id,
      userName: row.user_name,
      emailPrefix: row.email_prefix,
      title: row.title,
      tel: row.tel,
    }));
}

function mapCustomer(rowValue: unknown, employeeRows: unknown): CustomerRecord {
  const row = customerRowSchema.parse(rowValue);
  return {
    id: row.id,
    userId: row.user_id ?? null,
    company: {
      companyName: row.company_name,
      emailDomainSuffix: row.email_domain_suffix,
      type: row.customer_type,
    },
    employees: mapEmployees(employeeRows),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupplier(rowValue: unknown, employeeRows: unknown): SupplierRecord {
  const row = supplierRowSchema.parse(rowValue);
  return {
    id: row.id,
    userId: row.user_id ?? null,
    company: {
      companyName: row.company_name,
      emailDomainSuffix: row.email_domain_suffix,
      productTypes: normalizeSupplierProductTypes(row.product_types),
    },
    employees: mapEmployees(employeeRows),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProduct(rowValue: unknown): ProductRecord {
  const row = productRowSchema.parse(rowValue);
  return normalizeProductRecord({
    id: row.id,
    userId: row.user_id ?? null,
    ownerKind: row.owner_kind,
    supplierId: row.supplier_id ?? null,
    customerId: row.customer_id ?? null,
    projectId: row.project_id ?? null,
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
      row.product_variants.length > 0
        ? row.product_variants.map((variant) => ({
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapWorkspaceOption(rowValue: unknown): WorkspaceOption {
  const row = workspaceOptionRowSchema.parse(rowValue);
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

function mapGenericNodeDefinition(rowValue: unknown): GenericNodeDefinition {
  const row = genericNodeRowSchema.parse(rowValue);
  return genericNodeDefinitionSchema.parse({
    id: row.id,
    name: row.name,
    images: row.images,
    imageUrl: row.image_url,
    storagePath: row.storage_path,
    sortIndex: row.sort_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function createSupabaseWorkspaceRecordStore(): WorkspaceRecordStore {
  const supabase = getSupabaseBrowserClient();

  async function getCurrentUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    assertNoError({ error }, "getCurrentUser");
    if (!data.user) throw new Error("Sign in before saving to the database.");
    return data.user.id;
  }

  return {
    async listCustomers() {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, user_id, company_name, email_domain_suffix, customer_type, created_at, updated_at, customer_employees(id, user_name, email_prefix, title, tel, sort_index)",
        )
        .order("updated_at", { ascending: false });
      assertNoError({ error }, "listCustomers");
      return toUnknownArray(data).map((row) => {
        const record = row as { customer_employees?: unknown };
        return mapCustomer(record, record.customer_employees);
      });
    },

    async upsertCustomer(id, input) {
      const parsed = customerRecordInputSchema.parse(input);
      const userId = await getCurrentUserId();
      const { data, error } = await supabase.rpc("upsert_customer_record", {
        p_customer_id: id,
        p_company_name: parsed.company.companyName,
        p_customer_type: parsed.company.type,
        p_email_domain_suffix: parsed.company.emailDomainSuffix,
        p_employees: parsed.employees,
        p_user_id: userId,
      });
      assertNoError({ error }, "upsertCustomer");
      return mapCustomer(data, (data as { employees?: unknown } | null)?.employees);
    },

    async listSuppliers() {
      const { data, error } = await supabase
        .from("suppliers")
        .select(
          "id, user_id, company_name, email_domain_suffix, product_types, created_at, updated_at, supplier_employees(id, user_name, email_prefix, title, tel, sort_index)",
        )
        .order("updated_at", { ascending: false });
      assertNoError({ error }, "listSuppliers");
      return toUnknownArray(data).map((row) => {
        const record = row as { supplier_employees?: unknown };
        return mapSupplier(record, record.supplier_employees);
      });
    },

    async upsertSupplier(id, input) {
      const parsed = supplierRecordInputSchema.parse(input);
      const userId = await getCurrentUserId();
      const { data, error } = await supabase.rpc("upsert_supplier_record", {
        p_company_name: parsed.company.companyName,
        p_email_domain_suffix: parsed.company.emailDomainSuffix,
        p_employees: parsed.employees,
        p_product_types: parsed.company.productTypes,
        p_supplier_id: id,
        p_user_id: userId,
      });
      assertNoError({ error }, "upsertSupplier");
      return mapSupplier(data, (data as { employees?: unknown } | null)?.employees);
    },

    async deleteSuppliers(ids) {
      if (ids.length === 0) return;
      const { error } = await supabase.from("suppliers").delete().in("id", ids);
      assertNoError({ error }, "deleteSuppliers");
    },

    async listProducts() {
      const query = await supabase
        .from("products")
        .select(
          "id, user_id, owner_kind, supplier_id, customer_id, project_id, product_type, subject, detail, material, color_notes, parameters, unit_price, price_unit, image_name, image_url, image_storage_path, created_at, updated_at, product_variants(id, sort_index, material, color_notes, parameters, unit_price, price_unit, image_name, image_url, image_storage_path)",
        )
        .order("updated_at", { ascending: false });
      if (query.error && isProductSchemaCacheMismatch(query.error.message)) {
        const legacy = await supabase
          .from("products")
          .select(
            "id, product_type, subject, detail, material, color_notes, parameters, unit_price, price_unit, image_name, image_url, image_storage_path, created_at, updated_at",
          )
          .order("updated_at", { ascending: false });
        assertNoError({ error: legacy.error }, "listProducts");
        const localProducts = await localWorkspaceRecordStore.listProducts();
        return mergeProducts(toUnknownArray(legacy.data).map(mapProduct), localProducts);
      }
      assertNoError({ error: query.error }, "listProducts");
      return toUnknownArray(query.data).map(mapProduct);
    },

    async upsertProduct(id, input) {
      const parsed = productRecordInputSchema.parse(input);
      const userId = await getCurrentUserId();
      const { data, error } = await supabase.rpc("upsert_workspace_product_with_variants", {
        p_product_id: id,
        p_user_id: userId,
        p_owner_kind: parsed.ownerKind,
        p_supplier_id: parsed.supplierId ?? null,
        p_customer_id: parsed.customerId ?? null,
        p_project_id: parsed.projectId ?? null,
        p_product_type: parsed.productType,
        p_subject: parsed.subject,
        p_detail: parsed.detail,
        p_variants: parsed.variants.map((variant) => ({
          id: variant.id,
          sortIndex: variant.sortIndex,
          material: variant.material,
          colorNotes: variant.colorNotes,
          parameters: variant.parameters,
          unitPrice: variant.unitPrice,
          priceUnit: variant.priceUnit,
          image: variant.image,
        })),
      });
      if (!error) return mapProduct(data);
      if (!isProductSchemaCacheMismatch(error.message)) assertNoError({ error }, "upsertProduct");

      if (parsed.ownerKind === "supplier") {
        const legacyRpc = await supabase.rpc("upsert_product_with_variants", {
          p_product_id: id,
          p_user_id: userId,
          p_supplier_id: parsed.supplierId,
          p_product_type: parsed.productType,
          p_subject: parsed.subject,
          p_detail: parsed.detail,
          p_variants: parsed.variants.map((variant) => ({
            id: variant.id,
            sortIndex: variant.sortIndex,
            material: variant.material,
            colorNotes: variant.colorNotes,
            parameters: variant.parameters,
            unitPrice: variant.unitPrice,
            priceUnit: variant.priceUnit,
            image: variant.image,
          })),
        });
        if (!legacyRpc.error) return mapProduct(legacyRpc.data);
        if (!isProductSchemaCacheMismatch(legacyRpc.error.message)) {
          assertNoError({ error: legacyRpc.error }, "upsertProduct");
        }
      }

      // PostgREST can temporarily retain an old function cache after the
      // variants migration. Use the same tables directly so the form remains
      // usable; the migration RPC remains the normal atomic path.
      const productId = id ?? crypto.randomUUID();
      const first = parsed.variants[0];
      const productValues = {
        id: productId,
        user_id: userId,
        owner_kind: parsed.ownerKind,
        supplier_id: parsed.ownerKind === "supplier" ? parsed.supplierId : null,
        customer_id: parsed.ownerKind === "customer" ? parsed.customerId : null,
        project_id: null,
        product_type: parsed.productType,
        subject: parsed.subject,
        detail: parsed.detail,
        material: first.material,
        color_notes: first.colorNotes,
        parameters: first.parameters,
        unit_price: first.unitPrice,
        price_unit: first.priceUnit,
        image_name: first.image.name,
        image_url: first.image.url,
        image_storage_path: first.image.storagePath,
      };
      const productWrite = await supabase.from("products").upsert(productValues).select().single();
      if (productWrite.error) {
        if (!isProductSchemaCacheMismatch(productWrite.error.message)) {
          assertNoError({ error: productWrite.error }, "upsertProduct");
        }
        return localWorkspaceRecordStore.upsertProduct(
          id ?? productId,
          parsed satisfies ProductRecordInput,
        );
      }

      const removeVariants = await supabase
        .from("product_variants")
        .delete()
        .eq("product_id", productId);
      if (removeVariants.error) {
        if (!isProductSchemaCacheMismatch(removeVariants.error.message)) {
          assertNoError({ error: removeVariants.error }, "upsertProduct variants");
        }
        return localWorkspaceRecordStore.upsertProduct(
          id ?? productId,
          parsed satisfies ProductRecordInput,
        );
      }
      const variantWrite = await supabase.from("product_variants").insert(
        parsed.variants.map((variant) => ({
          id: variant.id,
          product_id: productId,
          user_id: userId,
          sort_index: variant.sortIndex,
          material: variant.material,
          color_notes: variant.colorNotes,
          parameters: variant.parameters,
          unit_price: variant.unitPrice,
          price_unit: variant.priceUnit,
          image_name: variant.image.name,
          image_url: variant.image.url,
          image_storage_path: variant.image.storagePath,
        })),
      );
      if (variantWrite.error) {
        if (!isProductSchemaCacheMismatch(variantWrite.error.message)) {
          assertNoError({ error: variantWrite.error }, "upsertProduct variants");
        }
        return localWorkspaceRecordStore.upsertProduct(
          id ?? productId,
          parsed satisfies ProductRecordInput,
        );
      }

      const saved = await supabase
        .from("products")
        .select(
          "id, owner_kind, supplier_id, customer_id, project_id, product_type, subject, detail, material, color_notes, parameters, unit_price, price_unit, image_name, image_url, image_storage_path, created_at, updated_at, product_variants(id, sort_index, material, color_notes, parameters, unit_price, price_unit, image_name, image_url, image_storage_path)",
        )
        .eq("id", productId)
        .single();
      if (saved.error) {
        if (!isProductSchemaCacheMismatch(saved.error.message)) {
          assertNoError({ error: saved.error }, "upsertProduct");
        }
        return localWorkspaceRecordStore.upsertProduct(
          id ?? productId,
          parsed satisfies ProductRecordInput,
        );
      }
      return mapProduct(saved.data);
    },

    async deleteProducts(ids) {
      if (ids.length === 0) return;
      const { error } = await supabase.from("products").delete().in("id", ids);
      assertNoError({ error }, "deleteProducts");
    },

    async getProduct(productId) {
      const query = await supabase
        .from("products")
        .select(
          "id, owner_kind, supplier_id, customer_id, project_id, product_type, subject, detail, material, color_notes, parameters, unit_price, price_unit, image_name, image_url, image_storage_path, created_at, updated_at, product_variants(id, sort_index, material, color_notes, parameters, unit_price, price_unit, image_name, image_url, image_storage_path)",
        )
        .eq("id", productId)
        .maybeSingle();
      if (query.error && isProductSchemaCacheMismatch(query.error.message)) {
        const legacy = await supabase
          .from("products")
          .select(
            "id, product_type, subject, detail, material, color_notes, parameters, unit_price, price_unit, image_name, image_url, image_storage_path, created_at, updated_at",
          )
          .eq("id", productId)
          .maybeSingle();
        assertNoError({ error: legacy.error }, "getProduct");
        return legacy.data ? mapProduct(legacy.data) : null;
      }
      assertNoError({ error: query.error }, "getProduct");
      return query.data ? mapProduct(query.data) : null;
    },

    async listWorkspaceOptions(kind) {
      const query = await supabase
        .from("workspace_options")
        .select("id, kind, code, name, symbol, is_favorite, sort_index")
        .eq("kind", kind)
        .order("sort_index", { ascending: true });
      if (query.error) {
        if (isSettingsSchemaCacheMismatch(query.error.message)) {
          return localWorkspaceRecordStore.listWorkspaceOptions(kind);
        }
        assertNoError({ error: query.error }, "listWorkspaceOptions");
      }
      const rows = toUnknownArray(query.data).map(mapWorkspaceOption);
      return rows.length > 0 ? rows : defaultWorkspaceOptions(kind);
    },

    async replaceWorkspaceOptions(kind, options) {
      const parsed = workspaceOptionListSchema.parse(options).map((option, sortIndex) => ({
        ...option,
        sortIndex,
      }));
      if (parsed.some((option) => option.kind !== kind)) {
        throw new Error("Workspace option kind does not match the requested setting.");
      }
      const userId = await getCurrentUserId();
      const { data, error } = await supabase.rpc("replace_workspace_options", {
        p_kind: kind,
        p_options: parsed,
        p_user_id: userId,
      });
      if (error) {
        if (isSettingsSchemaCacheMismatch(error.message)) {
          return localWorkspaceRecordStore.replaceWorkspaceOptions(kind, parsed);
        }
        assertNoError({ error }, "replaceWorkspaceOptions");
      }
      return workspaceOptionListSchema.parse(
        toUnknownArray(data).map((row) => mapWorkspaceOption(row)),
      );
    },

    async listGenericNodeDefinitions() {
      const query = await supabase
        .from("generic_node_definitions")
        .select("id, name, image_url, storage_path, images, sort_index, created_at, updated_at")
        .order("sort_index", { ascending: true });
      if (query.error) {
        if (isSettingsSchemaCacheMismatch(query.error.message)) {
          const legacy = await supabase
            .from("generic_node_definitions")
            .select("id, name, image_url, storage_path, sort_index, created_at, updated_at")
            .order("sort_index", { ascending: true });
          if (!legacy.error) return toUnknownArray(legacy.data).map(mapGenericNodeDefinition);
          return localWorkspaceRecordStore.listGenericNodeDefinitions();
        }
        assertNoError({ error: query.error }, "listGenericNodeDefinitions");
      }
      return toUnknownArray(query.data).map(mapGenericNodeDefinition);
    },

    async upsertGenericNodeDefinition(id, input) {
      const parsed = genericNodeDefinitionInputSchema.parse(input);
      const userId = await getCurrentUserId();
      const existing = await this.listGenericNodeDefinitions();
      const current = id ? existing.find((record) => record.id === id) : null;
      const primaryImage = parsed.images[0];
      const values = {
        id: current?.id ?? id ?? crypto.randomUUID(),
        user_id: userId,
        name: parsed.name,
        image_url: primaryImage.url,
        storage_path: primaryImage.storagePath,
        images: parsed.images,
        sort_index: current?.sortIndex ?? existing.length,
      };
      const query = await supabase
        .from("generic_node_definitions")
        .upsert(values)
        .select("id, name, image_url, storage_path, images, sort_index, created_at, updated_at")
        .single();
      if (query.error) {
        if (isSettingsSchemaCacheMismatch(query.error.message)) {
          return localWorkspaceRecordStore.upsertGenericNodeDefinition(id, parsed);
        }
        assertNoError({ error: query.error }, "upsertGenericNodeDefinition");
      }
      return mapGenericNodeDefinition(query.data);
    },

    async deleteGenericNodeDefinition(id) {
      const query = await supabase.from("generic_node_definitions").delete().eq("id", id);
      if (query.error) {
        if (isSettingsSchemaCacheMismatch(query.error.message)) {
          await localWorkspaceRecordStore.deleteGenericNodeDefinition(id);
          return;
        }
        assertNoError({ error: query.error }, "deleteGenericNodeDefinition");
      }
    },

    async reorderGenericNodeDefinitions(orderedIds) {
      const userId = await getCurrentUserId();
      const { data, error } = await supabase.rpc("reorder_generic_node_definitions", {
        p_ids: orderedIds,
        p_user_id: userId,
      });
      if (error) {
        if (isSettingsSchemaCacheMismatch(error.message)) {
          return localWorkspaceRecordStore.reorderGenericNodeDefinitions(orderedIds);
        }
        assertNoError({ error }, "reorderGenericNodeDefinitions");
      }
      return toUnknownArray(data).map(mapGenericNodeDefinition);
    },

    async getAppSetting(key) {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) {
        if (isSettingsSchemaCacheMismatch(error.message)) {
          return localWorkspaceRecordStore.getAppSetting(key);
        }
        assertNoError({ error }, "getAppSetting");
      }
      return data?.value ?? null;
    },

    async setAppSetting(key, value) {
      const userId = await getCurrentUserId();
      const { error } = await supabase
        .from("app_settings")
        .upsert({ user_id: userId, key, value }, { onConflict: "user_id,key" });
      if (error) {
        if (isSettingsSchemaCacheMismatch(error.message)) {
          return localWorkspaceRecordStore.setAppSetting(key, value);
        }
        assertNoError({ error }, "setAppSetting");
      }
    },
  };
}
