import { useState, type FormEvent } from "react";
import { getChipAdminLinks } from "./provider-links.js";
import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData, useCommerceMutation } from "./shared.js";

interface StoreSettings {
  storeName: string;
  storeEmail: string;
  defaultCurrency: string;
  lowStockThreshold: number;
}

interface ProviderStatusResponse {
  providers: Array<{ id: string; label: string; configured: boolean; settingsPath?: string; paymentsPath?: string }>;
}

const CURRENCIES = ["MYR", "USD", "SGD", "EUR", "GBP", "IDR", "THB", "PHP"] as const;

export function SettingsPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const settings = useCommerceData<StoreSettings>("/settings/get", apiBasePath);
  const providers = useCommerceData<ProviderStatusResponse>("/provider-status", apiBasePath);
  const save = useCommerceMutation<Partial<StoreSettings>>("/settings/save", apiBasePath);
  const [savedAt, setSavedAt] = useState<string>();
  const chip = providers.data?.providers.find((provider) => provider.id === "chip");
  const chipLinks = getChipAdminLinks();

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await save.submit({
        storeName: String(data.get("storeName") ?? ""),
        storeEmail: String(data.get("storeEmail") ?? ""),
        defaultCurrency: String(data.get("defaultCurrency") ?? ""),
        lowStockThreshold: Number(data.get("lowStockThreshold") ?? 5),
      });
      setSavedAt(new Date().toLocaleTimeString());
      settings.reload();
    } catch {
      /* surfaced via save.error */
    }
  }

  return (
    <AdminPageShell title="Commerce settings">
      <p>Store settings persist in plugin storage. Customer emails are delivered through the site's configured email provider when one exists.</p>
      <section aria-labelledby="commerce-store-settings">
        <h2 id="commerce-store-settings">Store</h2>
        <DataState {...settings}>
          <form onSubmit={(event) => void onSubmit(event)}>
            <label>
              Store name
              <input name="storeName" defaultValue={settings.data?.storeName} maxLength={120} required />
            </label>
            <label>
              Store email
              <input name="storeEmail" type="email" defaultValue={settings.data?.storeEmail} placeholder="hello@yourstore.test" />
            </label>
            <label>
              Default currency
              <select name="defaultCurrency" defaultValue={settings.data?.defaultCurrency}>
                {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <label>
              Low stock threshold
              <input name="lowStockThreshold" type="number" min={1} max={1000} step={1} defaultValue={settings.data?.lowStockThreshold} />
            </label>
            {save.error ? <p role="alert">{save.error}</p> : null}
            <div className="commerce-admin-toolbar">
              <button type="submit" className="commerce-btn" disabled={save.loading}>{save.loading ? "Saving…" : "Save settings"}</button>
              {!save.loading && !save.error && savedAt ? <span role="status">Saved at {savedAt}</span> : null}
            </div>
          </form>
        </DataState>
      </section>
      <section aria-labelledby="payment-providers">
        <h2 id="payment-providers">Payment providers</h2>
        <DataState {...providers}>
          <article>
            <h3>CHIP</h3>
            <p>{chip?.configured ? "Bridge configured. Merchant credentials are managed by CHIP." : "Bridge needs configuration."}</p>
            <p>
              <a href={chip?.settingsPath ?? chipLinks.settingsPath}>Configure CHIP Payments</a>{" "}
              <a href={chip?.paymentsPath ?? chipLinks.paymentsPath}>View CHIP Payments</a>
            </p>
          </article>
        </DataState>
      </section>
    </AdminPageShell>
  );
}
