import { describe, expect, it } from "vitest";
import {
  isPublishedProduct,
  isPublishedVariant,
  validateInventoryInput,
  validateProductInput,
  validateVariantInput,
} from "../../src/domain/products.js";

describe("Commerce product contracts", () => {
  it("accepts a valid simple product", () => {
    expect(validateProductInput({
      name: "Tea",
      slug: "tea",
      description: "Loose leaf tea",
      status: "draft",
      sku: "TEA-001",
      priceMinor: 1200,
      currency: "MYR",
      images: [],
      hasVariants: false,
    })).toMatchObject({
      name: "Tea",
      slug: "tea",
      priceMinor: 1200,
      currency: "MYR",
      images: [],
    });
  });

  it("accepts a variant with its owning product id", () => {
    expect(validateVariantInput({
      name: "Large",
      sku: "TEA-L",
      status: "published",
      priceMinor: 1500,
      currency: "MYR",
      options: { size: "Large" },
    }, "product-1")).toMatchObject({
      productId: "product-1",
      name: "Large",
      options: { size: "Large" },
    });
  });

  it("rejects unsafe prices and invalid currencies", () => {
    expect(() => validateProductInput({
      name: "Tea",
      slug: "tea",
      description: "",
      status: "draft",
      priceMinor: 12.5,
      currency: "myr",
      images: [],
      hasVariants: false,
    })).toThrow(/priceMinor|currency/);
  });

  it("rejects lower-case currency codes", () => {
    expect(() => validateProductInput({
      name: "Tea",
      slug: "tea",
      description: "",
      status: "draft",
      priceMinor: 1200,
      currency: "myr",
      images: [],
      hasVariants: false,
    })).toThrow(/currency/);
  });

  it("defaults missing images for legacy product records", () => {
    expect(validateProductInput({
      name: "Tea",
      slug: "tea",
      description: "",
      status: "draft",
      priceMinor: 1200,
      currency: "MYR",
      hasVariants: false,
    })).toMatchObject({ images: [] });
  });

  it("rejects invalid slugs and statuses", () => {
    expect(() => validateProductInput({
      name: "Tea",
      slug: "Tea With Spaces",
      description: "",
      status: "live",
      priceMinor: 1200,
      currency: "MYR",
      images: [],
      hasVariants: false,
    })).toThrow(/slug|status/);
  });

  it("rejects negative inventory", () => {
    expect(() => validateInventoryInput({
      sku: "TEA-001",
      status: "active",
      available: -1,
      reserved: 0,
    }, "product-1")).toThrow(/available/);
  });

  it("recognizes only published products and variants", () => {
    expect(isPublishedProduct({ status: "published" })).toBe(true);
    expect(isPublishedProduct({ status: "draft" })).toBe(false);
    expect(isPublishedVariant({ status: "published", productId: "p-1" })).toBe(true);
    expect(isPublishedVariant({ status: "archived", productId: "p-1" })).toBe(false);
  });
});
