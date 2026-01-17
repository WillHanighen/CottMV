/**
 * Metadata API Routes
 * ===================
 *
 * This file provides API endpoints for fetching and managing
 * external metadata for media files.
 *
 * Endpoints:
 * - GET /api/metadata/search - Search for metadata
 * - POST /api/metadata/fetch/:id - Fetch metadata for a media item
 * - POST /api/metadata/refresh/:id - Refresh metadata for a media item
 */

import { Hono } from "hono";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { createMetadataService } from "../../metadata/index.js";
import { getMediaType } from "../../media/utils.js";
import type { Id } from "../../../convex/_generated/dataModel.js";

// Type for Hono context with Convex client
type Variables = {
  convex: ConvexHttpClient;
};

const metadataRoutes = new Hono<{ Variables: Variables }>();

// Create metadata service
const metadataService = createMetadataService();

/**
 * Search for metadata
 * Query params: q (query), type (video|audio|document), year (optional)
 */
metadataRoutes.get("/search", async (c) => {
  const query = c.req.query("q");
  const type = c.req.query("type") || "video";
  const yearStr = c.req.query("year");
  const year = yearStr ? parseInt(yearStr, 10) : undefined;
  
  if (!query) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }
  
  try {
    let results: unknown[] = [];
    
    if (type === "video") {
      results = await metadataService.searchVideos(query, year);
    } else if (type === "audio") {
      // MusicBrainz search
      const musicbrainz = await import("../../metadata/musicbrainz.js");
      const client = musicbrainz.createMusicBrainzClient();
      const recordings = await client.searchRecordings(query);
      results = recordings.map((r) => ({
        externalId: r.id,
        externalSource: "musicbrainz",
        title: r.title,
        artist: r["artist-credit"]?.[0]?.artist?.name,
        album: r.releases?.[0]?.title,
        year: r["first-release-date"]?.slice(0, 4),
      }));
    } else if (type === "document") {
      // Open Library search
      const openlibrary = await import("../../metadata/openlibrary.js");
      const client = openlibrary.createOpenLibraryClient();
      const books = await client.searchBooks(query);
      results = books.map((b) => ({
        externalId: b.key,
        externalSource: "openlibrary",
        title: b.title,
        artist: b.author_name?.join(", "),
        year: b.first_publish_year,
        coverUrl: client.getCoverUrl(b.cover_i),
      }));
    }
    
    return c.json({ results });
  } catch (error) {
    console.error("Metadata search error:", error);
    return c.json({ error: "Failed to search metadata" }, 500);
  }
});

/**
 * Fetch metadata for a media item
 * Automatically detects media type and fetches appropriate metadata
 */
metadataRoutes.post("/fetch/:id", async (c) => {
  const convex = c.get("convex");
  const mediaId = c.req.param("id") as Id<"media">;
  
  try {
    // Get the media item
    const media = await convex.query(api.media.get, { id: mediaId });
    
    if (!media) {
      return c.json({ error: "Media not found" }, 404);
    }
    
    // Determine media type from extension
    const mediaType = getMediaType(media.extension || "");
    
    // Fetch metadata
    const metadata = await metadataService.fetchMetadata(media.filename, mediaType);
    
    if (!metadata) {
      return c.json({ error: "No metadata found" }, 404);
    }
    
    // Update the media item with metadata
    await convex.mutation(api.media.update, {
      id: mediaId,
      externalId: metadata.externalId,
      externalSource: metadata.externalSource,
      description: metadata.description,
      year: metadata.year,
      genre: metadata.genre,
      artist: metadata.artist,
      album: metadata.album,
      coverUrl: metadata.coverUrl,
    });
    
    return c.json({ 
      success: true, 
      metadata,
      message: "Metadata fetched and saved successfully" 
    });
  } catch (error) {
    console.error("Metadata fetch error:", error);
    return c.json({ error: "Failed to fetch metadata" }, 500);
  }
});

/**
 * Manually set metadata for a media item
 */
metadataRoutes.post("/set/:id", async (c) => {
  const convex = c.get("convex");
  const mediaId = c.req.param("id") as Id<"media">;
  
  try {
    const body = await c.req.json();
    
    // Validate required fields
    if (!body.externalId || !body.externalSource) {
      return c.json({ error: "externalId and externalSource are required" }, 400);
    }
    
    // Update the media item
    await convex.mutation(api.media.update, {
      id: mediaId,
      externalId: body.externalId,
      externalSource: body.externalSource,
      description: body.description,
      year: body.year,
      genre: body.genre,
      artist: body.artist,
      album: body.album,
      coverUrl: body.coverUrl,
    });
    
    return c.json({ 
      success: true, 
      message: "Metadata updated successfully" 
    });
  } catch (error) {
    console.error("Metadata set error:", error);
    return c.json({ error: "Failed to set metadata" }, 500);
  }
});

/**
 * Clear metadata for a media item
 */
metadataRoutes.delete("/:id", async (c) => {
  const convex = c.get("convex");
  const mediaId = c.req.param("id") as Id<"media">;
  
  try {
    // Clear metadata fields
    await convex.mutation(api.media.update, {
      id: mediaId,
      externalId: undefined,
      externalSource: undefined,
      description: undefined,
      year: undefined,
      genre: undefined,
      artist: undefined,
      album: undefined,
      coverUrl: undefined,
    });
    
    return c.json({ 
      success: true, 
      message: "Metadata cleared successfully" 
    });
  } catch (error) {
    console.error("Metadata clear error:", error);
    return c.json({ error: "Failed to clear metadata" }, 500);
  }
});

/**
 * Batch fetch metadata for all media without metadata
 */
metadataRoutes.post("/batch-fetch", async (c) => {
  const convex = c.get("convex");
  
  try {
    // Get media items without metadata
    const mediaItems = await convex.query(api.media.getWithoutMetadata, { limit: 20 });
    
    const results = {
      total: mediaItems.length,
      success: 0,
      failed: 0,
      skipped: 0,
    };
    
    for (const media of mediaItems) {
      try {
        const mediaType = getMediaType(media.extension || "");
        
        // Skip unsupported types
        if (mediaType === "image" || mediaType === "gif" || mediaType === "other") {
          results.skipped++;
          continue;
        }
        
        const metadata = await metadataService.fetchMetadata(media.filename, mediaType);
        
        if (metadata) {
          await convex.mutation(api.media.update, {
            id: media._id,
            externalId: metadata.externalId,
            externalSource: metadata.externalSource,
            description: metadata.description,
            year: metadata.year,
            genre: metadata.genre,
            artist: metadata.artist,
            album: metadata.album,
            coverUrl: metadata.coverUrl,
          });
          results.success++;
        } else {
          results.failed++;
        }
        
        // Rate limiting - wait between requests
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        results.failed++;
      }
    }
    
    return c.json({ 
      success: true, 
      results,
      message: `Processed ${results.total} items: ${results.success} success, ${results.failed} failed, ${results.skipped} skipped` 
    });
  } catch (error) {
    console.error("Batch fetch error:", error);
    return c.json({ error: "Failed to batch fetch metadata" }, 500);
  }
});

/**
 * Get metadata service status
 */
metadataRoutes.get("/status", async (c) => {
  return c.json({
    tmdb: {
      configured: metadataService.isTMDBConfigured(),
      name: "TheMovieDB",
      types: ["video"],
    },
    musicbrainz: {
      configured: true, // No API key required
      name: "MusicBrainz",
      types: ["audio"],
    },
    openlibrary: {
      configured: true, // No API key required
      name: "Open Library",
      types: ["document"],
    },
  });
});

export { metadataRoutes };
