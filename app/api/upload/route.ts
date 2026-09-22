import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  uploadPhotoToTelegram,
  uploadVideoToTelegram,
} from '@/services/telegram.service';

interface EpisodeMetadata {
  seasonNo: number;
  episodeNo: number;
  title: string;
  videoKey: string;
  thumbnailKey: string;
}

interface SeasonMetadata {
  seasonNumber: number;
  episodes: EpisodeMetadata[];
}

/**
 * Utility to generate a clean URL-friendly slug
 */
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // 1. Extract core content fields
    const type = (formData.get('type') as string)?.toUpperCase(); // 'MOVIE' | 'SERIES'
    const title = formData.get('title') as string;
    const description = (formData.get('description') as string) || '';
    const genreRaw = formData.get('genre') || formData.get('genres');
    const language = (formData.get('language') as string) || 'English';
    const releaseYearStr = formData.get('releaseYear') as string;
    const releaseYear = releaseYearStr ? parseInt(releaseYearStr, 10) : new Date().getFullYear();

    if (!type || !title) {
      return NextResponse.json(
        { error: 'Content type and title are required.' },
        { status: 400 }
      );
    }

    if (type !== 'MOVIE' && type !== 'SERIES') {
      return NextResponse.json(
        { error: 'Invalid content type. Must be MOVIE or SERIES.' },
        { status: 400 }
      );
    }

    // Parse genres array
    let genres: string[] = [];
    if (typeof genreRaw === 'string') {
      try {
        const parsed = JSON.parse(genreRaw);
        genres = Array.isArray(parsed) ? parsed : [genreRaw];
      } catch {
        genres = genreRaw.split(',').map((g) => g.trim()).filter(Boolean);
      }
    }

    // Generate unique slug
    let baseSlug = slugify(title);
    if (!baseSlug) baseSlug = `content-${Date.now()}`;
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.content.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // 2. Read poster and banner binary files
    const posterFile = formData.get('poster') as File | null;
    const bannerFile = formData.get('banner') as File | null;

    if (!posterFile) {
      return NextResponse.json(
        { error: 'Poster image is required.' },
        { status: 400 }
      );
    }

    console.log(`[UploadRoute] Uploading poster for "${title}" (${posterFile.size} bytes)...`);
    const posterUpload = await uploadPhotoToTelegram(
      posterFile,
      posterFile.name || `${slug}-poster.jpg`,
      posterFile.type || 'image/jpeg',
      `Poster: ${title}`
    );
    const posterFileId = posterUpload.fileId;

    let bannerFileId = posterFileId; // Fallback to poster if banner not provided
    if (bannerFile && bannerFile.size > 0) {
      console.log(`[UploadRoute] Uploading banner for "${title}" (${bannerFile.size} bytes)...`);
      const bannerUpload = await uploadPhotoToTelegram(
        bannerFile,
        bannerFile.name || `${slug}-banner.jpg`,
        bannerFile.type || 'image/jpeg',
        `Banner: ${title}`
      );
      bannerFileId = bannerUpload.fileId;
    }

    // 3. Create Content parent record in Prisma
    const content = await prisma.content.create({
      data: {
        type: type as 'MOVIE' | 'SERIES',
        title,
        slug,
        description,
        genres,
        language,
        releaseYear,
        poster: posterFileId,
        banner: bannerFileId,
      },
    });

    // 4. Handle MOVIE type
    if (type === 'MOVIE') {
      const movieVideo = (formData.get('movieVideo') || formData.get('video')) as File | null;
      if (!movieVideo) {
        return NextResponse.json(
          { error: 'Movie video file is required for movie uploads.' },
          { status: 400 }
        );
      }

      console.log(`[UploadRoute] Uploading movie video for "${title}" (${movieVideo.size} bytes)...`);
      const isMkv = movieVideo.name?.toLowerCase().endsWith('.mkv');
      const resolvedMime = isMkv ? 'video/x-matroska' : (movieVideo.type || 'video/mp4');
      const videoUpload = await uploadVideoToTelegram(
        movieVideo,
        movieVideo.name || `${slug}.${isMkv ? 'mkv' : 'mp4'}`,
        resolvedMime,
        `Movie: ${title} (${releaseYear})`
      );

      const movieRecord = await prisma.movie.create({
        data: {
          contentId: content.id,
          telegramFileId: videoUpload.fileId,
          duration: videoUpload.duration || null,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Movie uploaded and saved successfully.',
        content: {
          ...content,
          movie: movieRecord,
        },
      });
    }

    // 5. Handle SERIES type
    // Read metadata JSON string from FormData
    const seasonsMetaRaw = formData.get('metadata') as string;
    let seasonsList: SeasonMetadata[] = [];

    if (seasonsMetaRaw) {
      try {
        seasonsList = JSON.parse(seasonsMetaRaw);
      } catch (err) {
        console.error('[UploadRoute] Failed to parse seasons metadata JSON:', err);
        return NextResponse.json(
          { error: 'Invalid JSON metadata for seasons/episodes structure.' },
          { status: 400 }
        );
      }
    }

    if (!Array.isArray(seasonsList) || seasonsList.length === 0) {
      return NextResponse.json(
        { error: 'At least one season with episodes is required for series upload.' },
        { status: 400 }
      );
    }

    console.log(`[UploadRoute] Processing ${seasonsList.length} seasons for series "${title}"...`);

    const createdSeasons = [];

    for (const seasonData of seasonsList) {
      const seasonNumber = seasonData.seasonNumber || 1;

      // Create Season record in Prisma
      const season = await prisma.season.create({
        data: {
          contentId: content.id,
          seasonNumber,
        },
      });

      const createdEpisodes = [];

      // Process each episode in season
      for (const ep of seasonData.episodes || []) {
        const episodeNumber = ep.episodeNo;
        const episodeTitle = ep.title || `Episode ${episodeNumber}`;

        // Binary files retrieved from FormData using their designated keys
        const videoFile = formData.get(ep.videoKey) as File | null;
        const thumbFile = formData.get(ep.thumbnailKey) as File | null;

        if (!videoFile) {
          throw new Error(
            `Missing video file for Season ${seasonNumber} Episode ${episodeNumber} (key: ${ep.videoKey})`
          );
        }

        // Upload episode thumbnail (if provided, otherwise fallback to poster)
        let episodeThumbFileId = posterFileId;
        if (thumbFile && thumbFile.size > 0) {
          console.log(`[UploadRoute] Uploading thumbnail for S${seasonNumber}E${episodeNumber}...`);
          const thumbUpload = await uploadPhotoToTelegram(
            thumbFile,
            thumbFile.name || `s${seasonNumber}_e${episodeNumber}_thumb.jpg`,
            thumbFile.type || 'image/jpeg',
            `S${seasonNumber}E${episodeNumber} Thumb: ${episodeTitle}`
          );
          episodeThumbFileId = thumbUpload.fileId;
        }

        // Upload episode video
        console.log(`[UploadRoute] Uploading video for S${seasonNumber}E${episodeNumber} (${videoFile.size} bytes)...`);
        const isMkv = videoFile.name?.toLowerCase().endsWith('.mkv');
        const resolvedMime = isMkv ? 'video/x-matroska' : (videoFile.type || 'video/mp4');
        const videoUpload = await uploadVideoToTelegram(
          videoFile,
          videoFile.name || `s${seasonNumber}_e${episodeNumber}.${isMkv ? 'mkv' : 'mp4'}`,
          resolvedMime,
          `${title} - S${seasonNumber}E${episodeNumber}: ${episodeTitle}`
        );

        // Save Episode record in Prisma
        const episode = await prisma.episode.create({
          data: {
            seasonId: season.id,
            episodeNumber,
            title: episodeTitle,
            telegramFileId: videoUpload.fileId,
            thumbnail: episodeThumbFileId,
            duration: videoUpload.duration || null,
          },
        });

        createdEpisodes.push(episode);
      }

      createdSeasons.push({
        ...season,
        episodes: createdEpisodes,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Series with seasons and episodes uploaded and stored in Telegram successfully.',
      content: {
        ...content,
        seasons: createdSeasons,
      },
    });
  } catch (error: any) {
    console.error('[UploadRoute] Upload failed with error:', error);
    return NextResponse.json(
      {
        error: error.message || 'An unexpected error occurred during upload.',
        details: error.response?.data || null,
      },
      { status: 500 }
    );
  }
}
