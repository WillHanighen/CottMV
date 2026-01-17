/**
 * Transcoded Cache Functions
 * ==========================
 * 
 * This file manages the database records for transcoded video files.
 * When a video is transcoded for streaming, we cache the result to
 * avoid re-transcoding the same video repeatedly.
 * 
 * The cache has:
 * - A maximum size limit (configurable in settings)
 * - A TTL (time-to-live) after which entries expire
 * - Automatic cleanup of expired entries
 * 
 * This is separate from the actual file management - these functions
 * only handle the database records. The actual file deletion is
 * handled by the cleanup script.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get a cached transcoded version of a media file
 * 
 * Usage: Check if we already have a transcoded version before transcoding
 * Returns: The cache entry if found, null otherwise
 */
export const get = query({
  args: {
    mediaId: v.id("media"),
    format: v.string(),
    resolution: v.string(),
  },
  handler: async (ctx, args) => {
    const cacheEntry = await ctx.db
      .query("transcodedCache")
      .withIndex("by_media", (q) => q.eq("mediaId", args.mediaId))
      .filter((q) =>
        q.and(
          q.eq(q.field("format"), args.format),
          q.eq(q.field("resolution"), args.resolution)
        )
      )
      .first();
    
    // Check if the entry exists and hasn't expired
    if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
      return cacheEntry;
    }
    
    return null;
  },
});

/**
 * Create a new cache entry for a transcoded file
 * 
 * Usage: Called after successfully transcoding a video
 * Returns: The ID of the new cache entry
 */
export const create = mutation({
  args: {
    mediaId: v.id("media"),
    transcodedPath: v.string(),
    format: v.string(),
    resolution: v.string(),
    size: v.number(),
    ttlHours: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = now + args.ttlHours * 60 * 60 * 1000; // Convert hours to ms
    
    const cacheId = await ctx.db.insert("transcodedCache", {
      mediaId: args.mediaId,
      transcodedPath: args.transcodedPath,
      format: args.format,
      resolution: args.resolution,
      size: args.size,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt,
    });
    
    return cacheId;
  },
});

/**
 * Update the last accessed time for a cache entry
 * 
 * Usage: Called when a cached file is streamed
 * This helps with LRU (Least Recently Used) cleanup strategies
 */
export const touch = mutation({
  args: { id: v.id("transcodedCache") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      lastAccessedAt: Date.now(),
    });
  },
});

/**
 * Extend the expiry time of a cache entry
 * 
 * Usage: Called when a cached file is accessed to keep it alive longer
 */
export const extendExpiry = mutation({
  args: {
    id: v.id("transcodedCache"),
    ttlHours: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.id, {
      lastAccessedAt: now,
      expiresAt: now + args.ttlHours * 60 * 60 * 1000,
    });
  },
});

/**
 * Get all expired cache entries
 * 
 * Usage: Called by the cleanup job to find entries to delete
 * Returns: Array of expired cache entries
 */
export const getExpired = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    
    return await ctx.db
      .query("transcodedCache")
      .withIndex("by_expiry")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();
  },
});

/**
 * Delete a cache entry
 * 
 * Usage: Called after the actual file has been deleted
 */
export const remove = mutation({
  args: { id: v.id("transcodedCache") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/**
 * Delete multiple cache entries
 * 
 * Usage: Batch delete for cleanup operations
 */
export const removeMany = mutation({
  args: { ids: v.array(v.id("transcodedCache")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
  },
});

/**
 * Get all cache entries for a specific media file
 * 
 * Usage: Find all transcoded versions when deleting a media file
 */
export const getByMedia = query({
  args: { mediaId: v.id("media") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transcodedCache")
      .withIndex("by_media", (q) => q.eq("mediaId", args.mediaId))
      .collect();
  },
});

/**
 * Get cache statistics
 * 
 * Usage: Display on the admin dashboard
 * Returns: Object with cache stats
 */
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const allEntries = await ctx.db.query("transcodedCache").collect();
    const now = Date.now();
    
    const totalEntries = allEntries.length;
    const totalSize = allEntries.reduce((sum, e) => sum + e.size, 0);
    const expiredCount = allEntries.filter((e) => e.expiresAt < now).length;
    
    // Find oldest and newest entries
    let oldestAccess = now;
    let newestAccess = 0;
    
    for (const entry of allEntries) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
      }
      if (entry.lastAccessedAt > newestAccess) {
        newestAccess = entry.lastAccessedAt;
      }
    }
    
    return {
      totalEntries,
      totalSizeBytes: totalSize,
      totalSizeGb: Math.round((totalSize / (1024 * 1024 * 1024)) * 100) / 100,
      expiredCount,
      activeCount: totalEntries - expiredCount,
      oldestAccessAt: totalEntries > 0 ? oldestAccess : null,
      newestAccessAt: totalEntries > 0 ? newestAccess : null,
    };
  },
});

/**
 * Get entries to delete based on size limit
 * 
 * Usage: When cache exceeds max size, find entries to delete (LRU)
 * Returns: Array of cache entries to delete, sorted by last access (oldest first)
 */
export const getEntriesForSizeCleanup = query({
  args: { 
    maxSizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const allEntries = await ctx.db.query("transcodedCache").collect();
    
    // Sort by last accessed time (oldest first)
    allEntries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    
    // Calculate current total size
    let currentSize = allEntries.reduce((sum, e) => sum + e.size, 0);
    
    // Find entries to delete until we're under the limit
    const toDelete: typeof allEntries = [];
    
    for (const entry of allEntries) {
      if (currentSize <= args.maxSizeBytes) {
        break;
      }
      toDelete.push(entry);
      currentSize -= entry.size;
    }
    
    return toDelete;
  },
});
