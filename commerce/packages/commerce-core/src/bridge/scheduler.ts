import { retryPendingDeliveries } from "./outbox.js";
import type { BridgeOutbox, DeliveryAttemptResult, EventDelivery, RetrySummary } from "./outbox.js";

export interface BridgeMaintenanceDependencies {
  outbox: BridgeOutbox;
  deliver: (delivery: EventDelivery) => Promise<DeliveryAttemptResult>;
}

export function runBridgeMaintenance(
  dependencies: BridgeMaintenanceDependencies,
  now: string = new Date().toISOString(),
): Promise<RetrySummary> {
  return retryPendingDeliveries(dependencies.outbox, dependencies.deliver, now);
}
