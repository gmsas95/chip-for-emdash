import type { FormEvent } from "react";
import { allowedCommandsFor } from "../domain/order-state.js";
import type { OrderStatus } from "../domain/order-state.js";
import type { AdminPageElement, AdminPageProps } from "./shared.js";
import { DataState, formatMinorAmount, useCommerceData, useCommerceMutation } from "./shared.js";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_payment: "Pending payment",
  paid: "Paid",
  processing: "Processing",
  partially_fulfilled: "Partially fulfilled",
  fulfilled: "Fulfilled",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  refunded: "Refunded",
};

const COMMAND_LABELS: Record<string, string> = {
  payment_failed: "Mark payment failed",
  fulfillment_processing: "Start fulfilment",
  fulfillment_partially_fulfilled: "Mark partially fulfilled",
  fulfillment_completed: "Mark fulfilled",
  complete: "Complete order",
  cancel: "Cancel order",
};

export function statusLabel(status?: string): string {
  return (status !== undefined && STATUS_LABELS[status]) || status || "Unknown";
}

export function commandLabel(command: string): string {
  return COMMAND_LABELS[command] ?? command;
}

export function formatOrderRef(order: { orderNumber?: number; id?: string; orderId?: string }): string {
  if (typeof order.orderNumber === "number") return `#${order.orderNumber}`;
  const raw = order.orderId ?? order.id ?? "";
  return raw.length > 12 ? `#${raw.slice(0, 8).toUpperCase()}` : `#${raw}`;
}

const TERMINAL_HINTS: Record<string, string> = {
  cancelled: "This order is cancelled and can no longer be changed.",
  completed: "This order is completed and can no longer be changed.",
  refunded: "This order has been refunded and can no longer be changed.",
};

export function terminalHint(status?: string): string {
  if (status !== undefined && TERMINAL_HINTS[status]) return TERMINAL_HINTS[status];
  return statusLabel(status) === "Unknown" ? "" : "";
}

export interface StatusTransitionOption {
  command: string;
  label: string;
}

export function statusTransitionOptions(order: { status?: string; paymentStatus?: string; fulfillmentStatus?: string }): StatusTransitionOption[] {
  if (typeof order.status !== "string") return [];
  const state = {
    status: order.status as OrderStatus,
    ...(typeof order.paymentStatus === "string" ? { paymentStatus: order.paymentStatus } : {}),
    ...(typeof order.fulfillmentStatus === "string" ? { fulfillmentStatus: order.fulfillmentStatus } : {}),
  } as Parameters<typeof allowedCommandsFor>[0];
  return allowedCommandsFor(state).map((command) => ({ command: command.type, label: commandLabel(command.type) }));
}

interface AddressView {
  name?: string;
  company?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
}

interface OrderView {
  id: string;
  orderId?: string;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  subtotalMinor?: number;
  discountMinor?: number;
  taxMinor?: number;
  shippingMinor?: number;
  totalMinor?: number;
  createdAt?: string;
  lines?: Array<{ lineId?: string; name?: string; quantity?: number; totalMinor?: number }>;
  customer?: { name?: string; email?: string; phone?: string };
  billingAddress?: AddressView;
  shippingAddress?: AddressView;
  paymentProviderId?: string;
}

interface NoteView {
  id: string;
  note: string;
  type: string;
  system?: boolean;
  createdAt: string;
}

function formatAddress(address?: AddressView): string[] {
  if (!address) return [];
  return [
    address.name,
    address.company,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(" "),
    address.country,
    address.phone,
  ].filter((line): line is string => typeof line === "string" && line !== "");
}

function formatDate(value?: string): string {
  if (typeof value !== "string" || value === "") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function OrderDetail({ orderId, apiBasePath, onChanged }: AdminPageProps & { orderId: string; onChanged?: () => void }): AdminPageElement {
  const encodedOrderId = encodeURIComponent(orderId);
  const orderResult = useCommerceData<OrderView>(`/orders?orderId=${encodedOrderId}`, apiBasePath);
  const notesResult = useCommerceData<{ items: NoteView[] }>(`/orders/notes?orderId=${encodedOrderId}`, apiBasePath);
  const statusMutation = useCommerceMutation<{ orderId: string; command: string }>("/orders/status", apiBasePath);
  const refundMutation = useCommerceMutation<{ orderId: string }>("/orders/refund", apiBasePath);
  const noteMutation = useCommerceMutation<{ orderId: string; note: string; type: string }>("/orders/notes", apiBasePath);

  const order = orderResult.data;
  const transitions = statusTransitionOptions(order ?? {});
  const busy = statusMutation.loading || refundMutation.loading;

  function afterMutation(): void {
    orderResult.reload();
    notesResult.reload();
    onChanged?.();
  }

  async function applyStatus(command: string): Promise<void> {
    if (command === "cancel" && !window.confirm("Cancel this order? Cancelled orders are final and reserved stock will be returned.")) return;
    try {
      await statusMutation.submit({ orderId, command });
      afterMutation();
    } catch {
      /* error surfaced via mutation hook state */
    }
  }

  async function refund(): Promise<void> {
    if (!window.confirm("Request a provider refund for this order?")) return;
    try {
      await refundMutation.submit({ orderId });
      afterMutation();
    } catch {
      /* error surfaced via mutation hook state */
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const note = String(data.get("note") ?? "");
    const type = String(data.get("type") ?? "private");
    try {
      await noteMutation.submit({ orderId, note, type });
      form.reset();
      afterMutation();
    } catch {
      /* error surfaced via mutation hook state */
    }
  }


  return (
    <article aria-label={`Order ${orderId}`}>
      <DataState loading={orderResult.loading} error={orderResult.error}>
        {order ? (
          <>
            <header>
              <h3>Order {formatOrderRef(order)}</h3>
              <p>
                <strong>{statusLabel(order.status)}</strong>
                {order.createdAt === undefined ? null : <> · {formatDate(order.createdAt)}</>}
              </p>
            </header>
            <p>
              Payment: {order.paymentProviderId ?? "—"} ({statusLabel(order.paymentStatus)}) · Total:{" "}
              <strong>{formatMinorAmount(order.totalMinor ?? 0, order.currency ?? "USD")}</strong>
            </p>
            <section aria-labelledby="commerce-order-actions">
              <h2 id="commerce-order-actions">Actions</h2>
              <div className="commerce-admin-toolbar">
                <select
                  aria-label="Change order status"
                  value=""
                  disabled={busy || transitions.length === 0}
                  onChange={(event) => {
                    const command = event.target.value;
                    if (command !== "") void applyStatus(command);
                  }}
                >
                  <option value="">{busy ? "Applying…" : transitions.length === 0 ? "No actions available" : "Choose action…"}</option>
                  {transitions.map(({ command, label }) => <option key={command} value={command}>{label}</option>)}
                </select>
                {order.status === "paid" || order.status === "processing" ? (
                  <button type="button" className="commerce-btn" onClick={() => void refund()} disabled={busy}>{busy ? "Working…" : "Refund…"}</button>
                ) : null}
              </div>
              {(statusMutation.error ?? refundMutation.error) ? (
                <p role="alert">{statusMutation.error ?? refundMutation.error}</p>
              ) : null}
              {busy ? null : transitions.length === 0 ? (
                <p role="status" style={{ margin: 0, color: "var(--commerce-muted)" }}>{terminalHint(order.status)}</p>
              ) : null}
            </section>
            <section aria-labelledby="commerce-order-items">
              <h2 id="commerce-order-items">Items</h2>
              <table>
                <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Total</th></tr></thead>
                <tbody>
                  {(order.lines ?? []).map((line) => (
                    <tr key={line.lineId ?? line.name}>
                      <td>{line.name}</td>
                      <td>{line.quantity}</td>
                      <td>{formatMinorAmount(line.totalMinor ?? 0, order.currency ?? "USD")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section aria-labelledby="commerce-order-parties">
              <h2 id="commerce-order-parties">Customer</h2>
              <p>{order.customer?.name ?? "Guest"}{order.customer?.email ? ` · ${order.customer.email}` : ""}</p>
              {[["Billing", order.billingAddress], ["Shipping", order.shippingAddress]].map(([label, address]) => {
                const lines = formatAddress(address as AddressView | undefined);
                return lines.length === 0 ? null : (
                  <div key={String(label)}>
                    <h4>{String(label)}</h4>
                    {lines.map((line) => <p key={line}>{line}</p>)}
                  </div>
                );
              })}
            </section>
          </>
        ) : !orderResult.loading && !orderResult.error ? (
          <p role="alert">Order not found.</p>
        ) : null}
      </DataState>
      <section aria-labelledby="commerce-order-notes">
        <h2 id="commerce-order-notes">Notes</h2>
        <form onSubmit={(event) => void addNote(event)}>
          <label>
            Add a note
            <textarea name="note" required maxLength={2000} placeholder="Add an internal note or customer-facing update…" />
          </label>
          <label>
            Type
            <select name="type" defaultValue="private">
              <option value="private">Private (admin only)</option>
              <option value="customer">Customer-facing</option>
            </select>
          </label>
          <button type="submit" className="commerce-btn" disabled={noteMutation.loading}>{noteMutation.loading ? "Adding…" : "Add note"}</button>
        </form>
        {noteMutation.error ? <p role="alert">{noteMutation.error}</p> : null}
        {notesResult.data?.items.length ? (
          notesResult.data.items.map((note) => (
            <p key={note.id}>
              <em>[{note.type === "customer" ? "customer" : note.system ? "system" : "private"}]</em> {note.note} — {formatDate(note.createdAt)}
            </p>
          ))
        ) : (
          <p><span role="status">No notes yet.</span></p>
        )}
      </section>
    </article>
  );
}
