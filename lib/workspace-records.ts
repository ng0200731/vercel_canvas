import { z } from "zod";

export const supplierProductTypes = [
  "woven-label",
  "wash-care-label",
  "hang-tag",
  "heat-transfer",
  "elastic",
  "drawcord",
  "metal",
  "button",
  "pu-patch",
  "embroidery-patch",
  "silicon-patch",
  "thread",
  "polybag",
] as const;

export type SupplierProductType = (typeof supplierProductTypes)[number];

export const customerProductTypeGroups = [
  {
    label: "Upper Garments (Tops)",
    types: ["shirt", "blouse", "t-shirt", "sweater", "tank-top", "cardigan"],
  },
  {
    label: "Lower Garments (Bottoms)",
    types: ["pants", "jeans", "skirt", "shorts", "leggings", "trousers"],
  },
  {
    label: "Whole-Body Garments",
    types: ["dress", "jumpsuit", "romper", "overalls"],
  },
  {
    label: "Outerwear",
    types: ["coat", "jacket", "hoodie", "raincoat", "parka", "blazer"],
  },
  {
    label: "Foundation & Innerwear",
    types: ["bra", "briefs", "boxers", "undershirt", "socks", "corset"],
  },
  {
    label: "Functional & Special Wear",
    types: ["swimsuit", "uniform", "apron", "scrub", "sportswear"],
  },
] as const;

export const customerProductTypes = customerProductTypeGroups.flatMap((group) => group.types);
export type CustomerProductType = (typeof customerProductTypes)[number];
export type WorkspaceProductType = SupplierProductType | CustomerProductType;
export type ProductOwnerKind = "supplier" | "customer";

export const customerProductTypeLabels: Record<CustomerProductType, string> = {
  shirt: "Shirt",
  blouse: "Blouse",
  "t-shirt": "T-shirt",
  sweater: "Sweater",
  "tank-top": "Tank top",
  cardigan: "Cardigan",
  pants: "Pants",
  jeans: "Jeans",
  skirt: "Skirt",
  shorts: "Shorts",
  leggings: "Leggings",
  trousers: "Trousers",
  dress: "Dress",
  jumpsuit: "Jumpsuit",
  romper: "Romper",
  overalls: "Overalls",
  coat: "Coat",
  jacket: "Jacket",
  hoodie: "Hoodie",
  raincoat: "Raincoat",
  parka: "Parka",
  blazer: "Blazer",
  bra: "Bra",
  briefs: "Briefs",
  boxers: "Boxers",
  undershirt: "Undershirt",
  socks: "Socks",
  corset: "Corset",
  swimsuit: "Swimsuit",
  uniform: "Uniform",
  apron: "Apron",
  scrub: "Scrub",
  sportswear: "Sportswear",
};

export const defaultSupplierProductType = "woven-label" satisfies SupplierProductType;
export const defaultCustomerProductType = "shirt" satisfies CustomerProductType;

export const supplierProductTypeLabels: Record<SupplierProductType, string> = {
  "woven-label": "Woven label",
  "wash-care-label": "Wash care label",
  "hang-tag": "Hang tag",
  "heat-transfer": "Heat transfer",
  elastic: "Elastic",
  drawcord: "Drawcord",
  metal: "Metal",
  button: "Button",
  "pu-patch": "PU patch",
  "embroidery-patch": "Embroidery patch",
  "silicon-patch": "Silicon patch",
  thread: "Thread",
  polybag: "Polybag",
};

const legacySupplierProductTypeMap: Record<string, SupplierProductType> = {
  label: "woven-label",
  tag: "hang-tag",
  zipper: "metal",
  snap: "button",
};

export function normalizeSupplierProductTypes(values: readonly string[]): SupplierProductType[] {
  const normalized = values
    .map((value) =>
      supplierProductTypes.includes(value as SupplierProductType)
        ? (value as SupplierProductType)
        : legacySupplierProductTypeMap[value],
    )
    .filter((value): value is SupplierProductType => Boolean(value));

  return Array.from(new Set(normalized));
}

export function normalizeSupplierProductType(
  value: string | null | undefined,
): SupplierProductType {
  return normalizeSupplierProductTypes(value ? [value] : [])[0] ?? defaultSupplierProductType;
}

export function normalizeCustomerProductType(
  value: string | null | undefined,
): CustomerProductType {
  return customerProductTypes.includes(value as CustomerProductType)
    ? (value as CustomerProductType)
    : defaultCustomerProductType;
}

export function isSupplierProductType(value: string): value is SupplierProductType {
  return supplierProductTypes.includes(value as SupplierProductType);
}

export function isCustomerProductType(value: string): value is CustomerProductType {
  return customerProductTypes.includes(value as CustomerProductType);
}

export function getWorkspaceProductTypeLabel(productType: WorkspaceProductType): string {
  return isSupplierProductType(productType)
    ? supplierProductTypeLabels[productType]
    : customerProductTypeLabels[productType];
}

export function getProductPriceUnit(productType: WorkspaceProductType): string {
  if (productType === "elastic" || productType === "drawcord") return "per meter";
  if (productType === "thread") return "per cone";
  if (productType === "polybag") return "per bag";
  return "per pc";
}

export function normalizeProductParameters(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, parameterValue]) => [key, parameterValue]),
  );
}

const domainSuffixSchema = z
  .string()
  .trim()
  .min(1, "Email domain suffix is required.")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i, {
    message: "Use a domain like example.com.",
  });

export const customerCompanySchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required."),
  emailDomainSuffix: domainSuffixSchema,
  type: z.string().trim().min(1, "Customer type is required."),
});

export const supplierCompanySchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required."),
  emailDomainSuffix: domainSuffixSchema,
  productTypes: z.array(z.enum(supplierProductTypes)).min(1, "Choose at least one product type."),
});

export const employeeSchema = z.object({
  userName: z.string().trim().min(1, "User name is required."),
  emailPrefix: z.string().trim().min(1, "Email prefix is required."),
  title: z.string().trim().min(1, "Title is required."),
  tel: z.string().trim().min(1, "Telephone is required."),
});

export const productImageSchema = z.object({
  name: z.string().trim().min(1, "Image name is required."),
  url: z.string().trim().min(1, "Image URL is required."),
  storagePath: z.string().nullable(),
});

export const productVariantInputSchema = z.object({
  id: z.string().trim().min(1, "Variant id is required."),
  sortIndex: z.number().int().min(0),
  material: z.string().trim().min(1, "Material is required."),
  colorNotes: z.string().trim().min(1, "Color notes are required."),
  parameters: z.record(z.string(), z.string()),
  unitPrice: z.string().trim().min(1, "Unit price is required."),
  priceUnit: z.string().trim().min(1, "Price unit is required."),
  image: productImageSchema,
});

export const productVariantRecordSchema = productVariantInputSchema.extend({
  image: productImageSchema.nullable(),
});

export const productRecordInputSchema = z
  .object({
    ownerKind: z.enum(["supplier", "customer"]).default("supplier"),
    supplierId: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.string().trim().nullable().optional(),
    ),
    customerId: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.string().trim().nullable().optional(),
    ),
    projectId: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.string().trim().nullable().optional(),
    ),
    productType: z.union([z.enum(supplierProductTypes), z.enum(customerProductTypes)]),
    subject: z.string().trim().min(1, "Subject is required."),
    detail: z.string().trim().min(1, "Product detail is required."),
    variants: z.array(productVariantInputSchema).min(1, "Add at least one product image."),
  })
  .superRefine((value, context) => {
    if (value.ownerKind === "supplier") {
      if (!value.supplierId) {
        context.addIssue({
          code: "custom",
          path: ["supplierId"],
          message: "Supplier is required.",
        });
      }
      if (!isSupplierProductType(value.productType)) {
        context.addIssue({
          code: "custom",
          path: ["productType"],
          message: "Choose a supplier product type.",
        });
      }
      return;
    }

    if (!value.customerId) {
      context.addIssue({
        code: "custom",
        path: ["customerId"],
        message: "Customer is required.",
      });
    }
    if (!isCustomerProductType(value.productType)) {
      context.addIssue({
        code: "custom",
        path: ["productType"],
        message: "Choose a customer garment type.",
      });
    }
  });

export const productSchema = productRecordInputSchema;

export type CustomerCompanyInput = z.infer<typeof customerCompanySchema>;
export type SupplierCompanyInput = z.infer<typeof supplierCompanySchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;
export type ProductImageInput = z.infer<typeof productImageSchema>;
export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;
export type ProductInput = z.input<typeof productSchema>;

export interface EmployeeRecord extends EmployeeInput {
  id: string;
}

export interface CustomerRecord {
  id: string;
  userId?: string | null;
  company: CustomerCompanyInput;
  employees: EmployeeRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplierRecord {
  id: string;
  userId?: string | null;
  company: SupplierCompanyInput;
  employees: EmployeeRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariantRecord extends Omit<ProductVariantInput, "image"> {
  image: ProductImageInput | null;
}

export interface ProductRecord {
  id: string;
  userId?: string | null;
  ownerKind: ProductOwnerKind;
  supplierId: string | null;
  customerId: string | null;
  projectId: string | null;
  productType: WorkspaceProductType;
  subject: string;
  detail: string;
  variants: ProductVariantRecord[];
  createdAt: string;
  updatedAt: string;
}

export const customerRecordInputSchema = z.object({
  company: customerCompanySchema,
  employees: z.array(employeeSchema.extend({ id: z.string().min(1) })).min(1),
});

export const supplierRecordInputSchema = z.object({
  company: supplierCompanySchema,
  employees: z.array(employeeSchema.extend({ id: z.string().min(1) })).min(1),
});

export type CustomerRecordInput = z.infer<typeof customerRecordInputSchema>;
export type SupplierRecordInput = z.infer<typeof supplierRecordInputSchema>;
export type ProductRecordInput = z.input<typeof productRecordInputSchema>;
export type ProductVariantRecordInput = z.infer<typeof productVariantRecordSchema>;

function normalizeProductUnitPrice(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "0";
}

function normalizeProductPriceUnit(value: unknown, productType: WorkspaceProductType): string {
  return typeof value === "string" && value.trim() ? value : getProductPriceUnit(productType);
}

export function normalizeProductVariant(
  value: unknown,
  fallbackProductType: WorkspaceProductType,
  fallbackSortIndex = 0,
): ProductVariantRecord {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const parsed = productVariantRecordSchema.safeParse({
    id:
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : `variant-${fallbackSortIndex + 1}`,
    sortIndex: typeof candidate.sortIndex === "number" ? candidate.sortIndex : fallbackSortIndex,
    material: typeof candidate.material === "string" ? candidate.material : "",
    colorNotes: typeof candidate.colorNotes === "string" ? candidate.colorNotes : "",
    parameters: normalizeProductParameters(candidate.parameters),
    unitPrice: normalizeProductUnitPrice(candidate.unitPrice),
    priceUnit: normalizeProductPriceUnit(candidate.priceUnit, fallbackProductType),
    image: productImageSchema
      .nullable()
      .catch(null)
      .parse(candidate.image ?? null),
  });

  return parsed.success
    ? parsed.data
    : {
        id: `variant-${fallbackSortIndex + 1}`,
        sortIndex: fallbackSortIndex,
        material: "",
        colorNotes: "",
        parameters: {},
        unitPrice: "0",
        priceUnit: getProductPriceUnit(fallbackProductType),
        image: null,
      };
}

export function normalizeProductRecord(value: unknown): ProductRecord {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const ownerKind: ProductOwnerKind =
    candidate.ownerKind === "customer" ||
    (typeof candidate.customerId === "string" && candidate.customerId.trim())
      ? "customer"
      : "supplier";
  const rawProductType = typeof candidate.productType === "string" ? candidate.productType : null;
  const productType: WorkspaceProductType =
    ownerKind === "customer"
      ? normalizeCustomerProductType(rawProductType)
      : normalizeSupplierProductType(rawProductType);
  const variantsValue = Array.isArray(candidate.variants) ? candidate.variants : [];
  const variants =
    variantsValue.length > 0
      ? variantsValue.map((variant, index) => normalizeProductVariant(variant, productType, index))
      : [
          normalizeProductVariant(
            {
              id: "variant-1",
              sortIndex: 0,
              material: typeof candidate.material === "string" ? candidate.material : "",
              colorNotes: typeof candidate.colorNotes === "string" ? candidate.colorNotes : "",
              parameters: candidate.parameters,
              unitPrice: candidate.unitPrice,
              priceUnit: candidate.priceUnit,
              image: candidate.image ?? null,
            },
            productType,
            0,
          ),
        ];

  return {
    id: typeof candidate.id === "string" ? candidate.id : "",
    userId: typeof candidate.userId === "string" && candidate.userId.trim() ? candidate.userId : null,
    ownerKind,
    supplierId:
      typeof candidate.supplierId === "string" && candidate.supplierId.trim()
        ? candidate.supplierId
        : null,
    customerId:
      typeof candidate.customerId === "string" && candidate.customerId.trim()
        ? candidate.customerId
        : null,
    projectId:
      typeof candidate.projectId === "string" && candidate.projectId.trim()
        ? candidate.projectId
        : null,
    productType,
    subject: typeof candidate.subject === "string" ? candidate.subject : "",
    detail: typeof candidate.detail === "string" ? candidate.detail : "",
    variants: variants
      .sort((left, right) => left.sortIndex - right.sortIndex)
      .map((variant, index) => ({ ...variant, sortIndex: index })),
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
  };
}

export function normalizeEmailDomainSuffix(value: string) {
  return value.trim().replaceAll("@", "").replace(/\s+/g, "").toLowerCase();
}

export function hadAtSymbol(value: string) {
  return value.includes("@");
}
