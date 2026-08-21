import { describe, expect, it } from "vitest";
import { createEmptyProductDraft, serializeProductDraft } from "../../src/admin/product-form.js";

describe("Commerce product editor serialization", () => {
  it("creates a draft with one simple product form", () => {
    const draft = createEmptyProductDraft();
    const payload = serializeProductDraft({
      ...draft,
      name: "Tea",
      slug: "tea",
      description: "Loose leaf tea",
      priceMinor: "12.00",
      currency: "MYR",
      sku: "TEA-001",
    });

    expect(payload).toMatchObject({
      product: {
        name: "Tea",
        slug: "tea",
        priceMinor: 1200,
        currency: "MYR",
        hasVariants: false,
      },
      variants: [],
      inventory: [],
    });
  });

  it("serializes variant options and inventory counts", () => {
    const draft = createEmptyProductDraft();
    const payload = serializeProductDraft({
      ...draft,
      name: "Tea",
      slug: "tea",
      priceMinor: "",
      currency: "MYR",
      hasVariants: true,
      variants: [{ id: "v-1", name: "Large", sku: "TEA-L", status: "draft", priceMinor: "15.00", currency: "MYR", optionsText: "size=Large" }],
      inventory: [{ id: "i-1", variantId: "v-1", sku: "TEA-L", status: "active", available: "10", reserved: "2" }],
    });

    expect(payload).toMatchObject({
      variants: [{ id: "v-1", options: { size: "Large" }, priceMinor: 1500 }],
      inventory: [{ id: "i-1", variantId: "v-1", available: 10, reserved: 2 }],
    });
  });

  it("rejects malformed money and option lines", () => {
    const draft = createEmptyProductDraft();
    expect(() => serializeProductDraft({ ...draft, name: "Tea", slug: "tea", currency: "MYR", priceMinor: "12.345" })).toThrow(/price/);
    expect(() => serializeProductDraft({ ...draft, name: "Tea", slug: "tea", currency: "MYR", priceMinor: "12.00", variants: [{ id: "v", name: "Large", sku: "L", status: "draft", priceMinor: "15.00", currency: "MYR", optionsText: "broken" }] })).toThrow(/option/);
  });
});
