# GHN GTalk API — Developer Integration Guide

This guide walks backend developers through integrating with the **GHN GTalk REST API** to send messages and manage file uploads programmatically.

For the full machine-readable API specification, see [`swagger.yaml`](./swagger.yaml).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Sending a Text Message](#3-sending-a-text-message)
4. [Sending a Template Message](#4-sending-a-template-message)
5. [File Upload Flow](#5-file-upload-flow)
6. [Sending a Photo Message](#6-sending-a-photo-message)
7. [Sending a File Message](#7-sending-a-file-message)
8. [Sending a Video Message](#8-sending-a-video-message)
9. [Using an Existing File ID](#9-using-an-existing-file-id)
10. [Error Handling](#10-error-handling)
11. [Limits & Constraints](#11-limits--constraints)
12. [Create Server Direct Channel](#12-create-server-direct-channel)
13. [Configure Channel Processing](#13-configure-channel-processing)
14. [Send Message Receipt](#14-send-message-receipt)
15. [Modify Message](#15-modify-message)
16. [Plugin Behavior (OpenClaw Integration)](#16-plugin-behavior-openclaw-integration)
17. [Get File Download URL](#17-get-file-download-url)

---

## 1. Overview

The GTalk API allows you to send messages to GTalk channels. Supported message types are:

| Type     | Content                                      |
|----------|----------------------------------------------|
| Text     | Plain text, Markdown, or HTML                |
| Template | Structured card with icon, title, body, and action buttons |
| Photo    | Image attachment with optional caption       |
| File     | Generic file attachment                      |
| Video    | Video attachment with optional caption       |

### Base URLs

| Environment | Base URL                          |
|-------------|-----------------------------------|
| Production  | `https://mbff.ghn.vn`             |
| Test        | `https://test-api.mbff.ghn.tech`  |

All endpoints accept and return `application/json`.

---

## 2. Authentication

Every request must include an `oaToken` field in the **request body**. The token is formed by concatenating your username and password with a colon:

```
oaToken = "{username}:{password}"
```

**Example:**
```
oaToken: "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO"
```

> **Note:** There is no `Authorization` header. The token is always passed as a body field named `oaToken`.

---

## 3. Sending a Text Message

**Endpoint:** `POST /api/gtalk/send-message`

### Request Body

| Field        | Type   | Required | Description |
|--------------|--------|----------|-------------|
| `channelId`  | string | ✅       | Target channel ID |
| `clientMsgId`| string | ✅       | Client-generated unique message ID (use a timestamp) |
| `content`    | object | ✅       | Message content — see below |
| `oaToken`    | string | ✅       | Authentication token |

**`content` fields for text:**

| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `text`      | string | ✅       | Message body |
| `parseMode` | string | ❌       | `PLAIN_TEXT` (default), `MARKDOWN`, or `HTML` |

### cURL Example

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/send-message' \
--header 'Content-Type: application/json' \
--data '{
    "channelId": "414416020666490880",
    "clientMsgId": "1767846364",
    "content": {
        "text": "Hello from the API!",
        "parseMode": "PLAIN_TEXT"
    },
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO"
}'
```

### Response

```json
{
    "data": {
        "globalMsgId": "450267410683305984"
    },
    "errorCode": "success",
    "error": {}
}
```

---

## 4. Sending a Template Message

Templates are structured message cards with an icon, title, body text, and optional action buttons.

**Endpoint:** `POST /api/gtalk/send-message`

### `content` fields for template:

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `template` | object | ✅       | Template definition — see below |
| `parseMode`| string | ❌       | `PLAIN_TEXT`, `MARKDOWN`, or `HTML` |

**`template` object:**

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `templateId`   | string | ✅       | ID of the template to use |
| `shortMessage` | string | ✅       | Fallback/preview text |
| `data`         | string | ✅       | JSON-serialized template data (see below) |

**`data` JSON structure** (serialized as a string):

```json
{
    "icon_url": "https://example.com/icon.png",
    "title": "Order Update",
    "content": "Your order #12345 has been shipped.<br/>Track it now.",
    "actions": [
        {
            "text": "Track Order",
            "style": "primary",
            "type": "browser_external",
            "url": "https://example.com/track/12345"
        }
    ]
}
```

**Action `type` values:**

| Value              | Description |
|--------------------|-------------|
| `deeplink`         | Opens a deep link in the app |
| `browser_internal` | Opens URL in an in-app browser |
| `browser_external` | Opens URL in the device's default browser |

**Action `style` values:** `primary`, `secondary`

### cURL Example

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/send-message' \
--header 'Content-Type: application/json' \
--data '{
    "channelId": "414416020666490880",
    "clientMsgId": "1767846365",
    "content": {
        "template": {
            "templateId": "tmpl_001",
            "shortMessage": "You have a new notification",
            "data": "{\"icon_url\":\"https://example.com/icon.png\",\"title\":\"Order Update\",\"content\":\"Your order #12345 has been shipped.<br/>Track it now.\",\"actions\":[{\"text\":\"Track Order\",\"style\":\"primary\",\"type\":\"browser_external\",\"url\":\"https://example.com/track/12345\"}]}"
        }
    },
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO"
}'
```

---

## 5. File Upload Flow

Sending a photo, file, or video requires uploading the binary to S3 first. The process is always the same 3-step flow:

```
Step 1: POST /api/gtalk/initiate-upload   → get PresignedURL, PresignedThumbURL, UploadId
Step 2: PUT {PresignedURL}                → upload original file binary
        PUT {PresignedThumbURL}           → upload thumbnail binary
Step 3: POST /api/gtalk/complete-upload   → finalize, get permanent file Id
```

### Step 1 — Initiate Upload

**Endpoint:** `POST /api/gtalk/initiate-upload`

**Request Body:**

| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `ChannelId` | string | ✅       | Target channel ID |
| `FileName`  | string | ✅       | Original file name with extension |
| `FileSize`  | string | ✅       | File size in bytes (as a string) |
| `MimeType`  | string | ✅       | MIME type (e.g. `image/jpeg`, `video/mp4`) |
| `Metadata`  | string | ❌       | JSON-serialized metadata. For images: `{"width":680,"height":453}`. For videos: `{"width":1280,"height":720,"duration":30}` |
| `oaToken`   | string | ✅       | Authentication token |

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/initiate-upload' \
--header 'Content-Type: application/json' \
--data '{
    "ChannelId": "414416020666490880",
    "FileName": "Lifestyle.jpg",
    "FileSize": "98351",
    "MimeType": "image/jpeg",
    "Metadata": "{\"width\": 680, \"height\": 453}",
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO"
}'
```

**Response:**

```json
{
    "data": {
        "ExpiresAt": "1767850213",
        "PresignedURL": "https://s3-sgn10.fptcloud.com/gtalk-file-test/...",
        "PresignedThumbURL": "https://s3-sgn10.fptcloud.com/gtalk-file-test/..._thumb?...",
        "UploadId": "2009120434341085184"
    },
    "errorCode": "success",
    "error": {}
}
```

> **Important:** The presigned URLs expire at `ExpiresAt` (Unix timestamp in seconds). Complete the upload before expiry.

---

### Step 2 — Upload to S3

Upload the original file and the thumbnail using HTTP **PUT** to the presigned URLs. No authentication headers are needed — the credentials are embedded in the URL.

**Upload original file:**

```bash
curl --location --request PUT '{PresignedURL}' \
--header 'Content-Type: image/jpeg' \
--data-binary '@/path/to/Lifestyle.jpg'
```

**Upload thumbnail:**

```bash
curl --location --request PUT '{PresignedThumbURL}' \
--header 'Content-Type: image/jpeg' \
--data-binary '@/path/to/Lifestyle_thumb.jpg'
```

> **Thumbnail rules:**
> - **Images:** Resize to fit within **600×600 px** (maintain aspect ratio, do not enlarge).
> - **Videos:** Extract the **first frame**, then resize to fit within **600×600 px**.
> - A `200` HTTP status code from S3 means success.

---

### Step 3 — Complete Upload

**Endpoint:** `POST /api/gtalk/complete-upload`

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/complete-upload' \
--header 'Content-Type: application/json' \
--data '{
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO",
    "UploadId": "2009120434341085184"
}'
```

**Response:**

```json
{
    "data": {
        "ChannelId": "414416020666490880",
        "CreatedAt": "1767846785",
        "CreatedBy": "1970077287463710720",
        "FileName": "Lifestyle.jpg",
        "FileSize": "98351",
        "Id": "2009120434341085184",
        "MimeType": "image/jpeg"
    },
    "errorCode": "success",
    "error": {}
}
```

Use the `Id` field from this response when sending the message.

---

## 6. Sending a Photo Message

After completing the upload (see [Section 5](#5-file-upload-flow)), send the photo message using the file `Id` and the image dimensions.

**Endpoint:** `POST /api/gtalk/send-message`

### `content` fields for photo:

```json
{
    "attachment": {
        "caption": "Optional caption text",
        "items": [
            {
                "image": {
                    "fileId": "2009120434341085184",
                    "width": 680,
                    "height": 453
                }
            }
        ]
    }
}
```

| Field                       | Type    | Required | Description |
|-----------------------------|---------|----------|-------------|
| `attachment.caption`        | string  | ❌       | Caption displayed below the image |
| `attachment.items[].image.fileId` | string | ✅ | File ID from complete-upload response |
| `attachment.items[].image.width`  | integer | ✅ | Image width in pixels |
| `attachment.items[].image.height` | integer | ✅ | Image height in pixels |

### cURL Example

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/send-message' \
--header 'Content-Type: application/json' \
--data '{
    "channelId": "414416020666490880",
    "clientMsgId": "1767846364",
    "content": {
        "attachment": {
            "caption": "Hinh",
            "items": [
                {
                    "image": {
                        "fileId": "2009120434341085184",
                        "width": 680,
                        "height": 453
                    }
                }
            ]
        }
    },
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO"
}'
```

---

## 7. Sending a File Message

After completing the upload (see [Section 5](#5-file-upload-flow)), send the file message.

**Endpoint:** `POST /api/gtalk/send-message`

### `content` fields for file:

```json
{
    "attachment": {
        "items": [
            {
                "file": {
                    "fileId": "2009120434341085185",
                    "fileName": "document.pdf",
                    "mimeType": "application/pdf",
                    "fileSize": 204800
                }
            }
        ]
    }
}
```

| Field                            | Type    | Required | Description |
|----------------------------------|---------|----------|-------------|
| `attachment.items[].file.fileId`   | string  | ✅       | File ID from complete-upload response |
| `attachment.items[].file.fileName` | string  | ✅       | Original file name |
| `attachment.items[].file.mimeType` | string  | ✅       | MIME type of the file |
| `attachment.items[].file.fileSize` | integer | ✅       | File size in bytes |

### cURL Example

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/send-message' \
--header 'Content-Type: application/json' \
--data '{
    "channelId": "414416020666490880",
    "clientMsgId": "1767846366",
    "content": {
        "attachment": {
            "items": [
                {
                    "file": {
                        "fileId": "2009120434341085185",
                        "fileName": "document.pdf",
                        "mimeType": "application/pdf",
                        "fileSize": 204800
                    }
                }
            ]
        }
    },
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO"
}'
```

---

## 8. Sending a Video Message

After completing the upload (see [Section 5](#5-file-upload-flow)), send the video message with dimensions and duration.

**Endpoint:** `POST /api/gtalk/send-message`

### `content` fields for video:

```json
{
    "attachment": {
        "caption": "Optional caption text",
        "items": [
            {
                "video": {
                    "fileId": "2009120434341085186",
                    "width": 1280,
                    "height": 720,
                    "duration": 30
                }
            }
        ]
    }
}
```

| Field                              | Type    | Required | Description |
|------------------------------------|---------|----------|-------------|
| `attachment.caption`               | string  | ❌       | Caption displayed below the video |
| `attachment.items[].video.fileId`  | string  | ✅       | File ID from complete-upload response |
| `attachment.items[].video.width`   | integer | ✅       | Video width in pixels |
| `attachment.items[].video.height`  | integer | ✅       | Video height in pixels |
| `attachment.items[].video.duration`| integer | ✅       | Video duration in seconds |

> **Tip:** Use `ffprobe` to extract width, height, and duration from a video file before uploading:
> ```bash
> ffprobe -v error \
>   -show_entries format=duration:stream=width,height,codec_type \
>   -of json video.mp4
> ```

### cURL Example

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/send-message' \
--header 'Content-Type: application/json' \
--data '{
    "channelId": "414416020666490880",
    "clientMsgId": "1767846367",
    "content": {
        "attachment": {
            "caption": "Watch this video!",
            "items": [
                {
                    "video": {
                        "fileId": "2009120434341085186",
                        "width": 1280,
                        "height": 720,
                        "duration": 30
                    }
                }
            ]
        }
    },
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO"
}'
```

---

## 9. Using an Existing File ID

If you already have a file ID from a previous upload, you can skip the upload flow and send the message directly. However, you must first retrieve the file's metadata (dimensions, duration) using the **Detail File API**.

**Endpoint:** `POST /api/gtalk/detail-file`

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/detail-file' \
--header 'Content-Type: application/json' \
--data '{
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO",
    "Id": "2009551222366867456"
}'
```

**Response:**

```json
{
    "data": {
        "ChannelId": "776912982",
        "CreatedAt": "1767949378",
        "CreatedBy": "1985291631184633856",
        "FileName": "Lifestyle.jpg",
        "FileSize": "98351",
        "Id": "2009551222366867456",
        "Metadata": "{\"width\": 680, \"height\": 453}",
        "MimeType": "image/jpeg"
    },
    "errorCode": "success",
    "error": {}
}
```

Parse the `Metadata` JSON string to extract `width`, `height` (and `duration` for videos), then use those values in the send-message request.

---

## 10. Error Handling

All API responses follow a consistent envelope format:

```json
{
    "data": { ... },
    "errorCode": "success",
    "error": {}
}
```

| Field       | Type   | Description |
|-------------|--------|-------------|
| `errorCode` | string | `"success"` on success; an error code string on failure |
| `error`     | object | Empty `{}` on success; contains `errorMessage` on failure |
| `data`      | object | Response payload (only present on success) |

### Error Response Example

```json
{
    "data": null,
    "errorCode": "unauthorized",
    "error": {
        "errorMessage": "Invalid oaToken"
    }
}
```

### Common Error Scenarios

| Scenario | What to check |
|----------|---------------|
| `errorCode` is not `"success"` | Read `error.errorMessage` for details |
| S3 PUT returns `403 Forbidden` | The presigned URL has expired — restart from Step 1 |
| S3 PUT returns `400 Bad Request` | Mismatch between `Content-Type` header and the URL's expected type |
| `detail-file` returns error | The file ID does not exist or belongs to a different channel |

---

## 11. Limits & Constraints

| Constraint | Value |
|------------|-------|
| Maximum file size | **100 MB** |
| Presigned URL validity | Until `ExpiresAt` (Unix timestamp in seconds, ~1 hour) |
| Thumbnail max dimension | **600 × 600 px** (maintain aspect ratio, do not upscale) |
| `clientMsgId` | Must be unique per message; use a Unix timestamp in milliseconds |
| `FileSize` in initiate-upload | Must be passed as a **string**, not a number |

---

## 12. Create Server Direct Channel

Creates a direct message channel between an OA (Official Account) and a specific user. Use this endpoint to obtain a `channelId` before sending messages to a user who does not yet have an existing channel.

**Endpoint:** `POST /api/gtalk/create-server-direct-channel`

### Request Body

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `oaId`     | string | ✅       | The OA (Official Account) ID |
| `oaToken`  | string | ✅       | Authentication token |
| `userId`   | string | ✅       | The target user's ID |

### cURL Example

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/create-server-direct-channel' \
--header 'Content-Type: application/json' \
--data '{
    "oaId": "2037107123134361600",
    "oaToken": "2037107123134361600:oFteX954KLceeZqcs2coB1FbmojxJlls",
    "userId": "1942438010055499776"
}'
```

### Response

```json
{
    "data": {
        "channelId": "2037112448931287040"
    },
    "errorCode": "success",
    "error": {}
}
```

| Field              | Type   | Description |
|--------------------|--------|-------------|
| `data.channelId`   | string | The newly created (or existing) direct channel ID. Use this as `channelId` in subsequent send-message requests. |

---

## 13. Configure Channel Processing

Configures the webhook processing settings for a specific channel. Use this endpoint to set up (or update) the webhook that GTalk will call when events occur on the channel.

**Endpoint:** `POST /api/gtalk/config-channel-processing`

### Request Body

| Field         | Type   | Required | Description |
|---------------|--------|----------|-------------|
| `oaId`        | string | ✅       | The OA (Official Account) ID |
| `oaToken`     | string | ✅       | Authentication token |
| `channelId`   | string | ✅       | The channel to configure |
| `processingConfig` | object | ✅  | Processing configuration — see below |

**`processingConfig.webhook` object:**

| Field                                | Type    | Required | Description |
|--------------------------------------|---------|----------|-------------|
| `enabled`                            | boolean | ✅       | Whether the webhook is active |
| `webhookURL`                         | string  | ✅       | The URL GTalk will POST events to |
| `webhookSecret`                      | string  | ❌       | Secret used to sign webhook payloads for verification |
| `webhookResponseTimeoutInSecond`     | integer | ❌       | Timeout in seconds to wait for a response from the webhook (default: 30) |
| `method`                             | string  | ❌       | HTTP method for the webhook call (e.g. `POST`) |
| `headers`                            | object  | ❌       | Custom HTTP headers to include in the webhook request |
| `retry`                              | object  | ❌       | Retry policy — see below |

**`retry` object:**

| Field                | Type             | Required | Description |
|----------------------|------------------|----------|-------------|
| `maxRetries`         | integer          | ❌       | Maximum number of retry attempts |
| `retryDelayMs`       | integer          | ❌       | Delay between retries in milliseconds |
| `retryOnStatusCodes` | array of integer | ❌       | HTTP status codes that should trigger a retry (e.g. `[500, 502, 503]`) |

### cURL Example

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/config-channel-processing' \
--header 'Content-Type: application/json' \
--data '{
    "oaId": "2037107123134361600",
    "oaToken": "2037107123134361600:oFteX954KLceeZqcs2coB1FbmojxJlls",
    "channelId": "2037112448931287040",
    "processingConfig": {
        "webhook": {
            "enabled": true,
            "webhookURL": "https://swift-comet-37.webhook.cool",
            "webhookSecret": "H6kWhg0XGeYTjw6wnPX9",
            "webhookResponseTimeoutInSecond": 30,
            "method": "POST",
            "headers": {
                "Content-Type": "application/json"
            },
            "retry": {
                "maxRetries": 3,
                "retryDelayMs": 1000,
                "retryOnStatusCodes": [500, 502, 503]
            }
        }
    }
}'
```

### Response

```json
{
    "data": {},
    "errorCode": "success",
    "error": {}
}
```


### Payload Verification

When `webhookSecret` is set, GTalk signs every outbound webhook request so your server can confirm the call is genuine.

**How the signature is computed:**

| Parameter  | Value |
|------------|-------|
| HMAC Input | `oaId + jsonPayload + timestamp + webhookSecret` |
| Algorithm  | SHA-256 |
| Output     | hex digest |
| Header     | `x-gtalk-event-signature: mac=<hex>` |

- `oaId` — the OA ID configured on the channel.
- `jsonPayload` — the raw JSON string of the webhook request body (no extra whitespace).
- `timestamp` — the `timestamp` field value from inside the payload (milliseconds since epoch, as a string).
- `webhookSecret` — the secret you supplied in `processingConfig.webhook.webhookSecret`.

**Example webhook payload (`jsonPayload`):**

```json
{
    "globalMsgId": "",
    "clientMsgId": "",
    "oaId": "2035942623564533760",
    "channelId": "0",
    "senderId": "",
    "content": "Test message for webhook validation",
    "contentType": 0,
    "timestamp": "1774425168533"
}
```

**`contentType` values:**

| Value | Description |
|-------|-------------|
| `0`   | Text message |
| `3`   | Attachment message (photo, file, or video) |

**Verification steps:**

1. Read the `x-gtalk-event-signature` header from the incoming request.
2. Extract the raw JSON body as a string (do **not** re-serialize it).
3. Extract `oaId` and `timestamp` from the parsed payload.
4. Recompute: `SHA-256(oaId + jsonPayload + timestamp + webhookSecret)` → hex digest.
5. Prepend `mac=` to the hex digest.
6. Compare with the header value using a **constant-time** equality check.
7. Reject the request (return `401`) if the values do not match.

**Node.js example:**

```js
const crypto = require('crypto');

function verifySignature(req, webhookSecret) {
  const header = req.headers['x-gtalk-event-signature'] ?? '';
  const jsonPayload = req.rawBody;          // raw request body string
  const { oaId, timestamp } = JSON.parse(jsonPayload);

  const input = oaId + jsonPayload + timestamp + webhookSecret;
  const hex = crypto.createHash('sha256').update(input).digest('hex');
  const expected = 'mac=' + hex;

  // Use constant-time comparison to prevent timing attacks
  if (header.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(header),
    Buffer.from(expected)
  );
}
```

> **Important:** Always use a constant-time comparison (e.g. `crypto.timingSafeEqual`) rather than `===` to prevent timing-based attacks.

---

## 14. Send Message Receipt

Reports read/delivery receipts to GTalk for one or more messages in a channel. Use this endpoint to inform GTalk that a recipient has received or seen a message, or to signal typing/thinking/processing states.

**Endpoint:** `POST /api/gtalk/send-message-receipt`

### Request Body

| Field            | Type   | Required | Description |
|------------------|--------|----------|-------------|
| `oaId`           | string | ✅       | The OA (Official Account) ID |
| `oaToken`        | string | ✅       | Authentication token |
| `receiptMessage` | object | ✅       | Receipt payload — see below |

**`receiptMessage` object:**

| Field       | Type            | Required | Description |
|-------------|-----------------|----------|-------------|
| `channelId` | string          | ✅       | The channel the messages belong to |
| `receipts`  | array of object | ✅       | List of receipt entries — see below. You can send multiple statuses (e.g. SEEN + TYPING) in a single call. |

**`receipts[]` item:**

| Field          | Type    | Required | Description |
|----------------|---------|----------|-------------|
| `status`       | integer | ✅       | Receipt status code — see `ReceiptStatus` table below |
| `receiptedTs`  | number  | ✅       | Timestamp of the receipt event (milliseconds since epoch) |
| `globalMsgId`  | string  | ✅       | Global message ID of the message being receipted |

> **Important:** Pass all ID fields (`oaId`, `channelId`, `globalMsgId`) as **strings**, not numbers. GTalk uses 64-bit snowflake IDs that exceed JavaScript's safe integer range — converting them to `Number` will cause precision loss and API errors.

**`ReceiptStatus` enum:**

| Value | Name              | Description |
|-------|-------------------|-------------|
| `0`   | `RS_UNKNOWN`      | Unknown status |
| `1`   | `RECEIVED`        | The recipient has received the message |
| `2`   | `SEEN`            | The recipient or another sender device has read the message |
| `3`   | `TYPING`          | A user is typing |
| `4`   | `REACTION_SEEN`   | The recipient has seen the reaction on a message |
| `5`   | `REACTION_UNSEEN` | The recipient has not yet seen the reaction on a message |
| `6`   | `THINKING`        | A user is thinking |
| `7`   | `PROCESSING`      | A user is processing |

### cURL Example — Single receipt

```bash
curl -X POST https://test-api.mbff.ghn.tech/api/gtalk/send-message-receipt \
  -H "Content-Type: application/json" \
  -d '{
    "oaId": "2037107123134361600",
    "oaToken": "your-oa-token-here",
    "receiptMessage": {
      "channelId": "2037112448931287040",
      "receipts": [
        {
          "status": 2,
          "receiptedTs": 1712567089000,
          "globalMsgId": "2042140254245965824"
        }
      ]
    }
  }'
```

### cURL Example — Multiple receipts in one call (SEEN + TYPING)

```bash
curl -X POST https://test-api.mbff.ghn.tech/api/gtalk/send-message-receipt \
  -H "Content-Type: application/json" \
  -d '{
    "oaId": "2037107123134361600",
    "oaToken": "your-oa-token-here",
    "receiptMessage": {
      "channelId": "2037112448931287040",
      "receipts": [
        {
          "status": 2,
          "receiptedTs": 1712567089000,
          "globalMsgId": "2042140254245965824"
        },
        {
          "status": 3,
          "receiptedTs": 1712567089001,
          "globalMsgId": "2042140254245965824"
        }
      ]
    }
  }'
```

### Node.js Example (using `GtalkClient`)

```ts
await client.sendReceipt({
  oaId: "2037107123134361600",
  channelId: "2037112448931287040",
  receipts: [
    {
      globalMsgId: "2042140254245965824",
      status: ReceiptStatus.SEEN,
    },
    {
      globalMsgId: "2042140254245965824",
      status: ReceiptStatus.TYPING,
    },
  ],
});
```

### Response

```json
{
    "data": {},
    "errorCode": "success",
    "error": {}
}
```


---

## 15. Modify Message

Edits or deletes an existing message in a channel. Use `action = 1` to update the message content, or `action = 2` to delete it.

**Endpoint:** `POST /api/gtalk/modify-message`

### Request Body

| Field         | Type    | Required | Description |
|---------------|---------|----------|-------------|
| `channelId`   | number  | ✅       | ID of the channel containing the message |
| `globalMsgId` | number  | ✅       | Global ID of the message to modify |
| `oaToken`     | string  | ✅       | Authentication token |
| `action`      | integer | ✅       | Modify action — see `ModifyAction` table below |
| `content`     | object  | ❌       | New message content (required when `action = 1`; ignored for `action = 2`). Supports the same structure as `send-message` — see Sections [3](#3-sending-a-text-message), [4](#4-sending-a-template-message), [6](#6-sending-a-photo-message), [7](#7-sending-a-file-message), [8](#8-sending-a-video-message). |

**`ModifyAction` enum:**

| Value | Name        | Description |
|-------|-------------|-------------|
| `1`   | `MA_EDIT`   | Edit the message with the new `content` |
| `2`   | `MA_DELETE` | Delete the message |

### cURL Example

```bash
curl -X POST https://test-api.mbff.ghn.tech/api/gtalk/modify-message \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": 987654321,
    "globalMsgId": 444555666,
    "oaToken": "your-oa-token-here",
    "action": 1,
    "content": {
      "text": "Updated message content here"
    }
  }'
```

### Response

```json
{
    "data": {},
    "errorCode": "success",
    "error": {}
}
```


---

## 16. Plugin Behavior (OpenClaw Integration)

This section describes automatic receipt behavior implemented by the `gtalk-openclaw` OpenClaw plugin when processing inbound messages.

### Automatic Receipts on Inbound Message

When the plugin receives a valid inbound webhook from GTalk, it automatically sends receipts to the user **before** dispatching the message to the agent:

1. **SEEN** (status `2`) — signals that the message has been read
2. **TYPING** (status `3`) — signals that the bot is preparing a reply

Both are sent in a **single API call** with two entries in the `receipts` array:

```ts
await client.sendReceipt({
  oaId: "...",
  channelId: "...",
  receipts: [
    { globalMsgId: "...", status: ReceiptStatus.SEEN },
    { globalMsgId: "...", status: ReceiptStatus.TYPING },
  ],
});
```

### TYPING Heartbeat

The GTalk typing indicator expires after approximately **3 seconds** on the client side. To keep the indicator visible while the agent is processing a long response, the plugin sends a TYPING receipt on a repeating interval:

| Parameter | Value |
|-----------|-------|
| Interval  | **5 seconds** |
| Max ticks | **10** (stops after 50 seconds total) |
| Stops when | Reply is delivered, or max ticks reached |

The heartbeat is automatically cancelled (via `clearInterval`) in a `finally` block once the agent finishes and the reply is delivered — regardless of success or error.

> **Note:** `clearInterval()` is safe to call multiple times on the same interval ID. If the heartbeat already stopped due to reaching the max tick count, the `finally` cancellation is a no-op.

---

## 17. Get File Download URL

Retrieves a temporary presigned download URL for an uploaded file (video, photo, image, document, etc.). Use this endpoint when you need to provide a direct download link for a file stored in GTalk.

**Endpoint:** `POST /api/gtalk/get-file`

### Request Body

| Field     | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `oaToken` | string | ✅       | Authentication token |
| `Id`      | string | ✅       | The file ID to retrieve the download URL for |

### cURL Example

```bash
curl --location 'https://test-api.mbff.ghn.tech/api/gtalk/get-file' \
--header 'Content-Type: application/json' \
--data '{
    "oaToken": "1970077287463710720:q1dTKYPcEhGmOva6XhJcXn34Yq1pbBaO",
    "Id": "2010658516932628480"
}'
```

### Response

```json
{
    "data": {
        "FileName": "Mastering AI Agents.pdf",
        "PresignedURL": "https://s3-sgn10.fptcloud.com/gtalk-file-test/2026/01/12/414416020666490880/9340a3ae-cb62-4544-9dcc-c2162269f347?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=M6REZF53HJ43PDAX41MJ%2F20260422%2Fsgn10%2Fs3%2Faws4_request&X-Amz-Date=20260422T075034Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&x-id=GetObject&X-Amz-Signature=0cb5dd18e7bb99de8ffab767c09a6c982476fb6cc0f3e2f39737dacd90d4e03f"
    },
    "errorCode": "success",
    "error": {}
}
```

| Field              | Type   | Description |
|--------------------|--------|-------------|
| `data.FileName`    | string | Original file name |
| `data.PresignedURL`| string | Temporary presigned URL to download the file. Valid for approximately **1 hour**. |

> **Note:** The `PresignedURL` is time-limited (expires in ~1 hour). Generate a fresh URL each time you need to serve the file to a user.
