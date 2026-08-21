import { afterEach, describe, expect, it, vi } from "vitest";
import { listProductMedia, uploadProductImage } from "../../src/admin/media.js";

afterEach(() => vi.restoreAllMocks());

describe("Commerce product media adapter", () => {
  it("uploads an image through the authenticated EmDash media API", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { item: { id: "media-1", storageKey: "products/tea.jpg", mimeType: "image/jpeg", url: "/_emdash/api/media/file/products/tea.jpg" } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    const image = await uploadProductImage(new File(["image"], "tea.jpg", { type: "image/jpeg" }), "Tea product");

    expect(image).toEqual({ mediaId: "media-1", url: "/_emdash/api/media/file/products/tea.jpg", alt: "Tea product" });
    expect(fetcher).toHaveBeenCalledWith("/_emdash/api/media", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });

  it("lists image media for the product picker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { items: [{ id: "media-1", filename: "tea.jpg", url: "/media/tea.jpg", alt: "Tea" }] },
    }), { status: 200 })));

    await expect(listProductMedia()).resolves.toEqual([{ id: "media-1", filename: "tea.jpg", url: "/media/tea.jpg", alt: "Tea" }]);
  });

  it("surfaces rejected uploads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: { message: "Upload too large" } }), { status: 413 })));

    await expect(uploadProductImage(new File(["image"], "tea.jpg", { type: "image/jpeg" }), "Tea")).rejects.toThrow("Upload too large");
  });
});
