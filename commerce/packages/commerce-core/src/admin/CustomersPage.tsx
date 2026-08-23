import { useState } from "react";
import { CustomerDetail } from "./CustomerDetail.js";
import { Drawer } from "./Drawer.js";
import { AdminPageShell, DataState, formatMinorAmount, useCommerceData, type AdminPageElement, type AdminPageProps } from "./shared.js";

interface CustomerRow {
  id: string;
  data: {
    customerId?: string;
    name?: string;
    email?: string;
    phone?: string;
    orderCount?: number;
    status?: string;
    totalSpentMinor?: number;
    lastOrderAt?: string;
  };
}

function formatDate(value?: string): string {
  if (typeof value !== "string" || value === "") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export function CustomersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items: CustomerRow[] }>("/customers", apiBasePath);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>();

  return (
    <AdminPageShell title="Customers">
      <DataState {...result}>
        <table>
          <thead><tr><th scope="col">Customer</th><th scope="col">Email</th><th scope="col">Orders</th><th scope="col">Total spent</th><th scope="col">Last order</th></tr></thead>
          <tbody>
            {result.data?.items.length === 0 ? <tr><td colSpan={5}>No customers yet. Customers appear after checkout.</td></tr> : null}
            {(result.data?.items ?? []).map(({ id, data }) => (
              <tr key={id} style={{ cursor: "pointer" }} onClick={() => setSelectedCustomerId(id)}>
                <th scope="row">{data.name ?? data.email ?? id}</th>
                <td>{data.email ?? "—"}</td>
                <td>{data.orderCount ?? 0}</td>
                <td>{formatMinorAmount(data.totalSpentMinor ?? 0, "MYR")}</td>
                <td>{formatDate(data.lastOrderAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataState>
      {selectedCustomerId ? (
        <Drawer title="Customer details" ariaLabel={`Customer ${selectedCustomerId} details`} onClose={() => setSelectedCustomerId(undefined)}>
          <CustomerDetail customerId={selectedCustomerId} apiBasePath={apiBasePath} />
        </Drawer>
      ) : null}
    </AdminPageShell>
  );
}
