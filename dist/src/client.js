import { statSync } from "fs";
import { basename } from "path";
import { lookup as mimeLookup } from "mime-types";
import { getImageMeta, getVideoMeta, makeThumbnail } from "./media-meta.js";
export class GtalkClient {
    baseUrl;
    oaToken;
    constructor(baseUrl, oaToken) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.oaToken = oaToken;
    }
    async post(path, body) {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, oaToken: this.oaToken }),
        });
        const json = (await res.json());
        if (json.errorCode !== "success") {
            const msg = json.errorMessage ?? json.error?.errorMessage ?? "unknown error";
            throw new Error(`GTalk API error [${json.errorCode}]: ${msg}`);
        }
        return json.data;
    }
    // ─── Text Message ─────────────────────────────────────────────────────────
    async sendText(channelId, text, parseMode = "PLAIN_TEXT") {
        return this.post("/api/gtalk/send-message", {
            channelId,
            clientMsgId: Date.now().toString(),
            content: { text, parseMode },
        });
    }
    // ─── Template Message ─────────────────────────────────────────────────────
    async sendTemplate(channelId, templateId, shortMessage, templateData, parseMode) {
        const content = {
            template: {
                templateId,
                shortMessage,
                data: JSON.stringify({
                    icon_url: templateData.icon_url || "",
                    title: templateData.title,
                    content: templateData.content,
                    actions: templateData.actions || [],
                }),
            },
        };
        if (parseMode)
            content.parseMode = parseMode;
        return this.post("/api/gtalk/send-message", {
            channelId,
            clientMsgId: Date.now().toString(),
            content,
        });
    }
    // ─── File Upload Flow ─────────────────────────────────────────────────────
    async initiateUpload(params) {
        return this.post("/api/gtalk/initiate-upload", {
            ChannelId: params.channelId,
            FileName: params.fileName,
            FileSize: String(params.fileSize),
            MimeType: params.mimeType,
            ...(params.metadata ? { Metadata: JSON.stringify(params.metadata) } : {}),
        });
    }
    async uploadToS3(presignedUrl, data, mimeType) {
        const res = await fetch(presignedUrl, {
            method: "PUT",
            headers: { "Content-Type": mimeType },
            body: data,
        });
        if (!res.ok) {
            throw new Error(`S3 upload failed: ${res.status} ${res.statusText}`);
        }
    }
    async completeUpload(uploadId) {
        return this.post("/api/gtalk/complete-upload", {
            UploadId: uploadId,
        });
    }
    /**
     * Lấy thông tin file đã upload trước đó.
     * Dùng khi có sẵn fileId, tránh upload lại.
     */
    async getFileDetail(fileId) {
        return this.post("/api/gtalk/detail-file", {
            Id: fileId,
        });
    }
    // ─── Send by fileId (reuse) ───────────────────────────────────────────────
    /**
     * Gửi media bằng fileId đã có sẵn.
     * Tự gọi detail-file để lấy metadata, không cần upload lại.
     */
    async sendByFileId(channelId, fileId, caption) {
        const detail = await this.getFileDetail(fileId);
        const mimeType = detail.MimeType;
        const metadata = detail.Metadata ? JSON.parse(detail.Metadata) : {};
        if (mimeType.startsWith("image/")) {
            return this.sendPhoto(channelId, fileId, metadata.width ?? 0, metadata.height ?? 0, caption);
        }
        else if (mimeType.startsWith("video/")) {
            return this.sendVideo(channelId, fileId, metadata.width ?? 0, metadata.height ?? 0, metadata.duration ?? 0, caption);
        }
        else {
            return this.sendFile(channelId, fileId, detail.FileName, mimeType, parseInt(detail.FileSize, 10));
        }
    }
    // ─── Photo Message ────────────────────────────────────────────────────────
    async sendPhoto(channelId, fileId, width, height, caption) {
        return this.post("/api/gtalk/send-message", {
            channelId,
            clientMsgId: Date.now().toString(),
            content: {
                attachment: {
                    ...(caption ? { caption } : {}),
                    items: [{ image: { fileId, width, height } }],
                },
            },
        });
    }
    // ─── File Message ─────────────────────────────────────────────────────────
    async sendFile(channelId, fileId, fileName, mimeType, fileSize) {
        return this.post("/api/gtalk/send-message", {
            channelId,
            clientMsgId: Date.now().toString(),
            content: {
                attachment: {
                    items: [{ file: { fileId, fileName, mimeType, fileSize } }],
                },
            },
        });
    }
    // ─── Video Message ────────────────────────────────────────────────────────
    async sendVideo(channelId, fileId, width, height, duration, caption) {
        return this.post("/api/gtalk/send-message", {
            channelId,
            clientMsgId: Date.now().toString(),
            content: {
                attachment: {
                    ...(caption ? { caption } : {}),
                    items: [{ video: { fileId, width, height, duration } }],
                },
            },
        });
    }
    // ─── Upload + Send (full flow) ────────────────────────────────────────────
    /**
     * Full 3-step upload flow rồi gửi media message.
     * Tự động:
     * - Detect MIME type từ tên file
     * - Đọc width/height (ảnh: sharp, video: ffprobe)
     * - Tạo thumbnail đúng chuẩn GTalk (ảnh: JPEG, video: PNG từ frame đầu)
     * - Upload original + thumbnail lên S3
     * - Complete upload → gửi đúng loại message
     *
     * Max file size: 100MB
     */
    async uploadAndSend(params) {
        const { channelId, filePath, caption } = params;
        const { size: fileSize } = statSync(filePath);
        const fileName = basename(filePath);
        const mimeType = (mimeLookup(fileName) || "application/octet-stream");
        const isImage = mimeType.startsWith("image/");
        const isVideo = mimeType.startsWith("video/");
        const MAX_FILE_SIZE = 100 * 1024 * 1024;
        if (fileSize > MAX_FILE_SIZE) {
            throw new Error(`File size exceeds 100MB limit (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
        }
        // Read file buffer
        const { readFile } = await import("fs/promises");
        const fileBuffer = await readFile(filePath);
        // Auto-detect media metadata
        let mediaMeta = {};
        if (isImage) {
            mediaMeta = await getImageMeta(fileBuffer);
        }
        else if (isVideo) {
            // Video cần ghi ra temp file để ffprobe đọc — media-meta.ts lo
            mediaMeta = await getVideoMeta(filePath);
        }
        // Step 1: Initiate upload
        const initiated = await this.initiateUpload({
            channelId,
            fileName,
            fileSize,
            mimeType,
            metadata: (isImage || isVideo) ? mediaMeta : undefined,
        });
        // Step 2a: Upload original file
        await this.uploadToS3(initiated.PresignedURL, fileBuffer, mimeType);
        // Step 2b: Generate + upload thumbnail
        if (isImage || isVideo) {
            const { buffer: thumbBuffer, mimeType: thumbMime } = await makeThumbnail(isVideo ? filePath : fileBuffer, mimeType);
            await this.uploadToS3(initiated.PresignedThumbURL, thumbBuffer, thumbMime);
        }
        else {
            // Non-media: dùng file gốc làm thumbnail
            await this.uploadToS3(initiated.PresignedThumbURL, fileBuffer, mimeType);
        }
        // Step 3: Complete upload
        const completed = await this.completeUpload(initiated.UploadId);
        const fileId = completed.Id;
        // Step 4: Send message theo loại
        if (isImage && mediaMeta.width && mediaMeta.height) {
            return this.sendPhoto(channelId, fileId, mediaMeta.width, mediaMeta.height, caption);
        }
        else if (isVideo && mediaMeta.width && mediaMeta.height && mediaMeta.duration) {
            return this.sendVideo(channelId, fileId, mediaMeta.width, mediaMeta.height, mediaMeta.duration, caption);
        }
        else {
            return this.sendFile(channelId, fileId, fileName, mimeType, fileSize);
        }
    }
    // ─── Create Direct Channel ────────────────────────────────────────────────
    /**
     * Tạo (hoặc lấy lại) direct channel giữa OA và một user.
     * Dùng trước khi gửi tin cho user chưa có channel sẵn.
     *
     * @param oaId  - ID của OA (Official Account)
     * @param userId - ID của user muốn tạo channel
     * @returns channelId để dùng trong send-message
     */
    async createDirectChannel(oaId, userId) {
        const result = await this.post("/api/gtalk/create-server-direct-channel", { oaId, userId });
        return result.channelId;
    }
    // ─── Configure Channel Webhook ────────────────────────────────────────────
    /**
     * Cấu hình webhook cho một channel.
     * Gọi một lần khi setup, hoặc khi cần cập nhật webhook URL/secret.
     *
     * Workflow khuyến nghị khi onboard user mới:
     *   1. createDirectChannel(oaId, userId) → channelId
     *   2. configChannelWebhook({ oaId, channelId, webhookURL, webhookSecret })
     *   3. Lưu channelId lại để dùng cho send-message sau này
     */
    async configChannelWebhook(params) {
        await this.post("/api/gtalk/config-channel-processing", {
            oaId: params.oaId,
            channelId: params.channelId,
            processingConfig: {
                webhook: {
                    enabled: params.enabled ?? true,
                    webhookURL: params.webhookURL,
                    ...(params.webhookSecret ? { webhookSecret: params.webhookSecret } : {}),
                    webhookResponseTimeoutInSecond: params.webhookResponseTimeoutInSecond ?? 30,
                    method: params.method ?? "POST",
                    headers: params.headers ?? { "Content-Type": "application/json" },
                    ...(params.retry ? { retry: params.retry } : {}),
                },
            },
        });
    }
}
