import { getBridgeSigningData, getCommerceEventSigningData } from "@emdash-commerce/contracts";
import type { BridgeRequest, CommerceEvent } from "@emdash-commerce/contracts";
import type { PluginContext, RouteHandler } from "emdash/plugin";
import { signBridgePayload, verifyBridgePayload } from "./bridge/signature.js";
import type {
	CommercePaymentCreateData,
	CommercePaymentRefundData,
	CommercePaymentStatusData,
} from "./bridge/types.js";

interface BridgeSettings {
	commerceBridgeSecret: string | undefined;
	commerceEventUrl: string;
	brandId: string;
}

interface PaymentRecordLike {
	id: string;
	purchaseId: string;
	returnToken: string;
	reference: string;
	amount: number;
	currency: string;
	status: string;
	productName: string;
	checkoutUrl?: string;
	paidOn?: string;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
	commerceOrderId?: string;
	commercePaymentId?: string;
	idempotencyKey?: string;
}

interface BridgeDeps {
	loadSettings(ctx: PluginContext): Promise<BridgeSettings>;
	createChipPurchase(ctx: PluginContext, payload: Record<string, unknown>): Promise<{ purchase?: Record<string, unknown>; error?: string }>;
	getChipPurchase(ctx: PluginContext, purchaseId: string): Promise<{ purchase?: Record<string, unknown>; error?: string }>;
	normalizeStatus(raw: unknown): string | undefined;
	paidOnOf(purchase: Record<string, unknown>): string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response<T>(requestId: string, data: T): Record<string, unknown> {
	return { requestId, ok: true, data };
}

function failure(requestId: string, code: string, message: string, retryable: boolean): Record<string, unknown> {
	return { requestId, ok: false, error: { code, message, retryable } };
}

async function authenticate(
	routeCtx: Parameters<RouteHandler>[0],
	ctx: PluginContext,
	deps: BridgeDeps,
): Promise<{ request: BridgeRequest<unknown>; settings: BridgeSettings } | { error: Record<string, unknown> }> {
	const input = routeCtx.input;
	if (!isRecord(input)) return { error: failure("", "INVALID_REQUEST", "Bridge request must be an object", false) };
	const requestId = typeof input.requestId === "string" ? input.requestId : "";
	const settings = await deps.loadSettings(ctx);
	if (!settings.commerceBridgeSecret) return { error: failure(requestId, "BRIDGE_NOT_CONFIGURED", "Commerce bridge is not configured", false) };
	const auth = input.auth;
	if (!isRecord(auth) || typeof auth.timestamp !== "string" || typeof auth.signature !== "string" || auth.version !== 1) {
		return { error: failure(requestId, "BRIDGE_AUTH_FAILED", "Missing bridge authentication", false) };
	}
	if (input.version !== 1 || typeof input.contract !== "string" || typeof input.sentAt !== "string" || typeof input.idempotencyKey !== "string" || !("payload" in input)) {
		return { error: failure(requestId, "INVALID_REQUEST", "Invalid bridge envelope", false) };
	}
	const request = input as unknown as BridgeRequest<unknown>;
	try {
		await verifyBridgePayload(settings.commerceBridgeSecret, auth.timestamp, getBridgeSigningData(request), auth.signature, Date.now());
	} catch (error) {
		return { error: failure(requestId, error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "BRIDGE_AUTH_FAILED", "Invalid bridge authentication", false) };
	}
	return { request, settings };
}

function paymentRecord(value: unknown): PaymentRecordLike | undefined {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.purchaseId !== "string" || typeof value.reference !== "string" || typeof value.amount !== "number" || typeof value.currency !== "string" || typeof value.status !== "string" || typeof value.productName !== "string" || typeof value.returnToken !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return undefined;
	return value as unknown as PaymentRecordLike;
}

async function findByIdempotency(ctx: PluginContext, key: string): Promise<{ id: string; data: PaymentRecordLike } | undefined> {
	const result = await ctx.storage.payments?.query({ where: { idempotencyKey: key }, limit: 1 });
	const item = result?.items[0];
	if (!item) return undefined;
	const data = paymentRecord(item.data);
	return data ? { id: item.id, data } : undefined;
}

async function findPayment(ctx: PluginContext, paymentId: string): Promise<{ id: string; data: PaymentRecordLike } | undefined> {
	const direct = paymentRecord(await ctx.storage.payments?.get(paymentId));
	if (direct) return { id: paymentId, data: direct };
	const result = await ctx.storage.payments?.query({ where: { purchaseId: paymentId }, limit: 1 });
	const item = result?.items[0];
	const data = item ? paymentRecord(item.data) : undefined;
	return item && data ? { id: item.id, data } : undefined;
}

async function emitCommerceEvent(
	ctx: PluginContext,
	settings: BridgeSettings,
	event: string,
	payment: PaymentRecordLike,
): Promise<void> {
	if (!settings.commerceEventUrl || !settings.commerceBridgeSecret) return;
	const now = new Date().toISOString();
	const commerceEvent: CommerceEvent<Record<string, unknown>> = {
		eventId: crypto.randomUUID(),
		event,
		version: 1,
		occurredAt: now,
		correlationId: payment.commerceOrderId ?? payment.reference,
		deliveryId: `${payment.id}:${event}:${payment.updatedAt}`,
		payload: {
			providerId: "chip",
			paymentId: payment.commercePaymentId ?? payment.id,
			purchaseId: payment.purchaseId,
			commerceOrderId: payment.commerceOrderId ?? payment.reference,
			status: payment.status,
			...(payment.paidOn ? { paidOn: payment.paidOn } : {}),
		},
	};
	const body = getCommerceEventSigningData(commerceEvent);
	const signature = await signBridgePayload(settings.commerceBridgeSecret, now, body);
	await ctx.http?.fetch(settings.commerceEventUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-emdash-provider-id": "chip",
			"x-emdash-bridge-signature": signature,
			"x-emdash-bridge-timestamp": now,
		},
		body,
	});
}

export function createCommerceBridgeRoutes(deps: BridgeDeps): Record<string, { public: true; handler: RouteHandler }> {
	const create: RouteHandler = async (routeCtx, ctx) => {
		const auth = await authenticate(routeCtx, ctx, deps);
		if ("error" in auth) return auth.error;
		if (auth.request.contract !== "commerce.payment.create") return failure(auth.request.requestId, "UNSUPPORTED_CONTRACT", "Unsupported Commerce payment contract", false);
		const payload = isRecord(auth.request.payload) ? auth.request.payload : {};
		const order = isRecord(payload.order) ? payload.order : {};
		const orderId = typeof order.orderId === "string" ? order.orderId : undefined;
		const currency = isRecord(order.total) && typeof order.total.currency === "string" ? order.total.currency : undefined;
		const amount = isRecord(payload.amount) && typeof payload.amount.amountMinor === "number" ? payload.amount.amountMinor : isRecord(order.total) && typeof order.total.amountMinor === "number" ? order.total.amountMinor : undefined;
		if (!orderId || !currency || amount === undefined) return failure(auth.request.requestId, "INVALID_PAYMENT", "Payment command is missing order total data", false);
		const existing = await findByIdempotency(ctx, auth.request.idempotencyKey);
		if (existing) return response(auth.request.requestId, { paymentId: existing.data.commercePaymentId ?? existing.id, providerId: "chip", checkoutUrl: existing.data.checkoutUrl, status: existing.data.status });
		const firstItem = Array.isArray(order.items) && isRecord(order.items[0]) ? order.items[0] : undefined;
		const name = typeof firstItem?.name === "string" ? firstItem.name : orderId;
		const created = await deps.createChipPurchase(ctx, {
			client: {},
			purchase: { currency, products: [{ name, price: amount, quantity: "1" }] },
			brand_id: auth.settings.brandId,
			reference: orderId,
			metadata: { commerceOrderId: orderId, commercePaymentId: auth.request.requestId, idempotencyKey: auth.request.idempotencyKey },
		});
		const purchaseId = created.purchase && typeof created.purchase.id === "string" ? created.purchase.id : undefined;
		const checkoutUrl = created.purchase && typeof created.purchase.checkout_url === "string" ? created.purchase.checkout_url : undefined;
		if (!purchaseId || !checkoutUrl) return failure(auth.request.requestId, "PROVIDER_ERROR", created.error ?? "Payment provider failed", true);
		const now = new Date().toISOString();
		const record = {
			id: crypto.randomUUID(), purchaseId, returnToken: crypto.randomUUID(), reference: orderId, amount, currency,
			status: "created", productName: name, checkoutUrl, createdAt: now, updatedAt: now,
			commerceOrderId: orderId, commercePaymentId: auth.request.requestId, idempotencyKey: auth.request.idempotencyKey,
		};
		await ctx.storage.payments?.put(record.id, record);
		await emitCommerceEvent(ctx, auth.settings, "commerce.payment.created", record);
		return response<CommercePaymentCreateData>(auth.request.requestId, { paymentId: auth.request.requestId, providerId: "chip", checkoutUrl, status: "created" });
	};

	const status: RouteHandler = async (routeCtx, ctx) => {
		const auth = await authenticate(routeCtx, ctx, deps);
		if ("error" in auth) return auth.error;
		const payload = isRecord(auth.request.payload) ? auth.request.payload : {};
		const paymentId = typeof payload.paymentId === "string" ? payload.paymentId : typeof payload.paymentReference === "string" ? payload.paymentReference : undefined;
		if (!paymentId) return failure(auth.request.requestId, "INVALID_PAYMENT", "paymentId is required", false);
		const entry = await findPayment(ctx, paymentId);
		if (!entry) return failure(auth.request.requestId, "NOT_FOUND", "Payment not found", false);
		const verified = await deps.getChipPurchase(ctx, entry.data.purchaseId);
		if (!verified.purchase) return failure(auth.request.requestId, "PROVIDER_ERROR", verified.error ?? "Payment reconciliation failed", true);
		const normalized = deps.normalizeStatus(verified.purchase.status) ?? entry.data.status;
		const paidOn = deps.paidOnOf(verified.purchase);
		if (normalized !== entry.data.status) {
			const updated = { ...entry.data, status: normalized, ...(paidOn ? { paidOn } : {}), updatedAt: new Date().toISOString() };
			await ctx.storage.payments?.put(entry.id, updated);
			await emitCommerceEvent(ctx, auth.settings, `commerce.payment.${normalized}`, updated);
			entry.data = updated;
		}
		return response<CommercePaymentStatusData>(auth.request.requestId, { paymentId: entry.data.commercePaymentId ?? entry.id, providerId: "chip", checkoutUrl: entry.data.checkoutUrl ?? "", status: normalized as CommercePaymentStatusData["status"], purchaseId: entry.data.purchaseId, ...(entry.data.paidOn ? { paidOn: entry.data.paidOn } : {}) });
	};

	const refund: RouteHandler = async (routeCtx, ctx) => {
		const auth = await authenticate(routeCtx, ctx, deps);
		if ("error" in auth) return auth.error;
		const payload = isRecord(auth.request.payload) ? auth.request.payload : {};
		const paymentId = typeof payload.paymentId === "string" ? payload.paymentId : undefined;
		if (!paymentId) return failure(auth.request.requestId, "INVALID_PAYMENT", "paymentId is required", false);
		const entry = await findPayment(ctx, paymentId);
		if (!entry) return failure(auth.request.requestId, "NOT_FOUND", "Payment not found", false);
		const updated = { ...entry.data, metadata: { ...entry.data.metadata, commerceRefundRequested: "true", commerceRefundRequestId: auth.request.requestId }, updatedAt: new Date().toISOString() };
		await ctx.storage.payments?.put(entry.id, updated);
		return response<CommercePaymentRefundData>(auth.request.requestId, { paymentId: entry.data.commercePaymentId ?? entry.id, status: "MANUAL_PROVIDER_ACTION", message: "Refund request recorded for provider reconciliation" });
	};

	return {
		"commerce/payment/create": { public: true, handler: create },
		"commerce/payment/status": { public: true, handler: status },
		"commerce/payment/refund": { public: true, handler: refund },
	};
}
