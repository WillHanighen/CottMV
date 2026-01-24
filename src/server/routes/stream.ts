/**
 * Video Streaming Routes
 * ======================
 * 
 * This file handles video streaming endpoints.
 * It supports:
 * - Direct streaming of compatible video files
 * - On-demand transcoding for incompatible formats
 * - Range requests for seeking (jumping to different parts of the video)
 * - Caching of transcoded files
 * 
 * Key Concepts:
 * - Range Requests: HTTP feature that allows requesting parts of a file
 *   This enables video seeking without downloading the entire file
 * - Transcoding: Converting video to a browser-compatible format
 * - Caching: Storing transcoded files to avoid re-transcoding
 */

import { Hono } from "hono";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { createReadStream, existsSync } from "fs";
import { stat, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { nanoid } from "nanoid";
import {
  transcodeVideo,
  needsTranscoding,
  type Resolution,
  type Format,
  RESOLUTIONS,
  generateThumbnail,
} from "../../media/transcoder.js";
import { expandPath } from "../../storage/local.js";
import { transcodeManager } from "../transcode-manager.js";

/**
 * Create the stream routes
 */
export const streamRoutes = new Hono();

/**
 * GET /api/stream/:id
 * 
 * Stream a media file (video, audio, image, gif, document, etc.)
 * 
 * Parameters:
 * - id: The media ID
 * 
 * Query Parameters (video only):
 * - quality: Video quality (480p, 720p, 1080p) - triggers transcoding
 * - format: Output format (mp4, webm) - triggers transcoding
 * 
 * For videos: If no quality/format is specified, streams the original file.
 * If the original file is not browser-compatible, automatically transcodes.
 * 
 * For images, gifs, documents, and other files: Streams directly.
 */
streamRoutes.get("/:id", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const id = c.req.param("id");
    const quality = c.req.query("quality") as Resolution | undefined;
    const format = c.req.query("format") as Format | undefined;
    
    // Get media information from database
    const media = await convex.query(api.media.getById, { id: id as any });
    
    if (!media) {
      return c.json({ error: "Media not found" }, 404);
    }
    
    // Check if the file exists
    if (!existsSync(media.filepath)) {
      return c.json({ error: "File not found on disk" }, 404);
    }
    
    // Determine if this is a video that might need transcoding
    const isVideo = media.mediaType === "video" || media.mimeType?.startsWith("video/");
    
    let streamPath = media.filepath;
    let contentType = media.mimeType || "application/octet-stream";
    
    // Only consider transcoding for video files
    if (isVideo) {
      if (quality || format) {
        // User requested specific quality/format - transcode
        streamPath = await getOrCreateTranscodedFile(
          convex,
          media,
          quality || "720p",
          format || "mp4"
        );
        contentType = format === "webm" ? "video/webm" : "video/mp4";
      } else {
        // Check if original needs transcoding for browser compatibility
        const transcodeCheck = await needsTranscoding(media.filepath);
        
        if (transcodeCheck.needed) {
          // Auto-transcode to compatible format
          streamPath = await getOrCreateTranscodedFile(
            convex,
            media,
            "720p",
            transcodeCheck.suggestedFormat
          );
          contentType = transcodeCheck.suggestedFormat === "webm" 
            ? "video/webm" 
            : "video/mp4";
        }
      }
    }
    
    // Get file stats for streaming
    const fileStats = await stat(streamPath);
    const fileSize = fileStats.size;
    
    // Handle range requests (for video/audio seeking, large file downloads)
    const range = c.req.header("range");
    
    if (range) {
      // Parse the range header
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      
      // Create a read stream for the requested range
      const stream = createReadStream(streamPath, { start, end });
      
      // Return partial content (206)
      return new Response(stream as any, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": contentType,
        },
      });
    }
    
    // No range request - stream entire file
    const stream = createReadStream(streamPath);
    
    // Add cache headers for static content (images, gifs, documents)
    const cacheHeaders: Record<string, string> = {
      "Content-Length": fileSize.toString(),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    };
    
    // Cache images and gifs for better performance
    if (media.mediaType === "image" || media.mediaType === "gif") {
      cacheHeaders["Cache-Control"] = "public, max-age=31536000"; // 1 year
    }
    
    return new Response(stream as any, {
      status: 200,
      headers: cacheHeaders,
    });
  } catch (error) {
    console.error("Error streaming media:", error);
    return c.json({ error: "Failed to stream media" }, 500);
  }
});

/**
 * GET /api/stream/:id/info
 * 
 * Get streaming information for a media file.
 * Returns available qualities and whether transcoding is needed (for videos).
 */
streamRoutes.get("/:id/info", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const id = c.req.param("id");
    
    const media = await convex.query(api.media.getById, { id: id as any });
    
    if (!media) {
      return c.json({ error: "Media not found" }, 404);
    }
    
    const isVideo = media.mediaType === "video" || media.mimeType?.startsWith("video/");
    
    // Only check transcoding for videos
    let transcodeCheck = { needed: false, reason: undefined as string | undefined };
    let availableQualities: Resolution[] = [];
    
    if (isVideo) {
      transcodeCheck = await needsTranscoding(media.filepath);
      // For simplicity, offer all qualities
      // In production, you'd check the source resolution
      availableQualities = ["480p", "720p", "1080p", "1440p", "2160p"];
    }
    
    return c.json({
      success: true,
      data: {
        id: media._id,
        title: media.title,
        mediaType: media.mediaType,
        duration: media.duration,
        originalFormat: media.mimeType,
        needsTranscoding: transcodeCheck.needed,
        transcodeReason: transcodeCheck.reason,
        availableQualities,
        availableFormats: isVideo ? ["mp4", "webm"] : [],
        streamUrl: `/api/stream/${id}`,
      },
    });
  } catch (error) {
    console.error("Error getting stream info:", error);
    return c.json({ error: "Failed to get stream info" }, 500);
  }
});

/**
 * POST /api/stream/:id/transcode
 * 
 * Manually trigger transcoding for a video.
 * Useful for pre-transcoding videos before they're watched.
 */
streamRoutes.post("/:id/transcode", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    
    const quality = (body.quality as Resolution) || "720p";
    const format = (body.format as Format) || "mp4";
    
    const media = await convex.query(api.media.getById, { id: id as any });
    
    if (!media) {
      return c.json({ error: "Media not found" }, 404);
    }
    
    // Start transcoding
    const transcodedPath = await getOrCreateTranscodedFile(
      convex,
      media,
      quality,
      format
    );
    
    return c.json({
      success: true,
      data: {
        transcodedPath,
        quality,
        format,
      },
    });
  } catch (error) {
    console.error("Error transcoding video:", error);
    return c.json({ error: "Failed to transcode video" }, 500);
  }
});

/**
 * GET /api/stream/:id/transcode-progress
 * 
 * Stream transcoding progress using Server-Sent Events (SSE).
 * Starts transcoding and emits progress events until complete.
 * 
 * Query Parameters:
 * - quality: Video quality (480p, 720p, 1080p)
 * - format: Output format (mp4, webm)
 * 
 * Events:
 * - progress: { percent, eta, message }
 * - complete: { path, quality, format }
 * - error: { message }
 */
streamRoutes.get("/:id/transcode-progress", async (c) => {
  const convex = c.get("convex") as ConvexHttpClient;
  const id = c.req.param("id");
  const quality = (c.req.query("quality") as Resolution) || "720p";
  const format = (c.req.query("format") as Format) || "mp4";
  
  const media = await convex.query(api.media.getById, { id: id as any });
  
  if (!media) {
    return c.json({ error: "Media not found" }, 404);
  }
  
  // Check if already cached
  const cached = await convex.query(api.cache.get, {
    mediaId: media._id,
    format,
    resolution: quality,
  });
  
  if (cached && existsSync(cached.transcodedPath)) {
    // Already cached, return complete immediately
    const body = `data: ${JSON.stringify({ event: "complete", path: cached.transcodedPath })}\n\n`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }
  
  // Get cache configuration
  const cacheConfig = await convex.query(api.settings.getCacheConfig, {});
  const cacheDir = expandPath(cacheConfig.directory || "~/.CottMV/cache");
  await mkdir(cacheDir, { recursive: true });
  
  // Create SSE stream using TransformStream for better Bun compatibility
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let isStreamClosed = false;
  let unsubscribe: (() => void) | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  
  const encoder = new TextEncoder();
  
  const sendEvent = (eventData: any) => {
    if (isStreamClosed || !streamController) return false;
    try {
      const data = `data: ${JSON.stringify(eventData)}\n\n`;
      streamController.enqueue(encoder.encode(data));
      return true;
    } catch (e) {
      isStreamClosed = true;
      cleanup();
      return false;
    }
  };
  
  const cleanup = () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
  
  const closeStream = () => {
    if (!isStreamClosed && streamController) {
      isStreamClosed = true;
      cleanup();
      try {
        streamController.close();
      } catch (e) {
        // Already closed
      }
    }
  };
  
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      
      // Send initial status immediately
      sendEvent({ event: "status", message: "Starting transcoding...", quality, format });
      
      // Start ping interval immediately - send ping every 2 seconds to keep connection alive
      pingInterval = setInterval(() => {
        if (isStreamClosed) {
          cleanup();
          return;
        }
        // Send SSE comment as keepalive (doesn't trigger onmessage but keeps connection open)
        try {
          streamController?.enqueue(encoder.encode(": ping\n\n"));
        } catch (e) {
          isStreamClosed = true;
          cleanup();
        }
      }, 2000);
      
      // Subscribe to transcode manager events
      unsubscribe = transcodeManager.subscribe(
        media._id,
        quality,
        format,
        (event, data) => {
          if (isStreamClosed) return;
          
          const sent = sendEvent({ event, ...data });
          if (!sent) return;
          
          if (event === "complete") {
            console.log(`SSE: Received complete event with path: ${data.path}`);
            
            // Save to cache database if not already cached
            if (data.path && data.size !== undefined) {
              convex.query(api.cache.get, {
                mediaId: media._id,
                format,
                resolution: quality,
              }).then((existingCache) => {
                if (!existingCache) {
                  convex.mutation(api.cache.create, {
                    mediaId: media._id,
                    transcodedPath: data.path,
                    format,
                    resolution: quality,
                    size: data.size,
                    ttlHours: cacheConfig.ttlHours || 24,
                  }).catch((err) => {
                    console.error("Error saving transcoded file to cache:", err);
                  });
                }
              }).catch(console.error);
            }
            
            // Close stream after complete
            setTimeout(closeStream, 100);
          } else if (event === "error") {
            setTimeout(closeStream, 100);
          }
        }
      );
      
      // Start transcoding if not already in progress
      if (!transcodeManager.isTranscoding(media._id, quality, format)) {
        transcodeManager.startTranscode(
          media._id,
          quality,
          format,
          async (onProgress) => {
            const result = await transcodeVideo({
              inputPath: media.filepath,
              outputDir: cacheDir,
              resolution: quality,
              format,
              onProgress,
            });
            return result;
          }
        ).catch((error) => {
          console.error("Transcoding error:", error);
          if (!isStreamClosed) {
            sendEvent({ event: "error", message: error.message });
            setTimeout(closeStream, 100);
          }
        });
      }
    },
    cancel() {
      // Called when client disconnects
      isStreamClosed = true;
      cleanup();
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering if behind proxy
    },
  });
});

/**
 * Helper function to get or create a transcoded file
 * 
 * This function:
 * 1. Checks if a cached transcoded version exists
 * 2. If not, transcodes the video and caches it
 * 3. Returns the path to the transcoded file
 */
async function getOrCreateTranscodedFile(
  convex: ConvexHttpClient,
  media: any,
  resolution: Resolution,
  format: Format
): Promise<string> {
  // Check cache for existing transcoded version
  const cached = await convex.query(api.cache.get, {
    mediaId: media._id,
    format,
    resolution,
  });
  
  if (cached && existsSync(cached.transcodedPath)) {
    // Update last accessed time
    await convex.mutation(api.cache.touch, { id: cached._id });
    return cached.transcodedPath;
  }
  
  // Check if already transcoding via transcode manager
  const existingState = transcodeManager.getTranscodeState(media._id, resolution, format);
  if (existingState && existingState.status === 'complete' && existingState.outputPath) {
    return existingState.outputPath;
  }
  
  // Get cache configuration
  const cacheConfig = await convex.query(api.settings.getCacheConfig, {});
  // Expand ~ and $HOME to actual home directory path
  const cacheDir = expandPath(cacheConfig.directory || "~/.CottMV/cache");
  await mkdir(cacheDir, { recursive: true });
  
  // Use transcode manager to coordinate transcoding
  console.log(`Transcoding ${media.title} to ${resolution} ${format}...`);
  
  const result = await transcodeManager.startTranscode(
    media._id,
    resolution,
    format,
    async (onProgress) => {
      return await transcodeVideo({
        inputPath: media.filepath,
        outputDir: cacheDir,
        resolution,
        format,
        onProgress: (percent) => {
          console.log(`Transcoding progress: ${percent}%`);
          onProgress(percent);
        },
      });
    }
  );
  
  console.log(`Transcoding complete: ${result.outputPath}`);
  
  // Save to cache database if not already cached
  // Only save if we have both outputPath and size
  if (result.outputPath && result.size !== undefined) {
    const existingCache = await convex.query(api.cache.get, {
      mediaId: media._id,
      format,
      resolution,
    });
    
    if (!existingCache) {
      await convex.mutation(api.cache.create, {
        mediaId: media._id,
        transcodedPath: result.outputPath,
        format,
        resolution,
        size: result.size,
        ttlHours: cacheConfig.ttlHours || 24,
      });
    }
  } else {
    console.warn("Transcode result missing outputPath or size:", { 
      outputPath: result.outputPath, 
      size: result.size 
    });
  }
  
  return result.outputPath;
}

/**
 * GET /api/thumbnail/:id
 * 
 * Get a thumbnail for a media file.
 * For videos: Returns the stored thumbnail or generates one on demand
 * For images/gifs: Returns a small preview of the media
 * For audio: Returns cover art if available, otherwise a placeholder
 */
streamRoutes.get("/thumbnail/:id", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const id = c.req.param("id");
    
    // Get media information from database
    const media = await convex.query(api.media.getById, { id: id as any });
    
    if (!media) {
      return c.json({ error: "Media not found" }, 404);
    }
    
    // For images and gifs, stream a small preview
    if (media.mediaType === "image" || media.mediaType === "gif") {
      if (!existsSync(media.filepath)) {
        return c.json({ error: "File not found" }, 404);
      }
      
      const fileStats = await stat(media.filepath);
      const stream = createReadStream(media.filepath);
      
      return new Response(stream as any, {
        status: 200,
        headers: {
          "Content-Length": fileStats.size.toString(),
          "Content-Type": media.mimeType,
          "Cache-Control": "public, max-age=31536000",
        },
      });
    }
    
    // For videos, try to use stored thumbnail or generate one
    if (media.thumbnail && existsSync(media.thumbnail)) {
      const fileStats = await stat(media.thumbnail);
      const stream = createReadStream(media.thumbnail);
      
      return new Response(stream as any, {
        status: 200,
        headers: {
          "Content-Length": fileStats.size.toString(),
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=31536000",
        },
      });
    }
    
    // Generate thumbnail on demand for videos
    if (media.mediaType === "video") {
      const cacheConfig = await convex.query(api.settings.getCacheConfig, {});
      const thumbnailDir = expandPath(cacheConfig.directory || "~/.CottMV/cache");
      await mkdir(thumbnailDir, { recursive: true });
      
      const thumbnailFilename = `${nanoid(8)}.jpg`;
      const thumbnailPath = join(thumbnailDir, thumbnailFilename);
      
      try {
        await generateThumbnail(media.filepath, thumbnailPath);
        
        // Update the media record with the thumbnail path
        await convex.mutation(api.media.update, {
          id: media._id,
          thumbnail: thumbnailPath,
        });
        
        const fileStats = await stat(thumbnailPath);
        const stream = createReadStream(thumbnailPath);
        
        return new Response(stream as any, {
          status: 200,
          headers: {
            "Content-Length": fileStats.size.toString(),
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=31536000",
          },
        });
      } catch (err) {
        console.error("Failed to generate thumbnail:", err);
        return c.json({ error: "Failed to generate thumbnail" }, 500);
      }
    }
    
    // For audio with cover art
    if (media.mediaType === "audio" && media.coverUrl) {
      return c.redirect(media.coverUrl);
    }
    
    // Return a placeholder for other types
    return c.json({ error: "No thumbnail available" }, 404);
  } catch (error) {
    console.error("Error getting thumbnail:", error);
    return c.json({ error: "Failed to get thumbnail" }, 500);
  }
});

/**
 * GET /api/cover/:id
 * 
 * Get a cover image for a media file.
 * Priority:
 * 1. Custom uploaded cover (customCover field)
 * 2. External cover URL (coverUrl field from TMDB, MusicBrainz, etc.)
 * 3. Thumbnail (for videos)
 * 4. 404 if no cover available
 */
streamRoutes.get("/cover/:id", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const id = c.req.param("id");
    
    // Get media information from database
    const media = await convex.query(api.media.getById, { id: id as any });
    
    if (!media) {
      return c.json({ error: "Media not found" }, 404);
    }
    
    // Priority 1: Custom uploaded cover
    if (media.customCover && existsSync(media.customCover)) {
      const fileStats = await stat(media.customCover);
      const stream = createReadStream(media.customCover);
      
      // Determine content type from extension
      const ext = media.customCover.toLowerCase();
      let contentType = "image/jpeg";
      if (ext.endsWith(".png")) contentType = "image/png";
      else if (ext.endsWith(".webp")) contentType = "image/webp";
      else if (ext.endsWith(".gif")) contentType = "image/gif";
      
      return new Response(stream as any, {
        status: 200,
        headers: {
          "Content-Length": fileStats.size.toString(),
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400", // 1 day cache (might be updated)
        },
      });
    }
    
    // Priority 2: External cover URL - redirect to it
    if (media.coverUrl) {
      return c.redirect(media.coverUrl);
    }
    
    // Priority 3: Use thumbnail for videos
    if (media.mediaType === "video" && media.thumbnail && existsSync(media.thumbnail)) {
      const fileStats = await stat(media.thumbnail);
      const stream = createReadStream(media.thumbnail);
      
      return new Response(stream as any, {
        status: 200,
        headers: {
          "Content-Length": fileStats.size.toString(),
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=31536000",
        },
      });
    }
    
    // For images and gifs, the media itself can be the "cover"
    if (media.mediaType === "image" || media.mediaType === "gif") {
      if (!existsSync(media.filepath)) {
        return c.json({ error: "File not found" }, 404);
      }
      
      const fileStats = await stat(media.filepath);
      const stream = createReadStream(media.filepath);
      
      return new Response(stream as any, {
        status: 200,
        headers: {
          "Content-Length": fileStats.size.toString(),
          "Content-Type": media.mimeType,
          "Cache-Control": "public, max-age=31536000",
        },
      });
    }
    
    // No cover available
    return c.json({ error: "No cover available" }, 404);
  } catch (error) {
    console.error("Error getting cover:", error);
    return c.json({ error: "Failed to get cover" }, 500);
  }
});
