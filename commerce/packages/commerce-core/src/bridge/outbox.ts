export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface EventDeliveryInput {
  deliveryId: string;
  event: string;
  idempotencyKey?: string;
  payloadHash?: string;
  nextAttemptAt?: string;
}

export interface EventDelivery extends EventDeliveryInput {
  idempotencyKey: string;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt?: string;
  terminalError?: string;
  claimToken?: string;
  leaseUntil?: string;
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
  claim(now: string, leaseMs: number): Promise<EventDelivery[]>;
  renew(deliveryId: string, claimToken: string, leaseMs: number): Promise<void>;
  update(delivery: EventDelivery, claimToken: string): Promise<void>;
}

const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 30_000;
const DEFAULT_LEASE_MS = 60_000;

function clone(delivery: EventDelivery): EventDelivery {
  return { ...delivery };
}

function parseTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid outbox timestamp");
  }
  return parsed;
}

function isDue(delivery: EventDelivery, nowMs: number): boolean {
  if (delivery.status !== "pending") {
    return false;
  }
  if (delivery.leaseUntil !== undefined && parseTime(delivery.leaseUntil) > nowMs) {
    return false;
  }
  return delivery.nextAttemptAt === undefined || parseTime(delivery.nextAttemptAt) <= nowMs;
}

function nextAttempt(now: string, attempts: number): string {
  const nowMs = parseTime(now);
  const delay = Math.min(BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempts - 1)), 60 * 60 * 1000);
  return new Date(nowMs + delay).toISOString();
}

function sameIdentity(left: EventDelivery, right: EventDeliveryInput): boolean {
  return left.event === right.event && left.payloadHash === right.payloadHash && left.idempotencyKey === (right.idempotencyKey ?? right.deliveryId);
}

function claimId(deliveryId: string): string {
  return `${deliveryId}:${Math.random().toString(36).slice(2)}`;
}

class MemoryOutbox implements BridgeOutbox {
  private readonly deliveries = new Map<string, EventDelivery>();
  private readonly idempotency = new Map<string, string>();

  async record(input: EventDeliveryInput): Promise<void> {
    const idempotencyKey = input.idempotencyKey ?? input.deliveryId;
    const existing = this.deliveries.get(input.deliveryId);
    if (existing) {
      if (!sameIdentity(existing, { ...input, idempotencyKey })) {
        throw new Error("OUTBOX_IDEMPOTENCY_CONFLICT");
      }
      return;
    }
    const existingDeliveryId = this.idempotency.get(idempotencyKey);
    if (existingDeliveryId) {
      const existingByKey = this.deliveries.get(existingDeliveryId);
      if (existingByKey && !sameIdentity(existingByKey, { ...input, idempotencyKey })) {
        throw new Error("OUTBOX_IDEMPOTENCY_CONFLICT");
      }
      return;
    }
    this.idempotency.set(idempotencyKey, input.deliveryId);
    this.deliveries.set(input.deliveryId, {
      ...input,
      idempotencyKey,
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
    const nowMs = parseTime(now);
    return [...this.deliveries.values()].filter((delivery) => isDue(delivery, nowMs)).map(clone);
  }

  async claim(now: string, leaseMs: number): Promise<EventDelivery[]> {
    const nowMs = parseTime(now);
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new Error("Invalid outbox lease");
    }
    const claimed: EventDelivery[] = [];
    for (const delivery of this.deliveries.values()) {
      if (!isDue(delivery, nowMs)) {
        continue;
      }
      const claimToken = claimId(delivery.deliveryId);
      const claimedDelivery = {
        ...delivery,
        claimToken,
        leaseUntil: new Date(nowMs + leaseMs).toISOString(),
      };
      this.deliveries.set(delivery.deliveryId, claimedDelivery);
      claimed.push(clone(claimedDelivery));
    }
    return claimed;
  }

  async renew(deliveryId: string, claimToken: string, leaseMs: number): Promise<void> {
    const existing = this.deliveries.get(deliveryId);
    if (!existing || existing.claimToken !== claimToken) {
      throw new Error("OUTBOX_CLAIM_LOST");
    }
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new Error("Invalid outbox lease");
    }
    const nowMs = Date.now();
    this.deliveries.set(deliveryId, {
      ...existing,
      leaseUntil: new Date(nowMs + leaseMs).toISOString(),
    });
  }

  async update(delivery: EventDelivery, claimToken: string): Promise<void> {
    const existing = this.deliveries.get(delivery.deliveryId);
    if (!existing || existing.claimToken !== claimToken) {
      throw new Error("OUTBOX_CLAIM_LOST");
    }
    const { claimToken: _claimToken, leaseUntil: _leaseUntil, ...updated } = delivery;
    this.deliveries.set(delivery.deliveryId, updated);
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
  for (const delivery of await outbox.claim(now, DEFAULT_LEASE_MS)) {
    const claimToken = delivery.claimToken;
    if (!claimToken) {
      continue;
    }
    summary.attempted += 1;
    const attempt: EventDelivery = {
      ...delivery,
      attempts: delivery.attempts + 1,
      lastAttemptAt: now,
    };
    const heartbeat = setInterval(() => {
      void outbox.renew(delivery.deliveryId, claimToken, DEFAULT_LEASE_MS).catch(() => undefined);
    }, Math.floor(DEFAULT_LEASE_MS / 2));
    let result: DeliveryAttemptResult;
    try {
      result = await deliver(attempt);
    } finally {
      clearInterval(heartbeat);
    }
    if (result.ok) {
      summary.delivered += 1;
      await outbox.update({ ...attempt, status: "delivered", nextAttemptAt: undefined, terminalError: undefined }, claimToken);
      continue;
    }
    if (result.retryable && attempt.attempts < MAX_ATTEMPTS) {
      summary.retryable += 1;
      await outbox.update({
        ...attempt,
        status: "pending",
        nextAttemptAt: nextAttempt(now, attempt.attempts),
        terminalError: result.error,
      }, claimToken);
      continue;
    }
    summary.failed += 1;
    await outbox.update({
      ...attempt,
      status: "failed",
      nextAttemptAt: undefined,
      terminalError: result.error ?? "Bridge delivery failed",
    }, claimToken);
  }
  return summary;
}

export { MAX_ATTEMPTS as MAX_BRIDGE_DELIVERY_ATTEMPTS };
