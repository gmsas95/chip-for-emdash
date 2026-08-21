import { getChipAdminLinks } from "./provider-links.js";
import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

interface ProviderStatusResponse {
  providers: Array<{ id: string; label: string; configured: boolean; settingsPath?: string; paymentsPath?: string }>;
}

export function SettingsPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<ProviderStatusResponse>("/provider-status", apiBasePath);
  const chip = getChipAdminLinks();
  const chipProvider = result.data?.providers.find((provider) => provider.id === "chip");
  return (
    <AdminPageShell title="Commerce settings">
      <p>Commerce records persist in D1. Product images are managed by EmDash Media and stored in the configured R2 bucket.</p>
      <section aria-labelledby="payment-providers">
        <h2 id="payment-providers">Payment providers</h2>
        <DataState {...result}>
          <article>
            <h3>CHIP</h3>
            <p>{chipProvider?.configured ? "Bridge configured. Merchant credentials are managed by CHIP." : "Bridge needs configuration."}</p>
            <p>
              <a href={chipProvider?.settingsPath ?? chip.settingsPath}>Configure CHIP Payments</a>{" "}
              <a href={chipProvider?.paymentsPath ?? chip.paymentsPath}>View CHIP Payments</a>
            </p>
          </article>
        </DataState>
      </section>
    </AdminPageShell>
  );
}
