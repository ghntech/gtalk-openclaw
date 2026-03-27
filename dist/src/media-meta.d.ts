export interface ImageMeta {
    width: number;
    height: number;
}
export interface VideoMeta {
    width: number;
    height: number;
    duration: number;
}
/**
 * Lấy width/height của ảnh bằng sharp.
 * Hỗ trợ cả file path lẫn Buffer.
 * Cài: npm install sharp
 */
export declare function getImageMeta(input: string | Buffer): Promise<ImageMeta>;
/**
 * Lấy width/height/duration của video bằng ffprobe.
 * Input là file path hoặc Buffer (Buffer sẽ được ghi ra temp file).
 * Cần cài ffmpeg: brew install ffmpeg
 */
export declare function getVideoMeta(input: string | Buffer): Promise<VideoMeta>;
/**
 * Tạo thumbnail cho ảnh hoặc video.
 * - Ảnh: resize về max 600×600, trả về JPEG Buffer
 * - Video: extract frame đầu bằng ffmpeg, resize, trả về PNG Buffer
 *
 * Input có thể là file path hoặc Buffer.
 */
export declare function makeThumbnail(input: string | Buffer, mimeType: string): Promise<{
    buffer: Buffer;
    mimeType: string;
}>;
