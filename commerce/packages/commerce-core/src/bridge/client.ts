import { getBridgeSigningData } from "@emdash-commerce/contracts";
import type { BridgeRequest, BridgeResponse } from "@emdash-commerce/contracts";
import { signBridgePayload } from "./signature.js";

export interface BridgeConnection {
  pluginId: string;
  basePath: string;
  eventPath: string;
  capabilities: string[];
  sharedSecret: string;
  keyId?: string;
  fetcher?: typeof fetch;
}

export type UnsignedBridgeRequest<T> = Omit<BridgeRequest<T>, "auth"> & {
  auth?: BridgeRequest<T>["auth"];
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function endpointFor(connection: BridgeConnection): string {
  return connection.basePath;
}

function errorResponse(requestId: string, code: string, message: string, retryable: boolean): BridgeResponse<unknown> {
  return { requestId, ok: false, error: { code, message, retryable } };
}

export async function sendBridgeCommand<T>(
  connection: BridgeConnection,
  request: UnsignedBridgeRequest<T>,
): Promise<BridgeResponse<unknown>> {
  const timestamp = String(Date.now());
  const unsignedRequest: BridgeRequest<T> = {
    ...request,
    auth: {
      version: 1,
      keyId: connection.keyId ?? connection.pluginId,
      timestamp,
      signature: "",
    },
  };
  const body = getBridgeSigningData(unsignedRequest);
  unsignedRequest.auth.signature = await signBridgePayload(connection.sharedSecret, timestamp, body);
  const fetcher = connection.fetcher ?? fetch;

  try {
    const response = await fetcher(endpointFor(connection), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-emdash-bridge-version": "1",
      },
      body: JSON.stringify(unsignedRequest),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return errorResponse(request.requestId, "INVALID_RESPONSE", "Provider returned invalid JSON", false);
    }
    if (!isRecord(payload) || payload.requestId !== request.requestId || typeof payload.ok !== "boolean") {
      return errorResponse(request.requestId, "INVALID_RESPONSE", "Provider returned an invalid bridge response", false);
    }
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      return errorResponse(request.requestId, `HTTP_${response.status}`, `Provider bridge returned HTTP ${response.status}`, retryable);
    }
    if (payload.ok === false) {
      const providerError = isRecord(payload.error) ? payload.error : undefined;
      return errorResponse(
        request.requestId,
        typeof providerError?.code === "string" ? providerError.code : "PROVIDER_ERROR",
        typeof providerError?.message === "string" ? providerError.message : "Provider command failed",
        providerError?.retryable === true,
      );
    }
    return payload as unknown as BridgeResponse<unknown>;
  } catch (error) {
    return errorResponse(
      request.requestId,
      "BRIDGE_NETWORK_ERROR",
      error instanceof Error ? error.message : "Provider bridge request failed",
      true,
    );
  }
}
