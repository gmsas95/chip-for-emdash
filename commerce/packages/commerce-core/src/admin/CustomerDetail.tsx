import type { AdminPageElement, AdminPageProps } from "./shared.js";
import { DataState, formatMinorAmount, useCommerceData } from "./shared.js";
import { formatOrderRef, statusLabel } from "./OrderDetail.js";

interface CustomerProfile {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  orderCount?: number;
  totalSpentMinor?: number;
  lastOrderAt?: string;
  createdAt?: string;
}

interface CustomerOrderRow {
  id: string;
  orderId?: string;
  orderNumber?: number;
  status?: string;
  currency?: string;
  totalMinor?: number;
  createdAt?: string;
}

function formatDate(value?: string): string {
  if (typeof value !== "string" || value === "") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export function CustomerDetail({ customerId, apiBasePath }: AdminPageProps & { customerId: string }): AdminPageElement {
  const encodedId = encodeURIComponent(customerId);
  const result = useCommerceData<{ customer: CustomerProfile; orders: CustomerOrderRow[] }>(
    `/customers/detail?customerId=${encodedId}`,
    apiBasePath,
  );
  const customer = result.data?.customer;
  const orders = result.data?.orders ?? [];

  return (
    <div>
      <DataState loading={result.loading} error={result.error}>
        {customer ? (
          <>
            <header style={{ marginBottom: 12 }}>
              <h3 style={{ margin: "0 0 4px" }}>{customer.name ?? customer.email ?? formatOrderRef(customer)}</h3>
              <p style={{ margin: 0, color: "var(--commerce-muted)" }}>
                {customer.email ?? "no email"}{customer.phone ? ` · ${customer.phone}` : ""}
                {" · "}{statusLabel(customer.status)}
              </p>
            </header>
            <section aria-label="Customer statistics" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "14px 0" }}>
              {[
                ["Orders", String(customer.orderCount ?? orders.length)],
                ["Total spent", formatMinorAmount(customer.totalSpentMinor ?? 0, "MYR")],
                ["Last order", formatDate(customer.lastOrderAt)],
              ].map(([label, value]) => (
                <div key={label} style={{ border: "1px solid var(--commerce-line)", borderRadius: 10, padding: "10px 12px" }}>
                  <p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--commerce-muted)" }}>{label}</p>
                  <p style={{ margin: "4px 0 0", fontWeight: 700 }}>{value}</p>
                </div>
              ))}
            </section>
            <section aria-labelledby="commerce-customer-orders">
              <h2 id="commerce-customer-orders">Order history</h2>
              <table>
                <thead><tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Total</th></tr></thead>
                <tbody>
                  {orders.length === 0 ? <tr><td colSpan={4}>No orders yet.</td></tr> : null}
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <th scope="row">{formatOrderRef(order)}</th>
                      <td>{formatDate(order.createdAt)}</td>
                      <td>{statusLabel(order.status)}</td>
                      <td>{formatMinorAmount(order.totalMinor ?? 0, order.currency ?? "MYR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        ) : !result.loading && !result.error ? (
          <p role="alert">Customer not found.</p>
        ) : null}
      </DataState>
    </div>
  );
}
