import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

interface InventoryRow { id: string; data: { productId: string; variantId?: string; sku: string; status: string; available: number; reserved: number } }
interface ProductRow { id: string; data: { name: string; slug: string } }

export function InventoryPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const inventory = useCommerceData<{ items: InventoryRow[] }>("/inventory", apiBasePath);
  const products = useCommerceData<{ items: ProductRow[] }>("/products", apiBasePath);
  const names = new Map((products.data?.items ?? []).map((item) => [item.id, item.data.name]));
  return (
    <AdminPageShell title="Inventory">
      <DataState {...inventory}>
        <table>
          <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Available</th><th scope="col">Reserved</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {inventory.data?.items.length === 0 ? <tr><td colSpan={5}>No inventory records yet. Add inventory while editing a product.</td></tr> : null}
            {inventory.data?.items.map(({ id, data }) => <tr key={id}><th scope="row">{names.get(data.productId) ?? data.productId}</th><td>{data.sku}</td><td>{data.available}</td><td>{data.reserved}</td><td>{data.status}</td></tr>)}
          </tbody>
        </table>
      </DataState>
    </AdminPageShell>
  );
}
