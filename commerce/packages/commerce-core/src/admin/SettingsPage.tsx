import { AdminPageShell, type AdminPageElement, type AdminPageProps } from "./shared.js";

export function SettingsPage(_props: AdminPageProps): AdminPageElement {
  return <AdminPageShell title="Commerce settings"><p>Commerce provider connections and checkout settings are managed here.</p></AdminPageShell>;
}
