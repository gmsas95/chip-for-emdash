import type {
	BridgeRequest,
	BridgeResponse,
	CommerceEvent,
	LogisticsCommand,
	PaymentCommand,
} from "@emdash-commerce/contracts";

export type ChipBridgeRequest<T> = BridgeRequest<T>;
export type ChipBridgeResponse<T> = BridgeResponse<T>;
export type ChipCommerceEvent<T> = CommerceEvent<T>;
export type ChipPaymentRequest = BridgeRequest<PaymentCommand>;
export type ChipLogisticsRequest = BridgeRequest<LogisticsCommand>;

export interface CommercePaymentCreateData {
	paymentId: string;
	providerId: string;
	checkoutUrl: string;
	status: "created" | "paid" | "failed" | "cancelled" | "refunded";
}

export interface CommercePaymentStatusData extends CommercePaymentCreateData {
	purchaseId: string;
	paidOn?: string;
}

export interface CommercePaymentRefundData {
	paymentId: string;
	status: "MANUAL_PROVIDER_ACTION" | "refunded";
	message: string;
}

export type ChipLogisticsCommand = LogisticsCommand;
