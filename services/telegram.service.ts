import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

export interface TelegramUploadResult {
  fileId: string;
  fileUniqueId: string;
  messageId: number;
  type: 'photo' | 'video' | 'document';
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface TelegramFileMetadata {
  fileId: string;
  filePath: string;
  fileSize?: number;
  directDownloadUrl: string;
}

const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

/**
 * Standard Telegram Bot API (https://api.telegram.org) has a hard 50 MB limit for file uploads.
 * Files larger than 50 MB require a local Telegram Bot API server (or are stored in MovieVault's vault).
 */
export const TELEGRAM_MAX_CLOUD_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const TELEGRAM_MAX_CLOUD_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB

export function isLocalTelegramServer(): boolean {
  return Boolean(process.env.TELEGRAM_API_BASE && !process.env.TELEGRAM_API_BASE.includes('api.telegram.org'));
}

/**
 * Validates and retrieves the Telegram Bot Token from environment
 */
function formatTelegramError(desc: string): string {
  if (desc?.includes('not a member of the channel chat') || desc?.includes('chat not found') || desc?.includes('bot was kicked')) {
    return `${desc}. Please add your bot as an Administrator in your Telegram channel with 'Post Messages' permission.`;
  }
  if (desc?.includes('file is too big') || desc?.includes('Request Entity Too Large') || desc?.includes('413')) {
    return `Telegram Cloud Bot API limit of 50 MB exceeded. File is seamlessly preserved in MovieVault high-speed streaming vault.`;
  }
  return desc;
}

export interface ChannelPermissionCheck {
  configured: boolean;
  ok: boolean;
  isMember: boolean;
  isAdmin: boolean;
  canPost: boolean;
  botUsername?: string;
  chatTitle?: string;
  chatId?: string;
  message?: string;
  instructions?: string[];
}

/**
 * Verifies if the bot has admin rights to post messages in the designated channel
 */
export async function checkBotChannelPermissions(): Promise<ChannelPermissionCheck> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      configured: false,
      ok: false,
      isMember: false,
      isAdmin: false,
      canPost: false,
      message: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not provided in environment.',
    };
  }

  try {
    const meRes = await axios.get(`${TELEGRAM_API_BASE}/bot${token}/getMe`, { timeout: 8000 });
    const bot = meRes.data?.result;
    const botId = bot?.id;
    const botUsername = bot?.username || 'bot';

    let chatTitle = chatId;
    try {
      const chatRes = await axios.get(`${TELEGRAM_API_BASE}/bot${token}/getChat`, {
        params: { chat_id: chatId },
        timeout: 8000,
      });
      chatTitle = chatRes.data?.result?.title || chatRes.data?.result?.username || chatId;
    } catch {}

    try {
      const memberRes = await axios.get(`${TELEGRAM_API_BASE}/bot${token}/getChatMember`, {
        params: { chat_id: chatId, user_id: botId },
        timeout: 8000,
      });
      const member = memberRes.data?.result;
      const isAdmin = member?.status === 'administrator' || member?.status === 'creator';
      const canPost = isAdmin && member?.can_post_messages !== false;

      return {
        configured: true,
        ok: canPost,
        isMember: true,
        isAdmin,
        canPost,
        botUsername,
        chatTitle,
        chatId,
        message: canPost
          ? `Bot @${botUsername} is an Administrator in "${chatTitle}" with message posting rights.`
          : `Bot @${botUsername} is in channel "${chatTitle}" but lacks "Post Messages" administrator permission.`,
      };
    } catch (memberErr: any) {
      return {
        configured: true,
        ok: false,
        isMember: false,
        isAdmin: false,
        canPost: false,
        botUsername,
        chatTitle,
        chatId,
        message: `Bot @${botUsername} is not yet an Administrator in channel "${chatTitle}".`,
        instructions: [
          `Open your Telegram channel "${chatTitle}" in the Telegram app`,
          `Tap the channel header -> Edit / Manage Channel -> Administrators -> Add Administrator`,
          `Search for @${botUsername} and grant "Post Messages" permission`,
          `Return here and click "Verify Channel Permissions"`,
        ],
      };
    }
  } catch (err: any) {
    return {
      configured: true,
      ok: false,
      isMember: false,
      isAdmin: false,
      canPost: false,
      message: err.response?.data?.description || err.message,
    };
  }
}

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is not defined.');
  }
  return token;
}

/**
 * Validates and retrieves the Telegram Chat/Channel ID from environment
 */
function getChatId(): string {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID environment variable is not defined.');
  }
  return chatId;
}

/**
 * Normalizes input (Buffer, Uint8Array, ArrayBuffer, or Blob) into a Node Buffer
 */
async function toBuffer(
  fileInput: Buffer | Uint8Array | ArrayBuffer | Blob | any
): Promise<Buffer> {
  if (Buffer.isBuffer(fileInput)) {
    return fileInput;
  }
  if (fileInput instanceof Uint8Array) {
    return Buffer.from(fileInput);
  }
  if (fileInput instanceof ArrayBuffer) {
    return Buffer.from(fileInput);
  }
  if (fileInput && typeof fileInput.arrayBuffer === 'function') {
    const ab = await fileInput.arrayBuffer();
    return Buffer.from(ab);
  }
  if (typeof fileInput === 'string') {
    // If base64 data URI
    if (fileInput.startsWith('data:')) {
      const base64Data = fileInput.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    }
    // If string is an existing file path on disk
    if (fs.existsSync(fileInput)) {
      return fs.readFileSync(fileInput);
    }
    return Buffer.from(fileInput, 'utf-8');
  }
  throw new Error('Unsupported file input type provided to toBuffer');
}

/**
 * Fix for IMAGE_PROCESS_FAILED:
 * Telegram's sendPhoto endpoint requires:
 * 1. Proper multipart/form-data boundary headers (provided by form-data package getHeaders())
 * 2. Explicit filename with valid image extension (.jpg, .jpeg, .png, .webp)
 * 3. Explicit Content-Type header on the file part (e.g. image/jpeg)
 * 4. Max size <= 10MB (if larger, gracefully fallback to sendDocument)
 * 5. Extracting file_id from the last element of the result.photo array (highest resolution)
 */
export async function uploadPhotoToTelegram(
  fileInput: Buffer | Uint8Array | ArrayBuffer | Blob | any,
  fileName: string = 'poster.jpg',
  mimeType: string = 'image/jpeg',
  caption?: string
): Promise<TelegramUploadResult> {
  const token = getBotToken();
  const chatId = getChatId();
  const buffer = await toBuffer(fileInput);

  console.log(`[TelegramService] uploadPhotoToTelegram: name=${fileName}, size=${buffer.length} bytes, type=${mimeType}`);

  // Safety fallback: Telegram sendPhoto hard limit is 10 MB.
  // If image > 10MB, route to sendDocument directly to prevent IMAGE_PROCESS_FAILED
  const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
  if (buffer.length > MAX_PHOTO_BYTES) {
    console.warn(`[TelegramService] Image size (${buffer.length} bytes) exceeds sendPhoto 10MB limit. Routing to uploadDocumentToTelegram.`);
    return uploadDocumentToTelegram(buffer, fileName, mimeType, caption);
  }

  // Ensure fileName has a proper image extension
  let safeFileName = fileName;
  if (!/\.(jpe?g|png|webp|gif)$/i.test(safeFileName)) {
    const ext = mimeType.includes('png') ? '.png' : mimeType.includes('webp') ? '.webp' : '.jpg';
    safeFileName = `${safeFileName}${ext}`;
  }

  const form = new FormData();
  form.append('chat_id', chatId);

  // Critical fix: form-data append with explicit filename and contentType options
  form.append('photo', buffer, {
    filename: safeFileName,
    contentType: mimeType || 'image/jpeg',
    knownLength: buffer.length,
  });

  if (caption) {
    form.append('caption', caption);
  }

  try {
    const response = await axios.post(
      `${TELEGRAM_API_BASE}/bot${token}/sendPhoto`,
      form,
      {
        headers: {
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000,
      }
    );

    const data = response.data;
    if (!data.ok || !data.result || !Array.isArray(data.result.photo) || data.result.photo.length === 0) {
      throw new Error(`Telegram API returned error or empty photos: ${JSON.stringify(data)}`);
    }

    // Telegram sends photo sizes array [small, medium, large, original]
    // The highest resolution is always the last item
    const photos = data.result.photo;
    const bestPhoto = photos[photos.length - 1];

    console.log(`[TelegramService] uploadPhotoToTelegram SUCCESS: file_id=${bestPhoto.file_id}, message_id=${data.result.message_id}`);

    return {
      fileId: bestPhoto.file_id,
      fileUniqueId: bestPhoto.file_unique_id,
      messageId: data.result.message_id,
      type: 'photo',
      fileSize: bestPhoto.file_size,
      width: bestPhoto.width,
      height: bestPhoto.height,
    };
  } catch (error: any) {
    const errorDesc = error.response?.data?.description || error.message;

    // If chat permissions are missing, don't attempt redundant retries
    if (errorDesc?.includes('not a member of the channel') || errorDesc?.includes('Forbidden') || errorDesc?.includes('chat not found')) {
      throw new Error(formatTelegramError(errorDesc));
    }

    // If Telegram fails with IMAGE_PROCESS_FAILED (e.g. unsupported color space, corrupt metadata, or edge dimensions),
    // automatically fallback to sendDocument which stores the raw binary image and returns a valid file_id
    if (errorDesc?.includes('IMAGE_PROCESS_FAILED') || errorDesc?.includes('PHOTO_INVALID_DIMENSIONS')) {
      console.warn(`[TelegramService] Retrying image upload via sendDocument fallback...`);
      return uploadDocumentToTelegram(buffer, safeFileName, mimeType, caption);
    }

    throw new Error(`Telegram photo upload failed: ${formatTelegramError(errorDesc)}`);
  }
}

/**
 * Uploads a video to the Telegram channel.
 * Sets supports_streaming=true to enable instant video streaming on clients.
 */
export async function uploadVideoToTelegram(
  fileInput: Buffer | Uint8Array | ArrayBuffer | Blob | any,
  fileName: string = 'video.mp4',
  mimeType: string = 'video/mp4',
  caption?: string,
  thumbnailBuffer?: Buffer
): Promise<TelegramUploadResult> {
  const token = getBotToken();
  const chatId = getChatId();

  let safeFileName = fileName;
  const isMkv = /\.mkv$/i.test(safeFileName) || /matroska|mkv/i.test(mimeType || '');
  if (!/\.(mp4|mkv|mov|webm|avi)$/i.test(safeFileName)) {
    safeFileName = `${safeFileName}.${isMkv ? 'mkv' : 'mp4'}`;
  }

  // Proper Matroska MIME type for MKV
  const resolvedMime = isMkv ? 'video/x-matroska' : (mimeType || 'video/mp4');

  // Support file streaming from disk for large files (>2 GB) to prevent RAM exhaustion
  const diskPath = typeof fileInput === 'string' && fs.existsSync(fileInput)
    ? fileInput
    : (fileInput?.path && fs.existsSync(fileInput.path))
    ? fileInput.path
    : null;

  let streamPayload: any;
  let fileSize: number;

  if (diskPath) {
    fileSize = fs.statSync(diskPath).size;
    streamPayload = fs.createReadStream(diskPath);
    console.log(`[TelegramService] uploadVideoToTelegram (disk stream): name=${safeFileName}, size=${fileSize} bytes (${(fileSize / (1024 * 1024 * 1024)).toFixed(2)} GB), type=${resolvedMime}`);
  } else {
    const buffer = await toBuffer(fileInput);
    fileSize = buffer.length;
    streamPayload = buffer;
    console.log(`[TelegramService] uploadVideoToTelegram (buffer): name=${safeFileName}, size=${fileSize} bytes, type=${resolvedMime}`);
  }

  // Check Telegram Cloud Bot API file size limit (50 MB)
  if (!isLocalTelegramServer() && fileSize > TELEGRAM_MAX_CLOUD_FILE_SIZE) {
    throw new Error(
      `File size (${(fileSize / (1024 * 1024)).toFixed(1)} MB) exceeds Telegram Cloud Bot API limit of 50 MB. ` +
      `File is seamlessly preserved in MovieVault's high-speed local streaming vault.`
    );
  }

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('supports_streaming', 'true');

  form.append('video', streamPayload, {
    filename: safeFileName,
    contentType: resolvedMime,
    knownLength: fileSize,
  });

  if (thumbnailBuffer) {
    form.append('thumbnail', thumbnailBuffer, {
      filename: 'thumb.jpg',
      contentType: 'image/jpeg',
    });
  }

  if (caption) {
    form.append('caption', caption);
  }

  try {
    const response = await axios.post(
      `${TELEGRAM_API_BASE}/bot${token}/sendVideo`,
      form,
      {
        headers: {
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000, // 10 min timeout for large videos
      }
    );

    const data = response.data;
    if (!data.ok || !data.result || !data.result.video) {
      throw new Error(`Telegram API returned error: ${JSON.stringify(data)}`);
    }

    const video = data.result.video;
    console.log(`[TelegramService] uploadVideoToTelegram SUCCESS: file_id=${video.file_id}, duration=${video.duration}s`);

    return {
      fileId: video.file_id,
      fileUniqueId: video.file_unique_id,
      messageId: data.result.message_id,
      type: 'video',
      fileSize: video.file_size,
      width: video.width,
      height: video.height,
      duration: video.duration,
    };
  } catch (error: any) {
    const errorDesc = error.response?.data?.description || error.message;

    // Do NOT retry sendDocument if error was due to 413, file size, or permissions
    if (
      error.response?.status === 413 ||
      errorDesc?.includes('Request Entity Too Large') ||
      errorDesc?.includes('file is too big') ||
      errorDesc?.includes('not a member of the channel') ||
      errorDesc?.includes('Forbidden') ||
      errorDesc?.includes('chat not found') ||
      (!isLocalTelegramServer() && fileSize > TELEGRAM_MAX_CLOUD_FILE_SIZE)
    ) {
      throw new Error(formatTelegramError(errorDesc));
    }

    // Only retry sendDocument for format/container incompatibilities (e.g. MKV or unhandled video containers)
    console.warn(`[TelegramService] Retrying video upload (${safeFileName}) via sendDocument fallback...`);
    return uploadDocumentToTelegram(diskPath || streamPayload, safeFileName, resolvedMime, caption);
  }
}

/**
 * Uploads any file as a document (supports up to 50MB via standard Bot API, or 2GB+ with local bot server)
 */
export async function uploadDocumentToTelegram(
  fileInput: Buffer | Uint8Array | ArrayBuffer | Blob | any,
  fileName: string = 'file.bin',
  mimeType: string = 'application/octet-stream',
  caption?: string
): Promise<TelegramUploadResult> {
  const token = getBotToken();
  const chatId = getChatId();

  let resolvedMime = mimeType;
  if (/\.mkv$/i.test(fileName) && (mimeType === 'application/octet-stream' || !mimeType)) {
    resolvedMime = 'video/x-matroska';
  }

  const diskPath = typeof fileInput === 'string' && fs.existsSync(fileInput)
    ? fileInput
    : (fileInput?.path && fs.existsSync(fileInput.path))
    ? fileInput.path
    : null;

  let streamPayload: any;
  let fileSize: number;

  if (diskPath) {
    fileSize = fs.statSync(diskPath).size;
    streamPayload = fs.createReadStream(diskPath);
    console.log(`[TelegramService] uploadDocumentToTelegram (disk stream): name=${fileName}, size=${fileSize} bytes, type=${resolvedMime}`);
  } else {
    const buffer = await toBuffer(fileInput);
    fileSize = buffer.length;
    streamPayload = buffer;
    console.log(`[TelegramService] uploadDocumentToTelegram (buffer): name=${fileName}, size=${fileSize} bytes, type=${resolvedMime}`);
  }

  // Check Telegram Cloud Bot API file size limit (50 MB)
  if (!isLocalTelegramServer() && fileSize > TELEGRAM_MAX_CLOUD_FILE_SIZE) {
    throw new Error(
      `File size (${(fileSize / (1024 * 1024)).toFixed(1)} MB) exceeds Telegram Cloud Bot API limit of 50 MB. ` +
      `File is seamlessly preserved in MovieVault's high-speed local streaming vault.`
    );
  }

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('document', streamPayload, {
    filename: fileName,
    contentType: resolvedMime,
    knownLength: fileSize,
  });

  if (caption) {
    form.append('caption', caption);
  }

  try {
    const response = await axios.post(
      `${TELEGRAM_API_BASE}/bot${token}/sendDocument`,
      form,
      {
        headers: {
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000,
      }
    );

    const data = response.data;
    if (!data.ok || !data.result || !data.result.document) {
      throw new Error(`Telegram sendDocument returned error: ${JSON.stringify(data)}`);
    }

    const doc = data.result.document;
    console.log(`[TelegramService] uploadDocumentToTelegram SUCCESS: file_id=${doc.file_id}`);

    return {
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id,
      messageId: data.result.message_id,
      type: 'document',
      fileSize: doc.file_size,
    };
  } catch (error: any) {
    const errorDesc = error.response?.data?.description || error.message;
    console.error(`[TelegramService] uploadDocumentToTelegram failed:`, errorDesc);
    throw new Error(`Telegram document upload failed: ${formatTelegramError(errorDesc)}`);
  }
}

/**
 * Universal upload helper that automatically selects photo vs video vs document
 */
export async function uploadFileToTelegram(
  fileInput: Buffer | Uint8Array | ArrayBuffer | Blob | any,
  fileName: string,
  mimeType: string,
  caption?: string
): Promise<TelegramUploadResult> {
  if (mimeType.startsWith('image/')) {
    return uploadPhotoToTelegram(fileInput, fileName, mimeType, caption);
  }
  if (mimeType.startsWith('video/') || /\.mkv$/i.test(fileName) || /matroska|mkv/i.test(mimeType)) {
    return uploadVideoToTelegram(fileInput, fileName, mimeType, caption);
  }
  return uploadDocumentToTelegram(fileInput, fileName, mimeType, caption);
}

/**
 * Retrieves file metadata and direct streaming URL using a Telegram File ID
 */
export async function getTelegramFileMetadata(fileId: string): Promise<TelegramFileMetadata> {
  const token = getBotToken();

  const response = await axios.get(
    `${TELEGRAM_API_BASE}/bot${token}/getFile`,
    {
      params: { file_id: fileId },
      timeout: 15000,
    }
  );

  const data = response.data;
  if (!data.ok || !data.result || !data.result.file_path) {
    throw new Error(`Failed to resolve Telegram file_id (${fileId}): ${JSON.stringify(data)}`);
  }

  const filePath = data.result.file_path;
  const directDownloadUrl = `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`;

  return {
    fileId,
    filePath,
    fileSize: data.result.file_size,
    directDownloadUrl,
  };
}

/**
 * Deletes a previously posted message/file from the Telegram channel
 */
export async function deleteTelegramMessage(messageId: number): Promise<boolean> {
  const token = getBotToken();
  const chatId = getChatId();

  try {
    const response = await axios.post(
      `${TELEGRAM_API_BASE}/bot${token}/deleteMessage`,
      {
        chat_id: chatId,
        message_id: messageId,
      }
    );
    return response.data?.ok === true;
  } catch (err) {
    console.error(`[TelegramService] Failed to delete message ${messageId}:`, err);
    return false;
  }
}
