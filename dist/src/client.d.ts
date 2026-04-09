export interface GtalkResponse<T> {
    data: T | null;
    errorCode: string;
    errorMessage?: string;
    error?: {
        errorMessage?: string;
    };
}
export interface SendMessageResult {
    globalMsgId: string;
}
export interface InitiateUploadResult {
    ExpiresAt: string;
    PresignedURL: string;
    PresignedThumbURL: string;
    UploadId: string;
}
export interface CompleteUploadResult {
    Id: string;
    FileName: string;
    FileSize: string;
    MimeType: string;
    ChannelId: string;
    CreatedAt: string;
    CreatedBy: string;
}
export interface FileDetailResult {
    Id: string;
    FileName: string;
    FileSize: string;
    MimeType: string;
    /** JSON string: {"width":680,"height":453} or {"width":1280,"height":720,"duration":30} */
    Metadata: string;
    ChannelId: string;
    CreatedAt: string;
    CreatedBy: string;
}
export interface CreateDirectChannelResult {
    channelId: string;
}
export interface GtalkLogger {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
}
export declare enum ReceiptStatus {
    RS_UNKNOWN = 0,
    RECEIVED = 1,
    SEEN = 2,
    TYPING = 3,
    REACTION_SEEN = 4,
    REACTION_UNSEEN = 5,
    THINKING = 6,
    PROCESSING = 7
}
export interface ReceiptEntry {
    globalMsgId: string;
    status: ReceiptStatus;
    receiptedTs?: number;
}
export interface SendReceiptParams {
    oaId: string;
    channelId: string;
    receipts: ReceiptEntry[];
}
export interface ConfigChannelProcessingParams {
    oaId: string;
    channelId: string;
    webhookURL: string;
    webhookSecret?: string;
    webhookResponseTimeoutInSecond?: number;
    method?: string;
    headers?: Record<string, string>;
    retry?: {
        maxRetries?: number;
        retryDelayMs?: number;
        retryOnStatusCodes?: number[];
    };
    enabled?: boolean;
}
export declare class GtalkClient {
    private readonly baseUrl;
    private readonly oaToken;
    private readonly logger?;
    constructor(baseUrl: string, oaToken: string, logger?: GtalkLogger);
    private post;
    sendText(channelId: string, text: string, parseMode?: "PLAIN_TEXT" | "MARKDOWN" | "HTML"): Promise<SendMessageResult>;
    sendTemplate(channelId: string, templateId: string, shortMessage: string, templateData: {
        icon_url?: string;
        title: string;
        content: string;
        actions?: Array<{
            text: string;
            style: "primary" | "secondary";
            type: "deeplink" | "browser_internal" | "browser_external";
            url: string;
        }>;
    }, parseMode?: "PLAIN_TEXT" | "MARKDOWN" | "HTML"): Promise<SendMessageResult>;
    initiateUpload(params: {
        channelId: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        metadata?: Record<string, unknown>;
    }): Promise<InitiateUploadResult>;
    uploadToS3(presignedUrl: string, data: Buffer, mimeType: string): Promise<void>;
    completeUpload(uploadId: string): Promise<CompleteUploadResult>;
    /**
     * Lấy thông tin file đã upload trước đó.
     * Dùng khi có sẵn fileId, tránh upload lại.
     */
    getFileDetail(fileId: string): Promise<FileDetailResult>;
    /**
     * Gửi media bằng fileId đã có sẵn.
     * Tự gọi detail-file để lấy metadata, không cần upload lại.
     */
    sendByFileId(channelId: string, fileId: string, caption?: string): Promise<SendMessageResult>;
    sendPhoto(channelId: string, fileId: string, width: number, height: number, caption?: string): Promise<SendMessageResult>;
    sendFile(channelId: string, fileId: string, fileName: string, mimeType: string, fileSize: number): Promise<SendMessageResult>;
    sendVideo(channelId: string, fileId: string, width: number, height: number, duration: number, caption?: string): Promise<SendMessageResult>;
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
    uploadAndSend(params: {
        channelId: string;
        filePath: string;
        caption?: string;
    }): Promise<SendMessageResult>;
    /**
     * Tạo (hoặc lấy lại) direct channel giữa OA và một user.
     * Dùng trước khi gửi tin cho user chưa có channel sẵn.
     *
     * @param oaId  - ID của OA (Official Account)
     * @param userId - ID của user muốn tạo channel
     * @returns channelId để dùng trong send-message
     */
    createDirectChannel(oaId: string, userId: string): Promise<string>;
    /**
     * Gửi receipt cho một message trong channel.
     * Dùng để báo đã nhận (SEEN) hoặc đang gõ (TYPING).
     *
     * @param params.oaId        - OA ID
     * @param params.channelId   - Channel ID
     * @param params.receipts    - Danh sách receipt entries (globalMsgId, status, receiptedTs?)
     */
    sendReceipt(params: SendReceiptParams): Promise<void>;
    /**
     * Chỉnh sửa hoặc xóa một message đã gửi.
     *
     * @param params.channelId   - Channel chứa message
     * @param params.globalMsgId - Global message ID cần sửa/xóa
     * @param params.action      - 1=edit, 2=delete
     * @param params.content     - Nội dung mới (bắt buộc khi action=1)
     */
    modifyMessage(params: {
        channelId: string;
        globalMsgId: string;
        action: 1 | 2;
        content?: Record<string, unknown>;
    }): Promise<void>;
    /**
     * Cấu hình webhook cho một channel.
     * Gọi một lần khi setup, hoặc khi cần cập nhật webhook URL/secret.
     *
     * Workflow khuyến nghị khi onboard user mới:
     *   1. createDirectChannel(oaId, userId) → channelId
     *   2. configChannelWebhook({ oaId, channelId, webhookURL, webhookSecret })
     *   3. Lưu channelId lại để dùng cho send-message sau này
     */
    configChannelWebhook(params: ConfigChannelProcessingParams): Promise<void>;
}
