import { beforeEach, describe, expect, it } from "vitest";

import { localWorkspaceRecordStore } from "./localWorkspaceRecordStore";

beforeEach(async () => {
  localStorage.clear();

  if ("indexedDB" in window) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("ica:workspace-record-store");
      request.onerror = () => resolve();
      request.onsuccess = () => resolve();
      request.onblocked = () => resolve();
    });
  }
});

describe("localWorkspaceRecordStore", () => {
  it("creates and updates customer records with employees", async () => {
    const created = await localWorkspaceRecordStore.upsertCustomer(null, {
      company: {
        companyName: "Northstar",
        emailDomainSuffix: "northstar.com",
        type: "Brand owner",
      },
      employees: [
        {
          id: "employee-1",
          userName: "Mia Chen",
          emailPrefix: "mia",
          title: "Manager",
          tel: "+1 555 0001",
        },
      ],
    });

    const updated = await localWorkspaceRecordStore.upsertCustomer(created.id, {
      company: {
        companyName: "Northstar Group",
        emailDomainSuffix: "northstar.com",
        type: "Brand owner",
      },
      employees: [
        {
          id: "employee-1",
          userName: "Mia Chen",
          emailPrefix: "mia",
          title: "Director",
          tel: "+1 555 0001",
        },
      ],
    });

    const records = await localWorkspaceRecordStore.listCustomers();
    expect(records).toHaveLength(1);
    expect(updated.id).toBe(created.id);
    expect(records[0].company.companyName).toBe("Northstar Group");
    expect(records[0].employees[0].title).toBe("Director");
  });

  it("creates supplier records with structured product types", async () => {
    await localWorkspaceRecordStore.upsertSupplier(null, {
      company: {
        companyName: "Bright Trim",
        emailDomainSuffix: "brighttrim.com",
        productTypes: ["woven-label", "hang-tag"],
      },
      employees: [
        {
          id: "employee-1",
          userName: "Aaron Lee",
          emailPrefix: "aaron",
          title: "Coordinator",
          tel: "+1 555 0002",
        },
      ],
    });

    const records = await localWorkspaceRecordStore.listSuppliers();
    expect(records[0].company.productTypes).toEqual(["woven-label", "hang-tag"]);
  });

  it("normalizes legacy supplier product types from local storage", async () => {
    localStorage.setItem(
      "ica:workspace:suppliers",
      JSON.stringify([
        {
          id: "supplier-1",
          company: {
            companyName: "Legacy Supplier",
            emailDomainSuffix: "legacy.example",
            productTypes: ["label", "zipper"],
          },
          employees: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );

    const records = await localWorkspaceRecordStore.listSuppliers();
    expect(records[0].company.productTypes).toEqual(["woven-label", "metal"]);
  });

  it("defaults new suppliers to not shared, preserves it on edit, and toggles it", async () => {
    const created = await localWorkspaceRecordStore.upsertSupplier(null, {
      company: {
        companyName: "Toggle Trim",
        emailDomainSuffix: "toggletrim.com",
        productTypes: ["button"],
      },
      employees: [
        {
          id: "employee-1",
          userName: "Pat",
          emailPrefix: "pat",
          title: "Sales",
          tel: "+1 555 0003",
        },
      ],
    });
    expect(created.isShared).toBe(false);

    // Editing the supplier keeps the default OFF.
    const edited = await localWorkspaceRecordStore.upsertSupplier(created.id, {
      company: {
        companyName: "Toggle Trim Ltd",
        emailDomainSuffix: "toggletrim.com",
        productTypes: ["button"],
      },
      employees: created.employees,
    });
    expect(edited.isShared).toBe(false);

    // Toggle ON, then confirm the list reflects it.
    await localWorkspaceRecordStore.setSupplierShared(created.id, true);
    let records = await localWorkspaceRecordStore.listSuppliers();
    expect(records.find((record) => record.id === created.id)?.isShared).toBe(true);

    // Editing again after sharing preserves the ON state.
    await localWorkspaceRecordStore.upsertSupplier(created.id, {
      company: {
        companyName: "Toggle Trim Ltd",
        emailDomainSuffix: "toggletrim.com",
        productTypes: ["button"],
      },
      employees: created.employees,
    });
    records = await localWorkspaceRecordStore.listSuppliers();
    expect(records.find((record) => record.id === created.id)?.isShared).toBe(true);

    // Toggle OFF.
    await localWorkspaceRecordStore.setSupplierShared(created.id, false);
    records = await localWorkspaceRecordStore.listSuppliers();
    expect(records.find((record) => record.id === created.id)?.isShared).toBe(false);
  });

  it("creates and updates product records with variants", async () => {
    const created = await localWorkspaceRecordStore.upsertProduct(null, {
      supplierId: "supplier-1",
      productType: "woven-label",
      subject: "Woven label",
      detail: "Main neck label",
      variants: [
        {
          id: "variant-1",
          sortIndex: 0,
          material: "Polyester",
          colorNotes: "Black and white",
          parameters: {
            size: "45 x 20 mm",
            fold: "Center fold",
          },
          unitPrice: "0.032",
          priceUnit: "per pc",
          image: {
            name: "label.webp",
            url: "https://example.com/label.webp",
            storagePath: "user/label.webp",
          },
        },
      ],
    });

    await localWorkspaceRecordStore.upsertProduct(created.id, {
      supplierId: "supplier-1",
      productType: "hang-tag",
      subject: "Woven label set",
      detail: "Main neck label and care label",
      variants: [
        {
          id: "variant-2",
          sortIndex: 0,
          material: "Paper",
          colorNotes: "Black and white",
          parameters: {
            size: "60 x 90 mm",
            finish: "Matte lamination",
          },
          unitPrice: "0.075",
          priceUnit: "per pc",
          image: {
            name: "tag.webp",
            url: "https://example.com/tag.webp",
            storagePath: "user/tag.webp",
          },
        },
        {
          id: "variant-3",
          sortIndex: 1,
          material: "Paper",
          colorNotes: "Cream",
          parameters: {
            size: "40 x 70 mm",
          },
          unitPrice: "0.062",
          priceUnit: "per pc",
          image: {
            name: "tag-2.webp",
            url: "https://example.com/tag-2.webp",
            storagePath: "user/tag-2.webp",
          },
        },
      ],
    });

    const records = await localWorkspaceRecordStore.listProducts();
    expect(records).toHaveLength(1);
    expect(records[0].productType).toBe("hang-tag");
    expect(records[0].subject).toBe("Woven label set");
    expect(records[0].supplierId).toBe("supplier-1");
    expect(records[0].variants).toHaveLength(2);
    expect(records[0].variants[0].unitPrice).toBe("0.075");
    expect(records[0].variants[1].image?.name).toBe("tag-2.webp");
  });

  it("normalizes legacy product records from local storage into indexeddb variants", async () => {
    localStorage.setItem(
      "ica:workspace:products",
      JSON.stringify([
        {
          id: "product-1",
          subject: "Old trim",
          detail: "Legacy product",
          material: "Polyester",
          colorNotes: "Black",
          parameters: {
            size: "45 x 20 mm",
            ignored: 123,
          },
          image: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );

    const records = await localWorkspaceRecordStore.listProducts();
    expect(records[0].productType).toBe("woven-label");
    expect(records[0].variants).toHaveLength(1);
    expect(records[0].variants[0].parameters).toEqual({ size: "45 x 20 mm" });
    expect(records[0].variants[0].unitPrice).toBe("0");
    expect(records[0].variants[0].priceUnit).toBe("per pc");
    if ("indexedDB" in window) {
      expect(localStorage.getItem("ica:workspace:products")).toBeNull();
    } else {
      expect(localStorage.getItem("ica:workspace:products")).toContain("product-1");
    }
  });

  it("persists customer products without a customer project field", async () => {
    await localWorkspaceRecordStore.upsertProduct(null, {
      ownerKind: "customer",
      customerId: "customer-1",
      productType: "shirt",
      subject: "SH-001",
      detail: "Cotton shirt",
      variants: [
        {
          id: "variant-1",
          sortIndex: 0,
          material: "Cotton",
          colorNotes: "White",
          parameters: { sizeRange: "XS-XL" },
          unitPrice: "11.5",
          priceUnit: "per pc",
          image: {
            name: "shirt.webp",
            url: "https://example.com/shirt.webp",
            storagePath: null,
          },
        },
      ],
    });

    const products = await localWorkspaceRecordStore.listProducts();
    expect(products[0]).toMatchObject({
      ownerKind: "customer",
      customerId: "customer-1",
      projectId: null,
      supplierId: null,
      productType: "shirt",
    });
  });

  it("persists ordered settings and generic node definitions", async () => {
    const currencies = await localWorkspaceRecordStore.replaceWorkspaceOptions("currency", [
      {
        id: "currency:CNY",
        kind: "currency",
        code: "CNY",
        name: "Chinese Yuan",
        symbol: "CN¥",
        sortIndex: 4,
      },
      {
        id: "currency:USD",
        kind: "currency",
        code: "USD",
        name: "US Dollar",
        symbol: "$",
        sortIndex: 8,
      },
    ]);
    expect(currencies.map((currency) => currency.sortIndex)).toEqual([0, 1]);

    const first = await localWorkspaceRecordStore.upsertGenericNodeDefinition(null, {
      name: "Front view",
      images: [
        {
          id: "front-1",
          name: "front.webp",
          url: "data:image/webp;base64,front",
          storagePath: null,
        },
        {
          id: "front-2",
          name: "front-detail.webp",
          url: "data:image/webp;base64,front-detail",
          storagePath: null,
        },
      ],
    });
    const second = await localWorkspaceRecordStore.upsertGenericNodeDefinition(null, {
      name: "Back view",
      images: [
        {
          id: "back-1",
          name: "back.webp",
          url: "data:image/webp;base64,back",
          storagePath: null,
        },
      ],
    });
    const reordered = await localWorkspaceRecordStore.reorderGenericNodeDefinitions([
      second.id,
      first.id,
    ]);
    expect(reordered.map((definition) => definition.name)).toEqual(["Back view", "Front view"]);
    expect(reordered.find((definition) => definition.id === first.id)?.images).toHaveLength(2);
  });
});
