"use client";

import { useId, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, ReactNode } from "react";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  ImagePlus,
  Pencil,
  Save,
  Search,
  Trash2,
  UserPlus,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ProductImageBrowserDialog } from "@/components/product-image-browser-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  customerCompanySchema,
  customerProductTypeGroups,
  customerProductTypes,
  defaultCustomerProductType,
  defaultSupplierProductType,
  employeeSchema,
  getProductPriceUnit,
  getWorkspaceProductTypeLabel,
  hadAtSymbol,
  isCustomerProductType,
  isSupplierProductType,
  normalizeCustomerProductType,
  normalizeEmailDomainSuffix,
  normalizeSupplierProductTypes,
  normalizeSupplierProductType,
  productSchema,
  supplierCompanySchema,
  supplierProductTypeLabels,
  supplierProductTypes,
  type CustomerRecord,
  type CustomerCompanyInput,
  type EmployeeInput,
  type ProductOwnerKind,
  type ProductRecord,
  type ProductVariantRecord,
  type SupplierCompanyInput,
  type SupplierRecord,
  type SupplierProductType,
  type WorkspaceProductType,
} from "@/lib/workspace-records";
import {
  useCustomers,
  useProducts,
  useSuppliers,
  useDeleteSuppliers,
  useDeleteProducts,
  useUpsertCustomer,
  useUpsertProduct,
  useUpsertSupplier,
} from "@/lib/hooks/use-workspace-records";
import type { ProductImageGalleryItem } from "@/lib/product-image-gallery";
import { productRecordSearchText } from "@/lib/product-image-gallery";
import { uploadImage } from "@/lib/upload";
import { cn } from "@/lib/utils";

type EntityKind = "customer" | "supplier" | "product";
type PartyKind = "customer" | "supplier";
type PartySubTab = "company" | "employee" | "product";

interface EmployeeRow extends EmployeeInput {
  id: string;
}

type PartyRecord = CustomerRecord | SupplierRecord;

type CustomerCompanyState = CustomerCompanyInput;

type SupplierCompanyState = SupplierCompanyInput;

interface ProductImageState {
  name: string;
  url: string;
  storagePath: string | null;
}

interface ProductFormState {
  ownerKind: ProductOwnerKind;
  supplierId: string;
  customerId: string;
  projectId: string;
  projectName: string;
  productType: WorkspaceProductType;
  subject: string;
  detail: string;
  variants: ProductVariantFormState[];
  activeVariantId: string | null;
}

interface ProductVariantFormState extends Omit<ProductVariantRecord, "image"> {
  image: ProductImageState | null;
}

interface SupplierTableFilters {
  company: string;
  domain: string;
  productTypes: string;
  employees: string;
  products: string;
}

type CompanyErrors = Partial<Record<keyof CustomerCompanyInput, string>> &
  Partial<Record<keyof SupplierCompanyInput, string>>;
type FieldParseResult =
  | { success: true }
  | {
      success: false;
      error: {
        issues: Array<{
          path: readonly PropertyKey[];
          message: string;
        }>;
      };
    };

const emptyEmployee = (): EmployeeRow => ({
  id: crypto.randomUUID(),
  userName: "",
  emailPrefix: "",
  title: "",
  tel: "",
});

const partyLabels: Record<PartyKind, string> = {
  customer: "Customer",
  supplier: "Supplier",
};

const emptySupplierTableFilters = (): SupplierTableFilters => ({
  company: "",
  domain: "",
  productTypes: "",
  employees: "",
  products: "",
});

function normalizeSearchValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function fuzzyMatches(value: string, normalizedQuery: string) {
  if (!normalizedQuery) return true;

  const normalizedValue = normalizeSearchValue(value);
  if (normalizedValue.includes(normalizedQuery)) return true;

  let queryIndex = 0;
  for (const character of normalizedValue) {
    if (character === normalizedQuery[queryIndex]) queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return true;
  }
  return false;
}

function getEmployeeEmail(employee: EmployeeInput, domainSuffix: string) {
  return `${employee.emailPrefix}@${normalizeEmailDomainSuffix(domainSuffix)}`;
}

function getEmployeeSearchText(employee: EmployeeInput, domainSuffix: string) {
  return [
    employee.userName,
    employee.emailPrefix,
    getEmployeeEmail(employee, domainSuffix),
    employee.title,
    employee.tel,
  ].join(" ");
}

function getPartyRecordSearchText(record: PartyRecord) {
  const companyDetail =
    "type" in record.company
      ? record.company.type
      : record.company.productTypes
          .map((productType) => supplierProductTypeLabels[productType])
          .join(" ");

  return [
    record.company.companyName,
    record.company.emailDomainSuffix,
    companyDetail,
    ...record.employees.map((employee) =>
      getEmployeeSearchText(employee, record.company.emailDomainSuffix),
    ),
  ].join(" ");
}

const dummyCustomerCompanies: CustomerCompanyState[] = [
  {
    companyName: "Northstar Apparel Group",
    emailDomainSuffix: "northstarapparel.com",
    type: "Brand owner",
  },
  {
    companyName: "Cobalt Streetwear Co.",
    emailDomainSuffix: "cobaltstreetwear.com",
    type: "Distributor",
  },
  {
    companyName: "Harborline Retail Ltd.",
    emailDomainSuffix: "harborlineretail.com",
    type: "Buying office",
  },
  {
    companyName: "Juniper Activewear",
    emailDomainSuffix: "juniperactivewear.com",
    type: "Brand owner",
  },
  {
    companyName: "Atlas Department Stores",
    emailDomainSuffix: "atlasstores.com",
    type: "Retailer",
  },
  { companyName: "Willow & Loom", emailDomainSuffix: "willowandloom.com", type: "Brand owner" },
  {
    companyName: "Redwood Sourcing Partners",
    emailDomainSuffix: "redwoodsourcing.com",
    type: "Sourcing agent",
  },
  {
    companyName: "Summit Outdoor Goods",
    emailDomainSuffix: "summitoutdoorgoods.com",
    type: "Brand owner",
  },
  {
    companyName: "Evergreen Kidswear",
    emailDomainSuffix: "evergreenkidswear.com",
    type: "Brand owner",
  },
  {
    companyName: "Mosaic Fashion Group",
    emailDomainSuffix: "mosaicfashiongroup.com",
    type: "Distributor",
  },
  {
    companyName: "Bluebird Uniforms",
    emailDomainSuffix: "bluebirduniforms.com",
    type: "Uniform supplier",
  },
  { companyName: "Oak & Thread Co.", emailDomainSuffix: "oakandthread.com", type: "Retailer" },
  {
    companyName: "Meridian Buying House",
    emailDomainSuffix: "meridianbuying.com",
    type: "Buying office",
  },
  {
    companyName: "Fieldstone Workwear",
    emailDomainSuffix: "fieldstoneworkwear.com",
    type: "Brand owner",
  },
  {
    companyName: "Nova Sports Collective",
    emailDomainSuffix: "novasportscollective.com",
    type: "Distributor",
  },
  {
    companyName: "Riverside Essentials",
    emailDomainSuffix: "riversideessentials.com",
    type: "Retailer",
  },
  {
    companyName: "Cedar Lane Apparel",
    emailDomainSuffix: "cedarlaneapparel.com",
    type: "Brand owner",
  },
  { companyName: "Orbit Fashion Imports", emailDomainSuffix: "orbitfashion.com", type: "Importer" },
  { companyName: "Canvas & Coast", emailDomainSuffix: "canvasandcoast.com", type: "Brand owner" },
  {
    companyName: "Sterling Private Label",
    emailDomainSuffix: "sterlinglabel.com",
    type: "Private label",
  },
];

const dummySupplierCompanies: SupplierCompanyState[] = [
  {
    companyName: "Bright Trim Manufacturing",
    emailDomainSuffix: "brighttrim.com",
    productTypes: ["woven-label", "wash-care-label", "hang-tag"],
  },
  {
    companyName: "Metro Embroidery Works",
    emailDomainSuffix: "metroembroidery.com",
    productTypes: ["embroidery-patch", "silicon-patch", "heat-transfer"],
  },
  {
    companyName: "Pearl Packaging Supply",
    emailDomainSuffix: "pearlpackaging.com",
    productTypes: ["polybag", "thread", "button"],
  },
  {
    companyName: "Apex Label Industries",
    emailDomainSuffix: "apexlabels.com",
    productTypes: ["woven-label", "wash-care-label"],
  },
  {
    companyName: "Golden Card Printing",
    emailDomainSuffix: "goldencardprint.com",
    productTypes: ["hang-tag", "polybag"],
  },
  {
    companyName: "Vertex Transfer Lab",
    emailDomainSuffix: "vertextransfer.com",
    productTypes: ["heat-transfer", "silicon-patch"],
  },
  {
    companyName: "Unity Elastic Mills",
    emailDomainSuffix: "unityelastic.com",
    productTypes: ["elastic", "drawcord"],
  },
  {
    companyName: "Crown Metal Trims",
    emailDomainSuffix: "crownmetaltrims.com",
    productTypes: ["metal", "button"],
  },
  {
    companyName: "Heritage Patch Studio",
    emailDomainSuffix: "heritagepatch.com",
    productTypes: ["pu-patch", "embroidery-patch"],
  },
  {
    companyName: "Pioneer Thread Works",
    emailDomainSuffix: "pioneerthread.com",
    productTypes: ["thread", "embroidery-patch"],
  },
  {
    companyName: "ClearPack Solutions",
    emailDomainSuffix: "clearpacksolutions.com",
    productTypes: ["polybag"],
  },
  {
    companyName: "Evermark Accessories",
    emailDomainSuffix: "evermarkaccessories.com",
    productTypes: ["woven-label", "hang-tag", "button"],
  },
  {
    companyName: "Formosa Cord & Tape",
    emailDomainSuffix: "formosacord.com",
    productTypes: ["elastic", "drawcord"],
  },
  {
    companyName: "Northfield Branding",
    emailDomainSuffix: "northfieldbranding.com",
    productTypes: ["heat-transfer", "pu-patch"],
  },
  {
    companyName: "Precision Eyelet Co.",
    emailDomainSuffix: "precisioneyelet.com",
    productTypes: ["metal"],
  },
  {
    companyName: "SoftTouch Label Co.",
    emailDomainSuffix: "softtouchlabel.com",
    productTypes: ["woven-label", "wash-care-label"],
  },
  {
    companyName: "Blue Peak Embroidery",
    emailDomainSuffix: "bluepeakembroidery.com",
    productTypes: ["embroidery-patch", "thread"],
  },
  {
    companyName: "EcoTrim Materials",
    emailDomainSuffix: "ecotrimmaterials.com",
    productTypes: ["button", "polybag", "pu-patch"],
  },
  {
    companyName: "Signal Silicone Works",
    emailDomainSuffix: "signalsilicone.com",
    productTypes: ["silicon-patch", "heat-transfer"],
  },
  {
    companyName: "Keystone Tag & Label",
    emailDomainSuffix: "keystonetag.com",
    productTypes: ["hang-tag", "wash-care-label"],
  },
];

const dummyEmployees: EmployeeRow[] = [
  {
    id: "dummy-employee-1",
    userName: "Mia Chen",
    emailPrefix: "mia.chen",
    title: "Merchandising Manager",
    tel: "+86 755 8821 1042",
  },
  {
    id: "dummy-employee-2",
    userName: "Aaron Lee",
    emailPrefix: "aaron.lee",
    title: "Production Coordinator",
    tel: "+86 755 8821 1043",
  },
  {
    id: "dummy-employee-3",
    userName: "Sofia Martinez",
    emailPrefix: "sofia.martinez",
    title: "Senior Buyer",
    tel: "+1 212 555 0141",
  },
  {
    id: "dummy-employee-4",
    userName: "Noah Williams",
    emailPrefix: "noah.williams",
    title: "Product Developer",
    tel: "+44 20 7946 0182",
  },
  {
    id: "dummy-employee-5",
    userName: "Aisha Rahman",
    emailPrefix: "aisha.rahman",
    title: "Sourcing Director",
    tel: "+971 4 555 0183",
  },
  {
    id: "dummy-employee-6",
    userName: "Lucas Silva",
    emailPrefix: "lucas.silva",
    title: "Quality Manager",
    tel: "+55 11 5550 0184",
  },
  {
    id: "dummy-employee-7",
    userName: "Emma Johnson",
    emailPrefix: "emma.johnson",
    title: "Assistant Buyer",
    tel: "+1 312 555 0185",
  },
  {
    id: "dummy-employee-8",
    userName: "Kenji Sato",
    emailPrefix: "kenji.sato",
    title: "Materials Specialist",
    tel: "+81 3 5550 0186",
  },
  {
    id: "dummy-employee-9",
    userName: "Priya Nair",
    emailPrefix: "priya.nair",
    title: "Category Manager",
    tel: "+91 22 5550 0187",
  },
  {
    id: "dummy-employee-10",
    userName: "Oliver Brown",
    emailPrefix: "oliver.brown",
    title: "Supply Chain Lead",
    tel: "+44 161 555 0188",
  },
  {
    id: "dummy-employee-11",
    userName: "Hana Kim",
    emailPrefix: "hana.kim",
    title: "Design Coordinator",
    tel: "+82 2 555 0189",
  },
  {
    id: "dummy-employee-12",
    userName: "Ethan Davis",
    emailPrefix: "ethan.davis",
    title: "Procurement Manager",
    tel: "+1 415 555 0190",
  },
  {
    id: "dummy-employee-13",
    userName: "Lea Dubois",
    emailPrefix: "lea.dubois",
    title: "Brand Manager",
    tel: "+33 1 55 50 0191",
  },
  {
    id: "dummy-employee-14",
    userName: "Amir Haddad",
    emailPrefix: "amir.haddad",
    title: "Operations Manager",
    tel: "+971 2 555 0192",
  },
  {
    id: "dummy-employee-15",
    userName: "Isabella Rossi",
    emailPrefix: "isabella.rossi",
    title: "Packaging Developer",
    tel: "+39 02 555 0193",
  },
  {
    id: "dummy-employee-16",
    userName: "Liam Wilson",
    emailPrefix: "liam.wilson",
    title: "Merchandiser",
    tel: "+61 2 5550 0194",
  },
  {
    id: "dummy-employee-17",
    userName: "Mei Lin",
    emailPrefix: "mei.lin",
    title: "Production Manager",
    tel: "+86 21 5550 0195",
  },
  {
    id: "dummy-employee-18",
    userName: "Mateo Garcia",
    emailPrefix: "mateo.garcia",
    title: "Technical Designer",
    tel: "+34 91 555 0196",
  },
  {
    id: "dummy-employee-19",
    userName: "Chloe Taylor",
    emailPrefix: "chloe.taylor",
    title: "Compliance Lead",
    tel: "+44 20 7946 0197",
  },
  {
    id: "dummy-employee-20",
    userName: "Daniel Park",
    emailPrefix: "daniel.park",
    title: "Account Manager",
    tel: "+82 2 555 0198",
  },
];

function createDummyEmployee(index: number): EmployeeRow {
  const dummy = dummyEmployees[index % dummyEmployees.length];
  const cycle = Math.floor(index / dummyEmployees.length);
  const suffix = cycle > 0 ? ` ${cycle + 1}` : "";
  const emailSuffix = cycle > 0 ? `.${cycle + 1}` : "";

  return {
    ...dummy,
    id: crypto.randomUUID(),
    userName: `${dummy.userName}${suffix}`,
    emailPrefix: `${dummy.emailPrefix}${emailSuffix}`,
  };
}

interface ProductParameterField {
  key: string;
  label: string;
  placeholder: string;
}

interface ProductParameterDummySet {
  parameters: Record<string, string>;
  unitPrice: string;
}

interface ProductParameterTemplate {
  fields: ProductParameterField[];
  dummySets: ProductParameterDummySet[];
}

const productParameterTemplates: Record<SupplierProductType, ProductParameterTemplate> = {
  "woven-label": {
    fields: [
      { key: "width", label: "Width", placeholder: "45 mm" },
      { key: "height", label: "Height", placeholder: "20 mm" },
      { key: "fold", label: "Fold", placeholder: "Center fold, end fold..." },
      { key: "weave", label: "Weave", placeholder: "Damask, satin, taffeta" },
      { key: "backing", label: "Backing", placeholder: "Sew-on, iron-on, adhesive" },
    ],
    dummySets: [
      {
        parameters: {
          width: "45 mm",
          height: "20 mm",
          fold: "Center fold",
          weave: "Damask woven polyester",
          backing: "Sew-on edge",
        },
        unitPrice: "0.032",
      },
      {
        parameters: {
          width: "60 mm",
          height: "18 mm",
          fold: "End fold",
          weave: "Satin woven",
          backing: "Soft heat-cut edge",
        },
        unitPrice: "0.041",
      },
    ],
  },
  "wash-care-label": {
    fields: [
      { key: "width", label: "Width", placeholder: "35 mm" },
      { key: "height", label: "Height", placeholder: "70 mm" },
      { key: "material", label: "Material", placeholder: "Satin, nylon, cotton tape" },
      { key: "print", label: "Print", placeholder: "Black single side, double side..." },
      { key: "content", label: "Content", placeholder: "Care symbols, fiber, origin" },
    ],
    dummySets: [
      {
        parameters: {
          width: "35 mm",
          height: "70 mm",
          material: "White satin tape",
          print: "Black double-side print",
          content: "Care symbols, fiber content, COO",
        },
        unitPrice: "0.018",
      },
      {
        parameters: {
          width: "30 mm",
          height: "60 mm",
          material: "Recycled nylon tape",
          print: "One-side thermal transfer",
          content: "Wash icons, batch code, QR care link",
        },
        unitPrice: "0.021",
      },
    ],
  },
  "hang-tag": {
    fields: [
      { key: "width", label: "Width", placeholder: "55 mm" },
      { key: "height", label: "Height", placeholder: "90 mm" },
      { key: "paper", label: "Paper", placeholder: "350gsm art card, kraft..." },
      { key: "finish", label: "Finish", placeholder: "Matte lamination, spot UV..." },
      { key: "attachment", label: "Attachment", placeholder: "Hole, eyelet, string, pin" },
    ],
    dummySets: [
      {
        parameters: {
          width: "55 mm",
          height: "90 mm",
          paper: "450gsm matte art card",
          finish: "Matte lamination with round corners",
          attachment: "4 mm hole with cotton string",
        },
        unitPrice: "0.075",
      },
      {
        parameters: {
          width: "60 mm",
          height: "100 mm",
          paper: "600gsm black core card",
          finish: "Embossed logo and spot UV",
          attachment: "Metal eyelet with safety pin",
        },
        unitPrice: "0.128",
      },
    ],
  },
  "heat-transfer": {
    fields: [
      { key: "width", label: "Width", placeholder: "80 mm" },
      { key: "height", label: "Height", placeholder: "40 mm" },
      { key: "film", label: "Film", placeholder: "PU, silicone, reflective..." },
      { key: "application", label: "Application", placeholder: "Temp / time / pressure" },
      { key: "wash", label: "Wash resistance", placeholder: "40C, 60C, dry clean..." },
    ],
    dummySets: [
      {
        parameters: {
          width: "80 mm",
          height: "40 mm",
          film: "Matte PU transfer",
          application: "150C / 12 sec / medium pressure",
          wash: "40C wash, 25 cycles",
        },
        unitPrice: "0.19",
      },
      {
        parameters: {
          width: "120 mm",
          height: "55 mm",
          film: "Reflective heat transfer",
          application: "145C / 15 sec / firm pressure",
          wash: "60C wash, 20 cycles",
        },
        unitPrice: "0.34",
      },
    ],
  },
  elastic: {
    fields: [
      { key: "width", label: "Width", placeholder: "25 mm" },
      { key: "material", label: "Material", placeholder: "Polyester / spandex" },
      { key: "stretch", label: "Stretch / recovery", placeholder: "120% stretch, 95% recovery" },
      { key: "length", label: "Length", placeholder: "Roll length or cut length" },
    ],
    dummySets: [
      {
        parameters: {
          width: "25 mm",
          material: "Polyester / spandex jacquard",
          stretch: "120% stretch, 95% recovery",
          length: "100 m roll",
        },
        unitPrice: "0.42",
      },
      {
        parameters: {
          width: "38 mm",
          material: "Nylon covered spandex",
          stretch: "150% stretch, 92% recovery",
          length: "Cut to 720 mm per garment",
        },
        unitPrice: "0.68",
      },
    ],
  },
  drawcord: {
    fields: [
      { key: "diameter", label: "Diameter", placeholder: "5 mm" },
      { key: "material", label: "Material", placeholder: "Cotton, polyester, nylon" },
      { key: "tip", label: "Tip / aglet", placeholder: "Metal, plastic, heat sealed" },
      { key: "length", label: "Length", placeholder: "130 cm" },
    ],
    dummySets: [
      {
        parameters: {
          diameter: "5 mm",
          material: "Round polyester cord",
          tip: "Matte black metal aglet",
          length: "130 cm cut length",
        },
        unitPrice: "0.55",
      },
      {
        parameters: {
          diameter: "8 mm",
          material: "Cotton flat drawcord",
          tip: "Heat sealed clear tip",
          length: "150 cm cut length",
        },
        unitPrice: "0.62",
      },
    ],
  },
  metal: {
    fields: [
      { key: "item", label: "Item", placeholder: "Buckle, eyelet, D-ring..." },
      { key: "material", label: "Material", placeholder: "Zinc alloy, brass, steel" },
      { key: "finish", label: "Finish", placeholder: "Nickel, antique brass, matte black" },
      { key: "size", label: "Size", placeholder: "Inner width, diameter, thickness" },
    ],
    dummySets: [
      {
        parameters: {
          item: "D-ring",
          material: "Zinc alloy",
          finish: "Matte black plating",
          size: "25 mm inner width",
        },
        unitPrice: "0.11",
      },
      {
        parameters: {
          item: "Logo eyelet",
          material: "Brass",
          finish: "Antique brass",
          size: "12 mm outer diameter",
        },
        unitPrice: "0.085",
      },
    ],
  },
  button: {
    fields: [
      { key: "size", label: "Size", placeholder: "18L, 24L, 15 mm..." },
      { key: "material", label: "Material", placeholder: "Resin, corozo, metal" },
      { key: "hole", label: "Hole / shank", placeholder: "2-hole, 4-hole, shank" },
      { key: "finish", label: "Finish", placeholder: "Matte, glossy, engraved" },
    ],
    dummySets: [
      {
        parameters: {
          size: "24L / 15 mm",
          material: "Recycled resin",
          hole: "4-hole",
          finish: "Matte black with laser logo",
        },
        unitPrice: "0.038",
      },
      {
        parameters: {
          size: "18L / 11.5 mm",
          material: "Corozo",
          hole: "2-hole",
          finish: "Natural dye, polished edge",
        },
        unitPrice: "0.052",
      },
    ],
  },
  "pu-patch": {
    fields: [
      { key: "width", label: "Width", placeholder: "60 mm" },
      { key: "height", label: "Height", placeholder: "35 mm" },
      { key: "base", label: "Base", placeholder: "PU leather, microfiber" },
      { key: "logo", label: "Logo method", placeholder: "Deboss, emboss, print" },
      { key: "backing", label: "Backing", placeholder: "Sew line, adhesive, velcro" },
    ],
    dummySets: [
      {
        parameters: {
          width: "60 mm",
          height: "35 mm",
          base: "Brown PU leather",
          logo: "Debossed logo with black fill",
          backing: "Sew line 3 mm from edge",
        },
        unitPrice: "0.28",
      },
      {
        parameters: {
          width: "75 mm",
          height: "42 mm",
          base: "Matte microfiber PU",
          logo: "Embossed logo",
          backing: "Heat-press adhesive backing",
        },
        unitPrice: "0.36",
      },
    ],
  },
  "embroidery-patch": {
    fields: [
      { key: "width", label: "Width", placeholder: "80 mm" },
      { key: "height", label: "Height", placeholder: "50 mm" },
      { key: "thread", label: "Thread", placeholder: "Polyester, metallic, glow..." },
      { key: "backing", label: "Backing", placeholder: "Sew-on, iron-on, velcro" },
      { key: "border", label: "Border", placeholder: "Merrow, laser cut, satin stitch" },
    ],
    dummySets: [
      {
        parameters: {
          width: "80 mm",
          height: "50 mm",
          thread: "Polyester thread, 6 colors",
          backing: "Iron-on backing",
          border: "Merrow border",
        },
        unitPrice: "0.72",
      },
      {
        parameters: {
          width: "55 mm",
          height: "55 mm",
          thread: "Metallic gold plus polyester",
          backing: "Hook velcro backing",
          border: "Laser cut edge",
        },
        unitPrice: "0.91",
      },
    ],
  },
  "silicon-patch": {
    fields: [
      { key: "width", label: "Width", placeholder: "50 mm" },
      { key: "height", label: "Height", placeholder: "30 mm" },
      { key: "thickness", label: "Thickness", placeholder: "2 mm" },
      { key: "colors", label: "Colors", placeholder: "Raised logo colors" },
      { key: "backing", label: "Backing", placeholder: "Sew channel, adhesive, velcro" },
    ],
    dummySets: [
      {
        parameters: {
          width: "50 mm",
          height: "30 mm",
          thickness: "2 mm",
          colors: "Black base, white raised logo",
          backing: "Sew channel",
        },
        unitPrice: "0.39",
      },
      {
        parameters: {
          width: "70 mm",
          height: "40 mm",
          thickness: "3 mm",
          colors: "Tone-on-tone matte navy",
          backing: "Heat adhesive backing",
        },
        unitPrice: "0.58",
      },
    ],
  },
  thread: {
    fields: [
      { key: "composition", label: "Composition", placeholder: "Polyester, cotton, nylon" },
      { key: "count", label: "Count / Tex", placeholder: "Tex 27, 40/2..." },
      { key: "color", label: "Color", placeholder: "Pantone or shade code" },
      { key: "cone", label: "Cone weight", placeholder: "3000 yd, 5000 m, 1 kg" },
    ],
    dummySets: [
      {
        parameters: {
          composition: "Spun polyester",
          count: "40/2",
          color: "Pantone Black C",
          cone: "5000 m cone",
        },
        unitPrice: "2.85",
      },
      {
        parameters: {
          composition: "Core spun polyester",
          count: "Tex 27",
          color: "Warm white shade card match",
          cone: "3000 yd cone",
        },
        unitPrice: "3.2",
      },
    ],
  },
  polybag: {
    fields: [
      { key: "width", label: "Width", placeholder: "300 mm" },
      { key: "height", label: "Height", placeholder: "400 mm" },
      { key: "material", label: "Material", placeholder: "LDPE, PP, recycled content" },
      { key: "thickness", label: "Thickness", placeholder: "40 micron" },
      { key: "closure", label: "Closure", placeholder: "Self seal, zipper, warning print" },
    ],
    dummySets: [
      {
        parameters: {
          width: "300 mm",
          height: "400 mm",
          material: "LDPE with 30% recycled content",
          thickness: "40 micron",
          closure: "Self-seal flap with suffocation warning",
        },
        unitPrice: "0.045",
      },
      {
        parameters: {
          width: "250 mm",
          height: "350 mm",
          material: "Frosted PP",
          thickness: "55 micron",
          closure: "Zip lock with vent hole",
        },
        unitPrice: "0.063",
      },
    ],
  },
};

const supplierCommercialParameterFields: ProductParameterField[] = [
  { key: "sampleCharge", label: "Sample charge", placeholder: "USD 50" },
  { key: "sampleLeadTime", label: "Sample lead time", placeholder: "7 days" },
  { key: "bulkLeadTime", label: "Bulk lead time", placeholder: "25 days" },
];

const customerProductParameterTemplate: ProductParameterTemplate = {
  fields: [
    { key: "sizeRange", label: "Size range", placeholder: "XS-XL" },
    { key: "composition", label: "Composition", placeholder: "100% cotton" },
    { key: "fabricWeight", label: "Fabric weight", placeholder: "220 gsm" },
    { key: "fit", label: "Fit", placeholder: "Regular, slim, oversized..." },
    { key: "construction", label: "Construction", placeholder: "Key seams and finish" },
  ],
  dummySets: [
    {
      parameters: {
        sizeRange: "XS-XL",
        composition: "100% cotton",
        fabricWeight: "220 gsm",
        fit: "Regular fit",
        construction: "Reinforced main seams",
      },
      unitPrice: "12.5",
    },
    {
      parameters: {
        sizeRange: "S-XXL",
        composition: "80% cotton / 20% recycled polyester",
        fabricWeight: "280 gsm",
        fit: "Relaxed fit",
        construction: "Double-needle cover stitch",
      },
      unitPrice: "16.8",
    },
  ],
};

function getProductParameterTemplate(productType: WorkspaceProductType): ProductParameterTemplate {
  if (!isSupplierProductType(productType)) return customerProductParameterTemplate;
  const template = productParameterTemplates[productType];
  return { ...template, fields: [...template.fields, ...supplierCommercialParameterFields] };
}

function getDefaultProductParameters(productType: WorkspaceProductType): Record<string, string> {
  return Object.fromEntries(
    getProductParameterTemplate(productType).fields.map((field) => [field.key, ""]),
  );
}

function getProductParameterDummySet(
  productType: WorkspaceProductType,
  index: number,
): ProductParameterDummySet {
  const template = getProductParameterTemplate(productType);
  const combinationIndex = index % 20;
  const dummy = template.dummySets[combinationIndex % template.dummySets.length];
  const productionRuns = ["Prototype", "Low MOQ", "Standard", "Recycled option", "Premium"];
  const packingMethods = ["Bulk packed", "Bundled", "Individual packed", "Export packed"];
  const fieldToVary = isSupplierProductType(productType)
    ? productParameterTemplates[productType].fields.at(-1)?.key
    : template.fields.at(-1)?.key;
  const variation = `${productionRuns[combinationIndex % productionRuns.length]}, ${packingMethods[Math.floor(combinationIndex / productionRuns.length)]}`;
  const price = Number.parseFloat(dummy.unitPrice);
  const priceMultiplier = 1 + combinationIndex * 0.015;
  const parameters: Record<string, string> = {
    ...getDefaultProductParameters(productType),
    ...dummy.parameters,
    ...(isSupplierProductType(productType)
      ? {
          sampleCharge: `USD ${25 + combinationIndex * 5}`,
          sampleLeadTime: `${5 + (combinationIndex % 5)} days`,
          bulkLeadTime: `${20 + (combinationIndex % 4) * 5} days`,
        }
      : {}),
  };

  if (fieldToVary) {
    parameters[fieldToVary] = `${parameters[fieldToVary]} (${variation})`;
  }

  return {
    parameters,
    unitPrice: Number.isFinite(price)
      ? (price * priceMultiplier).toFixed(Math.max(2, dummy.unitPrice.split(".")[1]?.length ?? 0))
      : dummy.unitPrice,
  };
}

function createProductForm(
  productType: WorkspaceProductType,
  input: Omit<ProductFormState, "productType">,
): ProductFormState {
  return {
    ...input,
    productType,
  };
}

function getProductMaterialSummary(parameters: Record<string, string>): string {
  return (
    parameters.material ||
    parameters.paper ||
    parameters.weave ||
    parameters.film ||
    parameters.substrate ||
    parameters.finish ||
    "Supplier confirmed trim material"
  );
}

function getProductColorNotes(parameters: Record<string, string>): string {
  return (
    parameters.color ||
    parameters.colors ||
    parameters.finish ||
    parameters.print ||
    parameters.weave ||
    "Match approved supplier color standard"
  );
}

function normalizeProductDimensions(parameters: Record<string, string>): Record<string, string> {
  if (parameters.width || parameters.height || !parameters.size) return parameters;

  const match = parameters.size.match(/^\s*([^xX×]+?)\s*[xX×]\s*(.+?)\s*$/);
  if (!match) return parameters;

  const rest = { ...parameters };
  delete rest.size;
  return { ...rest, width: match[1].trim(), height: match[2].trim() };
}

function getDummyProduct(
  index: number,
  availableProductTypes: readonly WorkspaceProductType[] = supplierProductTypes,
  ownerKind: ProductOwnerKind = "supplier",
): ProductFormState {
  const fallbackTypes = ownerKind === "customer" ? customerProductTypes : supplierProductTypes;
  const productTypes = availableProductTypes.length ? availableProductTypes : fallbackTypes;
  const productType =
    productTypes[index % productTypes.length] ??
    (ownerKind === "customer" ? defaultCustomerProductType : defaultSupplierProductType);
  const parameterCycle = Math.floor(index / productTypes.length);
  const dummy = getProductParameterDummySet(productType, parameterCycle);
  const label = getWorkspaceProductTypeLabel(productType);

  const variants: ProductVariantFormState[] = [
    {
      id: crypto.randomUUID(),
      sortIndex: 0,
      material: getProductMaterialSummary(dummy.parameters),
      colorNotes: getProductColorNotes(dummy.parameters),
      parameters: { ...dummy.parameters },
      unitPrice: dummy.unitPrice,
      priceUnit: getProductPriceUnit(productType),
      image: null,
    },
  ];

  return createProductForm(productType, {
    ownerKind,
    supplierId: "",
    customerId: "",
    projectId: "",
    projectName: "",
    subject: `${label} sample ${parameterCycle + 1}`,
    detail: `Generic ${label.toLocaleLowerCase()} specification. Confirm construction, tolerance, finishing, packing, and production approval sample before bulk order.`,
    variants,
    activeVariantId: variants[0]?.id ?? null,
  });
}

function getDummyCustomerCompany(index: number): CustomerCompanyState {
  return { ...dummyCustomerCompanies[index % dummyCustomerCompanies.length] };
}

function getDummySupplierCompany(index: number): SupplierCompanyState {
  const company = dummySupplierCompanies[index % dummySupplierCompanies.length];
  return { ...company, productTypes: [...company.productTypes] };
}

function emptyProductForm(
  productType: WorkspaceProductType = defaultSupplierProductType,
  ownerKind: ProductOwnerKind = "supplier",
): ProductFormState {
  const variants: ProductVariantFormState[] = [
    {
      id: crypto.randomUUID(),
      sortIndex: 0,
      material: "",
      colorNotes: "",
      parameters: getDefaultProductParameters(productType),
      unitPrice: "",
      priceUnit: getProductPriceUnit(productType),
      image: null,
    },
  ];

  return {
    ownerKind,
    supplierId: "",
    customerId: "",
    projectId: "",
    projectName: "",
    productType,
    subject: "",
    detail: "",
    variants,
    activeVariantId: variants[0]?.id ?? null,
  };
}

function normalizeVariants(variants: ProductVariantFormState[]): ProductVariantFormState[] {
  return variants
    .slice()
    .sort((left, right) => left.sortIndex - right.sortIndex)
    .map((variant, index) => ({ ...variant, sortIndex: index }));
}

function getActiveVariant(form: ProductFormState): ProductVariantFormState {
  const normalized = normalizeVariants(form.variants);
  const fallbackVariant: ProductVariantFormState = normalized[0] ?? {
    id: crypto.randomUUID(),
    sortIndex: 0,
    material: "",
    colorNotes: "",
    parameters: getDefaultProductParameters(form.productType),
    unitPrice: "",
    priceUnit: getProductPriceUnit(form.productType),
    image: null,
  };

  return normalized.find((variant) => variant.id === form.activeVariantId) ?? fallbackVariant;
}

function setVariantField(
  form: ProductFormState,
  variantId: string,
  update: (variant: ProductVariantFormState) => ProductVariantFormState,
): ProductFormState {
  return {
    ...form,
    variants: normalizeVariants(
      form.variants.map((variant) => (variant.id === variantId ? update(variant) : variant)),
    ),
  };
}

function buildProductInput(form: ProductFormState) {
  return {
    ownerKind: form.ownerKind,
    supplierId: form.ownerKind === "supplier" ? form.supplierId : null,
    customerId: form.ownerKind === "customer" ? form.customerId.trim() || null : null,
    projectId:
      form.ownerKind === "customer" && form.projectId.trim() ? form.projectId.trim() : null,
    productType: form.productType,
    subject: form.subject,
    detail: form.detail,
    variants: normalizeVariants(form.variants).filter(
      (
        variant,
      ): variant is ProductVariantFormState & {
        image: ProductImageState;
      } => variant.image !== null,
    ),
  };
}

function getProductPrimaryVariant(product: ProductRecord): ProductVariantRecord | null {
  return product.variants[0] ?? null;
}

function getProductSearchText(product: ProductRecord) {
  return productRecordSearchText(product);
}

function getProductFormVariantSearchText(form: ProductFormState, variant: ProductVariantFormState) {
  return [
    getWorkspaceProductTypeLabel(form.productType),
    form.subject,
    form.detail,
    variant.material,
    variant.colorNotes,
    variant.unitPrice,
    variant.priceUnit,
    variant.image?.name ?? "",
    ...Object.entries(variant.parameters).flatMap(([key, value]) => [key, value]),
  ]
    .join(" ")
    .trim();
}

function getZodFieldErrors(result: FieldParseResult) {
  const errors: Record<string, string> = {};
  if (result.success) return errors;

  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

function getFirstZodErrorMessage(result: FieldParseResult): string | null {
  if (result.success) return null;
  return result.error.issues[0]?.message ?? "Please complete the required product fields.";
}

function FormField({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold tracking-wide uppercase">{label}</Label>
      {children}
      {error ? <p className="text-destructive text-xs leading-5">{error}</p> : null}
      {!error && hint ? <p className="text-muted-foreground text-xs leading-5">{hint}</p> : null}
    </div>
  );
}

function SubTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring h-9 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ProductTypeSelect({
  value,
  onChange,
}: {
  value: SupplierProductType[];
  onChange: (next: SupplierProductType[]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearchValue(query);
  const visibleTypes = supplierProductTypes.filter((productType) =>
    fuzzyMatches(supplierProductTypeLabels[productType], normalizedQuery),
  );

  function toggleProductType(productType: SupplierProductType) {
    onChange(
      value.includes(productType)
        ? value.filter((item) => item !== productType)
        : [...value, productType],
    );
  }

  return (
    <div className="grid gap-2">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search product types"
        aria-label="Search supplier product types"
      />
      <div className="bg-background max-h-48 overflow-y-auto rounded-lg border">
        {visibleTypes.map((productType) => {
          const checked = value.includes(productType);
          return (
            <label
              key={productType}
              className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleProductType(productType)}
                className="size-4"
              />
              <span>{supplierProductTypeLabels[productType]}</span>
            </label>
          );
        })}
        {visibleTypes.length === 0 ? (
          <p className="text-muted-foreground px-3 py-4 text-sm">No matching product types.</p>
        ) : null}
      </div>
      {value.length ? (
        <div className="flex flex-wrap gap-2">
          {value.map((productType) => (
            <Badge key={productType} variant="secondary">
              {supplierProductTypeLabels[productType]}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmployeeEditor({
  employees,
  domainSuffix,
  onEmployeesChange,
  onSave,
  isEditing,
}: {
  employees: EmployeeRow[];
  domainSuffix: string;
  onEmployeesChange: (employees: EmployeeRow[]) => void;
  onSave: () => Promise<void>;
  isEditing: boolean;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [dummyInputCount, setDummyInputCount] = useState(0);
  const normalizedDomain = normalizeEmailDomainSuffix(domainSuffix);

  function updateEmployee(id: string, key: keyof EmployeeInput, value: string) {
    onEmployeesChange(
      employees.map((employee) => (employee.id === id ? { ...employee, [key]: value } : employee)),
    );
  }

  function addEmployee() {
    onEmployeesChange([...employees, emptyEmployee()]);
  }

  function removeEmployee(id: string) {
    onEmployeesChange(
      employees.length === 1
        ? [emptyEmployee()]
        : employees.filter((employee) => employee.id !== id),
    );
  }

  function fillDummyEmployees() {
    const targetIndex = Math.max(employees.length - 1, 0);
    const dummy = createDummyEmployee(dummyInputCount);
    onEmployeesChange(
      employees.length
        ? employees.map((employee, index) =>
            index === targetIndex ? { ...dummy, id: employee.id } : employee,
          )
        : [dummy],
    );
    setDummyInputCount((count) => count + 1);
    setSubmitted(false);
  }

  function saveEmployees() {
    setSubmitted(true);
    if (employees.every((employee) => employeeSchema.safeParse(employee).success)) void onSave();
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">Employee contacts</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Add one or more contact people for this company.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={fillDummyEmployees}>
            <Wand2 />
            Dummy input
          </Button>
          <Button type="button" onClick={addEmployee}>
            <UserPlus />
            Add more
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {employees.map((employee, index) => {
          const parseResult = employeeSchema.safeParse(employee);
          const errors = submitted ? getZodFieldErrors(parseResult) : {};
          return (
            <div key={employee.id} className="bg-background rounded-lg border p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <Badge variant="secondary">Employee {index + 1}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove employee ${index + 1}`}
                  onClick={() => removeEmployee(employee.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="User name" error={errors.userName}>
                  <Input
                    value={employee.userName}
                    onChange={(event) =>
                      updateEmployee(employee.id, "userName", event.target.value)
                    }
                    placeholder="Jane Cooper"
                  />
                </FormField>
                <FormField
                  label="Email prefix"
                  error={errors.emailPrefix}
                  hint={
                    normalizedDomain
                      ? `Email preview: ${employee.emailPrefix || "name"}@${normalizedDomain}`
                      : undefined
                  }
                >
                  <div className="flex">
                    <Input
                      value={employee.emailPrefix}
                      onChange={(event) =>
                        updateEmployee(
                          employee.id,
                          "emailPrefix",
                          event.target.value.trim().replaceAll("@", ""),
                        )
                      }
                      className="rounded-r-none"
                      placeholder="jane.cooper"
                    />
                    <span className="border-input bg-muted text-muted-foreground flex h-8 shrink-0 items-center rounded-r-lg border border-l-0 px-2 text-sm">
                      @{normalizedDomain || "domain.com"}
                    </span>
                  </div>
                </FormField>
                <FormField label="Title" error={errors.title}>
                  <Input
                    value={employee.title}
                    onChange={(event) => updateEmployee(employee.id, "title", event.target.value)}
                    placeholder="Merchandising manager"
                  />
                </FormField>
                <FormField label="Tel" error={errors.tel}>
                  <Input
                    value={employee.tel}
                    onChange={(event) => updateEmployee(employee.id, "tel", event.target.value)}
                    placeholder="+1 212 555 0134"
                  />
                </FormField>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={saveEmployees}>
          <Save />
          {isEditing ? "Update employees" : "Save employees"}
        </Button>
      </div>
    </div>
  );
}

function CustomerCompanyForm({
  value,
  onChange,
  onSaved,
}: {
  value: CustomerCompanyState;
  onChange: (value: CustomerCompanyState) => void;
  onSaved: () => void;
}) {
  const [errors, setErrors] = useState<CompanyErrors>({});
  const [domainPrompt, setDomainPrompt] = useState<string | null>(null);
  const [dummyInputCount, setDummyInputCount] = useState(0);

  function updateField(key: keyof CustomerCompanyState, nextValue: string) {
    if (key === "emailDomainSuffix") {
      setDomainPrompt(
        hadAtSymbol(nextValue) ? "The @ symbol was removed. Enter only the domain suffix." : null,
      );
      onChange({ ...value, [key]: normalizeEmailDomainSuffix(nextValue) });
      return;
    }
    onChange({ ...value, [key]: nextValue });
  }

  function saveCompany() {
    const result = customerCompanySchema.safeParse(value);
    if (!result.success) {
      setErrors(getZodFieldErrors(result));
      return;
    }
    setErrors({});
    onSaved();
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">Company details</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Save the company first, then add employee contacts.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange(getDummyCustomerCompany(dummyInputCount));
            setDummyInputCount((count) => count + 1);
            setErrors({});
            setDomainPrompt(null);
          }}
        >
          <Wand2 />
          Dummy input
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Company name" error={errors.companyName}>
          <Input
            value={value.companyName}
            onChange={(event) => updateField("companyName", event.target.value)}
            placeholder="Acme Fashion Ltd."
          />
        </FormField>
        <FormField
          label="Email domain suffix"
          error={errors.emailDomainSuffix}
          hint={domainPrompt ?? "Example: acme.com"}
        >
          <div className="flex">
            <span className="border-input bg-muted text-muted-foreground flex h-8 items-center rounded-l-lg border border-r-0 px-2 text-sm">
              @
            </span>
            <Input
              value={value.emailDomainSuffix}
              onChange={(event) => updateField("emailDomainSuffix", event.target.value)}
              className="rounded-l-none"
              placeholder="acme.com"
            />
          </div>
        </FormField>
        <FormField label="Type" error={errors.type}>
          <Input
            value={value.type}
            onChange={(event) => updateField("type", event.target.value)}
            placeholder="Brand owner, agent, distributor..."
          />
        </FormField>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={saveCompany}>
          <Save />
          Save and add employees
        </Button>
      </div>
    </div>
  );
}

function SupplierCompanyForm({
  value,
  onChange,
  onSaved,
}: {
  value: SupplierCompanyState;
  onChange: (value: SupplierCompanyState) => void;
  onSaved: () => void;
}) {
  const [errors, setErrors] = useState<CompanyErrors>({});
  const [domainPrompt, setDomainPrompt] = useState<string | null>(null);
  const [dummyInputCount, setDummyInputCount] = useState(0);

  function updateTextField(key: "companyName" | "emailDomainSuffix", nextValue: string) {
    if (key === "emailDomainSuffix") {
      setDomainPrompt(
        hadAtSymbol(nextValue) ? "The @ symbol was removed. Enter only the domain suffix." : null,
      );
      onChange({ ...value, [key]: normalizeEmailDomainSuffix(nextValue) });
      return;
    }
    onChange({ ...value, [key]: nextValue });
  }

  function saveCompany() {
    const result = supplierCompanySchema.safeParse(value);
    if (!result.success) {
      setErrors(getZodFieldErrors(result));
      return;
    }
    setErrors({});
    onSaved();
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">Supplier company</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Choose the supplier product type, then continue to employees.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange(getDummySupplierCompany(dummyInputCount));
            setDummyInputCount((count) => count + 1);
            setErrors({});
            setDomainPrompt(null);
          }}
        >
          <Wand2 />
          Dummy input
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Company name" error={errors.companyName}>
          <Input
            value={value.companyName}
            onChange={(event) => updateTextField("companyName", event.target.value)}
            placeholder="Supplier company name"
          />
        </FormField>
        <FormField
          label="Email domain suffix"
          error={errors.emailDomainSuffix}
          hint={domainPrompt ?? "Example: supplier.com"}
        >
          <div className="flex">
            <span className="border-input bg-muted text-muted-foreground flex h-8 items-center rounded-l-lg border border-r-0 px-2 text-sm">
              @
            </span>
            <Input
              value={value.emailDomainSuffix}
              onChange={(event) => updateTextField("emailDomainSuffix", event.target.value)}
              className="rounded-l-none"
              placeholder="supplier.com"
            />
          </div>
        </FormField>
        <FormField label="Product type" error={errors.productTypes}>
          <ProductTypeSelect
            value={value.productTypes}
            onChange={(productTypes) => onChange({ ...value, productTypes })}
          />
        </FormField>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={saveCompany}>
          <Save />
          Save and add employees
        </Button>
      </div>
    </div>
  );
}

function PartyWorkspacePanel({
  kind,
  mode,
  onModeChange,
  formVersion,
}: {
  kind: PartyKind;
  mode: "new" | "records";
  onModeChange: (mode: "new" | "records") => void;
  formVersion: number;
}) {
  const [activeSubTab, setActiveSubTab] = useState<PartySubTab>("company");
  const [customerCompany, setCustomerCompany] = useState<CustomerCompanyState>({
    companyName: "",
    emailDomainSuffix: "",
    type: "",
  });
  const [supplierCompany, setSupplierCompany] = useState<SupplierCompanyState>({
    companyName: "",
    emailDomainSuffix: "",
    productTypes: [],
  });
  const [employees, setEmployees] = useState<EmployeeRow[]>([emptyEmployee()]);
  const [query, setQuery] = useState("");
  const [expandedRecordIds, setExpandedRecordIds] = useState<string[]>([]);
  const [searchCollapsedRecordKeys, setSearchCollapsedRecordKeys] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeFormVersion, setActiveFormVersion] = useState(formVersion);
  const [showProductNextStep, setShowProductNextStep] = useState(false);
  const [savedCustomerId, setSavedCustomerId] = useState<string | null>(null);
  const [savedSupplierId, setSavedSupplierId] = useState<string | null>(null);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [supplierFilters, setSupplierFilters] = useState<SupplierTableFilters>(
    emptySupplierTableFilters(),
  );
  const customers = useCustomers();
  const suppliers = useSuppliers();
  const products = useProducts();
  const upsertCustomer = useUpsertCustomer();
  const upsertSupplier = useUpsertSupplier();
  const upsertProduct = useUpsertProduct();
  const deleteSuppliers = useDeleteSuppliers();
  const deleteProducts = useDeleteProducts();

  const domainSuffix =
    kind === "customer" ? customerCompany.emailDomainSuffix : supplierCompany.emailDomainSuffix;
  const records: PartyRecord[] =
    kind === "customer" ? (customers.data ?? []) : (suppliers.data ?? []);
  const isLoadingRecords = kind === "customer" ? customers.isLoading : suppliers.isLoading;
  const isRecordsError = kind === "customer" ? customers.isError : suppliers.isError;
  const recordsError = kind === "customer" ? customers.error : suppliers.error;
  const isSaving = kind === "customer" ? upsertCustomer.isPending : upsertSupplier.isPending;
  const normalizedQuery = normalizeSearchValue(query);

  if (activeFormVersion !== formVersion) {
    setActiveFormVersion(formVersion);
    setCustomerCompany({ companyName: "", emailDomainSuffix: "", type: "" });
    setSupplierCompany({ companyName: "", emailDomainSuffix: "", productTypes: [] });
    setEmployees([emptyEmployee()]);
    setExpandedRecordIds([]);
    setSearchCollapsedRecordKeys([]);
    setEditingId(null);
    setActiveSubTab("company");
    setSavedCustomerId(null);
    setSavedSupplierId(null);
    setSelectedSupplierIds([]);
    setSupplierFilters(emptySupplierTableFilters());
  }

  async function saveRecord() {
    const company = kind === "customer" ? customerCompany : supplierCompany;
    try {
      if (kind === "customer") {
        const savedCustomer = await upsertCustomer.mutateAsync({
          id: editingId,
          input: { company: company as CustomerCompanyState, employees },
        });
        setSavedCustomerId(savedCustomer.id);
      } else {
        const savedSupplier = await upsertSupplier.mutateAsync({
          id: editingId,
          input: { company: company as SupplierCompanyState, employees },
        });
        setSavedSupplierId(savedSupplier.id);
      }
      toast.success(`${partyLabels[kind]} saved`);
      setEditingId(null);
      setSearchCollapsedRecordKeys([]);
      setShowProductNextStep(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to save ${kind}`);
    }
  }

  function editRecord(record: PartyRecord, tab: PartySubTab) {
    if (kind === "customer") {
      setCustomerCompany(record.company as CustomerCompanyState);
      setSavedCustomerId(record.id);
    } else {
      setSupplierCompany(record.company as SupplierCompanyState);
      setSavedSupplierId(record.id);
    }
    setEmployees(record.employees);
    setEditingId(record.id);
    setActiveSubTab(tab);
  }

  async function deleteSupplierRecords(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return;
    try {
      await deleteSuppliers.mutateAsync(uniqueIds);
      setSelectedSupplierIds((current) => current.filter((id) => !uniqueIds.includes(id)));
      setExpandedRecordIds((current) => current.filter((id) => !uniqueIds.includes(id)));
      if (editingId && uniqueIds.includes(editingId)) setEditingId(null);
      toast.success(uniqueIds.length === 1 ? "Supplier deleted" : "Suppliers deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete supplier");
    }
  }

  async function deleteSupplierProductImages(items: readonly ProductImageGalleryItem[]) {
    const uniqueItems = Array.from(new Map(items.map((item) => [item.id, item])).values());
    if (uniqueItems.length === 0) return;

    const itemsByProduct = new Map<string, ProductImageGalleryItem[]>();
    for (const item of uniqueItems) {
      const current = itemsByProduct.get(item.product.id) ?? [];
      current.push(item);
      itemsByProduct.set(item.product.id, current);
    }

    const recordsById = new Map((products.data ?? []).map((record) => [record.id, record]));
    const productIdsToDelete: string[] = [];
    const productUpdates: Array<{
      record: ProductRecord;
      remainingVariants: ProductVariantRecord[];
    }> = [];

    for (const [productId, productItems] of itemsByProduct) {
      const record = recordsById.get(productId);
      if (!record) continue;
      const selectedVariantIds = new Set(productItems.map((item) => item.variant.id));
      const remainingVariants = record.variants.filter(
        (variant) => !selectedVariantIds.has(variant.id),
      );

      if (remainingVariants.length === 0) {
        productIdsToDelete.push(record.id);
        continue;
      }

      productUpdates.push({ record, remainingVariants });
    }

    try {
      for (const { record, remainingVariants } of productUpdates) {
        await upsertProduct.mutateAsync({
          id: record.id,
          input: {
            ownerKind: record.ownerKind,
            supplierId: record.ownerKind === "supplier" ? record.supplierId : null,
            customerId: record.ownerKind === "customer" ? record.customerId : null,
            productType: record.productType,
            subject: record.subject,
            detail: record.detail,
            variants: remainingVariants.map((variant, sortIndex) => {
              if (!variant.image) {
                throw new Error("This image gallery contains an empty variant and cannot be deleted.");
              }
              return {
                id: variant.id,
                sortIndex,
                material: variant.material,
                colorNotes: variant.colorNotes,
                parameters: variant.parameters,
                unitPrice: variant.unitPrice,
                priceUnit: variant.priceUnit,
                image: variant.image,
              };
            }),
          },
        });
      }

      if (productIdsToDelete.length > 0) {
        await deleteProducts.mutateAsync(Array.from(new Set(productIdsToDelete)));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete product image");
      throw error;
    }
  }

  function getSearchCollapseKey(recordId: string) {
    return `${normalizedQuery}::${recordId}`;
  }

  function toggleRecordExpansion(recordId: string, isExpanded: boolean) {
    const searchCollapseKey = getSearchCollapseKey(recordId);

    if (isExpanded) {
      setExpandedRecordIds((current) => current.filter((id) => id !== recordId));
      setSearchCollapsedRecordKeys((current) =>
        current.includes(searchCollapseKey) ? current : [...current, searchCollapseKey],
      );
      return;
    }

    setExpandedRecordIds((current) =>
      current.includes(recordId) ? current : [...current, recordId],
    );
    setSearchCollapsedRecordKeys((current) => current.filter((key) => key !== searchCollapseKey));
  }

  const visibleRecords = records.filter((record) =>
    fuzzyMatches(getPartyRecordSearchText(record), normalizedQuery),
  );
  const supplierProducts = products.data ?? [];
  const filteredSupplierRecords =
    kind !== "supplier"
      ? []
      : visibleRecords.filter((record): record is SupplierRecord => {
          if (!("productTypes" in record.company)) return false;
          const employeesText = record.employees
            .map((employee) => `${employee.userName} ${employee.title} ${employee.tel}`)
            .join(" ");
          const productRecords = supplierProducts.filter(
            (product) => product.supplierId === record.id,
          );
          const productText = productRecords.map(getProductSearchText).join(" ");

          return (
            fuzzyMatches(
              record.company.companyName,
              normalizeSearchValue(supplierFilters.company),
            ) &&
            fuzzyMatches(
              record.company.emailDomainSuffix,
              normalizeSearchValue(supplierFilters.domain),
            ) &&
            fuzzyMatches(
              record.company.productTypes
                .map((productType) => supplierProductTypeLabels[productType])
                .join(" "),
              normalizeSearchValue(supplierFilters.productTypes),
            ) &&
            fuzzyMatches(employeesText, normalizeSearchValue(supplierFilters.employees)) &&
            fuzzyMatches(productText, normalizeSearchValue(supplierFilters.products))
          );
        });
  const companyIsComplete =
    kind === "customer"
      ? customerCompanySchema.safeParse(customerCompany).success
      : supplierCompanySchema.safeParse(supplierCompany).success;
  const selectedFilteredSupplierIds = filteredSupplierRecords
    .map((record) => record.id)
    .filter((id) => selectedSupplierIds.includes(id));
  const allFilteredSuppliersSelected =
    filteredSupplierRecords.length > 0 &&
    selectedFilteredSupplierIds.length === filteredSupplierRecords.length;
  const selectedSupplierDeleteDescription =
    selectedSupplierIds.length === 1
      ? "Delete this supplier record? Products from this supplier will become unlinked."
      : `Delete ${selectedSupplierIds.length} supplier records? Products from these suppliers will become unlinked.`;

  if (mode === "records" && editingId === null) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-5">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Directory
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {partyLabels[kind]} records
          </h2>
        </div>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          <div className="border-b p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative max-w-md flex-1">
                <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                  placeholder="Search company or employee"
                  aria-label="Search records"
                />
              </div>
              {kind === "supplier" && selectedSupplierIds.length > 0 ? (
                <ConfirmDialog
                  title="Delete supplier records?"
                  description={selectedSupplierDeleteDescription}
                  confirmLabel={
                    selectedSupplierIds.length === 1 ? "Delete supplier" : "Delete suppliers"
                  }
                  onConfirm={() => deleteSupplierRecords(selectedSupplierIds)}
                  trigger={
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={deleteSuppliers.isPending}
                    >
                      <Trash2 />
                      Delete selected ({selectedSupplierIds.length})
                    </Button>
                  }
                />
              ) : null}
            </div>
          </div>
          {isLoadingRecords ? (
            <p className="text-muted-foreground p-10 text-center text-sm">Loading records...</p>
          ) : isRecordsError ? (
            <p className="text-destructive p-10 text-center text-sm">
              Failed to load records:{" "}
              {recordsError instanceof Error ? recordsError.message : "unknown error"}
            </p>
          ) : kind === "supplier" ? (
            records.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/60 text-muted-foreground text-xs uppercase">
                    <tr>
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all visible suppliers"
                          checked={allFilteredSuppliersSelected}
                          onChange={(event) => {
                            const visibleIds = filteredSupplierRecords.map((record) => record.id);
                            setSelectedSupplierIds((current) =>
                              event.target.checked
                                ? Array.from(new Set([...current, ...visibleIds]))
                                : current.filter((id) => !visibleIds.includes(id)),
                            );
                          }}
                          className="accent-primary size-4"
                        />
                      </th>
                      <th className="px-4 py-3">Company</th>
                      <th className="px-4 py-3">Domain</th>
                      <th className="px-4 py-3">Product types</th>
                      <th className="px-4 py-3">Employees</th>
                      <th className="px-4 py-3">Products</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                    <tr className="bg-background/90 normal-case">
                      <th className="px-4 py-2" />
                      <th className="px-4 py-2">
                        <Input
                          value={supplierFilters.company}
                          onChange={(event) =>
                            setSupplierFilters((current) => ({
                              ...current,
                              company: event.target.value,
                            }))
                          }
                          placeholder="Filter company"
                          aria-label="Filter suppliers by company"
                        />
                      </th>
                      <th className="px-4 py-2">
                        <Input
                          value={supplierFilters.domain}
                          onChange={(event) =>
                            setSupplierFilters((current) => ({
                              ...current,
                              domain: event.target.value,
                            }))
                          }
                          placeholder="Filter domain"
                          aria-label="Filter suppliers by domain"
                        />
                      </th>
                      <th className="px-4 py-2">
                        <Input
                          value={supplierFilters.productTypes}
                          onChange={(event) =>
                            setSupplierFilters((current) => ({
                              ...current,
                              productTypes: event.target.value,
                            }))
                          }
                          placeholder="Filter product types"
                          aria-label="Filter suppliers by product types"
                        />
                      </th>
                      <th className="px-4 py-2">
                        <Input
                          value={supplierFilters.employees}
                          onChange={(event) =>
                            setSupplierFilters((current) => ({
                              ...current,
                              employees: event.target.value,
                            }))
                          }
                          placeholder="Filter employees"
                          aria-label="Filter suppliers by employees"
                        />
                      </th>
                      <th className="px-4 py-2">
                        <Input
                          value={supplierFilters.products}
                          onChange={(event) =>
                            setSupplierFilters((current) => ({
                              ...current,
                              products: event.target.value,
                            }))
                          }
                          placeholder="Filter products"
                          aria-label="Filter suppliers by products"
                        />
                      </th>
                      <th className="text-muted-foreground px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredSupplierRecords.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="text-muted-foreground px-4 py-10 text-center text-sm"
                        >
                          No suppliers match the active filters.
                        </td>
                      </tr>
                    ) : null}
                    {filteredSupplierRecords.map((record) => {
                      const productRecords = supplierProducts.filter(
                        (product) => product.supplierId === record.id,
                      );
                      const hasProductImages = productRecords.some((product) =>
                        product.variants.some((variant) => variant.image),
                      );
                      const productImageCount = productRecords.reduce(
                        (count, product) =>
                          count + product.variants.filter((variant) => variant.image).length,
                        0,
                      );

                      return (
                        <tr key={record.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Select ${record.company.companyName}`}
                              checked={selectedSupplierIds.includes(record.id)}
                              onChange={(event) =>
                                setSelectedSupplierIds((current) =>
                                  event.target.checked
                                    ? Array.from(new Set([...current, record.id]))
                                    : current.filter((id) => id !== record.id),
                                )
                              }
                              className="accent-primary size-4"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium">{record.company.companyName}</td>
                          <td className="text-muted-foreground px-4 py-3">
                            @{record.company.emailDomainSuffix}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {record.company.productTypes.map((productType) => (
                                <Badge key={productType} variant="secondary">
                                  {supplierProductTypeLabels[productType]}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">{record.employees.length}</td>
                          <td className="px-4 py-3">{productRecords.length}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              {hasProductImages ? (
                                <ProductImageBrowserDialog
                                  products={productRecords}
                                  title={`${record.company.companyName} product images`}
                                  onDeleteItems={deleteSupplierProductImages}
                                  trigger={
                                    <Button type="button" variant="ghost" size="sm">
                                      View product ({productImageCount})
                                    </Button>
                                  }
                                />
                              ) : (
                                <Button type="button" variant="ghost" size="sm" disabled>
                                  View product (0)
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => editRecord(record, "company")}
                              >
                                <Pencil />
                                Edit
                              </Button>
                              <ConfirmDialog
                                title="Delete supplier record?"
                                description={`Delete ${record.company.companyName}? Products from this supplier will become unlinked.`}
                                confirmLabel="Delete supplier"
                                onConfirm={() => deleteSupplierRecords([record.id])}
                                trigger={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={deleteSuppliers.isPending}
                                  >
                                    <Trash2 />
                                    Delete
                                  </Button>
                                }
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground p-10 text-center text-sm">
                {query ? "No matching records." : "No saved supplier records yet."}
              </p>
            )
          ) : visibleRecords.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-muted-foreground text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email / domain</th>
                    <th className="px-4 py-3">Details</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                {visibleRecords.map((record) => {
                  const customerProducts = (products.data ?? []).filter(
                    (product) =>
                      product.ownerKind === "customer" && product.customerId === record.id,
                  );
                  const customerProductImageCount = customerProducts.reduce(
                    (count, product) =>
                      count + product.variants.filter((variant) => variant.image).length,
                    0,
                  );
                  const matchingEmployees = normalizedQuery
                    ? record.employees.filter((employee) =>
                        fuzzyMatches(
                          getEmployeeSearchText(employee, record.company.emailDomainSuffix),
                          normalizedQuery,
                        ),
                      )
                    : record.employees;
                  const hasMatchingEmployees =
                    normalizedQuery.length > 0 && matchingEmployees.length > 0;
                  const isAutoExpanded =
                    hasMatchingEmployees &&
                    !searchCollapsedRecordKeys.includes(getSearchCollapseKey(record.id));
                  const isExpanded = expandedRecordIds.includes(record.id) || isAutoExpanded;
                  const employeesToShow = hasMatchingEmployees
                    ? matchingEmployees
                    : record.employees;
                  const employeeCountLabel =
                    record.employees.length === 1
                      ? "1 employee"
                      : `${record.employees.length} employees`;

                  return (
                    <tbody key={record.id} className="border-t first:border-t-0">
                      <tr className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="focus-visible:ring-ring -mx-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium outline-none focus-visible:ring-2"
                            aria-expanded={isExpanded}
                            onClick={() => toggleRecordExpansion(record.id, isExpanded)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="text-muted-foreground size-4" />
                            ) : (
                              <ChevronRight className="text-muted-foreground size-4" />
                            )}
                            <Building2 className="text-muted-foreground size-4" />
                            <span className="min-w-0 truncate">{record.company.companyName}</span>
                          </button>
                        </td>
                        <td className="text-muted-foreground px-4 py-3">
                          @{record.company.emailDomainSuffix}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{employeeCountLabel}</Badge>
                            {kind === "customer" && customerProducts.length ? (
                              <ProductImageBrowserDialog
                                products={customerProducts}
                                title={`${record.company.companyName} product images`}
                                trigger={
                                  <Button type="button" variant="outline" size="sm">
                                    View product ({customerProductImageCount})
                                  </Button>
                                }
                              />
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => editRecord(record, "product")}
                            >
                              <ImagePlus />
                              Add product
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => editRecord(record, "company")}
                            >
                              <Pencil />
                              Company Edit
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded
                        ? employeesToShow.map((employee) => (
                            <tr key={employee.id} className="bg-muted/10 hover:bg-muted/30">
                              <td className="px-4 py-3 pl-10 font-medium">
                                <div className="flex min-w-0 items-center gap-2">
                                  <UserPlus className="text-muted-foreground size-4" />
                                  <span className="min-w-0 truncate">{employee.userName}</span>
                                </div>
                              </td>
                              <td className="text-muted-foreground px-4 py-3">
                                {getEmployeeEmail(employee, record.company.emailDomainSuffix)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="grid gap-1">
                                  <span>{employee.title}</span>
                                  <span className="text-muted-foreground text-xs">
                                    {employee.tel}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => editRecord(record, "employee")}
                                >
                                  <Pencil />
                                  Employee Edit
                                </Button>
                              </td>
                            </tr>
                          ))
                        : null}
                    </tbody>
                  );
                })}
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground p-10 text-center text-sm">
              {query ? "No matching records." : "No saved records yet."}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid gap-2">
          {editingId !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() => {
                setEditingId(null);
                setActiveSubTab("company");
              }}
            >
              <ChevronLeft />
              Back
            </Button>
          ) : null}
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Standard userform
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{partyLabels[kind]} (+)</h2>
        </div>
        <div className="bg-muted flex rounded-lg p-1">
          <SubTabButton
            active={activeSubTab === "company"}
            onClick={() => setActiveSubTab("company")}
          >
            Company
          </SubTabButton>
          <SubTabButton
            active={activeSubTab === "employee"}
            onClick={() => {
              if (companyIsComplete) setActiveSubTab("employee");
            }}
          >
            Employee
          </SubTabButton>
          <SubTabButton
            active={activeSubTab === "product"}
            onClick={() => {
              if (companyIsComplete) setActiveSubTab("product");
            }}
          >
            Product
          </SubTabButton>
        </div>
      </div>

      <div className="bg-card rounded-lg border p-5 shadow-sm">
        {activeSubTab === "company" && kind === "customer" ? (
          <CustomerCompanyForm
            value={customerCompany}
            onChange={setCustomerCompany}
            onSaved={() => setActiveSubTab("employee")}
          />
        ) : null}

        {activeSubTab === "company" && kind === "supplier" ? (
          <SupplierCompanyForm
            value={supplierCompany}
            onChange={setSupplierCompany}
            onSaved={() => setActiveSubTab("employee")}
          />
        ) : null}

        {activeSubTab === "employee" ? (
          <EmployeeEditor
            employees={employees}
            domainSuffix={domainSuffix}
            onEmployeesChange={setEmployees}
            onSave={saveRecord}
            isEditing={editingId !== null}
          />
        ) : null}

        {activeSubTab === "product" ? (
          <ProductWorkspacePanel
            mode="new"
            onModeChange={() => undefined}
            formVersion={formVersion}
            availableProductTypes={
              kind === "supplier" ? supplierCompany.productTypes : customerProductTypes
            }
            embedded
            ownerKind={kind}
            initialSupplierId={kind === "supplier" ? savedSupplierId : null}
            initialCustomerId={kind === "customer" ? savedCustomerId : null}
          />
        ) : null}
      </div>
      {isSaving ? (
        <div
          className="bg-background/75 fixed inset-0 z-50 grid place-items-center backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="bg-card flex items-center gap-3 rounded-lg border px-5 py-4 shadow-lg">
            <span className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
            <span className="text-sm font-semibold">Saving...</span>
          </div>
        </div>
      ) : null}
      <Dialog open={showProductNextStep} onOpenChange={setShowProductNextStep}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Add a product for this {kind}?</DialogTitle>
            <DialogDescription>
              The {kind} and employees are saved. You can add a product now or return to {kind}
              records.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowProductNextStep(false);
                setActiveSubTab("company");
                onModeChange("records");
              }}
            >
              Not now
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShowProductNextStep(false);
                setActiveSubTab("product");
              }}
            >
              Add product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ProductWorkspacePanel({
  mode,
  onModeChange,
  formVersion,
  availableProductTypes = supplierProductTypes,
  embedded = false,
  ownerKind = "supplier",
  initialSupplierId = null,
  initialCustomerId = null,
}: {
  mode: "new" | "records";
  onModeChange: (mode: "new" | "records") => void;
  formVersion: number;
  availableProductTypes?: readonly WorkspaceProductType[];
  embedded?: boolean;
  ownerKind?: ProductOwnerKind;
  initialSupplierId?: string | null;
  initialCustomerId?: string | null;
}) {
  const fileInputId = useId();
  const [supplierQuery, setSupplierQuery] = useState("");
  const [query, setQuery] = useState("");
  const [variantImageQuery, setVariantImageQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeFormVersion, setActiveFormVersion] = useState(formVersion);
  const [submitted, setSubmitted] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const [dummyInputCount, setDummyInputCount] = useState(0);
  const [parameterDummyInputCount, setParameterDummyInputCount] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const suppliers = useSuppliers();
  const customers = useCustomers();
  const products = useProducts();
  const upsertProduct = useUpsertProduct();

  const supplierOptions = suppliers.data ?? [];
  const initialProductType: WorkspaceProductType =
    ownerKind === "customer"
      ? (availableProductTypes.find(isCustomerProductType) ?? defaultCustomerProductType)
      : (normalizeSupplierProductTypes(availableProductTypes)[0] ?? defaultSupplierProductType);
  const [form, setForm] = useState<ProductFormState>(() => {
    const next = emptyProductForm(initialProductType, ownerKind);
    return {
      ...next,
      supplierId: initialSupplierId ?? "",
      customerId: initialCustomerId ?? "",
      projectId: "",
      projectName: "",
      activeVariantId: next.variants[0]?.id ?? null,
    };
  });
  const activeSupplierId = embedded ? (initialSupplierId ?? "") : form.supplierId;
  const activeCustomerId = embedded ? (initialCustomerId ?? "") : form.customerId;
  const selectedSupplier =
    supplierOptions.find((supplier) => supplier.id === activeSupplierId) ?? null;
  const normalizedAvailableProductTypes: WorkspaceProductType[] =
    ownerKind === "customer"
      ? availableProductTypes.filter(isCustomerProductType)
      : embedded
        ? normalizeSupplierProductTypes(availableProductTypes)
        : normalizeSupplierProductTypes(selectedSupplier?.company.productTypes ?? []);
  const selectableProductTypes: readonly WorkspaceProductType[] =
    normalizedAvailableProductTypes.length
      ? normalizedAvailableProductTypes
      : ownerKind === "customer"
        ? customerProductTypes
        : supplierProductTypes;
  const productParameterFields = getProductParameterTemplate(form.productType).fields;
  const activeVariant = getActiveVariant(form);
  const activeVariantErrors = submitted
    ? {
        image: activeVariant.image ? undefined : "Add at least one product image.",
        material: activeVariant.material.trim() ? undefined : "Material is required.",
        colorNotes: activeVariant.colorNotes.trim() ? undefined : "Color notes are required.",
        unitPrice: activeVariant.unitPrice.trim() ? undefined : "Unit price is required.",
      }
    : {};
  const parseResult = productSchema.safeParse(buildProductInput(form));
  const errors = submitted ? getZodFieldErrors(parseResult) : {};
  const visibleProducts = (products.data ?? []).filter(
    (product) =>
      product.ownerKind === ownerKind &&
      (!embedded ||
        (ownerKind === "supplier"
          ? product.supplierId === activeSupplierId
          : product.customerId === activeCustomerId)) &&
      getProductSearchText(product).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const visibleFormVariants = normalizeVariants(form.variants).filter((variant) => {
    const normalizedQuery = variantImageQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return true;
    return getProductFormVariantSearchText(form, variant)
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
  const visibleSupplierOptions = supplierOptions.filter((supplier) =>
    fuzzyMatches(
      `${supplier.company.companyName} ${supplier.company.emailDomainSuffix} ${supplier.company.productTypes
        .map((productType) => supplierProductTypeLabels[productType])
        .join(" ")}`,
      normalizeSearchValue(supplierQuery),
    ),
  );

  if (activeFormVersion !== formVersion) {
    setActiveFormVersion(formVersion);
    const next = emptyProductForm(initialProductType, ownerKind);
    setForm({
      ...next,
      supplierId: initialSupplierId ?? "",
      customerId: initialCustomerId ?? "",
      projectId: "",
      projectName: "",
      activeVariantId: next.variants[0]?.id ?? null,
    });
    setImageError(null);
    setIsImageDragOver(false);
    setEditingId(null);
    setSubmitted(false);
  }

  if (!selectableProductTypes.includes(form.productType)) {
    const next = emptyProductForm(initialProductType, ownerKind);
    setForm({
      ...next,
      supplierId: activeSupplierId,
      customerId: activeCustomerId,
      activeVariantId: next.variants[0]?.id ?? null,
    });
    setParameterDummyInputCount(0);
    setSubmitted(false);
  }

  async function setImagesFromFiles(fileList: FileList) {
    const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setImageError("Drop or paste an image file.");
      return;
    }

    try {
      setIsUploadingImage(true);
      const uploads = await Promise.all(
        imageFiles.map(async (file) => {
          const image = await uploadImage(file);
          return {
            id: crypto.randomUUID(),
            sortIndex: 0,
            material: "",
            colorNotes: "",
            parameters: getDefaultProductParameters(form.productType),
            unitPrice: "",
            priceUnit: getProductPriceUnit(form.productType),
            image: {
              name: file.name || "Uploaded image",
              url: image.url,
              storagePath: image.storagePath,
            } satisfies ProductImageState,
          } satisfies ProductVariantFormState;
        }),
      );

      setForm((current) => ({
        ...current,
        // A new form contains one blank variant so its fields can render. The
        // first image ingest replaces that placeholder instead of leaving an
        // empty tab 1 before the uploaded images.
        variants: normalizeVariants([
          ...(current.variants.length === 1 &&
          current.variants[0]?.image === null &&
          !current.variants[0].material.trim() &&
          !current.variants[0].colorNotes.trim() &&
          !current.variants[0].unitPrice.trim()
            ? []
            : current.variants),
          ...uploads.map((variant, index) => ({
            ...variant,
            sortIndex:
              (current.variants.length === 1 && current.variants[0]?.image === null
                ? 0
                : current.variants.length) + index,
          })),
        ]),
        activeVariantId: uploads[0]?.id ?? current.activeVariantId,
      }));
      setImageError(null);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Unable to read image file.");
    } finally {
      setIsUploadingImage(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (event.clipboardData.files.length === 0) return;
    event.preventDefault();
    void setImagesFromFiles(event.clipboardData.files);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsImageDragOver(false);
    void setImagesFromFiles(event.dataTransfer.files);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) setIsImageDragOver(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (event.dataTransfer.types.includes("Files")) setIsImageDragOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsImageDragOver(false);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files) return;
    void setImagesFromFiles(event.target.files);
  }

  function updateProductType(value: string | null) {
    if (!value) return;
    const productType: WorkspaceProductType =
      ownerKind === "customer"
        ? normalizeCustomerProductType(value)
        : normalizeSupplierProductType(value);
    setForm((current) => ({
      ...current,
      productType,
      variants: normalizeVariants(
        current.variants.map((variant) => ({
          ...variant,
          parameters: getDefaultProductParameters(productType),
          priceUnit: getProductPriceUnit(productType),
        })),
      ),
    }));
    setParameterDummyInputCount(0);
  }

  function updateActiveVariant(
    update: (variant: ProductVariantFormState) => ProductVariantFormState,
  ) {
    setForm((current) => setVariantField(current, activeVariant.id, update));
  }

  function fillDummyProductParameters() {
    const label = getWorkspaceProductTypeLabel(form.productType);
    setForm((current) => ({
      ...current,
      subject: `${label} internal ${parameterDummyInputCount + 1}`,
      detail: `Generic ${label.toLocaleLowerCase()} specification. Confirm construction, tolerance, finishing, packing, and production approval sample before bulk order.`,
      variants: normalizeVariants(
        current.variants.map((variant, index) => {
          const variantDummy = getProductParameterDummySet(
            current.productType,
            parameterDummyInputCount + index,
          );
          return {
            ...variant,
            material: getProductMaterialSummary(variantDummy.parameters),
            colorNotes: getProductColorNotes(variantDummy.parameters),
            parameters: variantDummy.parameters,
            unitPrice: variantDummy.unitPrice,
            priceUnit: getProductPriceUnit(current.productType),
          };
        }),
      ),
    }));
    setParameterDummyInputCount((count) => count + 1);
    setSubmitted(false);
  }

  async function saveProduct() {
    setSubmitted(true);
    const result = productSchema.safeParse(buildProductInput(form));
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path.length ? ` (${issue.path.join(".")})` : "";
      toast.error(`${issue?.message ?? "Please complete the product form."}${field}`);
      return;
    }

    try {
      await upsertProduct.mutateAsync({ id: editingId, input: result.data });
      toast.success(ownerKind === "customer" ? "Customer product image saved" : "Product saved");
      setEditingId(null);
      onModeChange("records");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save product");
    }
  }

  function editProduct(product: ProductRecord) {
    const productType: WorkspaceProductType =
      product.ownerKind === "customer"
        ? normalizeCustomerProductType(product.productType)
        : normalizeSupplierProductType(product.productType);
    const variants = normalizeVariants(
      product.variants.map((variant) => ({
        id: variant.id,
        sortIndex: variant.sortIndex,
        material: variant.material,
        colorNotes: variant.colorNotes,
        parameters: {
          ...getDefaultProductParameters(productType),
          ...normalizeProductDimensions(variant.parameters),
        },
        unitPrice: variant.unitPrice,
        priceUnit: variant.priceUnit || getProductPriceUnit(productType),
        image: variant.image,
      })),
    );
    setForm({
      ownerKind: product.ownerKind,
      supplierId: product.supplierId ?? "",
      customerId: product.customerId ?? "",
      projectId: product.projectId ?? "",
      projectName: "",
      productType,
      subject: product.subject,
      detail: product.detail,
      variants,
      activeVariantId: variants[0]?.id ?? null,
    });
    setEditingId(product.id);
    setSubmitted(false);
    setImageError(null);
  }

  function removeVariant(variantId: string) {
    setForm((current) => {
      if (current.variants.length === 1) return current;
      const variants = normalizeVariants(
        current.variants.filter((variant) => variant.id !== variantId),
      );
      return {
        ...current,
        variants,
        activeVariantId:
          current.activeVariantId === variantId
            ? (variants[0]?.id ?? null)
            : current.activeVariantId,
      };
    });
  }

  if (mode === "records" && editingId === null) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-5">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Directory
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Product records</h2>
        </div>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          <div className="border-b p-4">
            <div className="relative max-w-md">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
                placeholder="Search product records"
                aria-label="Search product records"
              />
            </div>
          </div>
          {products.isLoading ? (
            <p className="text-muted-foreground p-10 text-center text-sm">Loading products...</p>
          ) : products.isError ? (
            <p className="text-destructive p-10 text-center text-sm">
              Failed to load products:{" "}
              {products.error instanceof Error ? products.error.message : "unknown error"}
            </p>
          ) : visibleProducts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-muted-foreground text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3">
                      {ownerKind === "customer" ? "Customer" : "Supplier"}
                    </th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Variants</th>
                    <th className="px-4 py-3">Unit price</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleProducts.map((product) => {
                    const primaryVariant = getProductPrimaryVariant(product);
                    const ownerName =
                      product.ownerKind === "customer"
                        ? ((customers.data ?? []).find(
                            (customer) => customer.id === product.customerId,
                          )?.company.companyName ?? "Unknown customer")
                        : (supplierOptions.find((supplier) => supplier.id === product.supplierId)
                            ?.company.companyName ?? "Unknown supplier");

                    return (
                      <tr key={product.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">{ownerName}</td>
                        <td className="text-muted-foreground px-4 py-3">
                          {getWorkspaceProductTypeLabel(product.productType)}
                        </td>
                        <td className="px-4 py-3 font-medium">{product.subject}</td>
                        <td className="px-4 py-3">{product.variants.length}</td>
                        <td className="px-4 py-3">
                          {primaryVariant?.unitPrice ?? "—"}{" "}
                          <span className="text-muted-foreground">
                            {primaryVariant?.priceUnit ?? ""}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <ProductImageBrowserDialog
                              products={[product]}
                              title={product.subject}
                              trigger={
                                <Button type="button" variant="ghost" size="sm">
                                  View
                                </Button>
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => editProduct(product)}
                            >
                              <Pencil />
                              Edit
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground p-10 text-center text-sm">
              {query ? "No matching products." : "No saved products yet."}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={cn("grid w-full gap-5", embedded ? "" : "mx-auto max-w-6xl")}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {embedded
              ? `${ownerKind === "customer" ? "Customer" : "Supplier"} product form`
              : "Standard userform"}
          </p>
          {!embedded ? (
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Product (+)</h2>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setForm({
                ...getDummyProduct(dummyInputCount, selectableProductTypes, ownerKind),
                supplierId: activeSupplierId,
                customerId: activeCustomerId,
              });
              setDummyInputCount((count) => count + 1);
              setParameterDummyInputCount(0);
              setImageError(null);
              setSubmitted(false);
            }}
          >
            <Wand2 />
            Dummy input
          </Button>
          <Button
            type="button"
            onClick={saveProduct}
            disabled={upsertProduct.isPending || isUploadingImage}
          >
            <Save />
            {editingId ? "Update product" : "Save product"}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
        <div
          className={cn("rounded-lg border p-5 shadow-sm", embedded ? "bg-background" : "bg-card")}
        >
          <div className="mb-5 flex flex-wrap items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={fillDummyProductParameters}>
              <Wand2 />
              Dummy parameters
            </Button>
          </div>
          <div className="grid gap-4">
            {ownerKind === "customer" ? (
              <FormField label="Customer project" error={errors.projectId}>
                <Input
                  value={form.projectName}
                  onChange={(event) => setForm({ ...form, projectName: event.target.value, projectId: "" })}
                  placeholder="Project name (optional)"
                />
              </FormField>
            ) : null}
            {!embedded && ownerKind === "supplier" ? (
              <FormField label="Supplier" error={errors.supplierId}>
                <div className="grid gap-2">
                  <Input
                    value={supplierQuery}
                    onChange={(event) => setSupplierQuery(event.target.value)}
                    placeholder="Search supplier"
                    aria-label="Search suppliers"
                  />
                  <div className="bg-background max-h-52 overflow-y-auto rounded-lg border">
                    {visibleSupplierOptions.map((supplier) => {
                      const checked = form.supplierId === supplier.id;
                      return (
                        <button
                          key={supplier.id}
                          type="button"
                          className={cn(
                            "hover:bg-muted/40 flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm",
                            checked ? "bg-muted/50" : "",
                          )}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              supplierId: supplier.id,
                            }))
                          }
                        >
                          <span>
                            <span className="block font-medium">
                              {supplier.company.companyName}
                            </span>
                            <span className="text-muted-foreground block text-xs">
                              @{supplier.company.emailDomainSuffix}
                            </span>
                          </span>
                          {checked ? <Badge>Selected</Badge> : null}
                        </button>
                      );
                    })}
                    {visibleSupplierOptions.length === 0 ? (
                      <p className="text-muted-foreground px-3 py-4 text-sm">
                        No matching suppliers.
                      </p>
                    ) : null}
                  </div>
                </div>
              </FormField>
            ) : null}
            <FormField label="Product type" error={errors.productType}>
              <Select value={form.productType} onValueChange={updateProductType}>
                <SelectTrigger className="w-full">
                  <SelectValue>{getWorkspaceProductTypeLabel(form.productType)}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" className="max-h-80">
                  {ownerKind === "customer" ? (
                    customerProductTypeGroups.map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.types
                          .filter((productType) => selectableProductTypes.includes(productType))
                          .map((productType) => (
                            <SelectItem key={productType} value={productType}>
                              {getWorkspaceProductTypeLabel(productType)}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    ))
                  ) : (
                    <SelectGroup>
                      <SelectLabel>Product type</SelectLabel>
                      {selectableProductTypes.map((productType) => (
                        <SelectItem key={productType} value={productType}>
                          {getWorkspaceProductTypeLabel(productType)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Internal code" error={errors.subject}>
              <Input
                value={form.subject}
                onChange={(event) => setForm({ ...form, subject: event.target.value })}
                placeholder="Internal product code"
              />
            </FormField>
            <FormField label="Product details" error={errors.detail}>
              <Textarea
                value={form.detail}
                onChange={(event) => setForm({ ...form, detail: event.target.value })}
                className="min-h-32"
                placeholder="Describe product specs, construction, packaging, and quality notes."
              />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Material" error={activeVariantErrors.material}>
                <Input
                  value={activeVariant.material}
                  onChange={(event) =>
                    updateActiveVariant((variant) => ({ ...variant, material: event.target.value }))
                  }
                  placeholder="Woven polyester, cotton, alloy..."
                />
              </FormField>
              <FormField label="Color notes" error={activeVariantErrors.colorNotes}>
                <Input
                  value={activeVariant.colorNotes}
                  onChange={(event) =>
                    updateActiveVariant((variant) => ({
                      ...variant,
                      colorNotes: event.target.value,
                    }))
                  }
                  placeholder="Pantone, finish, contrast..."
                />
              </FormField>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {productParameterFields.map((field) => (
                <FormField key={field.key} label={field.label}>
                  <Input
                    value={activeVariant.parameters[field.key] ?? ""}
                    onChange={(event) =>
                      updateActiveVariant((variant) => ({
                        ...variant,
                        parameters: {
                          ...variant.parameters,
                          [field.key]: event.target.value,
                        },
                      }))
                    }
                    placeholder={field.placeholder}
                  />
                </FormField>
              ))}
            </div>
            <FormField label="Unit price" error={activeVariantErrors.unitPrice}>
              <div className="flex">
                <Input
                  value={activeVariant.unitPrice}
                  onChange={(event) =>
                    updateActiveVariant((variant) => ({
                      ...variant,
                      unitPrice: event.target.value,
                    }))
                  }
                  className="rounded-r-none"
                  inputMode="decimal"
                  placeholder="0.075"
                />
                <span className="border-input bg-muted text-muted-foreground flex h-8 shrink-0 items-center rounded-r-lg border border-l-0 px-2 text-sm">
                  {activeVariant.priceUnit}
                </span>
              </div>
            </FormField>
          </div>
        </div>

        <div
          className={cn("rounded-lg border p-5 shadow-sm", embedded ? "bg-background" : "bg-card")}
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <Badge variant={activeVariant.image ? "default" : "outline"}>
              {form.variants.length} variant{form.variants.length === 1 ? "" : "s"}
            </Badge>
          </div>

          <div className="mb-4 grid gap-3">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={variantImageQuery}
                onChange={(event) => setVariantImageQuery(event.target.value)}
                className="pl-9"
                placeholder="Search uploaded images by code, details, material..."
                aria-label="Search uploaded product images"
              />
            </div>
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
              {visibleFormVariants.map((variant, index) => (
                <button
                  key={variant.id}
                  type="button"
                  className={cn(
                    "bg-muted focus-visible:ring-ring overflow-hidden rounded-md border text-left outline-none focus-visible:ring-2",
                    activeVariant.id === variant.id && "ring-primary ring-2",
                  )}
                  onClick={() =>
                    setForm((current) => ({ ...current, activeVariantId: variant.id }))
                  }
                >
                  {variant.image ? (
                    <>
                      <span className="bg-background flex aspect-square w-full items-center justify-center overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={variant.image.url}
                          alt={`Uploaded variant ${index + 1}`}
                          className="h-full w-full object-contain p-2"
                        />
                      </span>
                      <span className="block truncate px-2 py-1 text-[0.68rem]">
                        {variant.image.name}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground grid aspect-square place-items-center text-xs">
                      No image
                    </span>
                  )}
                </button>
              ))}
              {visibleFormVariants.length === 0 ? (
                <p className="text-muted-foreground col-span-3 py-6 text-center text-sm">
                  No uploaded images match.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mb-4 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-2">
              {normalizeVariants(form.variants).map((variant, index) => {
                const isActive = variant.id === activeVariant.id;
                const hasError =
                  submitted &&
                  (!variant.image || !variant.material.trim() || !variant.colorNotes.trim());

                return (
                  <button
                    key={variant.id}
                    type="button"
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm font-medium",
                      isActive ? "bg-foreground text-background" : "bg-background",
                      hasError ? "border-destructive" : "",
                    )}
                    onClick={() =>
                      setForm((current) => ({ ...current, activeVariantId: variant.id }))
                    }
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            tabIndex={0}
            aria-label="Product image upload area"
            onPaste={handlePaste}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-input focus-visible:ring-ring/50 relative grid min-h-72 place-items-center rounded-lg border border-dashed p-4 text-center transition-colors outline-none focus-visible:ring-3",
              isImageDragOver && "border-primary bg-primary/5 ring-primary/20 ring-2",
            )}
          >
            {isImageDragOver ? (
              <div className="bg-background/90 text-primary pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-md border border-dashed border-current text-sm font-semibold shadow-sm backdrop-blur-sm">
                Drop images to add variants
              </div>
            ) : null}
            {activeVariant.image ? (
              <div className="grid w-full justify-items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeVariant.image.url}
                  alt="Product preview"
                  className="max-h-72 max-w-full rounded-md object-contain"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground truncate text-xs">
                    {activeVariant.image.name}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove product image"
                    onClick={() =>
                      updateActiveVariant((variant) => ({
                        ...variant,
                        image: null,
                      }))
                    }
                  >
                    <X />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid justify-items-center gap-3">
                <span className="bg-muted flex size-12 items-center justify-center rounded-lg">
                  <ImagePlus className="text-muted-foreground size-6" />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    {isUploadingImage ? "Uploading images..." : "Paste or drop one or more images"}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">
                    Ctrl+V from clipboard, drag and drop, or choose files. Each image becomes its
                    own numbered variant tab.
                  </p>
                </div>
                <input
                  id={fileInputId}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={handleFileChange}
                />
                <Button type="button" variant="outline" render={<Label htmlFor={fileInputId} />}>
                  <FolderOpen />
                  Choose images
                </Button>
              </div>
            )}
          </div>

          {imageError ? (
            <p className="text-destructive mt-3 text-xs leading-5">{imageError}</p>
          ) : null}
          {activeVariantErrors.image ? (
            <p className="text-destructive mt-3 text-xs leading-5">{activeVariantErrors.image}</p>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={form.variants.length <= 1}
              onClick={() => removeVariant(activeVariant.id)}
            >
              <Trash2 />
              Remove current variant
            </Button>
          </div>
        </div>
      </div>
      {isUploadingImage || upsertProduct.isPending ? (
        <div
          className="bg-background/75 fixed inset-0 z-50 grid place-items-center backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="bg-card flex items-center gap-3 rounded-lg border px-5 py-4 shadow-lg">
            <span className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
            <span className="text-sm font-semibold">
              {isUploadingImage ? "uploading.." : "Saving..."}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function EntityWorkspacePanel({
  kind,
  mode = "new",
  onModeChange = () => undefined,
  formVersion = 0,
}: {
  kind: EntityKind;
  mode?: "new" | "records";
  onModeChange?: (mode: "new" | "records") => void;
  formVersion?: number;
}) {
  if (kind === "product")
    return (
      <ProductWorkspacePanel mode={mode} onModeChange={onModeChange} formVersion={formVersion} />
    );
  return (
    <PartyWorkspacePanel
      kind={kind}
      mode={mode}
      onModeChange={onModeChange}
      formVersion={formVersion}
    />
  );
}
