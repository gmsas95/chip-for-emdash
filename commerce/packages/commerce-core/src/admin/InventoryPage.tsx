import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

export function InventoryPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items?: Array<{ id: string; data: { sku?: string; available?: number } }> }>("/inventory", apiBasePath);
  return <AdminPageShell title="Inventory"><DataState {...result}><ul>{result.data?.items?.map((item) => <li key={item.id}>{item.data.sku ?? item.id}: {item.data.available ?? 0}</li>)}</ul></DataState></AdminPageShell>;
}
