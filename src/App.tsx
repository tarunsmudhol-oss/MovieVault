import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Info,
  Plus,
  Volume2,
  VolumeX,
  Upload,
  Tv,
  Film,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Sparkles,
  Search,
  X,
  ChevronRight,
  Maximize2,
  RotateCcw,
  RotateCw,
  Copy,
  Check,
  ShieldCheck,
  Server,
  Zap,
  Download,
  Trash2,
} from 'lucide-react';
import AdminUploadPage from '../app/admin/upload/page.tsx';

interface ContentItem {
  id: string;
  type: 'MOVIE' | 'SERIES';
  title: string;
  slug: string;
  description: string;
  genres: string[];
  language: string;
  releaseYear: number;
  poster: string;
  banner: string;
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

export const resolveMediaUrl = (urlOrFileId?: string): string => {
  if (!urlOrFileId) return '';
  if (
    urlOrFileId.startsWith('http://') ||
    urlOrFileId.startsWith('https://') ||
    urlOrFileId.startsWith('/') ||
    urlOrFileId.startsWith('data:')
  ) {
    return urlOrFileId;
  }
  return `/api/stream?fileId=${encodeURIComponent(urlOrFileId)}`;
};

export const getExternalStreamLinks = (rawUrlOrFileId?: string) => {
  const resolved = resolveMediaUrl(rawUrlOrFileId);
  if (!resolved) return { directUrl: '', intentUrl: '', vlcUrl: '' };
  
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const host = typeof window !== 'undefined' ? window.location.host : '';
  
  const directUrl = resolved.startsWith('http') ? resolved : `${origin}${resolved}`;
  const pathWithQuery = resolved.startsWith('http') ? resolved.replace(/^https?:\/\/[^/]+/, '') : resolved;
  
  // Android Intent URI compliant with Android Chrome specification
  const intentUrl = `intent://${host}${pathWithQuery}#Intent;scheme=https;type=video/*;action=android.intent.action.VIEW;end`;
  const vlcUrl = `vlc://${directUrl}`;
  
  return { directUrl, intentUrl, vlcUrl };
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'series' | 'movies' | 'admin' | 'docs'>('home');
  const [contentList, setContentList] = useState<ContentItem[]>([]);
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null);
  const [activeEpisode, setActiveEpisode] = useState<{
    seasonNo: number;
    episodeNo: number;
    title: string;
    streamUrl?: string;
    telegramFileId: string;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isVideoPaused, setIsVideoPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [botStatus, setBotStatus] = useState<{
    configured: boolean;
    ok?: boolean;
    canPost?: boolean;
    isAdmin?: boolean;
    botUsername?: string;
    chatTitle?: string;
    message?: string;
  }>({ configured: false });

  // Code inspection tab state
  const [selectedDocCode, setSelectedDocCode] = useState<
    'telegram_service' | 'upload_route' | 'stream_route' | 'prisma'
  >('telegram_service');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Video player references
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoVolume, setVideoVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [copiedStream, setCopiedStream] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch catalog on mount and when returning to catalog tabs
  useEffect(() => {
    fetchContent();
    checkBotStatus();
  }, []);

  useEffect(() => {
    if (activeTab === 'home' || activeTab === 'series' || activeTab === 'movies') {
      fetchContent();
    }
  }, [activeTab]);

  useEffect(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (showControls && !isVideoPaused) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [showControls, isVideoPaused]);

  const fetchContent = async () => {
    try {
      const res = await fetch('/api/content');
      if (res.ok) {
        const data = await res.json();
        setContentList(data.items || []);
        if (data.items?.length > 0 && !selectedContent) {
          setSelectedContent(data.items[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load content', e);
    }
  };

  const checkBotStatus = async () => {
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
      }
    } catch {
      // Fallback
    }
  };

  // Active hero item
  const heroItem = contentList[0] || null;

  // Filter lists
  const seriesList = contentList.filter((c) => c.type === 'SERIES');
  const moviesList = contentList.filter((c) => c.type === 'MOVIE');

  // Handle Play trigger
  const handlePlayContent = (item: ContentItem, epInfo?: any) => {
    setSelectedContent(item);
    if (item.type === 'MOVIE') {
      const rawUrl = item.movie?.streamUrl || (item.movie?.telegramFileId ? `/api/stream?fileId=${item.movie.telegramFileId}` : '');
      setActiveEpisode({
        seasonNo: 0,
        episodeNo: 0,
        title: item.title,
        streamUrl: resolveMediaUrl(rawUrl) || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
        telegramFileId: item.movie?.telegramFileId || 'simulated',
      });
    } else {
      const firstEp =
        epInfo ||
        item.seasons?.[0]?.episodes?.[0] || {
          episodeNumber: 1,
          title: 'Episode 1',
          telegramFileId: 'simulated',
        };
      const rawUrl = firstEp.streamUrl || (firstEp.telegramFileId ? `/api/stream?fileId=${firstEp.telegramFileId}` : '');
      setActiveEpisode({
        seasonNo: epInfo?.seasonNumber || item.seasons?.[0]?.seasonNumber || 1,
        episodeNo: firstEp.episodeNumber,
        title: firstEp.title,
        streamUrl: resolveMediaUrl(rawUrl) || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
        telegramFileId: firstEp.telegramFileId,
      });
    }
    setVideoError(null);
    setIsVideoPaused(false);
    setIsPlaying(true);
  };

  // Video time format
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = (Number(e.target.value) / 100) * videoDuration;
    videoRef.current.currentTime = time;
    setVideoCurrentTime(time);
  };

  const skipSeconds = (amount: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(videoDuration, videoRef.current.currentTime + amount));
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Code contents for handoff / production inspection
  const codeFiles = {
    telegram_service: `// File: /services/telegram.service.ts
import axios from 'axios';
import FormData from 'form-data';

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

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  return token;
}

function getChatId(): string {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is missing');
  return chatId;
}

async function toBuffer(input: any): Promise<Buffer> {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input && typeof input.arrayBuffer === 'function') {
    return Buffer.from(await input.arrayBuffer());
  }
  return Buffer.from(input);
}

/**
 * PRODUCTION FIX FOR IMAGE_PROCESS_FAILED:
 * 1. Uses npm 'form-data' with explicit ...form.getHeaders() boundary injection.
 * 2. Explicitly supplies filename with .jpg/.png extension.
 * 3. Sets contentType ('image/jpeg') on the multipart part.
 * 4. Extracts file_id from the last element of result.photo array.
 * 5. Automatic fallback to sendDocument if photo exceeds 10MB or Telegram rejects format.
 */
export async function uploadPhotoToTelegram(
  fileInput: any,
  fileName: string = 'poster.jpg',
  mimeType: string = 'image/jpeg',
  caption?: string
): Promise<TelegramUploadResult> {
  const token = getBotToken();
  const chatId = getChatId();
  const buffer = await toBuffer(fileInput);

  if (buffer.length > 10 * 1024 * 1024) {
    return uploadDocumentToTelegram(buffer, fileName, mimeType, caption);
  }

  let safeFileName = fileName;
  if (!/\\.(jpe?g|png|webp|gif)$/i.test(safeFileName)) {
    safeFileName = \`\${safeFileName}.jpg\`;
  }

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', buffer, {
    filename: safeFileName,
    contentType: mimeType || 'image/jpeg',
    knownLength: buffer.length,
  });

  if (caption) form.append('caption', caption);

  try {
    const res = await axios.post(\`\${TELEGRAM_API_BASE}/bot\${token}/sendPhoto\`, form, {
      headers: { ...form.getHeaders() },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000,
    });

    const photos = res.data.result.photo;
    const bestPhoto = photos[photos.length - 1];

    return {
      fileId: bestPhoto.file_id,
      fileUniqueId: bestPhoto.file_unique_id,
      messageId: res.data.result.message_id,
      type: 'photo',
      fileSize: bestPhoto.file_size,
    };
  } catch (error: any) {
    const desc = error.response?.data?.description || error.message;
    if (desc?.includes('IMAGE_PROCESS_FAILED')) {
      return uploadDocumentToTelegram(buffer, safeFileName, mimeType, caption);
    }
    throw error;
  }
}

export async function uploadVideoToTelegram(
  fileInput: any,
  fileName: string = 'video.mp4',
  mimeType: string = 'video/mp4',
  caption?: string
): Promise<TelegramUploadResult> {
  const token = getBotToken();
  const chatId = getChatId();
  const buffer = await toBuffer(fileInput);

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('supports_streaming', 'true');
  form.append('video', buffer, {
    filename: fileName,
    contentType: mimeType || 'video/mp4',
    knownLength: buffer.length,
  });

  if (caption) form.append('caption', caption);

  const res = await axios.post(\`\${TELEGRAM_API_BASE}/bot\${token}/sendVideo\`, form, {
    headers: { ...form.getHeaders() },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 300000,
  });

  const video = res.data.result.video;
  return {
    fileId: video.file_id,
    fileUniqueId: video.file_unique_id,
    messageId: res.data.result.message_id,
    type: 'video',
    duration: video.duration,
  };
}

export async function uploadDocumentToTelegram(
  fileInput: any,
  fileName: string,
  mimeType: string,
  caption?: string
): Promise<TelegramUploadResult> {
  const token = getBotToken();
  const chatId = getChatId();
  const buffer = await toBuffer(fileInput);

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('document', buffer, {
    filename: fileName,
    contentType: mimeType,
    knownLength: buffer.length,
  });

  if (caption) form.append('caption', caption);

  const res = await axios.post(\`\${TELEGRAM_API_BASE}/bot\${token}/sendDocument\`, form, {
    headers: { ...form.getHeaders() },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  const doc = res.data.result.document;
  return {
    fileId: doc.file_id,
    fileUniqueId: doc.file_unique_id,
    messageId: res.data.result.message_id,
    type: 'document',
  };
}

export async function getTelegramFileMetadata(fileId: string) {
  const token = getBotToken();
  const res = await axios.get(\`\${TELEGRAM_API_BASE}/bot\${token}/getFile\`, {
    params: { file_id: fileId },
  });
  return {
    filePath: res.data.result.file_path,
    directDownloadUrl: \`\${TELEGRAM_API_BASE}/file/bot\${token}/\${res.data.result.file_path}\`,
  };
}`,
    upload_route: `// File: /app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { uploadPhotoToTelegram, uploadVideoToTelegram } from '@/services/telegram.service';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const type = (formData.get('type') as string)?.toUpperCase();
    const title = formData.get('title') as string;
    const description = (formData.get('description') as string) || '';
    const genres = [formData.get('genre') as string];
    const language = (formData.get('language') as string) || 'English';
    const releaseYear = parseInt(formData.get('releaseYear') as string, 10) || 2025;

    // 1. Upload Poster & Banner
    const posterFile = formData.get('poster') as File;
    const bannerFile = formData.get('banner') as File | null;

    const posterUpload = await uploadPhotoToTelegram(
      posterFile,
      posterFile.name,
      posterFile.type,
      \`Poster: \${title}\`
    );

    let bannerFileId = posterUpload.fileId;
    if (bannerFile && bannerFile.size > 0) {
      const bannerUpload = await uploadPhotoToTelegram(
        bannerFile,
        bannerFile.name,
        bannerFile.type,
        \`Banner: \${title}\`
      );
      bannerFileId = bannerUpload.fileId;
    }

    // 2. Save Content parent record
    const content = await prisma.content.create({
      data: {
        type: type as 'MOVIE' | 'SERIES',
        title,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description,
        genres,
        language,
        releaseYear,
        poster: posterUpload.fileId,
        banner: bannerFileId,
      },
    });

    // 3. MOVIE branch
    if (type === 'MOVIE') {
      const movieVideo = formData.get('movieVideo') as File;
      const vid = await uploadVideoToTelegram(movieVideo, movieVideo.name, movieVideo.type);
      await prisma.movie.create({
        data: {
          contentId: content.id,
          telegramFileId: vid.fileId,
          duration: vid.duration,
        },
      });
      return NextResponse.json({ success: true, content });
    }

    // 4. SERIES branch
    const metadata = JSON.parse(formData.get('metadata') as string);
    for (const seasonData of metadata) {
      const season = await prisma.season.create({
        data: {
          contentId: content.id,
          seasonNumber: seasonData.seasonNumber,
        },
      });

      for (const ep of seasonData.episodes) {
        // Binary files retrieved from FormData using their designated keys
        const videoFile = formData.get(ep.videoKey) as File;
        const thumbFile = formData.get(ep.thumbnailKey) as File | null;

        let thumbFileId = posterUpload.fileId;
        if (thumbFile && thumbFile.size > 0) {
          const tUp = await uploadPhotoToTelegram(thumbFile, thumbFile.name, thumbFile.type);
          thumbFileId = tUp.fileId;
        }

        const vUp = await uploadVideoToTelegram(videoFile, videoFile.name, videoFile.type);

        await prisma.episode.create({
          data: {
            seasonId: season.id,
            episodeNumber: ep.episodeNo,
            title: ep.title,
            telegramFileId: vUp.fileId,
            thumbnail: thumbFileId,
            duration: vUp.duration,
          },
        });
      }
    }

    return NextResponse.json({ success: true, content });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}`,
    stream_route: `// File: /app/api/stream/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTelegramFileMetadata } from '@/services/telegram.service';

/**
 * Proxies video streaming from Telegram Bot API
 * Handles HTTP Range requests (HTTP 206 Partial Content)
 * Keeps TELEGRAM_BOT_TOKEN completely concealed from the browser
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');

  if (!fileId) return new NextResponse('Missing fileId', { status: 400 });

  const metadata = await getTelegramFileMetadata(fileId);
  const rangeHeader = request.headers.get('range');

  const tgRes = await fetch(metadata.directDownloadUrl, {
    headers: rangeHeader ? { Range: rangeHeader } : {},
  });

  const responseHeaders = new Headers();
  responseHeaders.set('Content-Type', 'video/mp4');
  responseHeaders.set('Accept-Ranges', 'bytes');
  if (tgRes.headers.get('content-range')) {
    responseHeaders.set('Content-Range', tgRes.headers.get('content-range')!);
  }
  if (tgRes.headers.get('content-length')) {
    responseHeaders.set('Content-Length', tgRes.headers.get('content-length')!);
  }

  return new NextResponse(tgRes.body as any, {
    status: tgRes.status,
    headers: responseHeaders,
  });
}`,
    prisma: `// File: /prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum ContentType {
  MOVIE
  SERIES
}

model Content {
  id          String      @id @default(cuid())
  type        ContentType
  title       String
  slug        String      @unique
  description String      @db.Text
  genres      String[]
  language    String
  releaseYear Int
  poster      String      // Telegram File ID
  banner      String      // Telegram File ID
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  movie       Movie?
  seasons     Season[]
}

model Movie {
  id             String   @id @default(cuid())
  contentId      String   @unique
  content        Content  @relation(fields: [contentId], references: [id], onDelete: Cascade)
  telegramFileId String   // Telegram File ID for film video
  duration       Int?
  createdAt      DateTime @default(now())
}

model Season {
  id           String    @id @default(cuid())
  contentId    String
  content      Content   @relation(fields: [contentId], references: [id], onDelete: Cascade)
  seasonNumber Int
  episodes     Episode[]
  createdAt    DateTime  @default(now())

  @@unique([contentId, seasonNumber])
}

model Episode {
  id             String   @id @default(cuid())
  seasonId       String
  season         Season   @relation(fields: [seasonId], references: [id], onDelete: Cascade)
  episodeNumber  Int
  title          String
  telegramFileId String   // Telegram File ID for episode video
  thumbnail      String   // Telegram File ID for episode thumbnail
  duration       Int?
  createdAt      DateTime @default(now())

  @@unique([seasonId, episodeNumber])
}`,
  };

  return (
    <div className="min-h-screen bg-[#141414] text-white flex flex-col font-sans selection:bg-red-600 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-black/90 backdrop-blur-md border-b border-zinc-800/80 px-4 md:px-12 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-8">
          {/* MovieVault Brand Logo */}
          <button
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2.5 text-left group cursor-pointer focus:outline-none"
          >
            <span className="bg-red-600 text-white font-black text-xl px-2 py-0.5 rounded tracking-tighter shadow-md shadow-red-900/50">
              MV
            </span>
            <span className="font-extrabold text-2xl tracking-wider text-red-600 uppercase flex items-center">
              Movie<span className="text-white">Vault</span>
            </span>
          </button>

          {/* Navigation Items */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              onClick={() => setActiveTab('home')}
              className={`transition cursor-pointer ${
                activeTab === 'home' ? 'text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Browse
            </button>
            <button
              onClick={() => setActiveTab('series')}
              className={`transition cursor-pointer ${
                activeTab === 'series' ? 'text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Web Series
            </button>
            <button
              onClick={() => setActiveTab('movies')}
              className={`transition cursor-pointer ${
                activeTab === 'movies' ? 'text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Movies
            </button>
            <button
              onClick={() => setActiveTab('docs')}
              className={`transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'docs' ? 'text-red-500 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-red-500" />
              Telegram Storage Fix
            </button>
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Telegram status pill */}
          <div
            className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono border ${
              botStatus.canPost
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/80'
                : botStatus.configured
                ? 'bg-amber-950/40 text-amber-300 border-amber-800/80'
                : 'bg-zinc-900 text-zinc-400 border-zinc-700'
            }`}
            title={botStatus.message || 'Telegram & Storage status'}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                botStatus.canPost
                  ? 'bg-emerald-400 animate-pulse'
                  : botStatus.configured
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-zinc-500'
              }`}
            />
            <span>
              {botStatus.canPost
                ? 'Telegram Cloud Live'
                : botStatus.configured
                ? 'Streaming Vault Active (Bot Admin Needed)'
                : 'Streaming Vault Active'}
            </span>
          </div>

          {/* Admin Studio Upload Button */}
          <button
            onClick={() => setActiveTab('admin')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition cursor-pointer ${
              activeTab === 'admin'
                ? 'bg-white text-black shadow-lg shadow-white/10'
                : 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-900/30'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Admin Studio
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 pb-20 md:pb-0"> {/* Padding bottom for mobile nav */}
        <div style={{ display: activeTab === 'admin' ? 'block' : 'none' }}>
          <AdminUploadPage />
        </div>

        {activeTab === 'docs' && (
          /* Production Telegram Fix Code Inspector */
          <div className="max-w-6xl mx-auto p-6 md:p-10 space-y-8">
            <div className="border-b border-zinc-800 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-red-600/20 text-red-400 border border-red-800/50 text-xs font-mono mb-2">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  ROOT CAUSE & PRODUCTION FIX
                </div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                  Telegram Bot API Multipart Fix
                </h1>
                <p className="text-zinc-400 text-sm mt-1">
                  Solves <code className="text-red-400 bg-zinc-900 px-1 py-0.5 rounded">Bad Request: IMAGE_PROCESS_FAILED</code>{' '}
                  permanently for poster, banner, and thumbnail uploads.
                </p>
              </div>

              <button
                onClick={() => setActiveTab('admin')}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg self-start transition flex items-center gap-2"
              >
                <Upload className="w-3.5 h-3.5" />
                Open Admin Uploader
              </button>
            </div>

            {/* Explanatory cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
                <div className="w-8 h-8 rounded-lg bg-red-600/20 text-red-500 flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <h3 className="font-semibold text-white text-sm">Boundary & Form-Data Headers</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Axios with Node global <code className="text-zinc-200">FormData</code> strips or breaks multipart boundaries. We use{' '}
                  <code className="text-zinc-200">form-data</code> with{' '}
                  <code className="text-red-400">...form.getHeaders()</code> so Telegram receives intact multipart streams.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
                <div className="w-8 h-8 rounded-lg bg-red-600/20 text-red-500 flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <h3 className="font-semibold text-white text-sm">Explicit Filename & Content-Type</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Telegram's image processor rejects unnamed buffers or generic blobs. We explicitly append{' '}
                  <code className="text-zinc-200">{`{ filename: 'poster.jpg', contentType: 'image/jpeg' }`}</code> to trigger the JPEG parser.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
                <div className="w-8 h-8 rounded-lg bg-red-600/20 text-red-500 flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <h3 className="font-semibold text-white text-sm">Photo Array & Fallback Guard</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Telegram returns an array of photo sizes. We extract <code className="text-zinc-200">photo[photo.length - 1].file_id</code>, and
                  route images &gt; 10MB or corrupted photos cleanly to <code className="text-zinc-200">sendDocument</code>.
                </p>
              </div>
            </div>

            {/* Code Selector Tabs */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                  <button
                    onClick={() => setSelectedDocCode('telegram_service')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                      selectedDocCode === 'telegram_service'
                        ? 'bg-zinc-800 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    telegram.service.ts
                  </button>
                  <button
                    onClick={() => setSelectedDocCode('upload_route')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                      selectedDocCode === 'upload_route'
                        ? 'bg-zinc-800 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    /app/api/upload/route.ts
                  </button>
                  <button
                    onClick={() => setSelectedDocCode('stream_route')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                      selectedDocCode === 'stream_route'
                        ? 'bg-zinc-800 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    /app/api/stream/route.ts
                  </button>
                  <button
                    onClick={() => setSelectedDocCode('prisma')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                      selectedDocCode === 'prisma'
                        ? 'bg-zinc-800 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    schema.prisma
                  </button>
                </div>

                <button
                  onClick={() => copyToClipboard(codeFiles[selectedDocCode], selectedDocCode)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-lg transition"
                >
                  {copiedKey === selectedDocCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Complete Code
                    </>
                  )}
                </button>
              </div>

              {/* Code viewer box */}
              <div className="relative rounded-xl overflow-hidden border border-zinc-800 bg-[#0c0d10] p-4 text-xs font-mono text-zinc-300 max-h-[520px] overflow-y-auto leading-relaxed shadow-inner">
                <pre>{codeFiles[selectedDocCode]}</pre>
              </div>
            </div>
          </div>
        )}

        {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'series') && (
          /* MovieVault Netflix-style Catalog & Billboard */
          <div className="space-y-12 pb-20">
            {/* Hero Billboard */}
            {heroItem && (
              <div className="relative h-[65vh] min-h-[460px] w-full overflow-hidden flex items-end">
                {/* Background image / banner */}
                <div
                  className="absolute inset-0 bg-cover bg-center transition duration-700 transform scale-105"
                  style={{
                    backgroundImage: `url(${resolveMediaUrl(heroItem.banner || heroItem.poster)})`,
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/50 to-black/40" />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-transparent to-transparent w-3/4" />
                </div>

                {/* Hero Information */}
                <div className="relative z-10 px-6 md:px-16 pb-12 max-w-2xl space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded tracking-wide uppercase">
                      {heroItem.type}
                    </span>
                    <span className="text-zinc-400 text-xs font-medium">{heroItem.releaseYear}</span>
                    <span className="border border-zinc-700 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded font-mono">
                      4K Ultra HD
                    </span>
                    <span className="text-zinc-400 text-xs">{heroItem.language}</span>
                  </div>

                  <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white drop-shadow-md">
                    {heroItem.title}
                  </h1>

                  <p className="text-sm md:text-base text-zinc-300 line-clamp-3 leading-relaxed drop-shadow">
                    {heroItem.description}
                  </p>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => handlePlayContent(heroItem)}
                      className="flex items-center gap-2 px-7 py-3 bg-white hover:bg-white/90 text-black font-bold rounded-md text-sm transition cursor-pointer shadow-lg shadow-white/10"
                    >
                      <Play className="w-5 h-5 fill-black" />
                      Play
                    </button>

                    <button
                      onClick={() => setSelectedContent(heroItem)}
                      className="flex items-center gap-2 px-6 py-3 bg-zinc-700/80 hover:bg-zinc-700 text-white font-medium rounded-md text-sm transition cursor-pointer backdrop-blur-sm"
                    >
                      <Info className="w-5 h-5" />
                      More Info
                    </button>

                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className="ml-auto p-3 rounded-full border border-zinc-600 bg-black/40 hover:bg-black/70 text-zinc-300 transition"
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Content Rails */}
            <div className="px-6 md:px-16 space-y-10">
              {/* Web Series Rail */}
              {seriesList.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                      <Tv className="w-5 h-5 text-red-500" />
                      Popular Web Series on Telegram
                    </h2>
                    <span className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer flex items-center gap-1">
                      Explore all <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {seriesList.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedContent(item)}
                        className="group relative rounded-md overflow-hidden bg-zinc-900 cursor-pointer transition transform hover:scale-105 hover:z-20 shadow-lg border border-zinc-800/80 hover:border-zinc-600"
                      >
                        <div className="aspect-[2/3] w-full relative">
                          <img
                            src={resolveMediaUrl(item.poster)}
                            alt={item.title}
                            className="w-full h-full object-cover group-hover:opacity-85 transition"
                            loading="lazy"
                          />
                          <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-xs text-[10px] font-bold px-2 py-0.5 rounded text-white border border-zinc-700">
                            {item.seasons?.length || 1} Season{(item.seasons?.length || 1) > 1 ? 's' : ''}
                          </div>
                        </div>
                        <div className="p-3 bg-zinc-900/95 space-y-1">
                          <h3 className="font-semibold text-sm text-white truncate">{item.title}</h3>
                          <div className="flex items-center justify-between text-[11px] text-zinc-400">
                            <span>{item.releaseYear}</span>
                            <span className="text-red-400 font-mono text-[10px]">
                              {item.genres[0] || 'Drama'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Feature Movies Rail */}
              {moviesList.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                      <Film className="w-5 h-5 text-red-500" />
                      Feature Movies
                    </h2>
                    <span className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer flex items-center gap-1">
                      Explore all <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {moviesList.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedContent(item)}
                        className="group relative rounded-md overflow-hidden bg-zinc-900 cursor-pointer transition transform hover:scale-105 hover:z-20 shadow-lg border border-zinc-800/80 hover:border-zinc-600"
                      >
                        <div className="aspect-[2/3] w-full relative">
                          <img
                            src={resolveMediaUrl(item.poster)}
                            alt={item.title}
                            className="w-full h-full object-cover group-hover:opacity-85 transition"
                            loading="lazy"
                          />
                          <div className="absolute top-2 left-2 bg-red-600/90 text-[10px] font-bold px-1.5 py-0.5 rounded text-white">
                            MOVIE
                          </div>
                        </div>
                        <div className="p-3 bg-zinc-900/95 space-y-1">
                          <h3 className="font-semibold text-sm text-white truncate">{item.title}</h3>
                          <div className="flex items-center justify-between text-[11px] text-zinc-400">
                            <span>{item.releaseYear}</span>
                            <span className="text-red-400 font-mono text-[10px]">
                              {item.genres[0] || 'Feature'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Telegram Architecture Card Banner */}
              <div className="p-6 rounded-2xl bg-gradient-to-r from-zinc-900 via-zinc-900 to-red-950/40 border border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="space-y-2 max-w-xl">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-500 uppercase tracking-wider">
                    <Server className="w-4 h-4" />
                    Zero Cloud Cost Storage Architecture
                  </div>
                  <h3 className="text-xl font-bold text-white">
                    All Media Files Stream Directly From Telegram
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    No AWS S3, Cloudinary, or Supabase Storage bills. Posters, banners, episode thumbnails, and
                    MP4 video streams are securely stored in your private Telegram channel and indexed via
                    PostgreSQL &amp; Prisma ORM.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setActiveTab('docs')}
                    className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-semibold transition"
                  >
                    View Code Handoff
                  </button>
                  <button
                    onClick={() => setActiveTab('admin')}
                    className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition shadow-lg shadow-red-900/40"
                  >
                    Upload New Series
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-black/95 backdrop-blur border-t border-zinc-800 z-40 flex items-center justify-around py-3">
        <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center gap-1 ${activeTab === 'home' ? 'text-white' : 'text-zinc-500'}`}><Film className="w-5 h-5" /><span className="text-[10px]">Browse</span></button>
        <button onClick={() => setActiveTab('series')} className={`flex flex-col items-center gap-1 ${activeTab === 'series' ? 'text-white' : 'text-zinc-500'}`}><Tv className="w-5 h-5" /><span className="text-[10px]">Series</span></button>
        <button onClick={() => setActiveTab('movies')} className={`flex flex-col items-center gap-1 ${activeTab === 'movies' ? 'text-white' : 'text-zinc-500'}`}><Play className="w-5 h-5" /><span className="text-[10px]">Movies</span></button>
        <button onClick={() => setActiveTab('admin')} className={`flex flex-col items-center gap-1 ${activeTab === 'admin' ? 'text-red-500' : 'text-zinc-500'}`}><Upload className="w-5 h-5" /><span className="text-[10px]">Upload</span></button>
      </div>

      {/* Media Detail & Season Episodes Modal */}
      {selectedContent && !isPlaying && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl bg-[#181818] rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl max-h-[90vh] flex flex-col">
            {/* Close button */}
            <button
              onClick={() => setSelectedContent(null)}
              className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-black/70 hover:bg-black text-white flex items-center justify-center transition"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Banner preview */}
            <div className="relative h-64 w-full bg-zinc-900 shrink-0">
              <img
                src={resolveMediaUrl(selectedContent.banner || selectedContent.poster)}
                alt={selectedContent.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
              <div className="absolute bottom-5 left-6 space-y-2">
                <h2 className="text-2xl md:text-3xl font-bold text-white drop-shadow">
                  {selectedContent.title}
                </h2>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => handlePlayContent(selectedContent)}
                    className="flex items-center gap-2 px-5 py-2 bg-white hover:bg-zinc-200 text-black font-bold rounded-lg text-xs transition shadow-md cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-black" />
                    Play in Browser
                  </button>
                  {selectedContent.type === 'MOVIE' && selectedContent.movie?.telegramFileId && (() => {
                    const links = getExternalStreamLinks(selectedContent.movie?.streamUrl || `/api/stream?fileId=${selectedContent.movie.telegramFileId}`);
                    return (
                      <div className="flex items-center gap-2">
                        <a
                          href={links.intentUrl}
                          className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs transition shadow-md shadow-red-900/40 cursor-pointer"
                          title="Stream directly in VLC, MX Player, or phone video player"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" />
                          Play in VLC / MX Player
                        </a>
                        <a
                          href={links.directUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg border border-zinc-700 transition"
                          title="Open direct streaming link in a new tab"
                        >
                          Direct Link
                        </a>
                      </div>
                    );
                  })()}
                  <button
                    onClick={async () => {
                      if (window.confirm(`Are you sure you want to delete "${selectedContent.title}"?`)) {
                        try {
                          await fetch(`/api/content/${selectedContent.id}`, { method: 'DELETE' });
                          setSelectedContent(null);
                          fetchContent();
                        } catch (err) {
                          alert('Failed to delete content');
                        }
                      }
                    }}
                    className="flex items-center gap-2 px-3.5 py-2 bg-zinc-800 hover:bg-red-600 text-zinc-300 hover:text-white font-semibold rounded-lg text-xs transition border border-zinc-700 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                  <span className="text-xs text-zinc-300 font-medium bg-black/60 backdrop-blur px-2.5 py-1 rounded-md border border-zinc-700/60">
                    {selectedContent.releaseYear} • {selectedContent.genres.join(', ')}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              <p className="text-sm text-zinc-300 leading-relaxed">{selectedContent.description}</p>

              {/* Seasons & Episodes for Series */}
              {selectedContent.type === 'SERIES' && selectedContent.seasons && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                    <h3 className="font-bold text-white text-base">Episodes</h3>
                    <span className="text-xs text-zinc-400 font-mono">
                      {selectedContent.seasons.length} Season
                      {selectedContent.seasons.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  {selectedContent.seasons.map((season) => (
                    <div key={season.seasonNumber} className="space-y-3">
                      <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider">
                        Season {season.seasonNumber}
                      </h4>
                      <div className="space-y-2">
                        {season.episodes.map((ep) => (
                          <div
                            key={ep.episodeNumber}
                            onClick={() =>
                              handlePlayContent(selectedContent, {
                                ...ep,
                                seasonNumber: season.seasonNumber,
                              })
                            }
                            className="flex items-center gap-4 p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 cursor-pointer transition group"
                          >
                            <span className="text-sm font-mono text-zinc-500 w-5 text-center">
                              {ep.episodeNumber}
                            </span>
                            <div className="w-24 h-14 rounded-md overflow-hidden bg-zinc-950 relative shrink-0">
                              <img
                                src={resolveMediaUrl(ep.thumbnail || selectedContent.poster)}
                                alt={ep.title}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                                <Play className="w-4 h-4 text-white fill-white" />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-white group-hover:text-red-400 transition truncate">
                                {ep.title}
                              </div>
                              <div className="text-xs text-zinc-500 font-mono flex items-center gap-2">
                                <span>Telegram ID: {ep.telegramFileId.substring(0, 14)}...</span>
                                <span>• 45m</span>
                              </div>
                            </div>
                            <button className="p-2 rounded-full hover:bg-zinc-700 text-zinc-400 group-hover:text-white transition">
                              <Play className="w-4 h-4 fill-current" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Movie info */}
              {selectedContent.type === 'MOVIE' && selectedContent.movie && (
                <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between text-xs font-mono text-zinc-400">
                  <span>Telegram Video File ID:</span>
                  <span className="text-red-400">{selectedContent.movie.telegramFileId}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Netflix Fullscreen-Style Video Player */}
      {isPlaying && activeEpisode && (() => {
        const streamLinks = getExternalStreamLinks(activeEpisode.streamUrl);
        return (
          <div 
            className="fixed inset-0 z-50 bg-black flex flex-col"
            onClick={() => setShowControls(prev => !prev)}
          >
            {/* Top Bar Controls */}
            <div className={`absolute top-0 inset-x-0 z-30 p-4 sm:p-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <div className="flex items-center gap-3 sm:gap-4">
                <button
                  onClick={(e) => { e.stopPropagation(); setIsPlaying(false); }}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-lg font-bold text-white truncate">
                    {selectedContent?.title}{' '}
                    {activeEpisode.seasonNo > 0
                      ? `• S${activeEpisode.seasonNo}:E${activeEpisode.episodeNo}`
                      : ''}
                  </h3>
                  <p className="text-[11px] sm:text-xs text-zinc-400 truncate">{activeEpisode.title}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {activeEpisode.streamUrl && (
                  <div className="flex items-center gap-1.5">
                    <a
                      href={streamLinks.intentUrl}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs transition font-bold shadow-md shadow-red-950/80 cursor-pointer"
                      title="Stream in VLC or mobile video player"
                    >
                      <Play className="w-3.5 h-3.5 fill-white text-white" />
                      <span>Play in VLC / MX Player</span>
                    </a>
                    <a
                      href={streamLinks.directUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg border border-zinc-700 transition"
                      title="Open direct streaming link in a new tab"
                    >
                      Direct Link
                    </a>
                  </div>
                )}
                <div className="hidden lg:block px-3 py-1 rounded bg-red-600/20 text-red-400 border border-red-800 text-[11px] font-mono">
                  Telegram Stream Proxy Active
                </div>
              </div>
            </div>

            {/* Quick helper pill for HEVC / MKV black screen on mobile */}
            {showControls && activeEpisode.streamUrl && (
              <div className="absolute top-18 sm:top-20 inset-x-0 z-30 flex justify-center pointer-events-none px-4">
                <a
                  href={streamLinks.intentUrl}
                  onClick={(e) => e.stopPropagation()}
                  className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-600/90 hover:bg-red-600 text-white font-semibold text-xs shadow-xl shadow-red-950/80 transition backdrop-blur border border-red-400/40 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Black screen? Tap to play in VLC / MX Player</span>
                </a>
              </div>
            )}

            {/* Video element */}
            <div className="flex-1 relative flex items-center justify-center bg-black">
              {videoError && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-black/90 text-center space-y-4">
                  <AlertCircle className="w-12 h-12 text-amber-400 animate-pulse" />
                  <h4 className="text-lg font-bold text-white">MKV / HEVC Video Stream</h4>
                  <p className="text-xs sm:text-sm text-zinc-300 max-w-md leading-relaxed">
                    This video is in <strong>.mkv (10-bit HEVC)</strong> format. Mobile browsers cannot decode raw MKVs, but you can stream it instantly with any video player on your phone!
                  </p>
                  {activeEpisode.streamUrl && (
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md pt-2">
                      {/* 1. Android Intent - Opens VLC / MX Player / Mi Video natively */}
                      <a
                        href={streamLinks.intentUrl}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full sm:w-auto px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs sm:text-sm shadow-lg shadow-red-900/50 flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        Play in App (VLC / MX Player)
                      </a>

                      {/* 2. Direct VLC scheme */}
                      <a
                        href={streamLinks.vlcUrl}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full sm:w-auto px-4 py-3 rounded-xl bg-orange-600/90 hover:bg-orange-600 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-white" />
                        Open in VLC
                      </a>

                      {/* 3. Direct Link (new tab) */}
                      <a
                        href={streamLinks.directUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="w-full sm:w-auto px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        Direct Stream Tab
                      </a>

                      {/* 4. Copy Stream URL */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(streamLinks.directUrl);
                          setCopiedStream(true);
                          setTimeout(() => setCopiedStream(false), 3000);
                        }}
                        className="w-full sm:w-auto px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs sm:text-sm flex items-center justify-center gap-2 border border-zinc-700 transition cursor-pointer"
                      >
                        {copiedStream ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        {copiedStream ? 'Copied Link!' : 'Copy Link'}
                      </button>
                    </div>
                  )}
                </div>
              )}

            <video
              ref={videoRef}
              src={activeEpisode.streamUrl}
              autoPlay
              controls={false}
              playsInline
              className="w-full h-full max-h-screen object-contain"
              onPlay={() => setIsVideoPaused(false)}
              onPause={() => setIsVideoPaused(true)}
              onError={() => {
                setVideoError('Your mobile browser cannot decode this video container (.mkv / 10-bit HEVC) directly. Tap below to stream or open with VLC, MX Player, or your favorite mobile video app.');
              }}
              onTimeUpdate={() => {
                if (videoRef.current) {
                  setVideoCurrentTime(videoRef.current.currentTime);
                  setVideoProgress((videoRef.current.currentTime / videoDuration) * 100);
                }
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  setVideoDuration(videoRef.current.duration);
                }
              }}
              onEnded={() => setIsPlaying(false)}
            />
          </div>

          {/* Bottom Video Controls Overlay */}
          <div 
            className={`absolute bottom-0 inset-x-0 z-30 p-4 sm:p-6 bg-gradient-to-t from-black via-black/80 to-transparent space-y-3 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Timeline Progress Bar */}
            <div className="relative flex items-center group">
              <input
                type="range"
                min="0"
                max="100"
                value={videoProgress || 0}
                onChange={handleSeek}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-red-600 group-hover:h-2 transition-all"
              />
            </div>

            {/* Bottom Buttons */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 sm:gap-4">
                <button
                  onClick={() => {
                    if (videoRef.current) {
                      if (videoRef.current.paused) {
                        videoRef.current.play().catch(() => {});
                        setIsVideoPaused(false);
                      } else {
                        videoRef.current.pause();
                        setIsVideoPaused(true);
                      }
                    }
                  }}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white text-black flex items-center justify-center hover:bg-zinc-200 transition cursor-pointer shrink-0"
                  title={isVideoPaused ? 'Play' : 'Pause'}
                >
                  {isVideoPaused ? (
                    <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-black" />
                  ) : (
                    <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-black" />
                  )}
                </button>

                <button
                  onClick={() => skipSeconds(-10)}
                  className="p-1.5 sm:p-2 text-zinc-400 hover:text-white transition"
                  title="Rewind 10s"
                >
                  <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                <button
                  onClick={() => skipSeconds(10)}
                  className="p-1.5 sm:p-2 text-zinc-400 hover:text-white transition"
                  title="Forward 10s"
                >
                  <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                <div className="text-[11px] sm:text-xs font-mono text-zinc-400 whitespace-nowrap">
                  {formatTime(videoCurrentTime)} / {formatTime(videoDuration)}
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-4">
                <div className="hidden sm:flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-zinc-400" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={videoVolume}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setVideoVolume(val);
                      if (videoRef.current) videoRef.current.volume = val;
                    }}
                    className="w-20 h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-red-600"
                  />
                </div>

                <button
                  onClick={() => {
                    if (document.fullscreenElement) {
                      document.exitFullscreen();
                    } else if (videoRef.current) {
                      if (videoRef.current.requestFullscreen) {
                        videoRef.current.requestFullscreen();
                      } else if ((videoRef.current as any).webkitEnterFullscreen) {
                        // iOS Safari fallback
                        (videoRef.current as any).webkitEnterFullscreen();
                      }
                    }
                  }}
                  className="p-2 text-zinc-400 hover:text-white transition"
                >
                  <Maximize2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    })()}
    </div>
  );
}
