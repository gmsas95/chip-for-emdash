import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { commercePlugin } from "@emdash-commerce/core";
import chipForEmdash from "@chip-in-asia/plugin-chip-for-emdash";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

const isProduction = process.env.NODE_ENV === "production";
const publicSiteUrl = process.env.PUBLIC_SITE_URL ?? (isProduction ? "" : "http://localhost:4321");
const bridgeSecret = process.env.COMMERCE_BRIDGE_SECRET ?? "";

if (isProduction && (!publicSiteUrl || !bridgeSecret)) {
  throw new Error("PUBLIC_SITE_URL and COMMERCE_BRIDGE_SECRET are required for production builds");
}

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  integrations: [
    react(),
    emdash({
      database: d1({ binding: "DB", session: "auto" }),
      storage: r2({ binding: "MEDIA" }),
      plugins: [
        commercePlugin({
          bridgeSecrets: {
            chip: bridgeSecret,
          },
          paymentBridges: {
            chip: {
              pluginId: "chip-for-emdash",
              basePath: `${publicSiteUrl}/_emdash/api/plugins/chip-for-emdash/commerce/payment/create`,
              eventPath: `${publicSiteUrl}/_emdash/api/plugins/emdash-commerce/bridge/events`,
              capabilities: ["payment.create", "payment.status", "payment.refund"],
              sharedSecret: bridgeSecret,
            },
          },
        }),
        chipForEmdash,
      ],
    }),
  ],
  devToolbar: { enabled: false },
});
