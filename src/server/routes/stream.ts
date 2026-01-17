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
import { stat } from "fs/promises";
import { join } from "path";
import {
  transcodeVideo,
  needsTranscoding,
  type Resolution,
  type Format,
  RESOLUTIONS,
} from "../../media/transcoder.js";
import { expandPath } from "../../storage/local.js";

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
      availableQualities = ["480p", "720p", "1080p"];
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
  
  // Get cache configuration
  const cacheConfig = await convex.query(api.settings.getCacheConfig, {});
  // Expand ~ and $HOME to actual home directory path
  const cacheDir = expandPath(cacheConfig.directory || "~/.CottMV/cache");
  
  // Transcode the video
  console.log(`Transcoding ${media.title} to ${resolution} ${format}...`);
  
  const result = await transcodeVideo({
    inputPath: media.filepath,
    outputDir: cacheDir,
    resolution,
    format,
    onProgress: (percent) => {
      console.log(`Transcoding progress: ${percent}%`);
    },
  });
  
  console.log(`Transcoding complete: ${result.outputPath}`);
  
  // Save to cache database
  await convex.mutation(api.cache.create, {
    mediaId: media._id,
    transcodedPath: result.outputPath,
    format,
    resolution,
    size: result.size,
    ttlHours: cacheConfig.ttlHours || 24,
  });
  
  return result.outputPath;
}
