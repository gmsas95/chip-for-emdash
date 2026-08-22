import { confirmReservation, expireReservation, releaseReservation, reserveInventory } from "../domain/inventory.js";
import type { InventoryReservation } from "../domain/inventory.js";
import type { OrderSnapshotLine } from "../domain/orders.js";
import type { CommerceRepositories } from "./repositories.js";

export const RESERVATION_TTL_MS = 60 * 60 * 1000;

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export interface StoredReservation extends InventoryReservation {
  inventoryId?: string;
  productId?: string;
  variantId?: string;
  lineId?: string;
  updatedAt?: string;
}

interface InventoryRecord {
  productId: string;
  variantId?: string;
  sku?: string;
  status: string;
  available: number;
  reserved: number;
  updatedAt?: string;
}

interface AppliedReservation {
  reservationId: string;
  inventoryId?: string;
  quantity: number;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function asStoredReservation(value: unknown): StoredReservation | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.quantity !== "number") return undefined;
  return value as unknown as StoredReservation;
}

function isActive(reservation: StoredReservation | undefined): reservation is StoredReservation {
  return reservation !== undefined && reservation.status === "active";
}

function isReleasable(reservation: StoredReservation | undefined): reservation is StoredReservation {
  return reservation !== undefined && (reservation.status === "active" || reservation.status === "confirmed");
}

async function findInventoryForLine(
  repositories: CommerceRepositories,
  line: OrderSnapshotLine,
): Promise<{ id: string; data: InventoryRecord } | undefined> {
  if (typeof line.productId !== "string") return undefined;
  const page = await repositories.inventory.query({ where: { productId: line.productId }, limit: 100 });
  for (const item of page.items) {
    if (!isRecord(item.data)) continue;
    const data = item.data as unknown as InventoryRecord;
    const variantId = typeof data.variantId === "string" ? data.variantId : undefined;
    if ((line.variantId ?? undefined) === variantId && data.status === "active") {
      return { id: item.id, data };
    }
  }
  return undefined;
}

async function adjustInventoryForReservation(
  repositories: CommerceRepositories,
  reservation: StoredReservation,
  mode: "restore" | "consume",
): Promise<void> {
  if (typeof reservation.inventoryId !== "string") return;
  const raw = await repositories.inventory.get(reservation.inventoryId);
  if (!isRecord(raw)) return;
  const available = typeof raw.available === "number" ? raw.available : 0;
  const reserved = typeof raw.reserved === "number" ? raw.reserved : 0;
  const nextReserved = Math.max(0, reserved - reservation.quantity);
  const nextAvailable = mode === "restore" ? available + reservation.quantity : available;
  await repositories.inventory.put(reservation.inventoryId, {
    ...raw,
    available: nextAvailable,
    reserved: nextReserved,
    updatedAt: new Date().toISOString(),
  } as never);
}

export async function releaseReservationRecord(
  repositories: CommerceRepositories,
  reservation: StoredReservation,
): Promise<void> {
  await adjustInventoryForReservation(repositories, reservation, "restore");
  await repositories.reservations.put(reservation.id, {
    ...releaseReservation(reservation),
    updatedAt: new Date().toISOString(),
  } as never);
}

export async function reserveOrderStock(
  repositories: CommerceRepositories,
  order: { id: string; lines: readonly OrderSnapshotLine[] },
): Promise<void> {
  const applied: AppliedReservation[] = [];
  try {
    for (const line of order.lines) {
      const inventory = await findInventoryForLine(repositories, line);
      if (!inventory) continue;
      const reservationId = `res-${order.id}:${line.lineId}`;
      const existing = asStoredReservation(await repositories.reservations.get(reservationId));
      const usableExisting = existing && existing.status !== "released" && existing.status !== "expired" ? existing : undefined;
      const now = new Date();
      const result = reserveInventory({
        available: inventory.data.available,
        requested: line.quantity,
        reservationId,
        orderId: order.id,
        ...(inventory.data.sku === undefined ? {} : { sku: inventory.data.sku }),
        idempotencyKey: `${order.id}:${line.lineId}`,
        expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS).toISOString(),
        now: now.toISOString(),
        ...(usableExisting ? { existingReservation: usableExisting } : {}),
      });
      if (!result.ok) {
        throw new InsufficientStockError(`Insufficient stock for ${line.name ?? line.sku ?? line.productId}`);
      }
      const record: StoredReservation = {
        ...result.reservation,
        inventoryId: inventory.id,
        productId: line.productId,
        ...(line.variantId === undefined ? {} : { variantId: line.variantId }),
        lineId: line.lineId,
        updatedAt: now.toISOString(),
      };
      await repositories.reservations.put(reservationId, record as never);
      await repositories.inventory.put(inventory.id, {
        ...inventory.data,
        available: result.remaining,
        reserved: inventory.data.reserved + line.quantity,
        updatedAt: now.toISOString(),
      } as never);
      applied.push({ reservationId, inventoryId: inventory.id, quantity: line.quantity });
    }
  } catch (error) {
    for (const entry of [...applied].reverse()) {
      const stored = asStoredReservation(await repositories.reservations.get(entry.reservationId));
      if (!isActive(stored)) continue;
      await releaseReservationRecord(repositories, stored);
    }
    throw error;
  }
}

export async function loadActiveReservations(
  repositories: CommerceRepositories,
  orderId: string,
): Promise<StoredReservation[]> {
  const page = await repositories.reservations.query({ where: { orderId }, limit: 100 });
  return page.items.map(({ data }) => asStoredReservation(data)).filter(isActive);
}

export async function loadReleasableReservations(
  repositories: CommerceRepositories,
  orderId: string,
): Promise<StoredReservation[]> {
  const page = await repositories.reservations.query({ where: { orderId }, limit: 100 });
  return page.items.map(({ data }) => asStoredReservation(data)).filter(isReleasable);
}

export async function confirmOrderReservations(repositories: CommerceRepositories, orderId: string): Promise<void> {
  for (const reservation of await loadActiveReservations(repositories, orderId)) {
    await repositories.reservations.put(reservation.id, {
      ...confirmReservation(reservation),
      updatedAt: new Date().toISOString(),
    } as never);
    await adjustInventoryForReservation(repositories, reservation, "consume");
  }
}

export async function releaseOrderReservations(repositories: CommerceRepositories, orderId: string): Promise<void> {
  for (const reservation of await loadReleasableReservations(repositories, orderId)) {
    await releaseReservationRecord(repositories, reservation);
  }
}

const UNPAID_ORDER_STATUSES = new Set(["draft", "pending_payment"]);

export async function expireDueReservations(
  repositories: CommerceRepositories,
  now = new Date(),
): Promise<number> {
  const page = await repositories.reservations.query({ where: { status: "active" }, limit: 100 });
  let expiredCount = 0;
  for (const item of page.items) {
    const reservation = asStoredReservation(item.data);
    if (!reservation || typeof reservation.expiresAt !== "string") continue;
    const expired = expireReservation(reservation, now.toISOString());
    if (expired.status !== "expired") continue;
    const order = typeof reservation.orderId === "string" ? await repositories.orders.get(reservation.orderId) : undefined;
    const orderStatus = isRecord(order) && typeof order.status === "string" ? order.status : undefined;
    if (orderStatus !== undefined && !UNPAID_ORDER_STATUSES.has(orderStatus)) continue;
    await repositories.reservations.put(expired.id, { ...expired, updatedAt: now.toISOString() } as never);
    await adjustInventoryForReservation(repositories, expired, "restore");
    expiredCount += 1;
  }
  return expiredCount;
}
