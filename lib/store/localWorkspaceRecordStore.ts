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
  genericNodeDefinitionInputSchema,
  genericNodeDefinitionSchema,
  normalizeWorkspaceOptions,
  workspaceOptionListSchema,
  type GenericNodeDefinition,
  type WorkspaceOptionKind,
} from "@/lib/workspace-settings";

import type { WorkspaceRecordStore } from "./workspaceRecordStore";

const KEYS = {
  customers: "ica:workspace:customers",
  suppliers: "ica:workspace:suppliers",
  products: "ica:workspace:products",
  currencyOptions: "ica:workspace:settings:currency",
  destinationCountryOptions: "ica:workspace:settings:destination-country",
  addressBookOptions: "ica:workspace:settings:address-book",
  genericNodes: "ica:workspace:generic-nodes",
} as const;

const PRODUCT_DB_NAME = "ica:workspace-record-store";
const PRODUCT_DB_VERSION = 2;
const PRODUCT_STORE = "products";
const GENERIC_NODE_STORE = "genericNodes";

const nowISO = () => new Date().toISOString();
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function newestFirst<T extends { updatedAt: string }>(records: T[]): T[] {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function openProductDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(PRODUCT_DB_NAME, PRODUCT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
        db.createObjectStore(PRODUCT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(GENERIC_NODE_STORE)) {
        db.createObjectStore(GENERIC_NODE_STORE, { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to open product storage"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readGenericNodesFromIndexedDb(): Promise<GenericNodeDefinition[]> {
  if (!canUseIndexedDb()) return [];

  const db = await openProductDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(GENERIC_NODE_STORE, "readonly")
        .objectStore(GENERIC_NODE_STORE)
        .getAll();
      request.onerror = () => reject(request.error ?? new Error("Failed to read generic nodes"));
      request.onsuccess = () => {
        const parsed = genericNodeDefinitionSchema.array().safeParse(request.result);
        resolve(
          parsed.success ? parsed.data.sort((left, right) => left.sortIndex - right.sortIndex) : [],
        );
      };
    });
  } finally {
    db.close();
  }
}

async function writeGenericNodesToIndexedDb(records: GenericNodeDefinition[]): Promise<void> {
  const db = await openProductDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(GENERIC_NODE_STORE, "readwrite");
      const store = transaction.objectStore(GENERIC_NODE_STORE);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Failed to save generic nodes"));
      store.clear();
      for (const record of records) store.put(record);
    });
  } finally {
    db.close();
  }
}

async function listLocalGenericNodes(): Promise<GenericNodeDefinition[]> {
  if (!canUseIndexedDb()) {
    const parsed = genericNodeDefinitionSchema
      .array()
      .safeParse(read<unknown[]>(KEYS.genericNodes, []));
    return parsed.success
      ? parsed.data.sort((left, right) => left.sortIndex - right.sortIndex)
      : [];
  }

  const indexed = await readGenericNodesFromIndexedDb();
  const legacy = genericNodeDefinitionSchema
    .array()
    .safeParse(read<unknown[]>(KEYS.genericNodes, []));
  if (!legacy.success || legacy.data.length === 0) return indexed;

  const merged = new Map(indexed.map((record) => [record.id, record]));
  for (const record of legacy.data) merged.set(record.id, record);
  const records = [...merged.values()]
    .sort((left, right) => left.sortIndex - right.sortIndex)
    .map((record, sortIndex) => ({ ...record, sortIndex }));
  await writeGenericNodesToIndexedDb(records);
  window.localStorage.removeItem(KEYS.genericNodes);
  return records;
}

async function saveLocalGenericNodes(records: GenericNodeDefinition[]): Promise<void> {
  const normalized = records.map((record, sortIndex) => ({ ...record, sortIndex }));
  if (!canUseIndexedDb()) {
    write(KEYS.genericNodes, normalized);
    return;
  }
  await writeGenericNodesToIndexedDb(normalized);
  window.localStorage.removeItem(KEYS.genericNodes);
}

function optionKey(kind: WorkspaceOptionKind): string {
  if (kind === "currency") return KEYS.currencyOptions;
  if (kind === "destination-country") return KEYS.destinationCountryOptions;
  return KEYS.addressBookOptions;
}

async function readProductsFromIndexedDb(): Promise<ProductRecord[]> {
  if (!canUseIndexedDb()) return [];

  const db = await openProductDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(PRODUCT_STORE, "readonly").objectStore(PRODUCT_STORE).getAll();
      request.onerror = () => reject(request.error ?? new Error("Failed to read product records"));
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : [];
        resolve(rows.map((row) => normalizeProductRecord(row)));
      };
    });
  } finally {
    db.close();
  }
}

async function writeProductsToIndexedDb(records: ProductRecord[]): Promise<void> {
  const db = await openProductDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PRODUCT_STORE, "readwrite");
      const store = transaction.objectStore(PRODUCT_STORE);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Failed to save product records"));

      store.clear();
      for (const record of records) {
        store.put(record);
      }
    });
  } finally {
    db.close();
  }
}

async function mergeLegacyProductsIntoIndexedDb(): Promise<ProductRecord[]> {
  const indexedRecords = await readProductsFromIndexedDb();
  const legacyRecords = read<unknown[]>(KEYS.products, []).map((record) =>
    normalizeProductRecord(record),
  );

  if (legacyRecords.length === 0) return newestFirst(indexedRecords);

  const merged = new Map(indexedRecords.map((record) => [record.id, record]));
  for (const record of legacyRecords) {
    const existing = merged.get(record.id);
    if (!existing || record.updatedAt.localeCompare(existing.updatedAt) > 0) {
      merged.set(record.id, record);
    }
  }

  const nextRecords = newestFirst([...merged.values()]);
  await writeProductsToIndexedDb(nextRecords);
  window.localStorage.removeItem(KEYS.products);
  return nextRecords;
}

async function listLocalProducts(): Promise<ProductRecord[]> {
  if (!canUseIndexedDb()) {
    return newestFirst(
      read<unknown[]>(KEYS.products, []).map((record) => normalizeProductRecord(record)),
    );
  }

  return mergeLegacyProductsIntoIndexedDb();
}

async function saveLocalProducts(records: ProductRecord[]): Promise<void> {
  if (!canUseIndexedDb()) {
    write(KEYS.products, records);
    return;
  }

  await writeProductsToIndexedDb(records);
  window.localStorage.removeItem(KEYS.products);
}

function normalizeSupplierRecord(record: SupplierRecord): SupplierRecord {
  return {
    ...record,
    company: {
      ...record.company,
      productTypes: normalizeSupplierProductTypes(record.company.productTypes),
    },
  };
}

function upsertRecord<T extends { id: string; createdAt: string; updatedAt: string }>(
  records: T[],
  id: string | null,
  build: (existing: T | null, timestamp: string) => T,
): T {
  const index = id ? records.findIndex((record) => record.id === id) : -1;
  const existing = index >= 0 ? records[index] : null;
  const record = build(existing, nowISO());

  if (index >= 0) {
    records[index] = record;
  } else {
    records.unshift(record);
  }

  return record;
}

export const localWorkspaceRecordStore: WorkspaceRecordStore = {
  async listCustomers() {
    return newestFirst(read<CustomerRecord[]>(KEYS.customers, []));
  },

  async upsertCustomer(id, input) {
    const parsed = customerRecordInputSchema.parse(input);
    const records = read<CustomerRecord[]>(KEYS.customers, []);
    const record = upsertRecord(records, id, (existing, timestamp) => ({
      id: existing?.id ?? id ?? uid(),
      company: parsed.company,
      employees: parsed.employees,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }));
    write(KEYS.customers, records);
    return record;
  },

  async listSuppliers() {
    return newestFirst(read<SupplierRecord[]>(KEYS.suppliers, []).map(normalizeSupplierRecord));
  },

  async upsertSupplier(id, input) {
    const parsed = supplierRecordInputSchema.parse(input);
    const records = read<SupplierRecord[]>(KEYS.suppliers, []);
    const record = upsertRecord(records, id, (existing, timestamp) => ({
      id: existing?.id ?? id ?? uid(),
      company: parsed.company,
      employees: parsed.employees,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }));
    write(KEYS.suppliers, records);
    return record;
  },

  async deleteSuppliers(ids) {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    write(
      KEYS.suppliers,
      read<SupplierRecord[]>(KEYS.suppliers, []).filter((supplier) => !idSet.has(supplier.id)),
    );
    const products = await listLocalProducts();
    await saveLocalProducts(
      products.map((product) =>
        product.ownerKind === "supplier" && product.supplierId && idSet.has(product.supplierId)
          ? { ...product, supplierId: null, updatedAt: nowISO() }
          : product,
      ),
    );
  },

  async listProducts() {
    return listLocalProducts();
  },

  async upsertProduct(id, input) {
    const parsed = productRecordInputSchema.parse(input);
    const records = await listLocalProducts();
    const record = upsertRecord(records, id, (existing, timestamp) => ({
      id: existing?.id ?? id ?? uid(),
      ownerKind: parsed.ownerKind,
      supplierId: parsed.ownerKind === "supplier" ? (parsed.supplierId ?? null) : null,
      customerId: parsed.ownerKind === "customer" ? (parsed.customerId ?? null) : null,
      projectId: null,
      productType: parsed.productType,
      subject: parsed.subject,
      detail: parsed.detail,
      variants: parsed.variants
        .slice()
        .sort((left, right) => left.sortIndex - right.sortIndex)
        .map((variant, index) => ({ ...variant, sortIndex: index })),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }));
    await saveLocalProducts(records);
    return record;
  },

  async deleteProducts(ids) {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    const records = await listLocalProducts();
    await saveLocalProducts(records.filter((record) => !idSet.has(record.id)));
  },

  async getProduct(productId) {
    const records = await listLocalProducts();
    return records.find((record) => record.id === productId) ?? null;
  },

  async listWorkspaceOptions(kind) {
    return normalizeWorkspaceOptions(kind, read<unknown[]>(optionKey(kind), []));
  },

  async replaceWorkspaceOptions(kind, options) {
    const parsed = workspaceOptionListSchema.parse(options);
    if (parsed.some((option) => option.kind !== kind)) {
      throw new Error("Workspace option kind does not match the requested setting.");
    }
    const normalized = parsed.map((option, sortIndex) => ({ ...option, sortIndex }));
    write(optionKey(kind), normalized);
    return normalized;
  },

  async listGenericNodeDefinitions() {
    return listLocalGenericNodes();
  },

  async upsertGenericNodeDefinition(id, input) {
    const parsed = genericNodeDefinitionInputSchema.parse(input);
    const records = await listLocalGenericNodes();
    const timestamp = nowISO();
    const index = id ? records.findIndex((record) => record.id === id) : -1;
    const existing = index >= 0 ? records[index] : null;
    const record: GenericNodeDefinition = {
      id: existing?.id ?? id ?? uid(),
      ...parsed,
      sortIndex: existing?.sortIndex ?? records.length,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (index >= 0) records[index] = record;
    else records.push(record);
    await saveLocalGenericNodes(records);
    return record;
  },

  async deleteGenericNodeDefinition(id) {
    const records = await listLocalGenericNodes();
    await saveLocalGenericNodes(records.filter((record) => record.id !== id));
  },

  async reorderGenericNodeDefinitions(orderedIds) {
    const records = await listLocalGenericNodes();
    const byId = new Map(records.map((record) => [record.id, record]));
    const ordered = orderedIds
      .map((id) => byId.get(id))
      .filter((record): record is GenericNodeDefinition => Boolean(record));
    const orderedSet = new Set(orderedIds);
    const next = [...ordered, ...records.filter((record) => !orderedSet.has(record.id))].map(
      (record, sortIndex) => ({ ...record, sortIndex, updatedAt: nowISO() }),
    );
    await saveLocalGenericNodes(next);
    return next;
  },

  async getAppSetting(key) {
    const all = read<Record<string, unknown>>("ica:workspace:app-settings", {});
    return key in all ? (all[key] ?? null) : null;
  },

  async setAppSetting(key, value) {
    const all = read<Record<string, unknown>>("ica:workspace:app-settings", {});
    write("ica:workspace:app-settings", { ...all, [key]: value });
  },
};
