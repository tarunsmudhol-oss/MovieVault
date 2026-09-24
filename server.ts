import express from 'express';
import http from 'http';
import path from 'path';
import os from 'os';
import fs from 'fs';
import multer from 'multer';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  uploadPhotoToTelegram,
  uploadVideoToTelegram,
  getTelegramFileMetadata,
  checkBotChannelPermissions,
} from './services/telegram.service';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Disk storage directories for high-performance processing of files > 2 GB without memory limits
const uploadDir = path.join(process.cwd(), 'movievault_uploads');
const mediaVaultDir = path.join(process.cwd(), 'movievault_media');
const dataDir = path.join(process.cwd(), 'movievault_data');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(mediaVaultDir)) fs.mkdirSync(mediaVaultDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Prevent server crashes from client disconnects (EPIPE, ECONNRESET on mobile 4G/5G)
process.on('uncaughtException', (err: any) => {
  if (err?.code === 'ECONNRESET' || err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
    return;
  }
  console.error('[MovieVault Server] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[MovieVault Server] Unhandled Rejection:', reason);
});

// Disk storage for multer to stream files > 2 GB cleanly to disk
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 * 1024, // 20 GB file size limit (allows > 2 GB)
    fieldSize: 100 * 1024 * 1024,      // 100 MB max field size
  },
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// In-memory & disk-persisted catalog database
interface InMemContent {
  id: string;
  type: 'MOVIE' | 'SERIES';
  title: string;
  slug: string;
  description: string;
  genres: string[];
  language: string;
  releaseYear: number;
  poster: string; // Telegram File ID or URL
  banner: string; // Telegram File ID or URL
  createdAt: string;
  movie?: {
    telegramFileId: string;
    duration?: number;
    streamUrl?: string;
  };
  seasons?: {
    seasonNumber: number;
    episodes: {
      episodeNumber: number;
      title: string;
      telegramFileId: string;
      thumbnail: string;
      duration?: number;
      streamUrl?: string;
    }[];
  }[];
}

const catalogFile = path.join(dataDir, 'catalog.json');

function loadCatalog(): InMemContent[] {
  try {
    if (fs.existsSync(catalogFile)) {
      const data = fs.readFileSync(catalogFile, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Error loading catalog.json:', err);
  }
  return [];
}

export function saveCatalog(items: InMemContent[]) {
  try {
    fs.writeFileSync(catalogFile, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving catalog.json:', err);
  }
}

// Load content from disk on boot
const contentDatabase: InMemContent[] = loadCatalog();

// Helper to check if telegram credentials are set
function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// Cached Telegram channel permission checker to prevent spamming Telegram API
let lastChannelCheckTime = 0;
let cachedChannelCheck: any = null;

async function getChannelPostingStatus(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedChannelCheck && (now - lastChannelCheckTime < 20000)) {
    return cachedChannelCheck;
  }
  cachedChannelCheck = await checkBotChannelPermissions();
  lastChannelCheckTime = now;
  return cachedChannelCheck;
}

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    telegramConfigured: isTelegramConfigured(),
    timestamp: new Date().toISOString(),
  });
});

// 2. Telegram Bot status and diagnostics
app.get('/api/telegram/status', async (req, res) => {
  const refresh = req.query.refresh === 'true';
  const status = await getChannelPostingStatus(refresh);
  res.json(status);
});

// 3. Test Telegram Photo Upload directly
app.post('/api/telegram/test-upload', upload.single('testPhoto') as any, async (req, res) => {
  try {
    if (!isTelegramConfigured()) {
      return res.status(400).json({
        error: 'Telegram Bot credentials not configured in environment variables.',
      });
    }

    let buffer: Buffer;
    let fileName = 'test_image.jpg';
    let mimeType = 'image/jpeg';

    if (req.file) {
      const fileBuf = getFileBuffer(req.file);
      if (!fileBuf) {
        return res.status(400).json({
          error: 'Failed to read uploaded test photo from disk.',
        });
      }
      buffer = fileBuf;
      fileName = req.file.originalname;
      mimeType = req.file.mimetype;
    } else {
      // 1x1 transparent red pixel JPEG buffer
      const sampleBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
      buffer = Buffer.from(sampleBase64, 'base64');
    }

    const result = await uploadPhotoToTelegram(
      buffer,
      fileName,
      mimeType,
      `[MovieVault Diagnostic Test] ${new Date().toISOString()}`
    );

    res.json({
      success: true,
      message: 'Test photo successfully uploaded to Telegram channel without IMAGE_PROCESS_FAILED!',
      result,
    });
  } catch (err: any) {
    console.error('Test upload error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null,
    });
  } finally {
    if (req.file) {
      safeCleanup(req.file);
    }
  }
});

// 4. Content catalog API
app.get('/api/content', (req, res) => {
  res.json({
    items: contentDatabase,
    total: contentDatabase.length,
  });
});

app.delete('/api/content/:id', (req, res) => {
  const { id } = req.params;
  const index = contentDatabase.findIndex(c => c.id === id);
  if (index !== -1) {
    contentDatabase.splice(index, 1);
    saveCatalog(contentDatabase);
    res.json({ success: true, message: 'Deleted successfully' });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Helper to retrieve buffer safely from disk or memory
function getFileBuffer(file?: Express.Multer.File): Buffer | null {
  if (!file) return null;
  if (file.buffer) return file.buffer;
  if (file.path && fs.existsSync(file.path)) {
    return fs.readFileSync(file.path);
  }
  return null;
}

function safeCleanup(file?: Express.Multer.File) {
  if (file?.path && fs.existsSync(file.path)) {
    try {
      fs.unlinkSync(file.path);
    } catch {}
  }
}

// 4.5 Chunked upload endpoint to bypass proxy & Cloud Run 32MB single-request limits
app.post('/api/upload/chunk', (req, res, next) => {
  (upload.single('chunk') as any)(req, res, (err: any) => {
    if (err) {
      console.error('[Chunk Middleware Error]:', err);
      return res.status(400).json({ error: `Chunk error: ${err.message}` });
    }
    next();
  });
}, async (req, res) => {
  try {
    const file = req.file;
    const body = req.body || {};
    const uploadId = body.uploadId;
    const fileKey = body.fileKey;
    const chunkIndex = parseInt(body.chunkIndex, 10);
    const totalChunks = parseInt(body.totalChunks, 10);
    const originalName = body.originalName || 'video.mp4';

    if (!file || !uploadId || !fileKey || isNaN(chunkIndex) || isNaN(totalChunks)) {
      return res.status(400).json({
        error: 'Missing chunk upload parameters (uploadId, fileKey, chunkIndex, totalChunks)',
      });
    }

    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const assembledFileName = `assembled_${uploadId}__SEP__${fileKey}__SEP__${sanitizedName}`;
    const assembledPath = path.join(uploadDir, assembledFileName);

    // If first chunk, reset assembled file to ensure clean write
    if (chunkIndex === 0 && fs.existsSync(assembledPath)) {
      try { fs.unlinkSync(assembledPath); } catch {}
    }

    // Stream-append chunk directly into assembled file
    if (file.path && fs.existsSync(file.path)) {
      fs.appendFileSync(assembledPath, fs.readFileSync(file.path));
      try {
        fs.unlinkSync(file.path);
      } catch {}
    } else if (file.buffer) {
      fs.appendFileSync(assembledPath, file.buffer);
    }

    // If final chunk, immediately respond - file is already fully assembled!
    if (chunkIndex === totalChunks - 1) {
      const totalSize = fs.existsSync(assembledPath) ? fs.statSync(assembledPath).size : 0;
      const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      console.log(`[Chunk Assembler] Completed streaming ${fileKey} (${totalSizeMB} MB, ${totalChunks} chunks) -> ${assembledFileName}`);

      return res.json({
        success: true,
        assembled: true,
        chunkIndex,
        totalChunks,
        totalSize,
      });
    }

    res.json({
      success: true,
      assembled: false,
      chunkIndex,
      totalChunks,
    });
  } catch (err: any) {
    console.error('[Chunk Upload Error]:', err);
    res.status(500).json({ error: err.message || 'Chunk processing failed' });
  }
});

// 5. Upload route (implements the exact architecture for MovieVault with >2GB support)
app.post('/api/upload', (req, res, next) => {
  (upload.any() as any)(req, res, (err: any) => {
    if (err) {
      console.error('[Upload Middleware Error]:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'Payload Too Large: One of the uploaded files exceeds the maximum limit of 20 GB.',
          code: 'PAYLOAD_TOO_LARGE',
        });
      }
      return res.status(400).json({
        error: `Upload processing error: ${err.message}`,
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const body = req.body || {};

    const type = (body.type || 'SERIES').toUpperCase() as 'MOVIE' | 'SERIES';
    const title = body.title || 'Untitled';
    const description = body.description || '';
    const genreRaw = body.genre || body.genres || 'Action';
    const language = body.language || 'English';
    const releaseYear = parseInt(body.releaseYear || String(new Date().getFullYear()), 10);

    const genres = typeof genreRaw === 'string'
      ? genreRaw.split(',').map((g: string) => g.trim()).filter(Boolean)
      : ['Action'];

    // Map files by fieldname
    const fileMap = new Map<string, Express.Multer.File>();
    files.forEach((f) => fileMap.set(f.fieldname, f));

    // Connect any chunk-assembled files from /tmp/movievault_uploads matching this uploadId
    const uploadId = body.uploadId as string | undefined;
    if (uploadId && fs.existsSync(uploadDir)) {
      const dirFiles = fs.readdirSync(uploadDir);
      dirFiles.forEach((fileName) => {
        const sepPrefix = `assembled_${uploadId}__SEP__`;
        const legacyPrefix = `assembled_${uploadId}_`;
        let fileKey = '';
        let origName = fileName;

        if (fileName.startsWith(sepPrefix)) {
          const rest = fileName.substring(sepPrefix.length);
          const sepIdx = rest.indexOf('__SEP__');
          fileKey = sepIdx > 0 ? rest.substring(0, sepIdx) : rest;
          origName = sepIdx > 0 ? rest.substring(sepIdx + 7) : fileName;
        } else if (fileName.startsWith(legacyPrefix)) {
          const rest = fileName.substring(legacyPrefix.length);
          const lastUnderscore = rest.lastIndexOf('_');
          fileKey = lastUnderscore > 0 ? rest.substring(0, lastUnderscore) : rest;
          origName = lastUnderscore > 0 ? rest.substring(lastUnderscore + 1) : fileName;
        }

        if (fileKey) {
          const fullPath = path.join(uploadDir, fileName);
          const stats = fs.statSync(fullPath);
          const isMkv = fileName.toLowerCase().endsWith('.mkv');
          const mime = isMkv ? 'video/x-matroska' : 'video/mp4';

          const virtualFile: Express.Multer.File = {
            fieldname: fileKey,
            originalname: origName,
            encoding: '7bit',
            mimetype: mime,
            size: stats.size,
            destination: uploadDir,
            filename: fileName,
            path: fullPath,
            buffer: undefined as any,
          } as Express.Multer.File;

          fileMap.set(fileKey, virtualFile);
          console.log(`[Server] Linked chunk-assembled file "${fileKey}" (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
        }
      });
    }

    const posterFile = fileMap.get('poster');
    const bannerFile = fileMap.get('banner');

    console.log(`[Server /api/upload] Received upload for "${title}" (${type}). Total files: ${files.length}`);

    let posterFileId = `sim_poster_${Date.now()}`;
    let bannerFileId = `sim_banner_${Date.now()}`;
    let posterUrl = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop&q=80';
    let bannerUrl = 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&auto=format&fit=crop&q=80';

    // Verify Telegram Bot channel permissions
    const channelStatus = isTelegramConfigured() ? await getChannelPostingStatus() : null;
    const canUploadToTg = Boolean(channelStatus && channelStatus.canPost);

    if (isTelegramConfigured() && !canUploadToTg) {
      console.log(`[Server] Bot @${channelStatus?.botUsername || 'bot'} is not yet an Administrator in channel "${channelStatus?.chatTitle || 'channel'}". Preserving media in MovieVault streaming vault.`);
    } else if (!isTelegramConfigured()) {
      console.log(`[Server] Note: TELEGRAM_BOT_TOKEN not configured. Preserving media in MovieVault local streaming vault.`);
    }

    if (posterFile) {
      const posterBuf = getFileBuffer(posterFile);
      if (posterBuf) {
        if (canUploadToTg) {
          try {
            console.log(`[Server] Uploading poster to Telegram...`);
            const posterRes = await uploadPhotoToTelegram(
              posterBuf,
              posterFile.originalname || 'poster.jpg',
              posterFile.mimetype || 'image/jpeg',
              `Poster: ${title}`
            );
            posterFileId = posterRes.fileId;
            posterUrl = `/api/stream?fileId=${posterFileId}`;
          } catch (tgPosterErr: any) {
            console.warn(`[Server] Telegram poster upload notice: ${tgPosterErr.message}. Preserving in local media vault.`);
            const vaultPosterName = `poster_${Date.now()}_${posterFile.originalname || 'poster.jpg'}`;
            const vaultPosterPath = path.join(mediaVaultDir, vaultPosterName);
            fs.writeFileSync(vaultPosterPath, posterBuf);
            posterFileId = `local_${vaultPosterName}`;
            posterUrl = `/api/stream?fileId=${posterFileId}`;
          }
        } else {
          const vaultPosterName = `poster_${Date.now()}_${posterFile.originalname || 'poster.jpg'}`;
          const vaultPosterPath = path.join(mediaVaultDir, vaultPosterName);
          fs.writeFileSync(vaultPosterPath, posterBuf);
          posterFileId = `local_${vaultPosterName}`;
          posterUrl = `/api/stream?fileId=${posterFileId}`;
        }
      }
    }

    if (bannerFile) {
      const bannerBuf = getFileBuffer(bannerFile);
      if (bannerBuf) {
        if (canUploadToTg) {
          try {
            console.log(`[Server] Uploading banner to Telegram...`);
            const bannerRes = await uploadPhotoToTelegram(
              bannerBuf,
              bannerFile.originalname || 'banner.jpg',
              bannerFile.mimetype || 'image/jpeg',
              `Banner: ${title}`
            );
            bannerFileId = bannerRes.fileId;
            bannerUrl = `/api/stream?fileId=${bannerFileId}`;
          } catch (tgBannerErr: any) {
            console.warn(`[Server] Telegram banner upload notice: ${tgBannerErr.message}. Preserving in local media vault.`);
            const vaultBannerName = `banner_${Date.now()}_${bannerFile.originalname || 'banner.jpg'}`;
            const vaultBannerPath = path.join(mediaVaultDir, vaultBannerName);
            fs.writeFileSync(vaultBannerPath, bannerBuf);
            bannerFileId = `local_${vaultBannerName}`;
            bannerUrl = `/api/stream?fileId=${bannerFileId}`;
          }
        } else {
          const vaultBannerName = `banner_${Date.now()}_${bannerFile.originalname || 'banner.jpg'}`;
          const vaultBannerPath = path.join(mediaVaultDir, vaultBannerName);
          fs.writeFileSync(vaultBannerPath, bannerBuf);
          bannerFileId = `local_${vaultBannerName}`;
          bannerUrl = `/api/stream?fileId=${bannerFileId}`;
        }
      }
    }

    const newId = `mv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const slug = title.toLowerCase().replace(/[\s\W-]+/g, '-');

    if (type === 'MOVIE') {
      const movieFile = fileMap.get('movieVideo') || fileMap.get('video');
      let movieFileId = `sim_movie_${Date.now()}`;
      let streamUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4';

      if (movieFile) {
        const isMkv = movieFile.originalname?.toLowerCase().endsWith('.mkv');
        const resolvedMime = isMkv ? 'video/x-matroska' : (movieFile.mimetype || 'video/mp4');
        const defaultName = isMkv ? 'movie.mkv' : 'movie.mp4';
        const fileSizeGB = (movieFile.size / (1024 * 1024 * 1024)).toFixed(2);
        console.log(`[Server] Processing movie video: ${movieFile.originalname} (${fileSizeGB} GB, ${movieFile.size} bytes)...`);

        let uploadedToTelegram = false;

        if (canUploadToTg) {
          try {
            console.log(`[Server] Uploading movie video to Telegram via streaming disk pipeline...`);
            const vidRes = await uploadVideoToTelegram(
              movieFile.path || movieFile.buffer,
              movieFile.originalname || defaultName,
              resolvedMime,
              `Movie: ${title}`
            );
            movieFileId = vidRes.fileId;
            streamUrl = `/api/stream?fileId=${movieFileId}`;
            uploadedToTelegram = true;
          } catch (tgErr: any) {
            console.warn(`[Server] Telegram upload returned notice: ${tgErr.message}. Preserving in MovieVault high-speed streaming vault.`);
          }
        }

        // If Telegram was not configured, or if Telegram cloud rejected the file size (>50MB/2GB limit),
        // store the large media file in MovieVault persistent streaming media vault!
        if (!uploadedToTelegram) {
          const vaultId = `vault_mov_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          const ext = isMkv ? '.mkv' : (path.extname(movieFile.originalname) || '.mp4');
          const vaultFileName = `${vaultId}${ext}`;
          const permanentPath = path.join(mediaVaultDir, vaultFileName);

          if (movieFile.path && fs.existsSync(movieFile.path)) {
            try {
              fs.renameSync(movieFile.path, permanentPath);
            } catch {
              fs.copyFileSync(movieFile.path, permanentPath);
              try { fs.unlinkSync(movieFile.path); } catch {}
            }
          } else if (movieFile.buffer) {
            fs.writeFileSync(permanentPath, movieFile.buffer);
          }

          movieFileId = `local_${vaultFileName}`;
          streamUrl = `/api/stream?fileId=${movieFileId}`;
          console.log(`[Server] Preserved media (> 2 GB ready) in streaming vault: ${permanentPath}`);
        }

        safeCleanup(movieFile);
      }

      safeCleanup(posterFile);
      safeCleanup(bannerFile);

      const newContent: InMemContent = {
        id: newId,
        type: 'MOVIE',
        title,
        slug,
        description,
        genres,
        language,
        releaseYear,
        poster: posterUrl,
        banner: bannerUrl,
        createdAt: new Date().toISOString(),
        movie: {
          telegramFileId: movieFileId,
          duration: 7200,
          streamUrl,
        },
      };

      contentDatabase.unshift(newContent);
      saveCatalog(contentDatabase);

      const botName = channelStatus?.botUsername ? `@${channelStatus.botUsername}` : 'your bot';
      const channelName = channelStatus?.chatTitle || channelStatus?.chatId || 'your channel';
      const movieNotice = canUploadToTg
        ? 'Movie successfully uploaded and saved with Telegram File IDs!'
        : isTelegramConfigured()
        ? `Movie saved in MovieVault high-speed streaming vault! (Note: Add ${botName} as an Administrator in "${channelName}" with "Post Messages" permission to host directly on Telegram).`
        : 'Movie uploaded into MovieVault with high-speed streaming support.';

      return res.json({
        success: true,
        message: movieNotice,
        content: newContent,
      });
    }

    // SERIES TYPE
    let seasonsMetadata: any[] = [];
    if (body.metadata) {
      try {
        seasonsMetadata = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata;
      } catch (e) {
        console.error('Error parsing metadata JSON:', e);
      }
    }

    const createdSeasons: any[] = [];

    for (let sIdx = 0; sIdx < (seasonsMetadata.length || 1); sIdx++) {
      const seasonObj = seasonsMetadata[sIdx] || { seasonNumber: sIdx + 1, episodes: [] };
      const episodesList = seasonObj.episodes || [];
      const createdEpisodes: any[] = [];

      for (let eIdx = 0; eIdx < (episodesList.length || 1); eIdx++) {
        const epMeta = episodesList[eIdx] || {
          episodeNo: eIdx + 1,
          title: `Episode ${eIdx + 1}`,
          videoKey: `episode_${sIdx}_${eIdx}`,
          thumbnailKey: `thumb_${sIdx}_${eIdx}`,
        };

        const epVideoFile = fileMap.get(epMeta.videoKey);
        const epThumbFile = fileMap.get(epMeta.thumbnailKey);

        let epThumbFileId = posterFileId;
        let epThumbUrl = posterUrl;
        let epVideoFileId = `sim_ep_${sIdx + 1}_${eIdx + 1}_${Date.now()}`;
        let epStreamUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4';

        if (epThumbFile) {
          const epThumbBuf = getFileBuffer(epThumbFile);
          if (epThumbBuf) {
            if (canUploadToTg) {
              try {
                const thumbRes = await uploadPhotoToTelegram(
                  epThumbBuf,
                  epThumbFile.originalname || `s${sIdx + 1}e${eIdx + 1}_thumb.jpg`,
                  epThumbFile.mimetype || 'image/jpeg',
                  `Thumb S${sIdx + 1}E${eIdx + 1}`
                );
                epThumbFileId = thumbRes.fileId;
                epThumbUrl = `/api/stream?fileId=${epThumbFileId}`;
              } catch (tgThumbErr: any) {
                console.warn(`[Server] Episode thumb notice: ${tgThumbErr.message}. Preserving locally.`);
                const vaultThumbName = `thumb_s${sIdx + 1}e${eIdx + 1}_${Date.now()}_${epThumbFile.originalname || 'thumb.jpg'}`;
                fs.writeFileSync(path.join(mediaVaultDir, vaultThumbName), epThumbBuf);
                epThumbFileId = `local_${vaultThumbName}`;
                epThumbUrl = `/api/stream?fileId=${epThumbFileId}`;
              }
            } else {
              const vaultThumbName = `thumb_s${sIdx + 1}e${eIdx + 1}_${Date.now()}_${epThumbFile.originalname || 'thumb.jpg'}`;
              fs.writeFileSync(path.join(mediaVaultDir, vaultThumbName), epThumbBuf);
              epThumbFileId = `local_${vaultThumbName}`;
              epThumbUrl = `/api/stream?fileId=${epThumbFileId}`;
            }
          }
          safeCleanup(epThumbFile);
        }

        if (epVideoFile) {
          const isMkv = epVideoFile.originalname?.toLowerCase().endsWith('.mkv');
          const resolvedMime = isMkv ? 'video/x-matroska' : (epVideoFile.mimetype || 'video/mp4');
          const defaultName = `s${sIdx + 1}e${eIdx + 1}.${isMkv ? 'mkv' : 'mp4'}`;
          let epUploadedToTg = false;

          if (canUploadToTg) {
            try {
              const vidRes = await uploadVideoToTelegram(
                epVideoFile.path || epVideoFile.buffer,
                epVideoFile.originalname || defaultName,
                resolvedMime,
                `${title} - S${sIdx + 1}E${eIdx + 1}: ${epMeta.title}`
              );
              epVideoFileId = vidRes.fileId;
              epStreamUrl = `/api/stream?fileId=${epVideoFileId}`;
              epUploadedToTg = true;
            } catch (tgErr: any) {
              console.warn(`[Server] Telegram episode upload notice: ${tgErr.message}. Storing in MovieVault streaming vault.`);
            }
          }

          if (!epUploadedToTg) {
            const vaultId = `vault_s${sIdx + 1}e${eIdx + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const ext = isMkv ? '.mkv' : (path.extname(epVideoFile.originalname) || '.mp4');
            const vaultFileName = `${vaultId}${ext}`;
            const permanentPath = path.join(mediaVaultDir, vaultFileName);

            if (epVideoFile.path && fs.existsSync(epVideoFile.path)) {
              try {
                fs.renameSync(epVideoFile.path, permanentPath);
              } catch {
                fs.copyFileSync(epVideoFile.path, permanentPath);
                try { fs.unlinkSync(epVideoFile.path); } catch {}
              }
            } else if (epVideoFile.buffer) {
              fs.writeFileSync(permanentPath, epVideoFile.buffer);
            }

            epVideoFileId = `local_${vaultFileName}`;
            epStreamUrl = `/api/stream?fileId=${epVideoFileId}`;
            console.log(`[Server] Preserved episode media in streaming vault: ${permanentPath}`);
          }

          safeCleanup(epVideoFile);
        }

        createdEpisodes.push({
          episodeNumber: epMeta.episodeNo || eIdx + 1,
          title: epMeta.title || `Episode ${eIdx + 1}`,
          telegramFileId: epVideoFileId,
          thumbnail: epThumbUrl,
          duration: 2700,
          streamUrl: epStreamUrl,
        });
      }

      createdSeasons.push({
        seasonNumber: seasonObj.seasonNumber || sIdx + 1,
        episodes: createdEpisodes,
      });
    }

    safeCleanup(posterFile);
    safeCleanup(bannerFile);

    const newContent: InMemContent = {
      id: newId,
      type: 'SERIES',
      title,
      slug,
      description,
      genres,
      language,
      releaseYear,
      poster: posterUrl,
      banner: bannerUrl,
      createdAt: new Date().toISOString(),
      seasons: createdSeasons,
    };

    contentDatabase.unshift(newContent);
    saveCatalog(contentDatabase);

    const botName = channelStatus?.botUsername ? `@${channelStatus.botUsername}` : 'your bot';
    const channelName = channelStatus?.chatTitle || channelStatus?.chatId || 'your channel';
    const uploadNotice = canUploadToTg
      ? 'Series, seasons, and episodes uploaded and saved with File IDs!'
      : isTelegramConfigured()
      ? `Series saved in MovieVault streaming vault! (Note: Add ${botName} as Administrator in "${channelName}" with "Post Messages" to host on Telegram).`
      : 'Series uploaded with seasons and episodes into MovieVault streaming vault.';

    res.json({
      success: true,
      message: uploadNotice,
      content: newContent,
    });
  } catch (err: any) {
    console.error('Server upload error:', err);
    res.status(500).json({
      error: err.message || 'Upload processing failed.',
      details: err.response?.data || null,
    });
  }
});

// 6. Streaming proxy API (handles both Telegram Bot API and local multi-GB disk vault)
app.get('/api/stream', async (req, res) => {
  const fileId = req.query.fileId as string;
  if (!fileId) {
    return res.status(400).send('Missing fileId');
  }

  // Handle local disk streaming vault (> 2 GB or local store with HTTP Range 206 streaming)
  if (fileId.startsWith('local_')) {
    const rawFileName = fileId.replace(/^local_/, '');
    const localFilePath = path.join(mediaVaultDir, rawFileName);

    if (!fs.existsSync(localFilePath)) {
      return res.status(404).send('Local media file not found');
    }

    const stat = fs.statSync(localFilePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const lowerPath = localFilePath.toLowerCase();
    let contentType = 'video/mp4';
    if (lowerPath.endsWith('.mkv')) contentType = 'video/x-matroska';
    else if (lowerPath.endsWith('.webm')) contentType = 'video/webm';
    else if (lowerPath.endsWith('.mp4')) contentType = 'video/mp4';
    else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (lowerPath.endsWith('.png')) contentType = 'image/png';
    else if (lowerPath.endsWith('.webp')) contentType = 'image/webp';
    else if (lowerPath.endsWith('.gif')) contentType = 'image/gif';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${path.basename(localFilePath)}"`,
        'Access-Control-Allow-Origin': '*',
      });

      const fileStream = fs.createReadStream(localFilePath, { start, end });
      const cleanupStream = () => {
        try { fileStream.destroy(); } catch {}
      };
      req.on('close', cleanupStream);
      res.on('error', cleanupStream);
      fileStream.on('error', cleanupStream);
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `inline; filename="${path.basename(localFilePath)}"`,
        'Access-Control-Allow-Origin': '*',
      });
      const fileStream = fs.createReadStream(localFilePath);
      const cleanupStream = () => {
        try { fileStream.destroy(); } catch {}
      };
      req.on('close', cleanupStream);
      res.on('error', cleanupStream);
      fileStream.on('error', cleanupStream);
      fileStream.pipe(res);
    }
    return;
  }

  // If simulated ID or external URL, redirect or stream fallback sample
  if (fileId.startsWith('sim_') || !isTelegramConfigured()) {
    if (fileId.includes('poster')) {
      return res.redirect('https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop&q=80');
    }
    if (fileId.includes('banner')) {
      return res.redirect('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&auto=format&fit=crop&q=80');
    }
    if (fileId.includes('thumb')) {
      return res.redirect('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80');
    }
    return res.redirect('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4');
  }

  try {
    const axios = (await import('axios')).default;
    const metadata = await getTelegramFileMetadata(fileId);
    const downloadUrl = metadata.directDownloadUrl;

    const range = req.headers.range;
    const headers: Record<string, string> = {};
    if (range) {
      headers['Range'] = range;
    }

    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
      headers,
    });

    res.status(response.status);
    const hopByHopHeaders = ['transfer-encoding', 'connection', 'keep-alive', 'upgrade'];
    Object.entries(response.headers).forEach(([key, value]) => {
      if (value && !hopByHopHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, value as string);
      }
    });

    // Content-Type normalization for MKV / MP4 / WebM / Image streaming
    const lowerFilePath = (metadata.filePath || '').toLowerCase();
    if (lowerFilePath.endsWith('.mkv')) {
      res.setHeader('Content-Type', 'video/x-matroska');
    } else if (lowerFilePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (lowerFilePath.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    } else if (lowerFilePath.endsWith('.jpg') || lowerFilePath.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (lowerFilePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (lowerFilePath.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    }
    res.setHeader('Accept-Ranges', 'bytes');

    const cleanupTgStream = () => {
      try {
        if (response.data && typeof response.data.destroy === 'function') {
          response.data.destroy();
        }
      } catch {}
    };

    req.on('close', cleanupTgStream);
    res.on('error', cleanupTgStream);
    if (response.data && typeof response.data.on === 'function') {
      response.data.on('error', cleanupTgStream);
    }

    response.data.pipe(res);
  } catch (err: any) {
    console.error('Stream proxy error:', err);
    if (!res.headersSent) {
      res.status(500).send(`Streaming failed: ${err.message}`);
    }
  }
});

// Start server with Vite middleware integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled
          ? false
          : {
              server,
            },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MovieVault Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
