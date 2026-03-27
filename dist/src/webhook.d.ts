export interface GtalkWebhookPayload {
    globalMsgId: string;
    clientMsgId: string;
    oaId: string;
    channelId: string;
    senderId: string;
    content: string;
    contentType: number;
    timestamp: string;
}
/**
 * Verify webhook signature từ app công ty.
 * Công thức: SHA-256(oaId + jsonPayload + timestamp + webhookSecret)
 * Header: x-gtalk-event-signature: mac=<hex>
 */
export declare function verifySignature(payload: GtalkWebhookPayload, rawBody: string, signatureHeader: string, webhookSecret: string): boolean;
