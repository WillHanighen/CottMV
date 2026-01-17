/**
 * Media API Routes
 * ================
 * 
 * This file contains all the API endpoints for managing media files.
 * These endpoints handle:
 * - Listing all media
 * - Getting details about a specific media file
 * - Adding new media to the library
 * - Updating media information
 * - Deleting media
 * - Scanning for new files
 * - Filtering and sorting
 * 
 * All endpoints return JSON responses.
 */

import { Hono } from "hono";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { readdir, stat } from "fs/promises";
import { join, extname, basename } from "path";
import { getVideoMetadata, generateThumbnail } from "../../media/transcoder.js";
import {
  getMediaType,
  getMimeType,
  getExtension,
  getBasename,
  parseFilename,
  SUPPORTED_EXTENSIONS,
  type MediaType,
} from "../../media/utils.js";
import { expandPath } from "../../storage/local.js";

/**
 * Create the media routes
 */
export const mediaRoutes = new Hono();

/**
 * GET /api/media
 * 
 * List all media files in the library.
 * 
 * Query Parameters:
 * - search: Optional search term to filter results
 * - type: Optional media type filter (video, audio, image, gif, document, other)
 * - extension: Optional file extension filter
 * - sort: Sort field (title, createdAt, size, duration, year)
 * - order: Sort direction (asc, desc)
 * - limit: Maximum number of results
 * 
 * Response: Array of media objects
 */
mediaRoutes.get("/", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const search = c.req.query("search");
    const mediaType = c.req.query("type") as MediaType | undefined;
    const extension = c.req.query("extension");
    const sortField = c.req.query("sort") as any;
    const sortDirection = c.req.query("order") as any;
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
    
    let media;
    if (search) {
      media = await convex.query(api.media.search, { 
        searchTerm: search,
        mediaType,
      });
    } else if (mediaType || extension || sortField) {
      media = await convex.query(api.media.listFiltered, {
        mediaType,
        extension,
        sortField,
        sortDirection,
        limit,
      });
    } else {
      media = await convex.query(api.media.list, {});
    }
    
    return c.json({
      success: true,
      data: media,
      count: media.length,
    });
  } catch (error) {
    console.error("Error listing media:", error);
    return c.json({
      success: false,
      error: "Failed to list media",
    }, 500);
  }
});

/**
 * GET /api/media/filters
 * 
 * Get available filter options (extensions and media type counts)
 */
mediaRoutes.get("/filters", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    const [extensions, typeCounts] = await Promise.all([
      convex.query(api.media.getExtensions, {}),
      convex.query(api.media.getMediaTypeCounts, {}),
    ]);
    
    return c.json({
      success: true,
      data: {
        extensions,
        typeCounts,
      },
    });
  } catch (error) {
    console.error("Error getting filters:", error);
    return c.json({
      success: false,
      error: "Failed to get filter options",
    }, 500);
  }
});

/**
 * GET /api/media/stats
 * 
 * Get library statistics.
 * 
 * Response: Statistics object
 */
mediaRoutes.get("/stats", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const stats = await convex.query(api.media.getStats, {});
    
    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error getting stats:", error);
    return c.json({
      success: false,
      error: "Failed to get statistics",
    }, 500);
  }
});

/**
 * GET /api/media/:id
 * 
 * Get details about a specific media file.
 * 
 * Parameters:
 * - id: The media ID
 * 
 * Response: Media object or 404 error
 */
mediaRoutes.get("/:id", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const id = c.req.param("id");
    
    const media = await convex.query(api.media.getById, { id: id as any });
    
    if (!media) {
      return c.json({
        success: false,
        error: "Media not found",
      }, 404);
    }
    
    return c.json({
      success: true,
      data: media,
    });
  } catch (error) {
    console.error("Error getting media:", error);
    return c.json({
      success: false,
      error: "Failed to get media",
    }, 500);
  }
});

/**
 * POST /api/media
 * 
 * Add a new media file to the library.
 * 
 * Request Body:
 * - title: Display title for the media
 * - filepath: Path to the file on disk
 * 
 * Response: Created media object
 */
mediaRoutes.post("/", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const body = await c.req.json();
    
    const { title, filepath } = body;
    
    if (!filepath) {
      return c.json({
        success: false,
        error: "filepath is required",
      }, 400);
    }
    
    // Get file information
    const fileStats = await stat(filepath);
    const filename = basename(filepath);
    const extension = getExtension(filename);
    const mediaType = getMediaType(extension);
    const mimeType = getMimeType(extension);
    
    // Parse filename for metadata hints
    const parsed = parseFilename(filename);
    
    // Try to get video metadata
    let duration: number | undefined;
    if (mediaType === "video" || mediaType === "audio") {
      try {
        const metadata = await getVideoMetadata(filepath);
        duration = metadata.duration;
      } catch {
        // Metadata extraction failed, continue without duration
      }
    }
    
    // Create the media record
    const mediaId = await convex.mutation(api.media.create, {
      title: title || parsed.title,
      filename,
      filepath,
      mimeType,
      extension: extension.replace(/^\./, ""),
      mediaType,
      size: fileStats.size,
      duration,
      year: parsed.year,
      artist: parsed.artist,
      album: parsed.album,
    });
    
    return c.json({
      success: true,
      data: { id: mediaId },
    }, 201);
  } catch (error) {
    console.error("Error creating media:", error);
    return c.json({
      success: false,
      error: "Failed to create media",
    }, 500);
  }
});

/**
 * PUT /api/media/:id
 * 
 * Update media information.
 * 
 * Parameters:
 * - id: The media ID
 * 
 * Request Body:
 * - title: New title (optional)
 * - Other updatable fields
 * 
 * Response: Success status
 */
mediaRoutes.put("/:id", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const id = c.req.param("id");
    const body = await c.req.json();
    
    await convex.mutation(api.media.update, {
      id: id as any,
      ...body,
    });
    
    return c.json({
      success: true,
    });
  } catch (error) {
    console.error("Error updating media:", error);
    return c.json({
      success: false,
      error: "Failed to update media",
    }, 500);
  }
});

/**
 * DELETE /api/media/:id
 * 
 * Delete a media file from the library.
 * Note: This only removes the database record, not the actual file.
 * 
 * Parameters:
 * - id: The media ID
 * 
 * Response: Success status
 */
mediaRoutes.delete("/:id", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const id = c.req.param("id");
    
    await convex.mutation(api.media.remove, { id: id as any });
    
    return c.json({
      success: true,
    });
  } catch (error) {
    console.error("Error deleting media:", error);
    return c.json({
      success: false,
      error: "Failed to delete media",
    }, 500);
  }
});

/**
 * POST /api/media/scan
 * 
 * Scan a directory for new media files and add them to the library.
 * 
 * Request Body:
 * - directory: Path to scan (optional, uses default media directory)
 * 
 * Response: Number of files found and added
 */
mediaRoutes.post("/scan", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const body = await c.req.json().catch(() => ({}));
    
    // Get media directory from settings or use provided directory
    const mediaDirSetting = body.directory ||
      await convex.query(api.settings.get, { key: "media_directory" }) ||
      "~/.CottMV";
    
    // Expand ~ to actual home directory
    const mediaDir = expandPath(mediaDirSetting);
    
    // Scan directory for media files
    const files = await scanDirectory(mediaDir);
    
    // Get existing media to avoid duplicates
    const existingMedia = await convex.query(api.media.list, {});
    const existingPaths = new Set(existingMedia.map((m: any) => m.filepath));
    
    // Add new files
    let added = 0;
    for (const file of files) {
      if (!existingPaths.has(file.path)) {
        try {
          // Get video/audio metadata
          let duration: number | undefined;
          if (file.mediaType === "video" || file.mediaType === "audio") {
            try {
              const metadata = await getVideoMetadata(file.path);
              duration = metadata.duration;
            } catch {
              // Continue without duration
            }
          }
          
          // Parse filename for metadata hints
          const parsed = parseFilename(file.name);
          
          await convex.mutation(api.media.create, {
            title: parsed.title,
            filename: file.name,
            filepath: file.path,
            mimeType: file.mimeType,
            extension: file.extension,
            mediaType: file.mediaType,
            size: file.size,
            duration,
            year: parsed.year,
            artist: parsed.artist,
            album: parsed.album,
          });
          added++;
        } catch (err) {
          console.error(`Failed to add ${file.path}:`, err);
        }
      }
    }
    
    return c.json({
      success: true,
      data: {
        scanned: files.length,
        added,
        skipped: files.length - added,
      },
    });
  } catch (error) {
    console.error("Error scanning media:", error);
    return c.json({
      success: false,
      error: "Failed to scan media directory",
    }, 500);
  }
});

/**
 * Helper function to scan a directory for media files
 * 
 * @param dir - Directory to scan
 * @returns Array of file information objects
 */
async function scanDirectory(dir: string): Promise<Array<{
  path: string;
  name: string;
  size: number;
  mimeType: string;
  extension: string;
  mediaType: MediaType;
}>> {
  const results: Array<{
    path: string;
    name: string;
    size: number;
    mimeType: string;
    extension: string;
    mediaType: MediaType;
  }> = [];
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subResults = await scanDirectory(fullPath);
        results.push(...subResults);
      } else if (entry.isFile()) {
        const ext = getExtension(entry.name);
        
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          const fileStats = await stat(fullPath);
          const mediaType = getMediaType(ext);
          const mimeType = getMimeType(ext);
          
          results.push({
            path: fullPath,
            name: entry.name,
            size: fileStats.size,
            mimeType,
            extension: ext.replace(/^\./, ""),
            mediaType,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error);
  }
  
  return results;
}
