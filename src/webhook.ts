import { createHash } from "crypto";

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
export function verifySignature(
  payload: GtalkWebhookPayload,
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): boolean {
  const data = payload.oaId + rawBody + payload.timestamp + webhookSecret;
  const expected = createHash("sha256").update(data).digest("hex");
  const actual = signatureHeader.replace("mac=", "").trim();
  return expected === actual;
}
