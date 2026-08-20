export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface EventDeliveryInput {
  deliveryId: string;
  event: string;
  idempotencyKey?: string;
  payloadHash?: string;
  nextAttemptAt?: string;
}

export interface EventDelivery extends EventDeliveryInput {
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt?: string;
  terminalError?: string;
}

export interface DeliveryAttemptResult {
  ok: boolean;
  retryable: boolean;
  error?: string;
}

export interface RetrySummary {
  attempted: number;
  delivered: number;
  retryable: number;
  failed: number;
}

export interface BridgeOutbox {
  record(delivery: EventDeliveryInput): Promise<void>;
  get(deliveryId: string): Promise<EventDelivery | undefined>;
  count(): Promise<number>;
  pending(now: string): Promise<EventDelivery[]>;
  update(delivery: EventDelivery): Promise<void>;
}

const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 30_000;

function clone(delivery: EventDelivery): EventDelivery {
  return { ...delivery };
}
function isDue(delivery: EventDelivery, now: string): boolean {
  if (delivery.status !== "pending" || delivery.nextAttemptAt === undefined) {
    return delivery.status === "pending";
  }
  const nowMs = Date.parse(now);
  const nextAttemptMs = Date.parse(delivery.nextAttemptAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(nextAttemptMs)) {
    throw new Error("Invalid outbox timestamp");
  }
  return nextAttemptMs <= nowMs;
}

function nextAttempt(now: string, attempts: number): string {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error("Invalid outbox timestamp");
  }
  const delay = Math.min(BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempts - 1)), 60 * 60 * 1000);
  return new Date(nowMs + delay).toISOString();
}

class MemoryOutbox implements BridgeOutbox {
  private readonly deliveries = new Map<string, EventDelivery>();
  private readonly idempotency = new Map<string, string>();

  async record(input: EventDeliveryInput): Promise<void> {
    const existing = this.deliveries.get(input.deliveryId);
    if (existing) {
      return;
    }
    if (input.idempotencyKey) {
      const existingDeliveryId = this.idempotency.get(input.idempotencyKey);
      if (existingDeliveryId && existingDeliveryId !== input.deliveryId) {
        return;
      }
      this.idempotency.set(input.idempotencyKey, input.deliveryId);
    }
    this.deliveries.set(input.deliveryId, {
      ...input,
      status: "pending",
      attempts: 0,
    });
  }

  async get(deliveryId: string): Promise<EventDelivery | undefined> {
    const delivery = this.deliveries.get(deliveryId);
    return delivery === undefined ? undefined : clone(delivery);
  }

  async count(): Promise<number> {
    return this.deliveries.size;
  }

  async pending(now: string): Promise<EventDelivery[]> {
    return [...this.deliveries.values()].filter((delivery) => isDue(delivery, now)).map(clone);
  }

  async update(delivery: EventDelivery): Promise<void> {
    this.deliveries.set(delivery.deliveryId, clone(delivery));
  }
}

export function createMemoryOutbox(): BridgeOutbox {
  return new MemoryOutbox();
}

export function recordEventDelivery(outbox: BridgeOutbox, delivery: EventDeliveryInput): Promise<void> {
  return outbox.record(delivery);
}

export async function retryPendingDeliveries(
  outbox: BridgeOutbox,
  deliver: (delivery: EventDelivery) => Promise<DeliveryAttemptResult>,
  now: string,
): Promise<RetrySummary> {
  const summary: RetrySummary = { attempted: 0, delivered: 0, retryable: 0, failed: 0 };
  for (const delivery of await outbox.pending(now)) {
    summary.attempted += 1;
    const attempt: EventDelivery = {
      ...delivery,
      attempts: delivery.attempts + 1,
      lastAttemptAt: now,
    };
    const result = await deliver(attempt);
    if (result.ok) {
      summary.delivered += 1;
      await outbox.update({ ...attempt, status: "delivered", nextAttemptAt: undefined });
      continue;
    }
    if (result.retryable && attempt.attempts < MAX_ATTEMPTS) {
      summary.retryable += 1;
      await outbox.update({
        ...attempt,
        status: "pending",
        nextAttemptAt: nextAttempt(now, attempt.attempts),
        terminalError: result.error,
      });
      continue;
    }
    summary.failed += 1;
    await outbox.update({
      ...attempt,
      status: "failed",
      nextAttemptAt: undefined,
      terminalError: result.error ?? "Bridge delivery failed",
    });
  }
  return summary;
}

export { MAX_ATTEMPTS as MAX_BRIDGE_DELIVERY_ATTEMPTS };
