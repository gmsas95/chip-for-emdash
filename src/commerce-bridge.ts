import type { BridgeRequest, CommerceEvent } from "@gmsas95/emdash-commerce-contracts";
import type { PluginContext, RouteHandler } from "emdash/plugin";
import { signBridgePayload, verifyBridgePayload } from "./bridge/signature.js";
import type {
	CommercePaymentCreateData,
	CommercePaymentRefundData,
	CommercePaymentStatusData,
} from "./bridge/types.js";

export interface BridgeSettings {
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
	createChipPurchase(ctx: PluginContext, payload: Record<string, unknown>): Promise<{ purchase?: Record<string, unknown>; error?: string; retryable?: boolean }>;
	getChipPurchase(ctx: PluginContext, purchaseId: string): Promise<{ purchase?: Record<string, unknown>; error?: string; retryable?: boolean }>;
	normalizeStatus(raw: unknown): string | undefined;
	paidOnOf(purchase: Record<string, unknown>): string | undefined;
}

const createLocks = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(input: unknown): unknown {
	if (Array.isArray(input)) return input.map(canonicalize);
	if (isRecord(input)) {
		return Object.keys(input).sort().reduce<Record<string, unknown>>((result, key) => {
			result[key] = canonicalize(input[key]);
			return result;
		}, {});
	}
	return input;
}

function getBridgeSigningData(request: BridgeRequest<unknown>): string {
	return JSON.stringify(canonicalize({
		contract: request.contract,
		version: request.version,
		requestId: request.requestId,
		idempotencyKey: request.idempotencyKey,
		sentAt: request.sentAt,
		auth: {
			version: request.auth.version,
			keyId: request.auth.keyId,
			timestamp: request.auth.timestamp,
		},
		payload: request.payload,
	}));
}

function getCommerceEventSigningData(event: CommerceEvent<unknown>): string {
	return JSON.stringify(canonicalize(event));
}

function parseChargePayload(input: unknown): Record<string, unknown> {
	if (!isRecord(input) || input.operation !== "charge" || !isRecord(input.order)) throw new Error("Invalid Commerce payment command");
	const total = input.order.total;
	if (!isRecord(total) || typeof total.amountMinor !== "number" || !Number.isSafeInteger(total.amountMinor) || total.amountMinor < 0 || typeof total.currency !== "string" || !/^[A-Z]{3}$/.test(total.currency)) {
		throw new Error("Invalid Commerce order total");
	}
	if (!Array.isArray(input.order.items)) throw new Error("Invalid Commerce order items");
	return input;
}

function response<T>(requestId: string, data: T): Record<string, unknown> {
	return { requestId, ok: true, data };
}

function failure(requestId: string, code: string, message: string, retryable: boolean): Record<string, unknown> {
	return { requestId, ok: false, error: { code, message, retryable } };
}
function providerErrorRetryable(error: unknown): boolean {
	const message = error instanceof Error ? error.message : "";
	return !/secret key|network:request|not configured/i.test(message);
}
interface CommerceEventDeliveryRecord {
	id: string;
	deliveryId: string;
	eventUrl: string;
	timestamp: string;
	signature: string;
	body: string;
	status: "pending" | "delivered";
	attempts: number;
	nextAttemptAt?: string;
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
	if (!requestId || !settings.commerceBridgeSecret) return { error: failure(requestId, settings.commerceBridgeSecret ? "INVALID_REQUEST" : "BRIDGE_NOT_CONFIGURED", settings.commerceBridgeSecret ? "requestId is required" : "Commerce bridge is not configured", false) };
	const auth = input.auth;
	if (!isRecord(auth) || auth.version !== 1 || typeof auth.keyId !== "string" || auth.keyId.length === 0 || typeof auth.timestamp !== "string" || typeof auth.signature !== "string") {
		return { error: failure(requestId, "BRIDGE_AUTH_FAILED", "Missing bridge authentication", false) };
	}
	if (input.version !== 1 || typeof input.contract !== "string" || typeof input.sentAt !== "string" || input.sentAt !== auth.timestamp || typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0 || !("payload" in input)) {
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
	for (const field of ["commercePaymentId", "commerceOrderId", "reference", "purchaseId"] as const) {
		const result = await ctx.storage.payments?.query({ where: { [field]: paymentId }, limit: 1 });
		const item = result?.items[0];
		const data = item ? paymentRecord(item.data) : undefined;
		if (item && data) return { id: item.id, data };
	}
	return undefined;
}

export async function emitCommerceEvent(
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
	const existing = await ctx.storage.commerce_events?.get(commerceEvent.deliveryId);
	if (isRecord(existing) && existing.status === "delivered") return;
	const delivery: CommerceEventDeliveryRecord = isRecord(existing)
		? existing as unknown as CommerceEventDeliveryRecord
		: { id: commerceEvent.deliveryId, deliveryId: commerceEvent.deliveryId, eventUrl: settings.commerceEventUrl, timestamp: now, signature, body, status: "pending", attempts: 0 };
	await ctx.storage.commerce_events?.put(delivery.id, delivery);
	if (!ctx.http) return;
	try {
		const response = await ctx.http.fetch(delivery.eventUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-emdash-provider-id": "chip",
				"x-emdash-bridge-signature": delivery.signature,
				"x-emdash-bridge-timestamp": delivery.timestamp,
			},
			body: delivery.body,
		});
		if (response.ok) {
			await ctx.storage.commerce_events?.put(delivery.id, { ...delivery, status: "delivered", attempts: delivery.attempts + 1 });
		} else {
			await ctx.storage.commerce_events?.put(delivery.id, { ...delivery, status: "pending", attempts: delivery.attempts + 1, nextAttemptAt: new Date(Date.now() + 30_000).toISOString() });
		}
	} catch {
		await ctx.storage.commerce_events?.put(delivery.id, { ...delivery, status: "pending", attempts: delivery.attempts + 1, nextAttemptAt: new Date(Date.now() + 30_000).toISOString() });
	}
}

export function createCommerceBridgeRoutes(deps: BridgeDeps): Record<string, { public: true; handler: RouteHandler }> {
	const create: RouteHandler = async (routeCtx, ctx) => {
		const auth = await authenticate(routeCtx, ctx, deps);
		if ("error" in auth) return auth.error;
		if (auth.request.contract !== "commerce.payment.create") return failure(auth.request.requestId, "UNSUPPORTED_CONTRACT", "Unsupported Commerce payment contract", false);
		let payload: Record<string, unknown>;
		try {
			payload = parseChargePayload(auth.request.payload);
		} catch {
			return failure(auth.request.requestId, "INVALID_PAYLOAD", "Invalid Commerce payment command", false);
		}
		if (payload.operation !== "charge") return failure(auth.request.requestId, "UNSUPPORTED_OPERATION", "Only charge creates a hosted payment", false);
		const order = isRecord(payload.order) ? payload.order : {};
		const orderId = typeof order.orderId === "string" ? order.orderId : undefined;
		const currency = isRecord(order.total) && typeof order.total.currency === "string" ? order.total.currency : undefined;
		const amount = isRecord(payload.amount) && typeof payload.amount.amountMinor === "number" ? payload.amount.amountMinor : isRecord(order.total) && typeof order.total.amountMinor === "number" ? order.total.amountMinor : undefined;
		if (!orderId || !currency || amount === undefined) return failure(auth.request.requestId, "INVALID_PAYMENT", "Payment command is missing order total data", false);
		const firstItem = Array.isArray(order.items) && isRecord(order.items[0]) ? order.items[0] : undefined;
		const name = typeof firstItem?.name === "string" ? firstItem.name : orderId;
		const lockKey = auth.request.idempotencyKey;
		const previous = createLocks.get(lockKey);
		let release!: () => void;
		const current = new Promise<void>((resolve) => { release = resolve; });
		createLocks.set(lockKey, current);
		await previous;
		try {
			const existing = await findByIdempotency(ctx, auth.request.idempotencyKey);
			if (existing) {
				if (existing.data.commerceOrderId !== orderId || existing.data.amount !== amount || existing.data.currency !== currency) {
					return failure(auth.request.requestId, "IDEMPOTENCY_CONFLICT", "Idempotency key was reused with different payment data", false);
				}
				if (existing.data.status === "creating") return failure(auth.request.requestId, "PAYMENT_CREATION_IN_PROGRESS", "Payment creation is already in progress", true);
				return response(auth.request.requestId, { paymentId: existing.data.commercePaymentId ?? existing.id, providerId: "chip", checkoutUrl: existing.data.checkoutUrl, status: existing.data.status });
			}
			const now = new Date().toISOString();
			const paymentId = crypto.randomUUID();
			const returnToken = crypto.randomUUID();
			const requestUrl = new URL(routeCtx.request.url);
			const returnUrl = `${requestUrl.origin}/_emdash/api/plugins/chip-for-emdash/return?token=${returnToken}`;
			const callbackAllowed = requestUrl.port === "" || requestUrl.port === "80" || requestUrl.port === "443";
			const claimRecord = {
				id: paymentId, purchaseId: "", returnToken, reference: orderId, amount, currency,
				status: "creating", productName: name, createdAt: now, updatedAt: now,
				commerceOrderId: orderId, commercePaymentId: auth.request.requestId, idempotencyKey: auth.request.idempotencyKey,
			};
			try {
				await ctx.storage.payments?.put(claimRecord.id, claimRecord);
			} catch {
				return failure(auth.request.requestId, "PAYMENT_CREATION_IN_PROGRESS", "Payment creation is already in progress", true);
			}
			let created: { purchase?: Record<string, unknown>; error?: string; retryable?: boolean };
		try {
			created = await deps.createChipPurchase(ctx, {
				client: {},
				purchase: { currency, products: [{ name, price: amount, quantity: "1" }] },
				brand_id: auth.settings.brandId,
				reference: orderId,
				success_redirect: returnUrl,
				failure_redirect: returnUrl,
				cancel_redirect: returnUrl,
				...(callbackAllowed ? { success_callback: returnUrl } : {}),
				metadata: { commerceOrderId: orderId, commercePaymentId: auth.request.requestId, idempotencyKey: auth.request.idempotencyKey },
			});
		} catch (error) {
			return failure(auth.request.requestId, "PROVIDER_ERROR", "Payment provider unavailable", providerErrorRetryable(error));
		}
		const purchaseId = created.purchase && typeof created.purchase.id === "string" ? created.purchase.id : undefined;
		const checkoutUrl = created.purchase && typeof created.purchase.checkout_url === "string" ? created.purchase.checkout_url : undefined;
		if (!purchaseId || !checkoutUrl) return failure(auth.request.requestId, "PROVIDER_ERROR", created.error ?? "Payment provider failed", created.retryable === true);
		const record = {
			id: paymentId, purchaseId, returnToken, reference: orderId, amount, currency,
			status: "created", productName: name, checkoutUrl, createdAt: now, updatedAt: now,
			commerceOrderId: orderId, commercePaymentId: auth.request.requestId, idempotencyKey: auth.request.idempotencyKey,
		};
		await ctx.storage.payments?.put(record.id, record);
		try {
			await emitCommerceEvent(ctx, auth.settings, "commerce.payment.created", record);
		} catch (error) {
			ctx.log.error("Commerce payment event delivery failed", error);
		}
		return response<CommercePaymentCreateData>(auth.request.requestId, { paymentId: auth.request.requestId, providerId: "chip", checkoutUrl, status: "created" });
		} finally {
			release();
			if (createLocks.get(lockKey) === current) createLocks.delete(lockKey);
		}
	};

	const status: RouteHandler = async (routeCtx, ctx) => {
		const auth = await authenticate(routeCtx, ctx, deps);
		if ("error" in auth) return auth.error;
		if (auth.request.contract !== "commerce.payment.status") return failure(auth.request.requestId, "UNSUPPORTED_CONTRACT", "Unsupported Commerce payment status contract", false);
		const payload = isRecord(auth.request.payload) ? auth.request.payload : {};
		const paymentId = typeof payload.paymentId === "string" ? payload.paymentId : typeof payload.paymentReference === "string" ? payload.paymentReference : undefined;
		if (!paymentId) return failure(auth.request.requestId, "INVALID_PAYMENT", "paymentId is required", false);
		const entry = await findPayment(ctx, paymentId);
		if (!entry) return failure(auth.request.requestId, "NOT_FOUND", "Payment not found", false);
		let verified: { purchase?: Record<string, unknown>; error?: string; retryable?: boolean };
		try {
			verified = await deps.getChipPurchase(ctx, entry.data.purchaseId);
		} catch (error) {
			return failure(auth.request.requestId, "PROVIDER_ERROR", "Payment reconciliation unavailable", providerErrorRetryable(error));
		}
		if (!verified.purchase) return failure(auth.request.requestId, "PROVIDER_ERROR", verified.error ?? "Payment reconciliation failed", verified.retryable === true);
		const normalizedRaw = deps.normalizeStatus(verified.purchase.status);
		if (!normalizedRaw) return failure(auth.request.requestId, "PROVIDER_ERROR", "Payment provider returned an unsupported status", false);
		const normalized = normalizedRaw === "hold" ? "created" : normalizedRaw;
		const paidOn = deps.paidOnOf(verified.purchase);
		if (normalized !== entry.data.status) {
			const updated = { ...entry.data, status: normalized, ...(paidOn ? { paidOn } : {}), updatedAt: new Date().toISOString() };
			await ctx.storage.payments?.put(entry.id, updated);
			try {
				await emitCommerceEvent(ctx, auth.settings, `commerce.payment.${normalized}`, updated);
			} catch (error) {
				ctx.log.error("Commerce payment event delivery failed", error);
			}
			entry.data = updated;
		}
		return response<CommercePaymentStatusData>(auth.request.requestId, { paymentId: entry.data.commercePaymentId ?? entry.id, providerId: "chip", checkoutUrl: entry.data.checkoutUrl ?? "", status: normalized as CommercePaymentStatusData["status"], purchaseId: entry.data.purchaseId, ...(entry.data.paidOn ? { paidOn: entry.data.paidOn } : {}) });
	};

	const refund: RouteHandler = async (routeCtx, ctx) => {
		const auth = await authenticate(routeCtx, ctx, deps);
		if ("error" in auth) return auth.error;
		if (auth.request.contract !== "commerce.payment.refund") return failure(auth.request.requestId, "UNSUPPORTED_CONTRACT", "Unsupported Commerce refund contract", false);
		const payload = isRecord(auth.request.payload) ? auth.request.payload : {};
		if (payload.operation !== undefined && payload.operation !== "refund") return failure(auth.request.requestId, "UNSUPPORTED_OPERATION", "Only refund creates a refund request", false);
		const paymentId = typeof payload.paymentId === "string" ? payload.paymentId : undefined;
		if (!paymentId) return failure(auth.request.requestId, "INVALID_PAYMENT", "paymentId is required", false);
		const entry = await findPayment(ctx, paymentId);
		if (!entry) return failure(auth.request.requestId, "NOT_FOUND", "Payment not found", false);
		let verified: { purchase?: Record<string, unknown>; error?: string; retryable?: boolean };
		try {
			verified = await deps.getChipPurchase(ctx, entry.data.purchaseId);
		} catch (error) {
			return failure(auth.request.requestId, "PROVIDER_ERROR", "Payment reconciliation unavailable", providerErrorRetryable(error));
		}
		if (!verified.purchase || typeof verified.purchase.status !== "string") return failure(auth.request.requestId, "PROVIDER_ERROR", verified.error ?? "Payment reconciliation failed", verified.retryable === true);
		const normalized = deps.normalizeStatus(verified.purchase.status);
		if (normalized === "refunded") {
			const updated = { ...entry.data, status: "refunded", updatedAt: new Date().toISOString() };
			await ctx.storage.payments?.put(entry.id, updated);
			try {
				await emitCommerceEvent(ctx, auth.settings, "commerce.payment.refunded", updated);
			} catch (error) {
				ctx.log.error("Commerce payment event delivery failed", error);
			}
			return response<CommercePaymentRefundData>(auth.request.requestId, { paymentId: entry.data.commercePaymentId ?? entry.id, status: "refunded", message: "Payment is already refunded" });
		}
		if (normalized !== "paid") return failure(auth.request.requestId, "REFUND_NOT_ELIGIBLE", "Payment is not provider-confirmed as paid", false);
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
