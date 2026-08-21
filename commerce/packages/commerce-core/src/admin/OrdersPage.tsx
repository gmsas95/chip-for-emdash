import { AdminPageShell, DataState, formatMinorAmount, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

interface OrderRow {
  id: string;
  data: {
    orderId?: string;
    status?: string;
    currency?: string;
    totalMinor?: number;
    lines?: Array<{ name: string; quantity: number; totalMinor: number }>;
    customer?: { name?: string; email?: string };
    paymentProviderId?: string;
  };
}

export function OrdersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items: OrderRow[] }>("/orders", apiBasePath);
  return (
    <AdminPageShell title="Orders">
      <DataState {...result}>
        <table>
          <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Payment</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {result.data?.items.length === 0 ? <tr><td colSpan={5}>No orders yet.</td></tr> : null}
            {result.data?.items.map(({ id, data }) => <tr key={id}><th scope="row">{data.orderId ?? id}</th><td>{data.customer?.name ?? data.customer?.email ?? "Guest"}</td><td>{formatMinorAmount(data.totalMinor ?? 0, data.currency ?? "MYR")}</td><td>{data.paymentProviderId ?? "—"}</td><td>{data.status ?? "created"}</td></tr>)}
          </tbody>
        </table>
      </DataState>
    </AdminPageShell>
  );
}
