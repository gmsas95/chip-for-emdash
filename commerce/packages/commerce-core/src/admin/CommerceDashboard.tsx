import { getChipAdminLinks } from "./provider-links.js";
import { AdminPageShell, DataState, formatMinorAmount, useCommerceData, type AdminPageElement, type AdminPageProps } from "./shared.js";
import { formatOrderRef, statusLabel } from "./OrderDetail.js";

interface StatsResponse {
  currency: string;
  totals: { revenueMinor: number; paidOrders: number; aovMinor: number; itemsSold: number };
  daily: Array<{ date: string; revenueMinor: number; orders: number }>;
  recentOrders: Array<{ id?: string; orderId?: string; orderNumber?: number; status?: string; currency?: string; totalMinor?: number; createdAt?: string }>;
  lowStock: Array<{ sku?: unknown; available?: unknown }>;
}

interface ProviderStatus {
  providers: Array<{ id: string; configured: boolean; settingsPath?: string; paymentsPath?: string }>;
}

function formatDate(value?: string): string {
  if (typeof value !== "string" || value === "") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

const DASHBOARD_CSS = `
.commerce-stats-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
.commerce-stat-tile { border: 1px solid var(--commerce-line); border-radius: 12px; padding: 14px 16px; background: var(--commerce-surface); }
.commerce-stat-tile p:first-child { margin: 0 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--commerce-muted); }
.commerce-stat-tile p:last-child { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
.commerce-chart { display: flex; align-items: flex-end; gap: 6px; height: 140px; padding: 12px 0 0; }
.commerce-chart-bar { flex: 1; min-height: 3px; background: var(--commerce-accent); border-radius: 4px 4px 0 0; position: relative; }
.commerce-chart-bar:hover::after { content: attr(data-label); position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: var(--commerce-ink); color: var(--commerce-surface); font-size: 11px; padding: 3px 7px; border-radius: 6px; white-space: nowrap; }
.commerce-chart-axis { display: flex; gap: 6px; margin-top: 6px; }
.commerce-chart-axis span { flex: 1; font-size: 10px; color: var(--commerce-muted); text-align: center; }
`;

export function CommerceDashboard({ apiBasePath }: AdminPageProps): AdminPageElement {
  const stats = useCommerceData<StatsResponse>("/stats", apiBasePath);
  const providers = useCommerceData<ProviderStatus>("/provider-status", apiBasePath);
  const links = getChipAdminLinks();
  const chip = providers.data?.providers.find((provider) => provider.id === "chip");
  const currency = stats.data?.currency ?? "MYR";
  const maxRevenue = Math.max(...(stats.data?.daily ?? []).map((bucket) => bucket.revenueMinor), 1);

  return (
    <AdminPageShell title="Commerce dashboard">
      <style dangerouslySetInnerHTML={{ __html: DASHBOARD_CSS }} />
      <DataState {...stats}>
        <div className="commerce-stats-tiles">
          {[
            ["Revenue (paid)", formatMinorAmount(stats.data?.totals.revenueMinor ?? 0, currency)],
            ["Paid orders", String(stats.data?.totals.paidOrders ?? 0)],
            ["Avg order value", formatMinorAmount(stats.data?.totals.aovMinor ?? 0, currency)],
            ["Items sold", String(stats.data?.totals.itemsSold ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="commerce-stat-tile">
              <p>{label}</p>
              <p>{value}</p>
            </div>
          ))}
        </div>
        <section aria-labelledby="commerce-sales-trend">
          <h2 id="commerce-sales-trend">Last 14 days</h2>
          <div className="commerce-chart" role="img" aria-label="Daily paid revenue over the last 14 days">
            {(stats.data?.daily ?? []).map((bucket) => (
              <div
                key={bucket.date}
                className="commerce-chart-bar"
                data-label={`${bucket.date}: ${formatMinorAmount(bucket.revenueMinor, currency)} · ${bucket.orders} order${bucket.orders === 1 ? "" : "s"}`}
                style={{ height: `${Math.max(3, Math.round((bucket.revenueMinor / maxRevenue) * 100))}%`, opacity: bucket.revenueMinor > 0 ? 1 : .25 }}
              />
            ))}
          </div>
          <div className="commerce-chart-axis" aria-hidden="true">
            {(stats.data?.daily ?? []).filter((_, index) => index % 3 === 0).map((bucket) => <span key={bucket.date}>{bucket.date.slice(5)}</span>)}
          </div>
        </section>
      </DataState>
      <section aria-labelledby="commerce-recent-orders">
        <h2 id="commerce-recent-orders">Recent orders</h2>
        <DataState {...stats}>
          <table>
            <thead><tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col" className="commerce-col-money">Total</th></tr></thead>
            <tbody>
              {(stats.data?.recentOrders ?? []).length === 0 ? <tr><td colSpan={4}>No orders yet.</td></tr> : null}
              {(stats.data?.recentOrders ?? []).map((order) => (
                <tr key={String(order.id)}>
                  <th scope="row">{formatOrderRef(order)}</th>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>{statusLabel(order.status)}</td>
                  <td className="commerce-col-money">{formatMinorAmount(order.totalMinor ?? 0, order.currency ?? currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataState>
      </section>
      {(stats.data?.lowStock ?? []).length > 0 ? (
        <section aria-labelledby="commerce-low-stock">
          <h2 id="commerce-low-stock">Low stock</h2>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {stats.data?.lowStock.map((item) => (
              <li key={String(item.sku)}><strong>{String(item.sku)}</strong> — {String(item.available)} left</li>
            ))}
          </ul>
        </section>
      ) : null}
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
