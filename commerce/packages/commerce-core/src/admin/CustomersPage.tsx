import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

interface CustomerRow {
  id: string;
  data: { customerId?: string; name?: string; email?: string; phone?: string; orderCount?: number; status?: string };
}

export function CustomersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items: CustomerRow[] }>("/customers", apiBasePath);
  return (
    <AdminPageShell title="Customers">
      <DataState {...result}>
        <table>
          <thead><tr><th scope="col">Customer</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col">Orders</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {result.data?.items.length === 0 ? <tr><td colSpan={5}>No customers yet. Customers appear after checkout.</td></tr> : null}
            {result.data?.items.map(({ id, data }) => <tr key={id}><th scope="row">{data.name ?? data.email ?? data.customerId ?? id}</th><td>{data.email ?? "—"}</td><td>{data.phone ?? "—"}</td><td>{data.orderCount ?? 0}</td><td>{data.status ?? "active"}</td></tr>)}
          </tbody>
        </table>
      </DataState>
    </AdminPageShell>
  );
}
