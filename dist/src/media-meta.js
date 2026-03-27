import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
const execFileAsync = promisify(execFile);
/**
 * Lấy width/height của ảnh bằng sharp.
 * Hỗ trợ cả file path lẫn Buffer.
 * Cài: npm install sharp
 */
export async function getImageMeta(input) {
    try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(input).metadata();
        if (!meta.width || !meta.height) {
            throw new Error("Cannot read image dimensions");
        }
        return { width: meta.width, height: meta.height };
    }
    catch (err) {
        if (err.code === "ERR_MODULE_NOT_FOUND" || err.message?.includes("Cannot find")) {
            throw new Error("sharp is not installed. Run: npm install sharp");
        }
        throw err;
    }
}
/**
 * Lấy width/height/duration của video bằng ffprobe.
 * Input là file path hoặc Buffer (Buffer sẽ được ghi ra temp file).
 * Cần cài ffmpeg: brew install ffmpeg
 */
export async function getVideoMeta(input) {
    let filePath;
    let isTempFile = false;
    if (Buffer.isBuffer(input)) {
        filePath = join(tmpdir(), `gtalk_video_${Date.now()}.mp4`);
        writeFileSync(filePath, input);
        isTempFile = true;
    }
    else {
        filePath = input;
    }
    try {
        const { stdout } = await execFileAsync("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration:stream=width,height,codec_type",
            "-of", "json",
            filePath,
        ]);
        const json = JSON.parse(stdout);
        const videoStream = json.streams?.find((s) => s.codec_type === "video");
        if (!videoStream?.width || !videoStream?.height) {
            throw new Error("Cannot read video dimensions");
        }
        const duration = Math.floor(parseFloat(json.format?.duration ?? "0"));
        if (!duration) {
            throw new Error("Cannot read video duration");
        }
        return { width: videoStream.width, height: videoStream.height, duration };
    }
    catch (err) {
        if (err.code === "ENOENT") {
            throw new Error("ffprobe not found. Run: brew install ffmpeg");
        }
        throw err;
    }
    finally {
        if (isTempFile) {
            try {
                unlinkSync(filePath);
            }
            catch { }
        }
    }
}
/**
 * Tạo thumbnail cho ảnh hoặc video.
 * - Ảnh: resize về max 600×600, trả về JPEG Buffer
 * - Video: extract frame đầu bằng ffmpeg, resize, trả về PNG Buffer
 *
 * Input có thể là file path hoặc Buffer.
 */
export async function makeThumbnail(input, mimeType) {
    const MAX = 600;
    const sharp = (await import("sharp")).default;
    if (mimeType.startsWith("image/")) {
        const buffer = await sharp(input)
            .resize(MAX, MAX, { fit: "inside", withoutEnlargement: true })
            .jpeg()
            .toBuffer();
        return { buffer, mimeType: "image/jpeg" };
    }
    if (mimeType.startsWith("video/")) {
        // Ghi video ra temp file
        let videoPath;
        let isTempVideo = false;
        if (Buffer.isBuffer(input)) {
            videoPath = join(tmpdir(), `gtalk_video_${Date.now()}.mp4`);
            writeFileSync(videoPath, input);
            isTempVideo = true;
        }
        else {
            videoPath = input;
        }
        const thumbPath = join(tmpdir(), `gtalk_thumb_${Date.now()}.png`);
        try {
            // Extract first frame bằng ffmpeg → PNG
            await execFileAsync("ffmpeg", [
                "-i", videoPath,
                "-ss", "00:00:00.000",
                "-vframes", "1",
                "-f", "image2",
                thumbPath,
                "-y",
            ]);
            const frameBuffer = readFileSync(thumbPath);
            // Resize về max 600×600, giữ PNG
            const resized = await sharp(frameBuffer)
                .resize(MAX, MAX, { fit: "inside", withoutEnlargement: true })
                .png()
                .toBuffer();
            return { buffer: resized, mimeType: "image/png" };
        }
        catch (err) {
            if (err.code === "ENOENT") {
                throw new Error("ffmpeg not found. Run: brew install ffmpeg");
            }
            throw err;
        }
        finally {
            if (isTempVideo) {
                try {
                    unlinkSync(videoPath);
                }
                catch { }
            }
            try {
                unlinkSync(thumbPath);
            }
            catch { }
        }
    }
    throw new Error(`makeThumbnail: unsupported mimeType ${mimeType}`);
}
