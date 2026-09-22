import { NextRequest, NextResponse } from 'next/server';
import { getTelegramFileMetadata } from '@/services/telegram.service';

/**
 * Stream proxy for Telegram media.
 * Supports HTTP Range requests for video scrubbing and hides bot credentials.
 * Usage: /api/stream?fileId=BAACAgIAAxkBA...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return new NextResponse('Missing fileId query parameter', { status: 400 });
    }

    // Resolve file_path and direct download URL from Telegram Bot API
    const metadata = await getTelegramFileMetadata(fileId);
    const directUrl = metadata.directDownloadUrl;

    // Check for HTTP Range header from video player
    const rangeHeader = request.headers.get('range');
    const proxyHeaders: Record<string, string> = {};

    if (rangeHeader) {
      proxyHeaders['Range'] = rangeHeader;
    }

    const tgResponse = await fetch(directUrl, {
      method: 'GET',
      headers: proxyHeaders,
    });

    if (!tgResponse.ok && tgResponse.status !== 206) {
      return new NextResponse(`Telegram stream error: ${tgResponse.statusText}`, {
        status: tgResponse.status,
      });
    }

    // Determine appropriate content type
    let contentType = tgResponse.headers.get('content-type') || 'application/octet-stream';
    if (metadata.filePath.endsWith('.mp4')) contentType = 'video/mp4';
    else if (metadata.filePath.endsWith('.mkv')) contentType = 'video/x-matroska';
    else if (metadata.filePath.endsWith('.webm')) contentType = 'video/webm';
    else if (metadata.filePath.endsWith('.jpg') || metadata.filePath.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (metadata.filePath.endsWith('.png')) contentType = 'image/png';
    else if (metadata.filePath.endsWith('.webp')) contentType = 'image/webp';

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', 'public, max-age=86400, immutable');

    const contentRange = tgResponse.headers.get('content-range');
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange);
    }

    const contentLength = tgResponse.headers.get('content-length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }

    return new NextResponse(tgResponse.body as any, {
      status: tgResponse.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error('[StreamRoute] Error streaming Telegram file:', err);
    return new NextResponse(`Streaming error: ${err.message}`, { status: 500 });
  }
}
