import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

export function CustomersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items?: Array<{ id: string; data: { name?: string; email?: string } }> }>("/customers", apiBasePath);
  return <AdminPageShell title="Customers"><DataState {...result}><ul>{result.data?.items?.map((item) => <li key={item.id}>{item.data.name ?? item.data.email ?? item.id}</li>)}</ul></DataState></AdminPageShell>;
}
