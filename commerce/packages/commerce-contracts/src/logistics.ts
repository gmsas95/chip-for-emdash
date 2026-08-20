import type { AddressSnapshot, OrderSnapshot } from "./domain.js";

export type LogisticsOperation = "quote" | "create" | "cancel" | "track";

export interface ShipmentRequest {
  recipient?: string;
  address?: AddressSnapshot;
  serviceCode?: string;
  packageCount?: number;
  weightGrams?: number;
}

export interface LogisticsCommand {
  operation: LogisticsOperation;
  order: OrderSnapshot;
  shipment?: ShipmentRequest;
  trackingNumber?: string;
  metadata?: Record<string, string>;
}
