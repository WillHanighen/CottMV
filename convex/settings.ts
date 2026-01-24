/**
 * Settings Functions
 * ==================
 * 
 * This file handles all application settings stored in the database.
 * Settings are stored as key-value pairs, making it easy to add new
 * configuration options without changing the database schema.
 * 
 * Common settings include:
 * - R2 storage credentials
 * - Cache configuration
 * - Media directory paths
 * - System preferences
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Default settings that will be created if they don't exist
 * These provide sensible defaults for a new installation
 */
const DEFAULT_SETTINGS: Record<string, { value: string; description: string }> = {
  // R2 Storage Settings
  r2_access_key_id: {
    value: "",
    description: "Cloudflare R2 Access Key ID",
  },
  r2_secret_access_key: {
    value: "",
    description: "Cloudflare R2 Secret Access Key (stored securely)",
  },
  r2_bucket_name: {
    value: "",
    description: "Name of your R2 bucket for media backup",
  },
  r2_endpoint: {
    value: "",
    description: "R2 endpoint URL (e.g., https://xxx.r2.cloudflarestorage.com)",
  },
  r2_enabled: {
    value: "false",
    description: "Enable automatic backup to R2",
  },
  
  // Cache Settings
  cache_max_size_gb: {
    value: "10",
    description: "Maximum size of transcoded video cache in GB",
  },
  cache_ttl_hours: {
    value: "24",
    description: "How long to keep transcoded files before cleanup (hours)",
  },
  cache_directory: {
    value: "~/.CottMV/cache",
    description: "Directory for storing transcoded video cache",
  },
  
  // Media Settings
  media_directory: {
    value: "~/.CottMV",
    description: "Directory to scan for media files",
  },
  thumbnail_directory: {
    value: "~/.CottMV/thumbnails",
    description: "Directory for storing generated thumbnails",
  },
  
  // Transcoding Settings
  default_video_quality: {
    value: "720p",
    description: "Default video quality for transcoding (480p, 720p, 1080p)",
  },
  transcode_format: {
    value: "mp4",
    description: "Output format for transcoded videos (mp4, webm)",
  },
  
  // Metadata Settings
  tmdb_api_key: {
    value: "",
    description: "TheMovieDB API key for fetching movie and TV show metadata",
  },
  
  // System Settings
  app_name: {
    value: "CottMV",
    description: "Application name displayed in the UI",
  },
  items_per_page: {
    value: "24",
    description: "Number of items to show per page in the library",
  },
};

/**
 * Get a single setting by key
 * 
 * Usage: Get a specific configuration value
 * Returns: The setting value as a string, or the default if not set
 */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    
    // Return the stored value, or the default if not found
    if (setting) {
      return setting.value;
    }
    
    // Check if there's a default value
    const defaultSetting = DEFAULT_SETTINGS[args.key];
    return defaultSetting?.value ?? null;
  },
});

/**
 * Get all settings
 * 
 * Usage: Load all settings for the admin panel
 * Returns: Object with all settings as key-value pairs
 */
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const storedSettings = await ctx.db.query("settings").collect();
    
    // Start with defaults
    const result: Record<string, { value: string; description: string }> = {
      ...DEFAULT_SETTINGS,
    };
    
    // Override with stored values
    for (const setting of storedSettings) {
      result[setting.key] = {
        value: setting.value,
        description: setting.description || DEFAULT_SETTINGS[setting.key]?.description || "",
      };
    }
    
    return result;
  },
});

/**
 * Get multiple settings at once
 * 
 * Usage: Efficiently fetch several related settings
 * Returns: Object with requested settings
 */
export const getMultiple = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const result: Record<string, string | null> = {};
    
    for (const key of args.keys) {
      const setting = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      
      if (setting) {
        result[key] = setting.value;
      } else {
        result[key] = DEFAULT_SETTINGS[key]?.value ?? null;
      }
    }
    
    return result;
  },
});

/**
 * Set a single setting
 * 
 * Usage: Update a configuration value from the admin panel
 * Returns: Nothing (void)
 */
export const set = mutation({
  args: {
    key: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    
    if (existing) {
      // Update existing setting
      await ctx.db.patch(existing._id, {
        value: args.value,
        description: args.description ?? existing.description,
        updatedAt: Date.now(),
      });
    } else {
      // Create new setting
      await ctx.db.insert("settings", {
        key: args.key,
        value: args.value,
        description: args.description ?? DEFAULT_SETTINGS[args.key]?.description,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Set multiple settings at once
 * 
 * Usage: Save all settings from the admin panel form
 * Returns: Nothing (void)
 */
export const setMultiple = mutation({
  args: {
    settings: v.array(
      v.object({
        key: v.string(),
        value: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const { key, value } of args.settings) {
      const existing = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      
      if (existing) {
        await ctx.db.patch(existing._id, {
          value,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("settings", {
          key,
          value,
          description: DEFAULT_SETTINGS[key]?.description,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

/**
 * Initialize default settings
 * 
 * Usage: Called on first run to set up default configuration
 * Returns: Number of settings initialized
 */
export const initializeDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    let initialized = 0;
    
    for (const [key, { value, description }] of Object.entries(DEFAULT_SETTINGS)) {
      const existing = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      
      if (!existing) {
        await ctx.db.insert("settings", {
          key,
          value,
          description,
          updatedAt: Date.now(),
        });
        initialized++;
      }
    }
    
    return initialized;
  },
});

/**
 * Get R2 configuration
 * 
 * Usage: Fetch all R2-related settings for the storage module
 * Returns: Object with R2 configuration
 */
export const getR2Config = query({
  args: {},
  handler: async (ctx) => {
    const keys = [
      "r2_access_key_id",
      "r2_secret_access_key",
      "r2_bucket_name",
      "r2_endpoint",
      "r2_enabled",
    ];
    
    const result: Record<string, string> = {};
    
    for (const key of keys) {
      const setting = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      
      result[key] = setting?.value ?? DEFAULT_SETTINGS[key]?.value ?? "";
    }
    
    return {
      accessKeyId: result.r2_access_key_id,
      secretAccessKey: result.r2_secret_access_key,
      bucketName: result.r2_bucket_name,
      endpoint: result.r2_endpoint,
      enabled: result.r2_enabled === "true",
    };
  },
});

/**
 * Get cache configuration
 * 
 * Usage: Fetch cache settings for the transcoding module
 * Returns: Object with cache configuration
 */
export const getCacheConfig = query({
  args: {},
  handler: async (ctx) => {
    const keys = ["cache_max_size_gb", "cache_ttl_hours", "cache_directory"];
    
    const result: Record<string, string> = {};
    
    for (const key of keys) {
      const setting = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      
      result[key] = setting?.value ?? DEFAULT_SETTINGS[key]?.value ?? "";
    }
    
    return {
      maxSizeGb: parseInt(result.cache_max_size_gb, 10),
      ttlHours: parseInt(result.cache_ttl_hours, 10),
      directory: result.cache_directory,
    };
  },
});
