import { createHash, timingSafeEqual } from "crypto";
/**
 * Verify webhook signature từ app công ty.
 * Công thức: SHA-256(oaId + jsonPayload + timestamp + webhookSecret)
 * Header: x-gtalk-event-signature: mac=<hex>
 */
export function verifySignature(payload, rawBody, signatureHeader, webhookSecret) {
    const data = payload.oaId + rawBody + payload.timestamp + webhookSecret;
    const expected = "mac=" + createHash("sha256").update(data).digest("hex");
    const actual = signatureHeader.trim();
    if (expected.length !== actual.length)
        return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
