/**
 * CHIP for EmDash — sandboxed payment plugin.
 *
 * Lets EmDash site owners accept CHIP (https://chip-in.asia) payments —
 * FPX, e-wallet, card, DuitNow QR — via CHIP's hosted checkout, and
 * records each payment attempt in plugin storage with a status.
 *
 * Runs in both trusted (in-process) and sandboxed (Cloudflare isolate)
 * modes: `export default { routes } satisfies SandboxedPlugin`; identity
 * and trust contract come from `emdash-plugin.jsonc`.
 *
 * ── Security model: verify-by-query ─────────────────────────────────────
 * EmDash plugin routes cannot read the raw request body — the body is
 * parsed once and exposed as `routeCtx.input`, and re-reading it throws
 * (see packages/core/src/plugins/routes.ts in the EmDash repo). CHIP's
 * webhook `X-Signature` is an RSA PKCS#1 v1.5 + SHA-256 signature over
 * the raw body bytes, so it cannot be verified inside a plugin route.
 *
 * Instead, every `return` (browser redirect / server callback) and
 * `callback` (webhook) re-fetches `GET /v1/purchases/{id}/` with the
 * configured secret key and only ever updates a payment record from
 * CHIP's confirmed response. The `status` field carried in a webhook or
 * query string is never trusted on its own. `settings:publicKey` is
 * stored now so a future raw-body upgrade can switch to full RSA
 * signature verification without a settings migration.
 */

import { createCommerceBridgeRoutes, emitCommerceEvent } from "./commerce-bridge.js";
import { signBridgePayload } from "./bridge/signature.js";
import type { PluginContext, RouteHandler, SandboxedPlugin, SandboxedRouteContext } from "emdash/plugin";

// ── Constants ────────────────────────────────────────────────────────────

const API_BASE = "https://gate.chip-in.asia/api/v1";
const PLUGIN_SLUG = "chip-for-emdash";
const CURRENCY_RE = /^[A-Za-z]{3}$/;
const MAX_REFERENCE_LENGTH = 128;
const MAX_PRODUCT_NAME_LENGTH = 256;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

const SETTINGS_KEYS = {
	secretKey: "settings:secretKey",
	brandId: "settings:brandId",
	publicKey: "settings:publicKey",
	successUrl: "settings:successUrl",
	failureUrl: "settings:failureUrl",
	cancelUrl: "settings:cancelUrl",
	commerceBridgeSecret: "settings:commerceBridgeSecret",
	commerceEventUrl: "settings:commerceEventUrl",
} as const;

/** Statuses the plugin persists. PRD §4.5's five-status model, extended with `refunded` (CHIP-dashboard refunds are a real merchant flow; see README "Refunds"). */
type PaymentStatus = "creating" | "created" | "paid" | "failed" | "cancelled" | "hold" | "refunded";

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
	creating: "Creating",
	created: "Pending",
	paid: "Paid",
	failed: "Needs attention",
	cancelled: "Cancelled",
	hold: "On hold",
	refunded: "Refunded",
};

export function formatPaymentAmount(amount: number, currency: string): string {
	const code = currency.trim().toUpperCase();
	const safeCurrency = CURRENCY_RE.test(code) ? code : "USD";
	const safeAmount = Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
	const formatted = new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(safeAmount / 100);
	return `${safeCurrency} ${formatted}`;
}

export function formatPaymentStatus(status: string): string {
	const known = PAYMENT_STATUS_LABELS[status as PaymentStatus];
	if (known) return known;
	const words = status.trim().replace(/[_-]+/g, " ");
	if (!words) return "Unknown";
	return `${words.charAt(0).toUpperCase()}${words.slice(1).toLowerCase()}`;
}

export function formatPaymentDate(value: string): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

interface PaymentRecord {
	id: string;
	purchaseId: string;
	returnToken: string;
	reference: string;
	amount: number;
	currency: string;
	status: PaymentStatus;
	productName: string;
	clientEmail?: string;
	metadata?: Record<string, unknown>;
	checkoutUrl?: string;
	paidOn?: string;
	commerceOrderId?: string;
	commercePaymentId?: string;
	idempotencyKey?: string;
	createdAt: string;
	updatedAt: string;
}
interface PluginSettings {
	secretKey: string | undefined;
	brandId: string;
	publicKey: string;
	successUrl: string;
	failureUrl: string;
	cancelUrl: string;
	commerceBridgeSecret: string | undefined;
	commerceEventUrl: string;
}

interface ChipResult {
	ok: boolean;
	/** HTTP status from CHIP. */
	status: number;
	/** Parsed JSON body (purchase object, error object, or PEM string). */
	data: unknown;
}

// ── Narrowing helpers ────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const v = value[key];
	return typeof v === "string" ? v : undefined;
}

function getNumber(value: unknown, key: string): number | undefined {
	if (!isRecord(value)) return undefined;
	const v = value[key];
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

function getRecord(value: unknown, key: string): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	const v = value[key];
	return isRecord(v) ? v : undefined;
}

/** Validate the optional `products` passthrough. Returns undefined when absent. */
function parseProducts(
	value: unknown,
): { ok: true; products: Array<{ name: string; price: number; quantity?: string }> } | { ok: false } {
	if (value === undefined || value === null) return { ok: true, products: [] };
	if (!Array.isArray(value)) return { ok: false };
	const products: Array<{ name: string; price: number; quantity?: string }> = [];
	for (const raw of value) {
		if (!isRecord(raw)) return { ok: false };
		const name = getString(raw, "name");
		const price = getNumber(raw, "price");
		if (!name || typeof price !== "number" || !Number.isInteger(price) || price <= 0) {
			return { ok: false };
		}
		const quantity = raw.quantity;
		products.push({
			name: name.slice(0, MAX_PRODUCT_NAME_LENGTH),
			price,
			...(quantity === undefined || quantity === null ? {} : { quantity: String(quantity) }),
		});
	}
	return products.length > 0 ? { ok: true, products } : { ok: true, products: [] };
}

/** Coerce a stored payments document back to a PaymentRecord, or null. */
function asPaymentRecord(value: unknown): PaymentRecord | null {
	if (!isRecord(value) || typeof getString(value, "status") !== "string") return null;
	const record: PaymentRecord = {
		id: getString(value, "id") ?? "",
		purchaseId: getString(value, "purchaseId") ?? "",
		returnToken: getString(value, "returnToken") ?? "",
		reference: getString(value, "reference") ?? "",
		amount: getNumber(value, "amount") ?? 0,
		currency: getString(value, "currency") ?? "",
		status: getString(value, "status") as PaymentStatus,
		productName: getString(value, "productName") ?? "",
		createdAt: getString(value, "createdAt") ?? "",
		updatedAt: getString(value, "updatedAt") ?? "",
	};
	const clientEmail = getString(value, "clientEmail");
	if (clientEmail) record.clientEmail = clientEmail;
	const metadata = getRecord(value, "metadata");
	if (metadata) record.metadata = metadata;
	const checkoutUrl = getString(value, "checkoutUrl");
	if (checkoutUrl) record.checkoutUrl = checkoutUrl;
	const paidOn = getString(value, "paidOn");
	if (paidOn) record.paidOn = paidOn;
	const commerceOrderId = getString(value, "commerceOrderId");
	if (commerceOrderId) record.commerceOrderId = commerceOrderId;
	const commercePaymentId = getString(value, "commercePaymentId");
	if (commercePaymentId) record.commercePaymentId = commercePaymentId;
	const idempotencyKey = getString(value, "idempotencyKey");
	if (idempotencyKey) record.idempotencyKey = idempotencyKey;
	return record;
}

function generateId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	// Fallback for runtimes without crypto.randomUUID — collision-safe enough
	// for a payment record key.
	return `pay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function clampLimit(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PAGE_LIMIT;
	return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(value)));
}

// ── Settings ─────────────────────────────────────────────────────────────

async function loadSettings(ctx: PluginContext): Promise<PluginSettings> {
	const [secretKey, brandId, publicKey, successUrl, failureUrl, cancelUrl, commerceBridgeSecret, commerceEventUrl] = await Promise.all([
		ctx.kv.get<string>(SETTINGS_KEYS.secretKey),
		ctx.kv.get<string>(SETTINGS_KEYS.brandId),
		ctx.kv.get<string>(SETTINGS_KEYS.publicKey),
		ctx.kv.get<string>(SETTINGS_KEYS.successUrl),
		ctx.kv.get<string>(SETTINGS_KEYS.failureUrl),
		ctx.kv.get<string>(SETTINGS_KEYS.cancelUrl),
		ctx.kv.get<string>(SETTINGS_KEYS.commerceBridgeSecret),
		ctx.kv.get<string>(SETTINGS_KEYS.commerceEventUrl),
	]);
	return {
		secretKey: secretKey ?? undefined,
		brandId: brandId ?? "",
		publicKey: publicKey ?? "",
		successUrl: successUrl ?? "",
		failureUrl: failureUrl ?? "",
		cancelUrl: cancelUrl ?? "",
		commerceBridgeSecret: commerceBridgeSecret ?? undefined,
		commerceEventUrl: commerceEventUrl ?? "",
	};
}

// ── CHIP Collect API client ──────────────────────────────────────────────

function getHttp(ctx: PluginContext): (url: string, init?: RequestInit) => Promise<Response> {
	if (!ctx.http) {
		throw new Error("CHIP plugin requires the network:request capability");
	}
	return ctx.http.fetch;
}

/**
 * Authenticated request to the CHIP Collect API. The secret key never
 * leaves the server and is never logged.
 */
async function chipRequest(
	ctx: PluginContext,
	method: "GET" | "POST",
	path: string,
	body?: unknown,
): Promise<ChipResult> {
	const secretKey = await ctx.kv.get<string>(SETTINGS_KEYS.secretKey);
	if (!secretKey) {
		throw new Error("CHIP secret key is not configured");
	}
	const fetch = getHttp(ctx);
	const response = await fetch(`${API_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${secretKey}`,
			...(body !== undefined ? { "Content-Type": "application/json" } : {}),
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		data = undefined;
	}
	return { ok: response.ok, status: response.status, data };
}

/** Build a short, loggable error message from a CHIP error response. */
function chipErrorMessage(result: Pick<ChipResult, "status" | "data">): string {
	const detail = getString(result.data, "detail");
	if (detail) return detail.slice(0, 300);
	const error = getString(result.data, "error");
	if (error) return error.slice(0, 300);
	if (Array.isArray(result.data)) {
		for (const entry of result.data) {
			const message = getString(entry, "message") ?? getString(entry, "detail");
			if (message) return message.slice(0, 300);
		}
	}
	return `CHIP API error (HTTP ${result.status})`;
}

async function createChipPurchase(
	ctx: PluginContext,
	payload: Record<string, unknown>,
): Promise<{ purchase?: Record<string, unknown>; error?: string; retryable?: boolean }> {
	const result = await chipRequest(ctx, "POST", "/purchases/", payload);
	if (!result.ok) return { error: chipErrorMessage(result), retryable: result.status >= 500 || result.status === 429 };
	return { purchase: isRecord(result.data) ? result.data : undefined };
}

async function getChipPurchase(
	ctx: PluginContext,
	purchaseId: string,
): Promise<{ purchase?: Record<string, unknown>; error?: string; retryable?: boolean }> {
	const result = await chipRequest(ctx, "GET", `/purchases/${encodeURIComponent(purchaseId)}/`);
	if (!result.ok) return { error: chipErrorMessage(result), retryable: result.status >= 500 || result.status === 429 };
	return { purchase: isRecord(result.data) ? result.data : undefined };
}

async function getChipPublicKey(ctx: PluginContext): Promise<{ ok: boolean; error?: string }> {
	const result = await chipRequest(ctx, "GET", "/public_key/");
	if (result.ok && typeof result.data === "string" && result.data.length > 0) {
		return { ok: true };
	}
	return { ok: false, error: chipErrorMessage(result) };
}

// ── Status mapping ───────────────────────────────────────────────────────

/**
 * Map CHIP's purchase status vocabulary to the plugin's PaymentStatus.
 * Only `paid`-family statuses count as paid; refund-related statuses
 * map to `refunded` (a failed refund reverts the purchase to `paid`,
 * which the mapping handles naturally). Everything else is "created"
 * (unpaid / still payable).
 */
function normalizeStatus(raw: unknown): PaymentStatus | undefined {
	if (typeof raw !== "string") return undefined;
	switch (raw) {
		case "paid":
		case "cleared":
		case "settled":
			return "paid";
		case "error":
		case "blocked":
			return "failed";
		case "cancelled":
			return "cancelled";
		case "hold":
			return "hold";
		case "refunded":
		case "chargeback":
		case "pending_refund":
			return "refunded";
		default:
			return "created";
	}
}

/** `purchase.payment.paid_on` is a Unix timestamp in seconds → ISO string. */
function paidOnOf(purchase: Record<string, unknown>): string | undefined {
	const payment = getRecord(purchase, "payment");
	const paidOn = getNumber(payment ?? {}, "paid_on");
	return paidOn ? new Date(paidOn * 1000).toISOString() : undefined;
}

/**
 * Pull the CHIP purchase id from a webhook/callback payload. Purchase
 * payloads (`purchase.*` events, success_callback) carry `id` at the
 * top level; `payment.refunded` delivers a Payment object whose
 * top-level `id` is the PAYMENT's own id and whose `related_to` points
 * at the originating purchase — so `related_to` wins when present.
 */
function extractPurchaseId(input: Record<string, unknown>): string | undefined {
	const relatedTo = getRecord(input, "related_to");
	if (relatedTo && getString(relatedTo, "type") === "purchase") {
		const relatedId = getString(relatedTo, "id");
		if (relatedId) return relatedId;
	}
	const direct = getString(input, "id");
	if (direct) return direct;
	const object = getRecord(input, "object");
	const objectId = object ? getString(object, "id") : undefined;
	if (objectId) return objectId;
	return undefined;
}

/**
 * Verify-by-query reference check: only act on a CHIP purchase whose
 * `reference` matches the reference we stored at create time. A missing
 * CHIP reference is tolerated; a mismatch is rejected.
 */
function referenceMatches(record: PaymentRecord, purchase: Record<string, unknown>): boolean {
	const chipRef = getString(purchase, "reference");
	return !chipRef || chipRef === record.reference;
}

// ── Storage helpers ──────────────────────────────────────────────────────

async function findPaymentByPurchaseId(
	ctx: PluginContext,
	purchaseId: string,
): Promise<{ id: string; data: PaymentRecord } | null> {
	const result = await ctx.storage.payments!.query({ where: { purchaseId }, limit: 1 });
	const first = result.items[0];
	if (!first) return null;
	const record = asPaymentRecord(first.data);
	return record ? { id: first.id, data: record } : null;
}

async function findPaymentByReturnToken(
	ctx: PluginContext,
	token: string,
): Promise<{ id: string; data: PaymentRecord } | null> {
	const result = await ctx.storage.payments!.query({ where: { returnToken: token }, limit: 1 });
	const first = result.items[0];
	if (!first) return null;
	const record = asPaymentRecord(first.data);
	return record ? { id: first.id, data: record } : null;
}

/** Idempotent status update — only writes when the status actually changes. */
async function updatePaymentStatus(
	ctx: PluginContext,
	entry: { id: string; data: PaymentRecord },
	status: PaymentStatus,
	paidOn?: string,
): Promise<void> {
	if (entry.data.status === status) return;
	const updated: PaymentRecord = {
		...entry.data,
		status,
		...(paidOn ? { paidOn } : {}),
		updatedAt: new Date().toISOString(),
	};
	await ctx.storage.payments!.put(entry.id, updated);
	entry.data = updated;
	ctx.log.info(`CHIP payment ${entry.data.reference} (${entry.data.purchaseId}) → ${status}`);
}

// ── Callback URL resolution ──────────────────────────────────────────────

/** Site origin from the request (absolute URL, Origin or Host header). */
function requestOrigin(routeCtx: SandboxedRouteContext): string {
	try {
		const url = new URL(routeCtx.request.url);
		if (url.origin && url.origin !== "null") return url.origin.replace(/\/$/, "");
	} catch {
		// Fall through to headers.
	}
	const headers = routeCtx.request.headers;
	const origin = headers["origin"] ?? headers["host"];
	if (origin) {
		return origin.startsWith("http") ? origin.replace(/\/$/, "") : `https://${origin}`;
	}
	return "";
}

/** Mount prefix of this plugin's routes, derived from the request path. */
function returnMount(routeCtx: SandboxedRouteContext, ctx: PluginContext): string {
	try {
		const pathname = new URL(routeCtx.request.url).pathname;
		// The create request hits .../<mount>/create — strip the route name.
		if (pathname.endsWith("/create")) return pathname.slice(0, -"/create".length);
	} catch {
		// Fall through to the plugin id.
	}
	return `/_emdash/api/plugins/${ctx.plugin.id || PLUGIN_SLUG}`;
}

/**
 * True when the URL uses a standard HTTP(S) port (80/443 or no explicit
 * port). CHIP's `success_callback` is a server-side POST target and CHIP
 * rejects callback URLs with custom ports ("only 80/443 ... are
 * supported"), so the callback is omitted on non-standard ports.
 */
function usesStandardPort(url: string): boolean {
	try {
		const parsed = new URL(url);
		const port = parsed.port;
		return port === "" || port === "80" || port === "443";
	} catch {
		return false;
	}
}

/**
 * Base URL of the plugin's public `return` route. Resolved from the
 * request origin so callbacks work on any deployment; `ctx.site.url`
 * (configured site URL) is the fallback.
 */
function resolveReturnBase(routeCtx: SandboxedRouteContext, ctx: PluginContext): string {
	const origin = requestOrigin(routeCtx) || ctx.site.url.replace(/\/$/, "");
	return `${origin}${returnMount(routeCtx, ctx)}/return`;
}

// ── Route handlers ───────────────────────────────────────────────────────

/**
 * Public POST — create a CHIP purchase and return its checkout URL.
 * Body: { amount, currency, reference, name?, email?, products?, metadata? }.
 */
const createHandler: RouteHandler = async (routeCtx, ctx) => {
	const input = isRecord(routeCtx.input) ? routeCtx.input : {};

	const amount = getNumber(input, "amount");
	const currencyRaw = getString(input, "currency");
	const reference = getString(input, "reference");

	if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
		return {
			ok: false,
			error: { code: "VALIDATION_ERROR", message: "amount must be a positive integer number of cents" },
		};
	}
	if (!currencyRaw || !CURRENCY_RE.test(currencyRaw)) {
		return {
			ok: false,
			error: { code: "VALIDATION_ERROR", message: "currency must be a 3-letter code (e.g. MYR)" },
		};
	}
	if (!reference || reference.length === 0 || reference.length > MAX_REFERENCE_LENGTH) {
		return {
			ok: false,
			error: {
				code: "VALIDATION_ERROR",
				message: `reference must be a non-empty string of at most ${MAX_REFERENCE_LENGTH} characters`,
			},
		};
	}
	const products = parseProducts(input.products);
	if (!products.ok) {
		return {
			ok: false,
			error: { code: "VALIDATION_ERROR", message: "products must be an array of { name, price } entries" },
		};
	}

	const settings = await loadSettings(ctx);
	if (!settings.secretKey) {
		return {
			ok: false,
			error: { code: "NOT_CONFIGURED", message: "CHIP secret key is not configured — set it on the CHIP plugin settings page" },
		};
	}
	if (!settings.brandId) {
		return {
			ok: false,
			error: { code: "NOT_CONFIGURED", message: "CHIP brand ID is not configured — set it on the CHIP plugin settings page" },
		};
	}

	const currency = currencyRaw.toUpperCase();
	const name = (getString(input, "name") ?? reference).slice(0, MAX_PRODUCT_NAME_LENGTH);
	const email = getString(input, "email");
	const metadata = getRecord(input, "metadata");

	// Callback/redirect URLs: the plugin's return route by default (so
	// every browser return is re-verified), overridable per status with
	// the settings URLs. Each URL carries a fresh unguessable token —
	// CHIP does not append the purchase id to redirect URLs, so the
	// return route looks the record up by token. CHIP's
	// `success_callback` is a server POST of the Purchase object (which
	// does include the id); the return route handles both.
	// CHIP rejects callback URLs on custom ports (only 80/443 are
	// accepted), so the callback is only sent when the origin uses a
	// standard port — browser returns and webhooks still cover status
	// on non-standard ports (e.g. local dev on :4321).
	const base = resolveReturnBase(routeCtx, ctx);
	const returnToken = generateId();
	const payload: Record<string, unknown> = {
		client: email ? { email } : {},
		purchase: {
			currency,
			products:
				products.products.length > 0
					? products.products
					: [{ name, price: amount, quantity: "1" }],
			...(metadata ? { metadata } : {}),
		},
		brand_id: settings.brandId,
		reference,
		success_redirect: settings.successUrl || `${base}?token=${returnToken}&status=success`,
		failure_redirect: settings.failureUrl || `${base}?token=${returnToken}&status=failure`,
		cancel_redirect: settings.cancelUrl || `${base}?token=${returnToken}&status=cancel`,
	};
	if (usesStandardPort(base)) {
		payload.success_callback = `${base}?token=${returnToken}&status=success`;
	}

	const created = await createChipPurchase(ctx, payload);
	if (!created.purchase) {
		ctx.log.error(`CHIP create purchase failed: ${created.error ?? "unknown error"}`);
		return { ok: false, error: { code: "CHIP_ERROR", message: created.error ?? "CHIP API error" } };
	}

	const purchaseId = getString(created.purchase, "id");
	const checkoutUrl = getString(created.purchase, "checkout_url");
	if (!purchaseId || !checkoutUrl) {
		ctx.log.error("CHIP create purchase response missing id/checkout_url");
		return { ok: false, error: { code: "CHIP_ERROR", message: "CHIP returned an unexpected response" } };
	}

	const now = new Date().toISOString();
	const record: PaymentRecord = {
		id: generateId(),
		purchaseId,
		returnToken,
		reference,
		amount,
		currency,
		status: "created",
		productName: name,
		...(email ? { clientEmail: email } : {}),
		...(metadata ? { metadata } : {}),
		checkoutUrl,
		createdAt: now,
		updatedAt: now,
	};
	await ctx.storage.payments!.put(record.id, record);

	return { ok: true, id: record.id, purchaseId, checkoutUrl };
};

/**
 * Public GET (browser return) / POST (CHIP server callback) — verify the
 * purchase against the CHIP API before recording any status, then hand
 * the customer's browser onward to the site's own page.
 *
 * The query/webhook `status` is never trusted: only the CHIP-confirmed
 * status is written. EmDash plugin routes return JSON (the platform
 * serializes every route result), so the redirect target is carried in
 * the `redirectTo` field — see README "Platform notes".
 */
const returnHandler: RouteHandler = async (routeCtx, ctx) => {
	const input = isRecord(routeCtx.input) ? routeCtx.input : {};
	const settings = await loadSettings(ctx);
	const origin = requestOrigin(routeCtx) || ctx.site.url.replace(/\/$/, "");
	const defaultTarget = settings.failureUrl || origin;

	// Browser redirects carry the per-purchase return token (CHIP does
	// not append the purchase id to redirect URLs); CHIP's server
	// callbacks POST the Purchase object, so fall back to its id.
	const token = getString(input, "token");
	const bodyId = extractPurchaseId(input);

	const entry = token
		? await findPaymentByReturnToken(ctx, token)
		: bodyId
			? await findPaymentByPurchaseId(ctx, bodyId)
			: null;
	if (!entry) {
		ctx.log.warn("CHIP return: no local record for the return URL");
		return { ok: true, status: "unknown", redirectTo: defaultTarget };
	}

	// Verify-by-query: never trust the query/webhook status field.
	let purchase: Record<string, unknown>;
	try {
		const verified = await getChipPurchase(ctx, entry.data.purchaseId);
		if (!verified.purchase) {
			ctx.log.warn(`CHIP return: purchase ${entry.data.purchaseId} not confirmed by the CHIP API`);
			return { ok: true, verified: false, redirectTo: defaultTarget };
		}
		purchase = verified.purchase;
	} catch (error) {
		ctx.log.error(`CHIP return: verification failed for purchase ${entry.data.purchaseId}`, error);
		return { ok: true, verified: false, redirectTo: defaultTarget };
	}

	if (!referenceMatches(entry.data, purchase)) {
		ctx.log.warn(`CHIP return: reference mismatch for purchase ${entry.data.purchaseId}`);
		return { ok: true, verified: true, status: "unknown", redirectTo: defaultTarget };
	}

	const status = normalizeStatus(getString(purchase, "status"));
	if (status) {
		await updatePaymentStatus(ctx, entry, status, paidOnOf(purchase));
		try {
			await emitCommerceEvent(ctx, await loadSettings(ctx), `commerce.payment.${status === "hold" ? "created" : status}`, { ...entry.data, status: status === "hold" ? "created" : status });
		} catch (error) {
			ctx.log.error("Failed to emit Commerce payment event", error);
		}
	}

	const redirectTo =
		status === "paid"
			? settings.successUrl || origin
			: status === "cancelled"
				? settings.cancelUrl || defaultTarget
				: defaultTarget;

	return {
		ok: true,
		verified: true,
		status: status ?? "unknown",
		purchaseId: entry.data.purchaseId,
		reference: entry.data.reference,
		redirectTo,
	};
};

/**
 * Public POST — CHIP webhook (`purchase.paid`, `purchase.payment_failure`,
 * …). Verify-by-query, update the record idempotently, and ALWAYS answer
 * HTTP 200 so CHIP does not retry-storm the site. The webhook's own
 * status field is never trusted.
 */
const callbackHandler: RouteHandler = async (routeCtx, ctx) => {
	try {
		const input = isRecord(routeCtx.input) ? routeCtx.input : {};
		const purchaseId = extractPurchaseId(input);
		if (!purchaseId) {
			ctx.log.warn("CHIP webhook received without a purchase id");
			return { ok: true };
		}

		const verified = await getChipPurchase(ctx, purchaseId);
		if (!verified.purchase) {
			ctx.log.warn(`CHIP webhook: purchase ${purchaseId} could not be verified against the CHIP API`);
			return { ok: true };
		}

		const entry = await findPaymentByPurchaseId(ctx, purchaseId);
		if (!entry) {
			ctx.log.warn(`CHIP webhook: no local record for purchase ${purchaseId}`);
			return { ok: true };
		}
		if (!referenceMatches(entry.data, verified.purchase)) {
			ctx.log.warn(`CHIP webhook: reference mismatch for purchase ${purchaseId}`);
			return { ok: true };
		}

		const status = normalizeStatus(getString(verified.purchase, "status"));
		if (status) {
			await updatePaymentStatus(ctx, entry, status, paidOnOf(verified.purchase));
			try {
				await emitCommerceEvent(ctx, await loadSettings(ctx), `commerce.payment.${status === "hold" ? "created" : status}`, { ...entry.data, status: status === "hold" ? "created" : status });
			} catch (error) {
				ctx.log.error("Failed to emit Commerce payment event", error);
			}
		}
		return { ok: true };
	} catch (error) {
		// Never fail a webhook response — CHIP retries non-2xx and storms the site.
		ctx.log.error("CHIP webhook handling failed", error);
		return { ok: true };
	}
};

/** Private GET — admin list of payments, filterable by status, paginated. */
const paymentsHandler: RouteHandler = async (routeCtx, ctx) => {
	try {
		const input = isRecord(routeCtx.input) ? routeCtx.input : {};
		const status = getString(input, "status");
		const cursor = getString(input, "cursor");
		const limit = clampLimit(getNumber(input, "limit"));

		const result = await ctx.storage.payments!.query({
			...(status ? { where: { status } } : {}),
			orderBy: { createdAt: "desc" },
			limit,
			...(cursor ? { cursor } : {}),
		});

		return {
			ok: true,
			items: result.items.flatMap(({ id, data }) => {
				const record = asPaymentRecord(data);
				return record ? [{ ...record }] : [];
			}),
			cursor: result.cursor,
			hasMore: result.hasMore,
		};
	} catch (error) {
		ctx.log.error("Failed to list payments", error);
		return { ok: false, error: "Failed to list payments" };
	}
};

/** Private GET — admin detail for one payment. */
const paymentDetailHandler: RouteHandler = async (routeCtx, ctx) => {
	const input = isRecord(routeCtx.input) ? routeCtx.input : {};
	const id = getString(input, "id");
	if (!id) return { ok: false, error: "Missing id" };
	const data = await ctx.storage.payments!.get(id);
	const record = asPaymentRecord(data);
	if (!record) return { ok: false, error: "Payment not found" };
	return { ok: true, item: { ...record } };
};

/** Private GET — current settings, with the secret key masked. */
const settingsHandler: RouteHandler = async (_routeCtx, ctx) => {
	const settings = await loadSettings(ctx);
	return {
		ok: true,
		settings: {
			// The secret key itself is never returned — only whether it is set.
			secretKeySet: !!settings.secretKey,
			commerceBridgeSecretSet: !!settings.commerceBridgeSecret,
			commerceEventUrl: settings.commerceEventUrl,
			brandId: settings.brandId,
			publicKey: settings.publicKey,
			successUrl: settings.successUrl,
			failureUrl: settings.failureUrl,
			cancelUrl: settings.cancelUrl,
		},
	};
};

/** Private POST — persist settings. The secret key is only overwritten, never read back. */
const settingsSaveHandler: RouteHandler = async (routeCtx, ctx) => {
	try {
		const input = isRecord(routeCtx.input) ? routeCtx.input : {};
		// An empty secretKey keeps the existing key — secret_input masks
		// stored values, so the form never echoes the real key back.
		if (typeof input.secretKey === "string" && input.secretKey !== "") {
			await ctx.kv.set(SETTINGS_KEYS.secretKey, input.secretKey);
		}
		if (typeof input.commerceBridgeSecret === "string" && input.commerceBridgeSecret !== "") {
			await ctx.kv.set(SETTINGS_KEYS.commerceBridgeSecret, input.commerceBridgeSecret);
		}
		for (const key of ["brandId", "publicKey", "successUrl", "failureUrl", "cancelUrl", "commerceEventUrl"] as const) {
			if (typeof input[key] === "string") await ctx.kv.set(SETTINGS_KEYS[key], input[key]);
		}
		return { ok: true };
	} catch (error) {
		ctx.log.error("Failed to save settings", error);
		return { ok: false, error: "Failed to save settings" };
	}
};

/** Private POST — Block Kit admin: settings page, payments page, widget, test action. */
const adminHandler: RouteHandler = async (routeCtx, ctx) => {
	const interaction = isRecord(routeCtx.input) ? routeCtx.input : {};
	const type = getString(interaction, "type");
	const actionId = getString(interaction, "action_id");

	if (type === "page_load") {
		const page = getString(interaction, "page");
		if (page === "/settings") return buildSettingsPage(ctx);
		if (page === "/payments") return buildPaymentsPage(ctx, undefined);
		if (page === "widget:chip-summary") return buildChipWidget(ctx);
		return { blocks: [] };
	}
	if (type === "form_submit" && actionId === "view_payment") {
		const values = getRecord(interaction, "values") ?? {};
		const id = getString(values, "paymentId");
		return id ? buildPaymentDetailPage(ctx, id) : { blocks: [{ type: "banner", title: "Select a payment", description: "Choose a payment record before opening its detail.", variant: "alert" }] };
	}
	if (type === "form_submit" && actionId === "save_settings") {
		return saveSettingsInteraction(ctx, getRecord(interaction, "values") ?? {});
	}
	if (type === "block_action" && actionId === "test_chip") {
		return testChip(ctx);
	}
	if (type === "block_action" && actionId === "payments_page") {
		const value = getRecord(interaction, "value");
		return buildPaymentsPage(ctx, value ? getString(value, "cursor") : undefined);
	}
	return { blocks: [] };
};

// ── Plugin definition ────────────────────────────────────────────────────

const commerceBridgeRoutes = createCommerceBridgeRoutes({
	loadSettings,
	createChipPurchase,
	getChipPurchase,
	normalizeStatus,
	paidOnOf,
});
async function retryCommerceEvents(ctx: PluginContext): Promise<void> {
	const now = Date.now();
	const pending = await ctx.storage.commerce_events?.query({ where: { status: "pending" }, limit: 50 });
	for (const item of pending?.items ?? []) {
		const record = item.data as Record<string, unknown>;
		const nextAttemptAt = typeof record.nextAttemptAt === "string" ? Date.parse(record.nextAttemptAt) : 0;
if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now) continue;
		if (!ctx.http || typeof record.eventUrl !== "string" || typeof record.body !== "string") continue;
		let timestamp = typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString();
		let signature = typeof record.signature === "string" ? record.signature : "";
		const settings = await loadSettings(ctx);
		if (settings.commerceBridgeSecret) {
			timestamp = new Date().toISOString();
			signature = await signBridgePayload(settings.commerceBridgeSecret, timestamp, record.body);
		}
		try {
			const response = await ctx.http.fetch(record.eventUrl, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-emdash-provider-id": "chip",
					"x-emdash-bridge-signature": signature,
					"x-emdash-bridge-timestamp": timestamp,
				},
				body: record.body,
			});
			const attempts = typeof record.attempts === "number" ? record.attempts + 1 : 1;
			await ctx.storage.commerce_events?.put(item.id, response.ok ? { ...record, status: "delivered", attempts } : { ...record, status: "pending", attempts, nextAttemptAt: new Date(now + 60_000).toISOString() });
		} catch {
			const attempts = typeof record.attempts === "number" ? record.attempts + 1 : 1;
			await ctx.storage.commerce_events?.put(item.id, { ...record, status: "pending", attempts, nextAttemptAt: new Date(now + 60_000).toISOString() });
		}
	}
}
export default {
	hooks: { cron: async (_event, ctx) => retryCommerceEvents(ctx) },
	routes: {
		create: { public: true, handler: createHandler },
		return: { public: true, handler: returnHandler },
		callback: { public: true, handler: callbackHandler },
		payments: { handler: paymentsHandler },
		"payments/detail": { handler: paymentDetailHandler },
		settings: { handler: settingsHandler },
		"settings/save": { handler: settingsSaveHandler },
		...commerceBridgeRoutes,
		admin: { handler: adminHandler },
	},
} satisfies SandboxedPlugin;

// ── Block Kit admin helpers ──────────────────────────────────────────────

async function buildSettingsPage(ctx: PluginContext) {
	try {
		const settings = await loadSettings(ctx);
		const secretKeyHelp = settings.secretKey
			? "A secret key is already configured. Enter a replacement only when rotating it; leave blank to keep the current key."
			: "Enter the secret key used to authenticate CHIP requests. It is never revealed after saving.";
		const bridgeSecretHelp = settings.commerceBridgeSecret
			? "A Commerce Bridge secret is already configured. Enter a replacement only when rotating it; leave blank to keep the current key."
			: "Optional: configure a shared Commerce Bridge secret for signed payment events.";
		return {
			blocks: [
				{ type: "header", text: "CHIP Settings" },
				{
					type: "section",
					text: "Connect your CHIP Collect account. Use Test Mode credentials while setting up the integration.",
				},
				{ type: "divider" },
				{ type: "section", text: `Connection\n${secretKeyHelp}\n${bridgeSecretHelp}\nThe public key is stored for a future signature-verification upgrade.` },
				{
					type: "form",
					block_id: "chip-settings",
					fields: [
						{
							type: "secret_input",
							action_id: "secretKey",
							label: "Secret key",
							// Stored secrets are never sent to the browser. Block Kit uses
							// this flag to render a masked value, then clears it when the
							// operator focuses the field to enter a replacement.
							has_value: !!settings.secretKey,
							placeholder: "sk_live_... / sk_test_...",
						},
						{
							type: "text_input",
							action_id: "brandId",
							label: "Brand ID",
							placeholder: "e.g. 409eb80e-…",
							initial_value: settings.brandId,
						},
						{
							type: "text_input",
							action_id: "publicKey",
							label: "Public key (optional)",
							placeholder: "PEM key from Developer → API keys",
							initial_value: settings.publicKey,
						},
						{
							type: "text_input",
							action_id: "successUrl",
							label: "Success page URL (optional)",
							placeholder: "https://yoursite.com/thank-you",
							initial_value: settings.successUrl,
						},
						{
							type: "text_input",
							action_id: "failureUrl",
							label: "Failure page URL (optional)",
							placeholder: "https://yoursite.com/payment-failed",
							initial_value: settings.failureUrl,
						},
						{
							type: "text_input",
							action_id: "cancelUrl",
							label: "Cancel page URL (optional)",
							placeholder: "https://yoursite.com/checkout",
							initial_value: settings.cancelUrl,
						},
						{
							type: "secret_input",
							action_id: "commerceBridgeSecret",
							label: "Commerce Bridge Secret (optional)",
							has_value: !!settings.commerceBridgeSecret,
							placeholder: "Shared HMAC secret",
						},
						{
							type: "text_input",
							action_id: "commerceEventUrl",
							label: "Commerce Event URL (optional)",
							placeholder: "https://store.example.com/_emdash/api/plugins/emdash-commerce/bridge/events",
							initial_value: settings.commerceEventUrl,
						},
					],
					submit: { label: "Save settings", action_id: "save_settings" },
				},
				{ type: "divider" },
				{ type: "section", text: "After payment\nLeave return URL fields empty to send customers back to your site root after payment." },
				{
					type: "actions",
					elements: [
						{
							type: "button",
							action_id: "test_chip",
							label: "Test credentials",
							style: "primary",
						},
					],
				},
				{
					type: "context",
					text: "Customers use CHIP's hosted checkout. Browser returns and server callbacks are re-verified against CHIP before a payment is recorded. Secrets are never revealed after saving: leave a secret field blank to keep its current value, or enter a new value to replace it.",
				},
			],
		};
	} catch (error) {
		ctx.log.error("Failed to build CHIP settings page", error);
		return {
			blocks: [
				{
					type: "banner",
					title: "Failed to load settings",
					description: "An error occurred while loading the CHIP settings page.",
					variant: "error",
				},
			],
		};
	}
}

async function saveSettingsInteraction(ctx: PluginContext, values: Record<string, unknown>) {
	try {
		if (typeof values.secretKey === "string" && values.secretKey !== "") {
			await ctx.kv.set(SETTINGS_KEYS.secretKey, values.secretKey);
		}
		if (typeof values.commerceBridgeSecret === "string" && values.commerceBridgeSecret !== "") {
			await ctx.kv.set(SETTINGS_KEYS.commerceBridgeSecret, values.commerceBridgeSecret);
		}
		for (const key of ["brandId", "publicKey", "successUrl", "failureUrl", "cancelUrl", "commerceEventUrl"] as const) {
			if (typeof values[key] === "string") await ctx.kv.set(SETTINGS_KEYS[key], values[key]);
		}
		return {
			...(await buildSettingsPage(ctx)),
			toast: { message: "Settings saved", type: "success" as const },
		};
	} catch (error) {
		ctx.log.error("Failed to save settings", error);
		return {
			...(await buildSettingsPage(ctx)),
			toast: { message: "Failed to save settings", type: "error" as const },
		};
	}
}

async function testChip(ctx: PluginContext) {
	const settings = await loadSettings(ctx);
	if (!settings.secretKey) {
		return {
			...(await buildSettingsPage(ctx)),
			toast: { message: "Save a secret key first", type: "error" as const },
		};
	}
	try {
		const result = await getChipPublicKey(ctx);
		if (result.ok) {
			return {
				...(await buildSettingsPage(ctx)),
				toast: { message: "Credentials OK — CHIP returned the public key", type: "success" as const },
			};
		}
		return {
			...(await buildSettingsPage(ctx)),
			toast: {
				message: `Credentials check failed: ${result.error ?? "unknown error"}`,
				type: "error" as const,
			},
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			...(await buildSettingsPage(ctx)),
			toast: { message: `Credentials check failed: ${msg}`, type: "error" as const },
		};
	}
}

async function buildPaymentsPage(ctx: PluginContext, cursor: string | undefined) {
	try {
		const result = await ctx.storage.payments!.query({
			orderBy: { createdAt: "desc" },
			limit: DEFAULT_PAGE_LIMIT,
			...(cursor ? { cursor } : {}),
		});

		const records = result.items.flatMap(({ id, data }) => {
			const record = asPaymentRecord(data);
			return record ? [{ id, record }] : [];
		});
		const rows = records.map(({ id, record }) => ({
			id,
			reference: record.reference || id,
			amount: formatPaymentAmount(record.amount, record.currency),
			status: formatPaymentStatus(record.status),
			createdAt: formatPaymentDate(record.createdAt),
		}));

		return {
			blocks: [
				{ type: "header", text: "CHIP Payments" },
				{
					type: "context",
					text: "Payment attempts recorded by this plugin. Statuses are only ever set from the CHIP API (verify-by-query), never from webhook or query-string data.",
				},
				{
					type: "stats",
					items: [
						{ label: "Paid", value: String(records.filter(({ record }) => record.status === "paid").length) },
						{ label: "Needs attention", value: String(records.filter(({ record }) => record.status === "failed").length) },
						{ label: "Visible records", value: String(rows.length) },
					],
				},
				...(rows.length > 0
					? [{
						type: "form",
						block_id: "payment-detail",
						fields: [{
							type: "select",
							action_id: "paymentId",
							label: "Open payment detail",
							options: rows.map((row) => ({ label: `${row.reference} — ${row.status}`, value: row.id })),
						}],
						submit: { label: "View payment", action_id: "view_payment" },
					}]
					: [{ type: "context", text: "No payment records are available yet." }]),
				{ type: "divider" },
				{
					type: "table",
					block_id: "payments-table",
					columns: [
						{ key: "reference", label: "Reference" },
						{ key: "amount", label: "Amount" },
						{ key: "status", label: "Status", format: "badge" },
						{ key: "createdAt", label: "Created" },
					],
					rows,
					...(result.cursor ? { next_cursor: result.cursor } : {}),
					page_action_id: "payments_page",
					empty_text: "No payments recorded yet. Create one with the pay button on your site.",
				},
			],
		};
	} catch (error) {
		ctx.log.error("Failed to build payments page", error);
		return {
			blocks: [
				{
					type: "banner",
					title: "Failed to load payments",
					description: "An error occurred while loading the payments table.",
					variant: "error",
				},
			],
		};
	}
}

async function buildPaymentDetailPage(ctx: PluginContext, id: string) {
	const data = await ctx.storage.payments!.get(id);
	const record = asPaymentRecord(data);
	if (!record) {
		return {
			blocks: [{
				type: "banner",
				title: "Payment not found",
				description: "The payment record may have been removed or is no longer available.",
				variant: "error",
			}],
		};
	}
	return {
		blocks: [
			{ type: "header", text: "Payment detail" },
			{ type: "context", text: "This status was confirmed against CHIP before it was stored." },
			{
				type: "fields",
				fields: [
					{ label: "Reference", value: record.reference || record.id },
					{ label: "Status", value: formatPaymentStatus(record.status) },
					{ label: "Amount", value: formatPaymentAmount(record.amount, record.currency) },
					{ label: "Purchase ID", value: record.purchaseId || "—" },
					{ label: "Product", value: record.productName || "—" },
					{ label: "Customer email", value: record.clientEmail || "—" },
					{ label: "Created", value: formatPaymentDate(record.createdAt) },
					{ label: "Paid", value: record.paidOn ? formatPaymentDate(record.paidOn) : "-" },
					{ label: "Updated", value: formatPaymentDate(record.updatedAt) },
				],
			},
			...(record.checkoutUrl ? [{ type: "section", text: "Hosted checkout URL is retained server-side for auditability." }] : []),
			{
				type: "actions",
				elements: [{ type: "button", label: "Back to payments", action_id: "payments_page", style: "primary" }],
			},
		],
	};
}

async function buildChipWidget(ctx: PluginContext) {
	try {
		const [paid, pending, failed, cancelled, refunded] = await Promise.all([
			ctx.storage.payments!.count({ status: "paid" }),
			ctx.storage.payments!.count({ status: "created" }),
			ctx.storage.payments!.count({ status: "failed" }),
			ctx.storage.payments!.count({ status: "cancelled" }),
			ctx.storage.payments!.count({ status: "refunded" }),
		]);
		return {
			blocks: [
				{
					type: "stats",
					items: [
						{ label: "Paid", value: String(paid) },
						{ label: "Pending", value: String(pending) },
						{ label: "Failed", value: String(failed) },
						{ label: "Cancelled", value: String(cancelled) },
						{ label: "Refunded", value: String(refunded) },
					],
				},
			],
		};
	} catch (error) {
		ctx.log.error("Failed to build CHIP widget", error);
		return { blocks: [{ type: "context", text: "Failed to load CHIP payment summary" }] };
	}
}
