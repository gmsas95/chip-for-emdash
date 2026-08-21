import { getChipAdminLinks } from "./provider-links.js";
import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

interface DashboardCatalog {
  items?: unknown[];
}

interface ProviderStatus {
  providers: Array<{ id: string; configured: boolean; settingsPath?: string; paymentsPath?: string }>;
}

export function CommerceDashboard({ apiBasePath }: AdminPageProps): AdminPageElement {
  const catalog = useCommerceData<DashboardCatalog>("/catalog", apiBasePath);
  const providers = useCommerceData<ProviderStatus>("/provider-status", apiBasePath);
  const links = getChipAdminLinks();
  const chip = providers.data?.providers.find((provider) => provider.id === "chip");
  return (
    <AdminPageShell title="Commerce dashboard">
      <DataState {...catalog}><p>{catalog.data?.items?.length ?? 0} published catalog records.</p></DataState>
      <section aria-labelledby="commerce-payment-status">
        <h2 id="commerce-payment-status">Payment status</h2>
        <DataState {...providers}>
          <p>CHIP: {chip?.configured ? "configured" : "needs configuration"}</p>
          <p><a href={chip?.settingsPath ?? links.settingsPath}>Configure CHIP Payments</a>{" "}<a href={chip?.paymentsPath ?? links.paymentsPath}>View CHIP Payments</a></p>
        </DataState>
      </section>
    </AdminPageShell>
  );
}
