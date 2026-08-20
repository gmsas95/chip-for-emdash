export { CommerceDashboard } from "./admin/CommerceDashboard.js";
export { ProductsPage } from "./admin/ProductsPage.js";
export { InventoryPage } from "./admin/InventoryPage.js";
export { OrdersPage } from "./admin/OrdersPage.js";
export { CustomersPage } from "./admin/CustomersPage.js";
export { SettingsPage } from "./admin/SettingsPage.js";

import { CommerceDashboard } from "./admin/CommerceDashboard.js";
import { CustomersPage } from "./admin/CustomersPage.js";
import { InventoryPage } from "./admin/InventoryPage.js";
import { OrdersPage } from "./admin/OrdersPage.js";
import { ProductsPage } from "./admin/ProductsPage.js";
import { SettingsPage } from "./admin/SettingsPage.js";

export const pages = {
  "/dashboard": CommerceDashboard,
  "/products": ProductsPage,
  "/inventory": InventoryPage,
  "/orders": OrdersPage,
  "/customers": CustomersPage,
  "/settings": SettingsPage,
};

export const widgets = {
  "commerce-summary": CommerceDashboard,
};
