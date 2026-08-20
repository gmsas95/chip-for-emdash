const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

export class BridgeAuthError extends Error {
	constructor(public readonly code: "BRIDGE_AUTH_FAILED" | "BRIDGE_REPLAY_WINDOW", message: string) {
		super(message);
		this.name = "BridgeAuthError";
	}
}

function toBase64Url(bytes: ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
	const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timestampMs(timestamp: string): number {
	const numeric = Number(timestamp);
	if (Number.isFinite(numeric)) return numeric;
	const parsed = Date.parse(timestamp);
	if (Number.isFinite(parsed)) return parsed;
	throw new BridgeAuthError("BRIDGE_REPLAY_WINDOW", "Invalid bridge timestamp");
}

async function keyFor(secret: string, usage: KeyUsage): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signBridgePayload(secret: string, timestamp: string, body: string): Promise<string> {
	const key = await keyFor(secret, "sign");
	return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
}

export async function verifyBridgePayload(
	secret: string,
	timestamp: string,
	body: string,
	signature: string,
	now: number = Date.now(),
): Promise<void> {
	const sentAt = timestampMs(timestamp);
	if (!Number.isFinite(now) || Math.abs(now - sentAt) > REPLAY_WINDOW_MS) {
		throw new BridgeAuthError("BRIDGE_REPLAY_WINDOW", "Bridge timestamp expired");
	}
	let signatureBytes: Uint8Array;
	try {
		signatureBytes = fromBase64Url(signature);
	} catch {
		throw new BridgeAuthError("BRIDGE_AUTH_FAILED", "Invalid bridge signature");
	}
	const valid = await crypto.subtle.verify("HMAC", await keyFor(secret, "verify"), signatureBytes as unknown as BufferSource, encoder.encode(`${timestamp}.${body}`));
	if (!valid) throw new BridgeAuthError("BRIDGE_AUTH_FAILED", "Invalid bridge signature");
}

export const BRIDGE_REPLAY_WINDOW_MS_EXPORT = REPLAY_WINDOW_MS;
