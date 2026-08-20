import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

export function OrdersPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items?: Array<{ id: string; data: { status?: string; totalMinor?: number } }> }>("/orders", apiBasePath);
  return <AdminPageShell title="Orders"><DataState {...result}><ul>{result.data?.items?.map((item) => <li key={item.id}>{item.id}: {item.data.status ?? "unknown"} ({item.data.totalMinor ?? 0})</li>)}</ul></DataState></AdminPageShell>;
}
