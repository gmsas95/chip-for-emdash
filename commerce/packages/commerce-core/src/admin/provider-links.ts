export interface ChipAdminLinks {
  settingsPath: string;
  paymentsPath: string;
}

export function getChipAdminLinks(): ChipAdminLinks {
  return {
    settingsPath: "/_emdash/admin/plugins/chip-for-emdash/settings",
    paymentsPath: "/_emdash/admin/plugins/chip-for-emdash/payments",
  };
}
