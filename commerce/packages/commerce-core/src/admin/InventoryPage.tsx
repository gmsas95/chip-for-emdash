import { useState } from "react";
import { AdminPageShell, DataState, useCommerceData, useCommerceMutation, type AdminPageElement, type AdminPageProps } from "./shared.js";

interface InventoryRow { id: string; data: { productId: string; variantId?: string; sku: string; status: string; available: number; reserved: number } }
interface ProductRow { id: string; data: { name: string; slug: string } }
interface HoldRow {
  id?: string;
  orderId?: string;
  sku?: string;
  quantity?: number;
  status?: string;
  createdAt?: string;
  expiresAt?: string;
}

function formatDate(value?: string): string {
  if (typeof value !== "string" || value === "") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function StockEditor({ row, apiBasePath, onSaved }: { row: InventoryRow; apiBasePath?: string; onSaved: () => void }): AdminPageElement {
  const [value, setValue] = useState(String(row.data.available));
  const mutation = useCommerceMutation<{ inventoryId: string; available: number }>("/inventory/update", apiBasePath);
  const dirty = Number(value) !== row.data.available && value !== "";

  async function save(): Promise<void> {
    try {
      await mutation.submit({ inventoryId: row.id, available: Number(value) });
      onSaved();
    } catch {
      /* surfaced via mutation.error */
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        aria-label={`Available stock for ${row.data.sku}`}
        style={{ width: 76, minHeight: 34 }}
        onChange={(event) => setValue(event.target.value)}
      />
      {dirty || mutation.loading ? (
        <button type="button" className="commerce-btn commerce-btn-sm" onClick={() => void save()} disabled={mutation.loading}>
          {mutation.loading ? "…" : "Save"}
        </button>
      ) : null}
    </span>
  );
}

export function InventoryPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const inventory = useCommerceData<{ items: InventoryRow[]; lowStockThreshold: number }>("/inventory", apiBasePath);
  const products = useCommerceData<{ items: ProductRow[] }>("/products", apiBasePath);
  const holds = useCommerceData<{ items: HoldRow[] }>("/inventory/holds", apiBasePath);
  const names = new Map((products.data?.items ?? []).map((item) => [item.id, item.data.name]));
  const threshold = inventory.data?.lowStockThreshold ?? 5;

  return (
    <AdminPageShell title="Inventory">
      <p style={{ color: "var(--commerce-muted)" }}>Rows with available stock at or below {threshold} are flagged as low. Reserved units are held by pending checkouts.</p>
      <DataState {...inventory}>
        <table>
          <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Available</th><th scope="col">Reserved</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {inventory.data?.items.length === 0 ? <tr><td colSpan={5}>No inventory records yet. Add inventory while editing a product.</td></tr> : null}
            {(inventory.data?.items ?? []).map((row) => (
              <tr
                key={row.id}
                style={row.data.status === "active" && row.data.available <= threshold ? { background: "color-mix(in srgb, var(--commerce-danger) 8%, transparent)" } : undefined}
              >
                <th scope="row">{names.get(row.data.productId) ?? row.data.productId}{row.data.variantId ? ` (variant)` : ""}</th>
                <td>{row.data.sku}</td>
                <td><StockEditor row={row} apiBasePath={apiBasePath} onSaved={inventory.reload} /></td>
                <td>{row.data.reserved}</td>
                <td>{row.data.available <= threshold && row.data.status === "active" ? "Low stock" : row.data.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataState>
      <section aria-labelledby="commerce-holds">
        <h2 id="commerce-holds">Active holds</h2>
        <DataState {...holds}>
          <table>
            <thead><tr><th scope="col">Order</th><th scope="col">SKU</th><th scope="col">Quantity</th><th scope="col">State</th><th scope="col">Expires</th></tr></thead>
            <tbody>
              {holds.data?.items.length === 0 ? <tr><td colSpan={5}>No reservation holds right now.</td></tr> : null}
              {(holds.data?.items ?? []).map((hold) => (
                <tr key={hold.id}>
                  <th scope="row">{hold.orderId ?? "—"}</th>
                  <td>{hold.sku ?? "—"}</td>
                  <td>{hold.quantity ?? 0}</td>
                  <td>{hold.status === "confirmed" ? "Confirmed (paid)" : "Held (awaiting payment)"}</td>
                  <td>{formatDate(hold.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataState>
      </section>
    </AdminPageShell>
  );
}
