const BRIDGE_REPLAY_WINDOW_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

function timestampToMilliseconds(timestamp: string): number {
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const parsed = Date.parse(timestamp);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  throw new Error("Invalid bridge timestamp");
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importSigningKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function signBridgePayload(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await importSigningKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return toBase64Url(signature);
}

export async function verifyBridgeSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now: number = Date.now(),
): Promise<void> {
  const timestampMs = timestampToMilliseconds(timestamp);
  if (Math.abs(now - timestampMs) > BRIDGE_REPLAY_WINDOW_MS) {
    throw new Error("Bridge timestamp expired");
  }
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64Url(signature);
  } catch {
    throw new Error("Invalid bridge signature");
  }
  const key = await importSigningKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes as unknown as BufferSource, encoder.encode(`${timestamp}.${body}`));
  if (!valid) {
    throw new Error("Invalid bridge signature");
  }
}

export const BRIDGE_REPLAY_WINDOW = BRIDGE_REPLAY_WINDOW_MS;
