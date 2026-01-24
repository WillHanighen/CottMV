/**
 * Media Functions
 * ===============
 * 
 * This file contains all the database operations for media files.
 * These functions are called from the frontend or server to:
 * - List all media files
 * - Get details about a specific file
 * - Add new media to the library
 * - Update media information
 * - Delete media from the library
 * - Filter and sort media
 * 
 * Convex Concepts:
 * - query: Read-only operations (like SELECT in SQL)
 * - mutation: Write operations (like INSERT, UPDATE, DELETE in SQL)
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Media type validator for filtering
 */
const mediaTypeValidator = v.union(
  v.literal("video"),
  v.literal("audio"),
  v.literal("image"),
  v.literal("gif"),
  v.literal("document"),
  v.literal("other")
);

/**
 * Sort field options
 */
const sortFieldValidator = v.union(
  v.literal("title"),
  v.literal("createdAt"),
  v.literal("size"),
  v.literal("duration"),
  v.literal("year")
);

/**
 * Sort direction options
 */
const sortDirectionValidator = v.union(
  v.literal("asc"),
  v.literal("desc")
);

/**
 * List all media files in the library
 * 
 * Usage: Call this to display the media library on the homepage
 * Returns: Array of media objects, sorted by creation date (newest first)
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    // Fetch all media and sort by creation date (newest first)
    const media = await ctx.db.query("media").order("desc").collect();
    // Filter out thumbnail files
    return media.filter((m) => !m.filename.endsWith("_thumb.jpg"));
  },
});

/**
 * List media with filtering and sorting
 * 
 * Usage: Call this for filtered/sorted media views
 * Returns: Array of media objects matching the criteria
 */
export const listFiltered = query({
  args: {
    mediaType: v.optional(mediaTypeValidator),
    extension: v.optional(v.string()),
    sortField: v.optional(sortFieldValidator),
    sortDirection: v.optional(sortDirectionValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Collect results - apply filter if specified
    let results;
    if (args.mediaType) {
      results = await ctx.db
        .query("media")
        .withIndex("by_media_type", (q) => q.eq("mediaType", args.mediaType!))
        .collect();
    } else {
      results = await ctx.db.query("media").collect();
    }
    
    // Apply extension filter (post-query since we can't combine indexes)
    if (args.extension) {
      const ext = args.extension.toLowerCase().replace(/^\./, "");
      results = results.filter((m) => m.extension?.toLowerCase() === ext);
    }
    
    // Filter out thumbnail files
    results = results.filter((m) => !m.filename.endsWith("_thumb.jpg"));
    
    // Apply sorting
    const sortField = args.sortField || "createdAt";
    const sortDirection = args.sortDirection || "desc";
    
    results.sort((a, b) => {
      let aVal: any;
      let bVal: any;
      
      switch (sortField) {
        case "title":
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case "size":
          aVal = a.size;
          bVal = b.size;
          break;
        case "duration":
          aVal = a.duration || 0;
          bVal = b.duration || 0;
          break;
        case "year":
          aVal = a.year || 0;
          bVal = b.year || 0;
          break;
        case "createdAt":
        default:
          aVal = a.createdAt;
          bVal = b.createdAt;
          break;
      }
      
      if (sortDirection === "asc") {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
    
    // Apply limit
    if (args.limit && args.limit > 0) {
      results = results.slice(0, args.limit);
    }
    
    return results;
  },
});

/**
 * Get unique extensions in the library
 * 
 * Usage: Populate filter dropdown
 * Returns: Array of unique file extensions
 */
export const getExtensions = query({
  args: {},
  handler: async (ctx) => {
    const allMedia = await ctx.db.query("media").collect();
    const extensions = new Set<string>();
    
    for (const m of allMedia) {
      if (m.extension) {
        extensions.add(m.extension.toLowerCase());
      }
    }
    
    return Array.from(extensions).sort();
  },
});

/**
 * Get media type counts
 * 
 * Usage: Display filter badges with counts
 * Returns: Object with counts per media type
 */
export const getMediaTypeCounts = query({
  args: {},
  handler: async (ctx) => {
    const allMedia = await ctx.db.query("media").collect();
    
    const counts: Record<string, number> = {
      video: 0,
      audio: 0,
      image: 0,
      gif: 0,
      document: 0,
      other: 0,
    };
    
    for (const m of allMedia) {
      if (m.mediaType && counts[m.mediaType] !== undefined) {
        counts[m.mediaType]++;
      }
    }
    
    return counts;
  },
});

/**
 * Get a single media file by its ID
 *
 * Usage: Call this when viewing a specific video's details
 * Returns: The media object, or null if not found
 */
export const getById = query({
  args: { id: v.id("media") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Alias for getById - for compatibility
 */
export const get = query({
  args: { id: v.id("media") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Search media by title with full filtering and sorting support
 * 
 * Usage: Call this for the search functionality
 * Returns: Array of matching media objects
 * 
 * Note: This is a simple substring search. For larger libraries,
 * you might want to implement full-text search.
 */
export const search = query({
  args: { 
    searchTerm: v.string(),
    mediaType: v.optional(mediaTypeValidator),
    tagId: v.optional(v.id("tags")),
    extension: v.optional(v.string()),
    sortField: v.optional(sortFieldValidator),
    sortDirection: v.optional(sortDirectionValidator),
  },
  handler: async (ctx, args) => {
    let allMedia = await ctx.db.query("media").collect();
    const searchLower = args.searchTerm.toLowerCase();
    
    // Filter by search term (includes OCR text for searching text in images/videos)
    let results = allMedia.filter((m) => 
      m.title.toLowerCase().includes(searchLower) ||
      m.filename.toLowerCase().includes(searchLower) ||
      (m.description && m.description.toLowerCase().includes(searchLower)) ||
      (m.artist && m.artist.toLowerCase().includes(searchLower)) ||
      (m.album && m.album.toLowerCase().includes(searchLower)) ||
      (m.ocrText && m.ocrText.toLowerCase().includes(searchLower))
    );
    
    // Filter by media type if specified
    if (args.mediaType) {
      results = results.filter((m) => m.mediaType === args.mediaType);
    }
    
    // Filter by tag if specified
    if (args.tagId) {
      results = results.filter((m) => m.tags && m.tags.includes(args.tagId!));
    }
    
    // Filter by extension if specified
    if (args.extension) {
      const ext = args.extension.toLowerCase().replace(/^\./, "");
      results = results.filter((m) => m.extension?.toLowerCase() === ext);
    }
    
    // Filter out thumbnail files
    results = results.filter((m) => !m.filename.endsWith("_thumb.jpg"));
    
    // Apply sorting
    const sortField = args.sortField || "createdAt";
    const sortDirection = args.sortDirection || "desc";
    
    results.sort((a, b) => {
      let aVal: any;
      let bVal: any;
      
      switch (sortField) {
        case "title":
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case "size":
          aVal = a.size;
          bVal = b.size;
          break;
        case "duration":
          aVal = a.duration || 0;
          bVal = b.duration || 0;
          break;
        case "year":
          aVal = a.year || 0;
          bVal = b.year || 0;
          break;
        case "createdAt":
        default:
          aVal = a.createdAt;
          bVal = b.createdAt;
          break;
      }
      
      if (sortDirection === "asc") {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
    
    return results;
  },
});

/**
 * Add a new media file to the library
 * 
 * Usage: Called when scanning for new files or uploading
 * Returns: The ID of the newly created media record
 * 
 * Note: This doesn't upload the file itself - it just creates
 * a database record pointing to an existing file on disk.
 */
export const create = mutation({
  args: {
    title: v.string(),
    filename: v.string(),
    filepath: v.string(),
    mimeType: v.string(),
    extension: v.string(),
    mediaType: mediaTypeValidator,
    size: v.number(),
    duration: v.optional(v.number()),
    thumbnail: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
    customCover: v.optional(v.string()),
    // External metadata
    externalId: v.optional(v.string()),
    externalSource: v.optional(v.string()),
    description: v.optional(v.string()),
    year: v.optional(v.number()),
    genre: v.optional(v.string()),
    artist: v.optional(v.string()),
    album: v.optional(v.string()),
    // OCR text for search
    ocrText: v.optional(v.string()),
    // OCR attempted flag
    ocrAttempted: v.optional(v.boolean()),
    // Tags
    tags: v.optional(v.array(v.id("tags"))),
    // File hash for duplicate detection
    fileHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const mediaId = await ctx.db.insert("media", {
      title: args.title,
      filename: args.filename,
      filepath: args.filepath,
      mimeType: args.mimeType,
      extension: args.extension,
      mediaType: args.mediaType,
      size: args.size,
      duration: args.duration,
      thumbnail: args.thumbnail,
      coverUrl: args.coverUrl,
      customCover: args.customCover,
      r2BackedUp: false,
      // External metadata
      externalId: args.externalId,
      externalSource: args.externalSource,
      description: args.description,
      year: args.year,
      genre: args.genre,
      artist: args.artist,
      album: args.album,
      metadataFetchedAt: args.externalId ? now : undefined,
      // OCR text
      ocrText: args.ocrText,
      // OCR attempted flag
      ocrAttempted: args.ocrAttempted,
      // Tags
      tags: args.tags,
      // File hash
      fileHash: args.fileHash,
      // Timestamps
      createdAt: now,
      updatedAt: now,
    });
    
    return mediaId;
  },
});

/**
 * Update media information
 * 
 * Usage: Called when editing media details or after processing
 * Returns: Nothing (void)
 */
export const update = mutation({
  args: {
    id: v.id("media"),
    title: v.optional(v.string()),
    duration: v.optional(v.number()),
    thumbnail: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
    customCover: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    r2BackedUp: v.optional(v.boolean()),
    // External metadata
    externalId: v.optional(v.string()),
    externalSource: v.optional(v.string()),
    description: v.optional(v.string()),
    year: v.optional(v.number()),
    genre: v.optional(v.string()),
    artist: v.optional(v.string()),
    album: v.optional(v.string()),
    metadataFetchedAt: v.optional(v.number()),
    // OCR text for search
    ocrText: v.optional(v.string()),
    // OCR attempted flag (prevents re-scanning failed files)
    ocrAttempted: v.optional(v.boolean()),
    // Tags
    tags: v.optional(v.array(v.id("tags"))),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    
    // Only include fields that were actually provided
    const fieldsToUpdate: Record<string, unknown> = {
      updatedAt: Date.now(),
    };
    
    if (updates.title !== undefined) fieldsToUpdate.title = updates.title;
    if (updates.duration !== undefined) fieldsToUpdate.duration = updates.duration;
    if (updates.thumbnail !== undefined) fieldsToUpdate.thumbnail = updates.thumbnail;
    if (updates.coverUrl !== undefined) fieldsToUpdate.coverUrl = updates.coverUrl;
    if (updates.customCover !== undefined) fieldsToUpdate.customCover = updates.customCover;
    if (updates.r2Key !== undefined) fieldsToUpdate.r2Key = updates.r2Key;
    if (updates.r2BackedUp !== undefined) fieldsToUpdate.r2BackedUp = updates.r2BackedUp;
    // External metadata
    if (updates.externalId !== undefined) fieldsToUpdate.externalId = updates.externalId;
    if (updates.externalSource !== undefined) fieldsToUpdate.externalSource = updates.externalSource;
    if (updates.description !== undefined) fieldsToUpdate.description = updates.description;
    if (updates.year !== undefined) fieldsToUpdate.year = updates.year;
    if (updates.genre !== undefined) fieldsToUpdate.genre = updates.genre;
    if (updates.artist !== undefined) fieldsToUpdate.artist = updates.artist;
    if (updates.album !== undefined) fieldsToUpdate.album = updates.album;
    if (updates.metadataFetchedAt !== undefined) fieldsToUpdate.metadataFetchedAt = updates.metadataFetchedAt;
    // OCR text
    if (updates.ocrText !== undefined) fieldsToUpdate.ocrText = updates.ocrText;
    // OCR attempted flag
    if (updates.ocrAttempted !== undefined) fieldsToUpdate.ocrAttempted = updates.ocrAttempted;
    // Tags
    if (updates.tags !== undefined) fieldsToUpdate.tags = updates.tags;
    
    await ctx.db.patch(id, fieldsToUpdate);
  },
});

/**
 * Update tags for a media file
 *
 * Usage: Called when adding/removing tags from media
 */
export const updateTags = mutation({
  args: {
    id: v.id("media"),
    tags: v.array(v.id("tags")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      tags: args.tags.length > 0 ? args.tags : undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Add a tag to a media file
 */
export const addTag = mutation({
  args: {
    id: v.id("media"),
    tagId: v.id("tags"),
  },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.id);
    if (!media) throw new Error("Media not found");
    
    const currentTags = media.tags || [];
    if (!currentTags.includes(args.tagId)) {
      await ctx.db.patch(args.id, {
        tags: [...currentTags, args.tagId],
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Remove a tag from a media file
 */
export const removeTag = mutation({
  args: {
    id: v.id("media"),
    tagId: v.id("tags"),
  },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.id);
    if (!media) throw new Error("Media not found");
    
    const currentTags = media.tags || [];
    const newTags = currentTags.filter((t) => t !== args.tagId);
    
    await ctx.db.patch(args.id, {
      tags: newTags.length > 0 ? newTags : undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * List media filtered by tag with full filtering and sorting support
 *
 * Usage: Filter media browser by tag
 */
export const listByTag = query({
  args: {
    tagId: v.id("tags"),
    mediaType: v.optional(mediaTypeValidator),
    extension: v.optional(v.string()),
    sortField: v.optional(sortFieldValidator),
    sortDirection: v.optional(sortDirectionValidator),
  },
  handler: async (ctx, args) => {
    const allMedia = await ctx.db.query("media").collect();
    
    // Filter by tag
    let results = allMedia.filter((m) => m.tags && m.tags.includes(args.tagId));
    
    // Filter by media type if specified
    if (args.mediaType) {
      results = results.filter((m) => m.mediaType === args.mediaType);
    }
    
    // Filter by extension if specified
    if (args.extension) {
      const ext = args.extension.toLowerCase().replace(/^\./, "");
      results = results.filter((m) => m.extension?.toLowerCase() === ext);
    }
    
    // Filter out thumbnail files
    results = results.filter((m) => !m.filename.endsWith("_thumb.jpg"));
    
    // Apply sorting
    const sortField = args.sortField || "createdAt";
    const sortDirection = args.sortDirection || "desc";
    
    results.sort((a, b) => {
      let aVal: any;
      let bVal: any;
      
      switch (sortField) {
        case "title":
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case "size":
          aVal = a.size;
          bVal = b.size;
          break;
        case "duration":
          aVal = a.duration || 0;
          bVal = b.duration || 0;
          break;
        case "year":
          aVal = a.year || 0;
          bVal = b.year || 0;
          break;
        case "createdAt":
        default:
          aVal = a.createdAt;
          bVal = b.createdAt;
          break;
      }
      
      if (sortDirection === "asc") {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
    
    return results;
  },
});

/**
 * Check for duplicate file by hash
 *
 * Usage: Called before uploading to detect duplicates
 */
export const checkDuplicate = query({
  args: {
    fileHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("media")
      .withIndex("by_file_hash", (q) => q.eq("fileHash", args.fileHash))
      .first();
    
    return existing ? { isDuplicate: true, existingMedia: existing } : { isDuplicate: false };
  },
});

/**
 * Check for duplicate file by filename
 *
 * Usage: Called before uploading to detect duplicates
 */
export const checkDuplicateByFilename = query({
  args: {
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("media")
      .withIndex("by_filename", (q) => q.eq("filename", args.filename))
      .first();
    
    return existing ? { isDuplicate: true, existingMedia: existing } : { isDuplicate: false };
  },
});

/**
 * Delete a media file from the library
 * 
 * Usage: Called when removing a video from the library
 * Returns: Nothing (void)
 * 
 * Note: This only removes the database record. The actual file
 * on disk and any R2 backup should be handled separately.
 */
export const remove = mutation({
  args: { id: v.id("media") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/**
 * Get media files that haven't been backed up to R2
 * 
 * Usage: Called by the backup job to find files needing backup
 * Returns: Array of media objects without R2 backup
 */
export const getUnbackedUp = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("media")
      .withIndex("by_backup_status", (q) => q.eq("r2BackedUp", false))
      .collect();
  },
});

/**
 * Get media files without external metadata
 * 
 * Usage: Called to find files that need metadata fetching
 * Returns: Array of media objects without external metadata
 */
export const getWithoutMetadata = query({
  args: {
    mediaType: v.optional(mediaTypeValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("media").collect();
    
    // Filter to items without external metadata
    results = results.filter((m) => !m.externalId);
    
    // Filter by media type if specified
    if (args.mediaType) {
      results = results.filter((m) => m.mediaType === args.mediaType);
    }
    
    // Apply limit
    if (args.limit && args.limit > 0) {
      results = results.slice(0, args.limit);
    }
    
    return results;
  },
});

/**
 * Get media files without OCR text that haven't been attempted yet
 * 
 * Usage: Called to find files that need OCR processing
 * Returns: Array of media objects that support OCR but haven't been attempted
 */
export const getWithoutOCR = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("media").collect();
    
    // Filter to items that support OCR (image, gif, video) and haven't been attempted
    results = results.filter((m) => 
      (m.mediaType === "image" || m.mediaType === "gif" || m.mediaType === "video") &&
      !m.ocrAttempted
    );
    
    // Apply limit
    if (args.limit && args.limit > 0) {
      results = results.slice(0, args.limit);
    }
    
    return results;
  },
});

/**
 * Get OCR statistics
 * 
 * Usage: Display OCR status in admin dashboard
 * Returns: Object with OCR processing stats
 */
export const getOCRStats = query({
  args: {},
  handler: async (ctx) => {
    const allMedia = await ctx.db.query("media").collect();
    
    // Count media that supports OCR
    const ocrSupportedTypes = ["image", "gif", "video"];
    const ocrSupported = allMedia.filter((m) => ocrSupportedTypes.includes(m.mediaType));
    const withOCR = ocrSupported.filter((m) => m.ocrText);
    const attempted = ocrSupported.filter((m) => m.ocrAttempted);
    const pending = ocrSupported.filter((m) => !m.ocrAttempted);
    
    return {
      totalSupported: ocrSupported.length,
      withOCR: withOCR.length,
      attempted: attempted.length,
      pending: pending.length,
      // withoutOCR is now "pending" - files not yet attempted
      withoutOCR: pending.length,
      percentage: ocrSupported.length > 0
        ? Math.round((attempted.length / ocrSupported.length) * 100)
        : 100,
    };
  },
});

/**
 * Get media files where OCR was attempted but failed (no text extracted)
 * 
 * Usage: Find files that might need OCR retry
 * Returns: Array of media IDs that failed OCR
 */
export const getFailedOCR = query({
  args: {},
  handler: async (ctx) => {
    const allMedia = await ctx.db.query("media").collect();
    
    // Files where OCR was attempted but resulted in no text (empty string or undefined)
    const ocrSupportedTypes = ["image", "gif", "video"];
    const failed = allMedia.filter((m) => 
      ocrSupportedTypes.includes(m.mediaType) &&
      m.ocrAttempted === true &&
      (!m.ocrText || m.ocrText.trim() === "")
    );
    
    return {
      count: failed.length,
      mediaIds: failed.map((m) => m._id),
    };
  },
});

/**
 * Reset OCR attempted flag for specific media files
 * 
 * Usage: Called to allow re-scanning of files that failed or need re-processing
 * Args: mediaIds - array of media IDs to reset, or empty to reset all
 */
export const resetOcrAttempted = mutation({
  args: {
    mediaIds: v.optional(v.array(v.id("media"))),
  },
  handler: async (ctx, args) => {
    if (args.mediaIds && args.mediaIds.length > 0) {
      // Reset specific files
      for (const id of args.mediaIds) {
        await ctx.db.patch(id, { 
          ocrAttempted: false,
          ocrText: undefined,
          updatedAt: Date.now(),
        });
      }
      return { reset: args.mediaIds.length };
    } else {
      // Reset all files
      const allMedia = await ctx.db.query("media").collect();
      const ocrSupportedTypes = ["image", "gif", "video"];
      const ocrSupported = allMedia.filter((m) => ocrSupportedTypes.includes(m.mediaType));
      
      for (const media of ocrSupported) {
        await ctx.db.patch(media._id, { 
          ocrAttempted: false,
          ocrText: undefined,
          updatedAt: Date.now(),
        });
      }
      return { reset: ocrSupported.length };
    }
  },
});

/**
 * Get media files with WebP or WebM extensions that need conversion
 * 
 * Usage: Called by admin route to find files needing format conversion
 * Returns: Array of media objects with .webp or .webm extensions
 */
export const getWebPWebMFiles = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const allMedia = await ctx.db.query("media").collect();
    
    // Filter to WebP and WebM files
    let results = allMedia.filter((m) => {
      const ext = m.extension?.toLowerCase();
      return ext === "webp" || ext === "webm";
    });
    
    // Apply limit
    if (args.limit && args.limit > 0) {
      results = results.slice(0, args.limit);
    }
    
    return results;
  },
});

/**
 * Update media file info after format conversion
 * 
 * Usage: Called after converting WebP/WebM files to update all file-related fields
 * Returns: Nothing (void)
 */
export const updateFileInfo = mutation({
  args: {
    id: v.id("media"),
    filename: v.string(),
    filepath: v.string(),
    mimeType: v.string(),
    extension: v.string(),
    mediaType: mediaTypeValidator,
    size: v.number(),
    fileHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    
    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get library statistics
 * 
 * Usage: Display on the admin dashboard
 * Returns: Object with total count, size, and backup status
 */
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const allMedia = await ctx.db.query("media").collect();
    
    const totalCount = allMedia.length;
    const totalSize = allMedia.reduce((sum, m) => sum + m.size, 0);
    const backedUpCount = allMedia.filter((m) => m.r2BackedUp).length;
    const totalDuration = allMedia.reduce((sum, m) => sum + (m.duration || 0), 0);
    
    // Count by media type
    const byType: Record<string, number> = {};
    for (const m of allMedia) {
      const type = m.mediaType || "other";
      byType[type] = (byType[type] || 0) + 1;
    }
    
    return {
      totalCount,
      totalSize,
      backedUpCount,
      totalDuration,
      byType,
      // Calculate percentage backed up
      backupPercentage: totalCount > 0 
        ? Math.round((backedUpCount / totalCount) * 100) 
        : 0,
    };
  },
});
