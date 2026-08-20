import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

export function ProductsPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items?: Array<{ id: string; data: { name?: string; sku?: string } }> }>("/catalog", apiBasePath);
  return <AdminPageShell title="Products"><DataState {...result}><ul>{result.data?.items?.map((item) => <li key={item.id}>{item.data.name ?? item.data.sku ?? item.id}</li>)}</ul></DataState></AdminPageShell>;
}
