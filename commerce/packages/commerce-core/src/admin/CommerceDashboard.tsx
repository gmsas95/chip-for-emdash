import { AdminPageShell, DataState, type AdminPageElement, type AdminPageProps, useCommerceData } from "./shared.js";

export function CommerceDashboard({ apiBasePath }: AdminPageProps): AdminPageElement {
  const result = useCommerceData<{ items?: unknown[] }>("/catalog", apiBasePath);
  return <AdminPageShell title="Commerce dashboard"><DataState {...result}><p>{result.data?.items?.length ?? 0} catalog records available.</p></DataState></AdminPageShell>;
}
