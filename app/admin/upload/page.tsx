'use client';

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Film,
  Tv,
  Upload,
  Plus,
  Trash2,
  Image as ImageIcon,
  Video,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Layers,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

interface EpisodeData {
  title: string;
  video: File | null;
  thumbnail: File | null;
}

export default function AdminUploadPage() {
  // Core state
  const [type, setType] = useState<'MOVIE' | 'SERIES'>('SERIES');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('Action, Sci-Fi, Drama');
  const [language, setLanguage] = useState('English');
  const [releaseYear, setReleaseYear] = useState(new Date().getFullYear());

  // Image files
  const [poster, setPoster] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);

  // Movie video
  const [movieVideo, setMovieVideo] = useState<File | null>(null);

  // Series structure: array of seasons, each with array of EpisodeData
  const [seasons, setSeasons] = useState<EpisodeData[][]>([
    [
      { title: 'Pilot', video: null, thumbnail: null },
      { title: 'Episode 2', video: null, thumbnail: null },
    ],
  ]);

  // Upload UI states
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Telegram bot and channel diagnostics
  const [botStatus, setBotStatus] = useState<{
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
  } | null>(null);
  const [checkingBot, setCheckingBot] = useState(false);

  const fetchBotStatus = useCallback(async (refresh = false) => {
    setCheckingBot(true);
    try {
      const res = await axios.get(`/api/telegram/status${refresh ? '?refresh=true' : ''}`);
      setBotStatus(res.data);
    } catch (err) {
      console.error('Failed to fetch Telegram status:', err);
    } finally {
      setCheckingBot(false);
    }
  }, []);

  useEffect(() => {
    fetchBotStatus();
  }, [fetchBotStatus]);

  // Poster handler
  const handlePosterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPoster(file);
      setPosterPreview(URL.createObjectURL(file));
    }
  };

  // Banner handler
  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setBanner(file);
      setBannerPreview(URL.createObjectURL(file));
    }
  };

  // Season management
  const addSeason = () => {
    setSeasons((prev) => [
      ...prev,
      [{ title: 'Episode 1', video: null, thumbnail: null }],
    ]);
  };

  const removeSeason = (seasonIndex: number) => {
    if (seasons.length <= 1) return;
    setSeasons((prev) => prev.filter((_, idx) => idx !== seasonIndex));
  };

  // Episode management
  const addEpisode = (seasonIndex: number) => {
    setSeasons((prev) => {
      const next = [...prev];
      const epCount = next[seasonIndex].length + 1;
      next[seasonIndex] = [
        ...next[seasonIndex],
        { title: `Episode ${epCount}`, video: null, thumbnail: null },
      ];
      return next;
    });
  };

  const removeEpisode = (seasonIndex: number, episodeIndex: number) => {
    setSeasons((prev) => {
      const next = [...prev];
      if (next[seasonIndex].length <= 1) return next;
      next[seasonIndex] = next[seasonIndex].filter((_, idx) => idx !== episodeIndex);
      return next;
    });
  };

  const updateEpisodeTitle = (seasonIndex: number, episodeIndex: number, newTitle: string) => {
    setSeasons((prev) => {
      const next = [...prev];
      next[seasonIndex] = [...next[seasonIndex]];
      next[seasonIndex][episodeIndex] = {
        ...next[seasonIndex][episodeIndex],
        title: newTitle,
      };
      return next;
    });
  };

  const updateEpisodeFile = (
    seasonIndex: number,
    episodeIndex: number,
    field: 'video' | 'thumbnail',
    file: File | null
  ) => {
    setSeasons((prev) => {
      const next = [...prev];
      next[seasonIndex] = [...next[seasonIndex]];
      next[seasonIndex][episodeIndex] = {
        ...next[seasonIndex][episodeIndex],
        [field]: file,
      };
      return next;
    });
  };

  // Submission handler
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setMessage('');
    setUploadSuccess(false);

    if (!title.trim()) {
      setErrorMessage('Please provide a title.');
      return;
    }

    if (!poster) {
      setErrorMessage('Please upload a poster image.');
      return;
    }

    if (type === 'MOVIE' && !movieVideo) {
      setErrorMessage('Please upload the movie video file.');
      return;
    }

    if (type === 'SERIES') {
      for (let s = 0; s < seasons.length; s++) {
        for (let ep = 0; ep < seasons[s].length; ep++) {
          if (!seasons[s][ep].video) {
            setErrorMessage(`Season ${s + 1}, Episode ${ep + 1} is missing a video file.`);
            return;
          }
        }
      }
    }

    setUploading(true);
    setProgress(5);
    setMessage('Initializing upload session...');

    try {
      const uploadId = `up_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB per chunk(well below Cloud Run's 32 MB limit)

      // Helper to upload a large file in 15 MB chunks to bypass proxy/Cloud Run 32MB single-request limit
      const uploadFileInChunks = async (file: File, fileKey: string, label: string) => {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);

        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
          const start = chunkIdx * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const chunkBlob = file.slice(start, end);

          const chunkForm = new FormData();
          chunkForm.append('uploadId', uploadId);
          chunkForm.append('fileKey', fileKey);
          chunkForm.append('chunkIndex', String(chunkIdx));
          chunkForm.append('totalChunks', String(totalChunks));
          chunkForm.append('originalName', file.name);
          chunkForm.append('chunk', chunkBlob, file.name);

          const percent = Math.round(5 + ((chunkIdx + 1) / totalChunks) * 80);
          setProgress(percent);
          setMessage(`Streaming ${label} (${fileSizeMB} MB): Chunk ${chunkIdx + 1} of ${totalChunks}...`);

          await axios.post('/api/upload/chunk', chunkForm, {
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });
        }
      };

      // 1. Upload video files via chunks
      if (type === 'MOVIE' && movieVideo) {
        await uploadFileInChunks(movieVideo, 'movieVideo', 'Movie Video');
      } else if (type === 'SERIES') {
        for (let sIdx = 0; sIdx < seasons.length; sIdx++) {
          for (let eIdx = 0; eIdx < seasons[sIdx].length; eIdx++) {
            const ep = seasons[sIdx][eIdx];
            if (ep.video) {
              await uploadFileInChunks(
                ep.video,
                `episode_${sIdx}_${eIdx}`,
                `S${sIdx + 1}E${eIdx + 1} (${ep.title || 'Episode ' + (eIdx + 1)})`
              );
            }
          }
        }
      }

      setProgress(88);
      setMessage('Finalizing metadata & visual assets in MovieVault...');

      // 2. Finalize metadata & small image assets (poster, banner, episode thumbnails)
      const formData = new FormData();
      formData.append('uploadId', uploadId);
      formData.append('type', type);
      formData.append('title', title);
      formData.append('description', description);
      formData.append('genre', genre);
      formData.append('language', language);
      formData.append('releaseYear', String(releaseYear));

      // Append binary images
      formData.append('poster', poster);
      if (banner) {
        formData.append('banner', banner);
      }

      if (type === 'SERIES') {
        // Build metadata JSON structure with designated binary keys
        const seasonsMetadata = seasons.map((epList, sIdx) => ({
          seasonNumber: sIdx + 1,
          episodes: epList.map((ep, eIdx) => ({
            seasonNo: sIdx + 1,
            episodeNo: eIdx + 1,
            title: ep.title,
            videoKey: `episode_${sIdx}_${eIdx}`,
            thumbnailKey: `thumb_${sIdx}_${eIdx}`,
          })),
        }));

        formData.append('metadata', JSON.stringify(seasonsMetadata));

        // Append episode thumbnails (small images)
        seasons.forEach((epList, sIdx) => {
          epList.forEach((ep, eIdx) => {
            if (ep.thumbnail) {
              formData.append(`thumb_${sIdx}_${eIdx}`, ep.thumbnail);
            }
          });
        });
      }

      const response = await axios.post('/api/upload', formData, {
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      setProgress(100);
      setMessage(response.data.message || 'Media successfully processed and saved!');
      setUploadSuccess(true);
    } catch (err: any) {
      console.error('Upload failed:', err);
      const is413 = err.response?.status === 413 || err.message?.includes('413');
      const errMsg =
        err.response?.data?.error ||
        err.response?.data?.details ||
        (is413
          ? 'Upload failed (HTTP 413 Payload Too Large): One of the requests exceeded payload limits. The chunked upload pipeline splits videos into 15 MB slices.'
          : err.message) ||
        'Upload failed. Please check Telegram bot credentials and connection.';
      setErrorMessage(errMsg);
    } finally {
      setUploading(false);
    }
  };

  // Helper to compute total file size
  const totalSizeBytes = (() => {
    let bytes = 0;
    if (poster) bytes += poster.size;
    if (banner) bytes += banner.size;
    if (type === 'MOVIE') {
      if (movieVideo) bytes += movieVideo.size;
    } else {
      seasons.forEach((s) =>
        s.forEach((ep) => {
          if (ep.video) bytes += ep.video.size;
          if (ep.thumbnail) bytes += ep.thumbnail.size;
        })
      );
    }
    return bytes;
  })();

  const formattedPayloadSize = totalSizeBytes >= 1024 * 1024 * 1024
    ? `${(totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    : `${(totalSizeBytes / (1024 * 1024)).toFixed(1)} MB`;

  const hasFilesExceeding2GB = (() => {
    if (type === 'MOVIE' && movieVideo && movieVideo.size > 2 * 1024 * 1024 * 1024) return true;
    if (type === 'SERIES') {
      return seasons.some((s) => s.some((ep) => ep.video && ep.video.size > 2 * 1024 * 1024 * 1024));
    }
    return false;
  })();

  const hasFilesExceeding50MB = (() => {
    if (type === 'MOVIE' && movieVideo && movieVideo.size > 50 * 1024 * 1024) return true;
    if (type === 'SERIES') {
      return seasons.some((s) => s.some((ep) => ep.video && ep.video.size > 50 * 1024 * 1024));
    }
    return false;
  })();

  return (
    <div className="min-h-screen bg-[#0f0f11] text-zinc-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center font-black text-xl text-white tracking-wider">
              MV
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">MovieVault Admin Studio</h1>
              <p className="text-xs text-zinc-400">
                Direct-to-Telegram Media Uploader with Next.js 16 App Router & Prisma ORM
              </p>
            </div>
          </div>
          <a
            href="/"
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white px-3 py-2 rounded-md hover:bg-zinc-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Vault
          </a>
        </div>

        {/* Telegram Connection & Channel Permission Banner */}
        {botStatus && (
          <div
            className={`border rounded-xl p-5 transition ${
              botStatus.canPost
                ? 'bg-emerald-950/20 border-emerald-800/60'
                : 'bg-amber-950/25 border-amber-800/60'
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    botStatus.canPost ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {botStatus.canPost ? (
                    <ShieldCheck className="w-5 h-5" />
                  ) : (
                    <ShieldAlert className="w-5 h-5" />
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-white">
                      {botStatus.canPost
                        ? 'Telegram Cloud Bot Connected'
                        : 'Telegram Channel Administrator Access Needed'}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        botStatus.canPost
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {botStatus.canPost ? 'Ready for Direct Telegram Hosting' : 'Local Streaming Vault Active'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300">
                    Bot: <strong className="text-white">@{botStatus.botUsername}</strong> • Channel:{' '}
                    <strong className="text-white">{botStatus.chatTitle}</strong> ({botStatus.chatId})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fetchBotStatus(true)}
                disabled={checkingBot}
                className="flex items-center justify-center gap-2 self-start md:self-auto text-xs px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700 transition font-medium shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingBot ? 'animate-spin' : ''}`} />
                {checkingBot ? 'Checking...' : 'Verify Channel Permissions'}
              </button>
            </div>

            {!botStatus.canPost && botStatus.instructions && (
              <div className="mt-4 pt-3.5 border-t border-amber-800/40 text-xs text-zinc-300 space-y-2">
                <div className="font-medium text-amber-300">
                  How to enable direct Telegram Channel hosting:
                </div>
                <ol className="list-decimal list-inside space-y-1 text-zinc-300 pl-1">
                  <li>Open your channel <strong className="text-white">&quot;{botStatus.chatTitle}&quot;</strong> in Telegram</li>
                  <li>Tap Channel Info → Edit (or Manage Channel) → <strong className="text-white">Administrators</strong> → <strong className="text-white">Add Administrator</strong></li>
                  <li>Search for <strong className="text-amber-200">@{botStatus.botUsername}</strong> and enable <strong className="text-white">&quot;Post Messages&quot;</strong> permission</li>
                  <li>Click <strong className="text-white">&quot;Verify Channel Permissions&quot;</strong> above</li>
                </ol>
                <div className="bg-zinc-900/80 rounded-lg p-2.5 mt-2 border border-zinc-800 text-[11px] text-zinc-400">
                  💡 <strong className="text-zinc-200">Zero interruption:</strong> While permissions are pending, all uploaded posters, banners, and videos are automatically preserved and streamed via MovieVault&apos;s internal high-speed vault without errors.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Content Type Selector */}
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setType('SERIES')}
            className={`flex items-center justify-center gap-3 p-5 rounded-xl border-2 transition font-medium ${
              type === 'SERIES'
                ? 'border-red-600 bg-red-950/20 text-white shadow-lg shadow-red-950/30'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            }`}
          >
            <Tv className={`w-6 h-6 ${type === 'SERIES' ? 'text-red-500' : 'text-zinc-400'}`} />
            <div className="text-left">
              <div className="text-base font-semibold">Web Series / TV Show</div>
              <div className="text-xs text-zinc-500">Multiple seasons, episodes, thumbnails & streaming videos</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setType('MOVIE')}
            className={`flex items-center justify-center gap-3 p-5 rounded-xl border-2 transition font-medium ${
              type === 'MOVIE'
                ? 'border-red-600 bg-red-950/20 text-white shadow-lg shadow-red-950/30'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            }`}
          >
            <Film className={`w-6 h-6 ${type === 'MOVIE' ? 'text-red-500' : 'text-zinc-400'}`} />
            <div className="text-left">
              <div className="text-base font-semibold">Feature Movie</div>
              <div className="text-xs text-zinc-500">Single movie title with poster, banner & full-length film</div>
            </div>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleUpload} className="space-y-8">
          {/* Metadata Section */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-red-500" />
              General Information
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Stranger Things, Inception, Breaking Bad"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Synopsis, cast, or plot summary..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Genres (Comma separated)
                </label>
                <input
                  type="text"
                  placeholder="Action, Sci-Fi, Drama"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Language
                  </label>
                  <input
                    type="text"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Release Year
                  </label>
                  <input
                    type="number"
                    value={releaseYear}
                    onChange={(e) => setReleaseYear(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
                  />
                </div>
              </div>
            </div>

            {/* Poster & Banner Upload */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-800">
              {/* Poster */}
              <div className="space-y-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                  <span>Poster Image (Portrait) *</span>
                  <span className="text-[11px] text-zinc-500 font-normal">Stored in Telegram</span>
                </label>
                <div className="flex gap-4 items-start">
                  <div className="w-28 h-40 bg-zinc-950 border border-dashed border-zinc-700 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                    {posterPreview ? (
                      <img src={posterPreview} alt="Poster" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-zinc-600" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePosterChange}
                      className="text-xs text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer"
                    />
                    <p className="text-[11px] text-zinc-500">
                      JPEG, PNG or WEBP (Max 10MB). Uses multipart boundary fix to prevent IMAGE_PROCESS_FAILED.
                    </p>
                  </div>
                </div>
              </div>

              {/* Banner */}
              <div className="space-y-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                  <span>Banner Image (Landscape)</span>
                  <span className="text-[11px] text-zinc-500 font-normal">Hero Backdrop</span>
                </label>
                <div className="space-y-3">
                  <div className="w-full h-24 bg-zinc-950 border border-dashed border-zinc-700 rounded-lg overflow-hidden flex items-center justify-center">
                    {bannerPreview ? (
                      <img src={bannerPreview} alt="Banner" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center gap-2 text-zinc-600 text-xs">
                        <ImageIcon className="w-5 h-5" />
                        <span>Landscape Hero (16:9)</span>
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleBannerChange}
                    className="text-xs text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* MOVIE MODE: Single video file */}
          {type === 'MOVIE' && (
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Video className="w-5 h-5 text-red-500" />
                Feature Film Video File (MP4 / MKV)
              </h2>
              <p className="text-xs text-zinc-400">
                Supports MP4, MKV (Matroska container), and WebM. Uploaded via Telegram with streaming enabled.
              </p>
              <div className="p-6 border-2 border-dashed border-zinc-700 rounded-xl bg-zinc-950/60 text-center space-y-3">
                <Video className="w-10 h-10 text-red-500 mx-auto" />
                <div className="text-sm font-medium text-zinc-200">
                  {movieVideo ? movieVideo.name : 'Select or drop MP4 / MKV video'}
                </div>
                {movieVideo && (
                  <div className="text-xs text-zinc-400 flex items-center justify-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[11px]">
                      {movieVideo.name.split('.').pop()?.toUpperCase() || 'VIDEO'}
                    </span>
                    <span>Size: {(movieVideo.size / (1024 * 1024)).toFixed(2)} MB</span>
                  </div>
                )}
                <input
                  type="file"
                  accept="video/mp4,video/x-matroska,video/mkv,video/webm,.mp4,.mkv,.webm,.mov"
                  onChange={(e) => setMovieVideo(e.target.files?.[0] || null)}
                  className="text-xs text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* SERIES MODE: Seasons & Episodes */}
          {type === 'SERIES' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">Seasons & Episodes Architecture</h2>
                  <p className="text-xs text-zinc-400">
                    Binary files use designated keys (e.g. episode_0_0, thumb_0_0) separated from metadata JSON.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addSeason}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-semibold transition"
                >
                  <Plus className="w-4 h-4" />
                  Add Season
                </button>
              </div>

              {seasons.map((episodeList, seasonIdx) => (
                <div
                  key={seasonIdx}
                  className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-5"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-xs">
                        {seasonIdx + 1}
                      </span>
                      <h3 className="font-semibold text-white">Season {seasonIdx + 1}</h3>
                      <span className="text-xs text-zinc-500">({episodeList.length} episodes)</span>
                    </div>
                    {seasons.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSeason(seasonIdx)}
                        className="text-zinc-500 hover:text-red-400 text-xs flex items-center gap-1 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove Season
                      </button>
                    )}
                  </div>

                  {/* Episodes List */}
                  <div className="space-y-4">
                    {episodeList.map((ep, epIdx) => (
                      <div
                        key={epIdx}
                        className="p-4 rounded-lg bg-zinc-950/80 border border-zinc-800/80 flex flex-col md:flex-row items-start md:items-center gap-4"
                      >
                        <span className="text-xs font-mono text-zinc-500 shrink-0 w-8">
                          EP {epIdx + 1}
                        </span>

                        <div className="flex-1 w-full md:w-auto">
                          <input
                            type="text"
                            placeholder="Episode Title"
                            value={ep.title}
                            onChange={(e) => updateEpisodeTitle(seasonIdx, epIdx, e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
                          />
                        </div>

                        {/* Video input */}
                        <div className="w-full md:w-60">
                          <label className="text-[10px] text-zinc-400 block mb-1">
                            Video file (MP4 / MKV) (key: episode_{seasonIdx}_{epIdx})
                          </label>
                          <input
                            type="file"
                            accept="video/mp4,video/x-matroska,video/mkv,video/webm,.mp4,.mkv,.webm,.mov"
                            onChange={(e) =>
                              updateEpisodeFile(seasonIdx, epIdx, 'video', e.target.files?.[0] || null)
                            }
                            className="text-[11px] text-zinc-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-medium file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700"
                          />
                        </div>

                        {/* Thumbnail input */}
                        <div className="w-full md:w-60">
                          <label className="text-[10px] text-zinc-400 block mb-1">
                            Thumbnail (key: thumb_{seasonIdx}_{epIdx})
                          </label>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) =>
                              updateEpisodeFile(seasonIdx, epIdx, 'thumbnail', e.target.files?.[0] || null)
                            }
                            className="text-[11px] text-zinc-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-medium file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700"
                          />
                        </div>

                        {episodeList.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeEpisode(seasonIdx, epIdx)}
                            className="text-zinc-600 hover:text-red-400 p-1 self-center"
                            title="Remove episode"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => addEpisode(seasonIdx)}
                    className="flex items-center gap-2 text-xs text-red-500 hover:text-red-400 font-medium py-1 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Episode to Season {seasonIdx + 1}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Progress & Status Message */}
          {uploading && (
            <div className="p-5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-3">
              <div className="flex justify-between text-xs font-semibold">
                <span className="flex items-center gap-2 text-white">
                  <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                  {message || 'Uploading files...'}
                </span>
                <span className="text-red-500 font-mono">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-600 to-red-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Success Banner */}
          {uploadSuccess && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/80 flex items-center gap-3 text-emerald-300 text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <p className="font-semibold">Upload Complete!</p>
                <p className="text-xs text-emerald-400/90">{message}</p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/80 flex items-center gap-3 text-red-300 text-sm">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <div>
                <p className="font-semibold">Upload Failed</p>
                <p className="text-xs text-red-400/90">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Payload Summary & Limit Indicators */}
          <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-zinc-400">Total Upload Payload:</span>
              <span className="font-mono font-bold text-white text-sm">{formattedPayloadSize}</span>
              <span className="text-emerald-400 font-medium ml-1">(&gt; 2 GB Supported)</span>
              <span className="ml-2 px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">
                MP4 • MKV • 20 GB Max
              </span>
            </div>
            <div className="text-zinc-400 text-[11px]">
              {hasFilesExceeding2GB ? (
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  Large Media (&gt; 2 GB): High-performance disk streaming & Range 206 player active.
                </span>
              ) : hasFilesExceeding50MB ? (
                <span className="text-amber-400 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Extended Media (&gt; 50 MB): Telegram Bot API local server / streaming fallback active.
                </span>
              ) : (
                <span className="text-emerald-400/90 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  All selected files within standard limits.
                </span>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={uploading}
              className="flex items-center gap-2 px-8 py-3.5 bg-red-600 hover:bg-red-700 disabled:bg-zinc-800 text-white font-semibold rounded-xl text-sm transition shadow-lg shadow-red-900/30 cursor-pointer disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing Telegram Storage...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  {type === 'MOVIE' ? 'Upload Complete Movie' : 'Upload Complete Series'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
