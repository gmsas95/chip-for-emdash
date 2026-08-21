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
});
