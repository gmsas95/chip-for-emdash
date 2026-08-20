import { assertSafeNonNegativeMinorUnit, assertSafeQuantity } from "./money.js";

export type ReservationStatus = "active" | "confirmed" | "released" | "expired";

export interface InventoryReservation {
  id: string;
  sku?: string;
  orderId?: string;
  quantity: number;
  status: ReservationStatus;
  idempotencyKey?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface ReserveInventoryInput {
  available: number;
  requested: number;
  reservationId?: string;
  sku?: string;
  orderId?: string;
  idempotencyKey?: string;
  expiresAt?: string;
  now?: string;
  existingReservation?: InventoryReservation;
}

export type ReservationFailureCode = "INVALID_STOCK" | "INVALID_QUANTITY" | "INSUFFICIENT_STOCK" | "IDEMPOTENCY_CONFLICT";

export type ReservationResult =
  | {
      ok: true;
      code: "RESERVED" | "ALREADY_RESERVED";
      reservation: InventoryReservation;
      reserved: number;
      remaining: number;
    }
  | { ok: false; code: ReservationFailureCode };

function cloneReservation(reservation: InventoryReservation): InventoryReservation {
  return { ...reservation };
}

function createReservationId(input: ReserveInventoryInput): string {
  return input.reservationId ?? `reservation-${input.sku ?? input.orderId ?? "inventory"}-${input.idempotencyKey ?? Date.now().toString(36)}`;
}

export function reserveInventory(input: ReserveInventoryInput): ReservationResult {
  try {
    assertSafeNonNegativeMinorUnit(input.available, "available");
  } catch {
    return { ok: false, code: "INVALID_STOCK" };
  }
  try {
    assertSafeQuantity(input.requested, "requested");
  } catch {
    return { ok: false, code: "INVALID_QUANTITY" };
  }

  const existing = input.existingReservation;
  if (existing !== undefined) {
    if (existing.idempotencyKey !== input.idempotencyKey) {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    if (existing.status === "released" || existing.status === "expired") {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    return {
      ok: true,
      code: "ALREADY_RESERVED",
      reservation: cloneReservation(existing),
      reserved: existing.quantity,
      remaining: input.available,
    };
  }

  if (input.available < input.requested) {
    return { ok: false, code: "INSUFFICIENT_STOCK" };
  }

  const reservation: InventoryReservation = {
    id: createReservationId(input),
    ...(input.sku === undefined ? {} : { sku: input.sku }),
    ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
    quantity: input.requested,
    status: "active",
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    createdAt: input.now ?? new Date().toISOString(),
  };
  return {
    ok: true,
    code: "RESERVED",
    reservation,
    reserved: input.requested,
    remaining: input.available - input.requested,
  };
}

export function confirmReservation(reservation: InventoryReservation): InventoryReservation {
  if (reservation.status === "confirmed") {
    return cloneReservation(reservation);
  }
  if (reservation.status !== "active") {
    throw new Error("Invalid reservation transition");
  }
  return { ...reservation, status: "confirmed" };
}

export function releaseReservation(reservation: InventoryReservation): InventoryReservation {
  if (reservation.status === "released" || reservation.status === "expired") {
    return cloneReservation(reservation);
  }
  return { ...reservation, status: "released" };
}

export function expireReservation(reservation: InventoryReservation, now: string): InventoryReservation {
  if (reservation.status !== "active" || reservation.expiresAt === undefined || now < reservation.expiresAt) {
    return cloneReservation(reservation);
  }
  return { ...reservation, status: "expired" };
}
