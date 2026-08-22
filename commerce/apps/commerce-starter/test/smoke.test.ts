import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

async function read(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

describe("Commerce starter", () => {
  it("registers Commerce Core and CHIP in trusted EmDash plugins", async () => {
    const source = await read("astro.config.mjs");

    expect(source).toContain("commercePlugin");
    expect(source).toContain("chipForEmdash");
    expect(source).toContain("plugins:");
  });

  it("wires the CHIP bridge from deployment-only environment variables", async () => {
    const source = await read("astro.config.mjs");

    expect(source).toContain("bridgeSecrets");
    expect(source).toContain("paymentBridges");
    expect(source).toContain("COMMERCE_BRIDGE_SECRET");
    expect(source).toContain("PUBLIC_SITE_URL");
    expect(source).toContain("required for production builds");

  });

  it("declares customer-owned Cloudflare bindings and scheduled maintenance", async () => {
    const source = await read("wrangler.jsonc");

    expect(source).toContain('"DB"');
    expect(source).toContain('"MEDIA"');
    expect(source).toContain('"crons"');
    expect(source).not.toMatch(/secret|token|api[_-]?key/i);
  });

  it("ships the required storefront pages and checkout entry points", async () => {
    const pages = await Promise.all([
      read("src/pages/shop/index.astro"),
      read("src/pages/shop/[slug].astro"),
      read("src/pages/cart.astro"),
      read("src/pages/checkout.astro"),
      read("src/pages/checkout/result.astro"),
      read("src/pages/orders/[id].astro"),
      read("src/pages/about.astro"),
      read("src/pages/shipping-returns.astro"),
      read("src/pages/privacy.astro"),
      read("src/pages/terms.astro"),
      read("src/pages/contact.astro"),
    ]);
    expect(pages.join("\n")).toContain("paymentProvider");
  });

  it("builds Commerce Core before bundling the Worker", async () => {
    const source = await read("package.json");
    expect(source).toContain("\"pnpm --filter @emdash-commerce/core build && astro build\"");
    expect(source).toContain("\"deploy\": \"pnpm run build && wrangler deploy\"");
  });

  it("renders marketing content from EmDash pages", async () => {
    const [home, route, seed] = await Promise.all([
      read("src/pages/index.astro"),
      read("src/components/CmsPageRoute.astro"),
      read("seed/seed.json"),
    ]);
    expect(home).toContain("loadCmsPage");
    expect(home).toContain("CmsPageContent");
    expect(route).toContain("loadCmsPage");
    expect(route).toContain("Astro.cache.set");
    expect(seed).toContain("\"home\"");
    expect(seed).toContain("\"shipping-returns\"");
  });
});
