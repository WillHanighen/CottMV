/**
 * Admin API Routes
 * ================
 * 
 * This file contains all the API endpoints for administration.
 * These endpoints handle:
 * - Settings management (R2, cache, system preferences)
 * - Cache cleanup operations
 * - R2 backup operations
 * - System statistics
 * 
 * All endpoints return JSON responses.
 */

import { Hono } from "hono";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { runCleanup, getCacheStats, formatBytes } from "../../media/cleanup.js";
import { R2Storage, createR2Client, generateR2Key } from "../../storage/r2.js";
import { existsSync, statSync } from "fs";
import { expandPath } from "../../storage/local.js";

/**
 * Helper function to format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Upload a file to R2 with retry logic
 */
async function uploadWithRetry(
  r2: R2Storage,
  filepath: string,
  r2Key: string,
  mimeType: string | undefined,
  maxRetries: number = 3
): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[R2 Backup] Upload attempt ${attempt}/${maxRetries}...`);
      await r2.uploadFile(filepath, r2Key, mimeType);
      return; // Success
    } catch (err) {
      lastError = err as Error;
      console.error(`[R2 Backup] Upload attempt ${attempt} failed:`, err);
      
      if (attempt < maxRetries) {
        // Wait before retrying (exponential backoff: 2s, 4s, 8s...)
        const waitMs = Math.pow(2, attempt) * 1000;
        console.log(`[R2 Backup] Waiting ${waitMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }
  
  throw lastError;
}

/**
 * Create the admin routes
 */
export const adminRoutes = new Hono();

/**
 * GET /api/admin/settings
 * 
 * Get all application settings.
 * 
 * Response: Object with all settings
 */
adminRoutes.get("/settings", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const settings = await convex.query(api.settings.getAll, {});
    
    // Mask sensitive values
    const maskedSettings = { ...settings };
    if (maskedSettings.r2_secret_access_key?.value) {
      maskedSettings.r2_secret_access_key = {
        ...maskedSettings.r2_secret_access_key,
        value: "••••••••",
      };
    }
    
    return c.json({
      success: true,
      data: maskedSettings,
    });
  } catch (error) {
    console.error("Error getting settings:", error);
    return c.json({
      success: false,
      error: "Failed to get settings",
    }, 500);
  }
});

/**
 * PUT /api/admin/settings
 * 
 * Update multiple settings at once.
 * 
 * Request Body:
 * - settings: Array of { key, value } objects
 * 
 * Response: Success status
 */
adminRoutes.put("/settings", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const body = await c.req.json();
    
    if (!body.settings || !Array.isArray(body.settings)) {
      return c.json({
        success: false,
        error: "settings array is required",
      }, 400);
    }
    
    await convex.mutation(api.settings.setMultiple, {
      settings: body.settings,
    });
    
    return c.json({
      success: true,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    return c.json({
      success: false,
      error: "Failed to update settings",
    }, 500);
  }
});

/**
 * PUT /api/admin/settings/:key
 * 
 * Update a single setting.
 * 
 * Parameters:
 * - key: The setting key
 * 
 * Request Body:
 * - value: The new value
 * 
 * Response: Success status
 */
adminRoutes.put("/settings/:key", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const key = c.req.param("key");
    const body = await c.req.json();
    
    if (body.value === undefined) {
      return c.json({
        success: false,
        error: "value is required",
      }, 400);
    }
    
    await convex.mutation(api.settings.set, {
      key,
      value: String(body.value),
    });
    
    return c.json({
      success: true,
    });
  } catch (error) {
    console.error("Error updating setting:", error);
    return c.json({
      success: false,
      error: "Failed to update setting",
    }, 500);
  }
});

/**
 * POST /api/admin/settings/initialize
 * 
 * Initialize default settings.
 * Called on first run or to reset to defaults.
 * 
 * Response: Number of settings initialized
 */
adminRoutes.post("/settings/initialize", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const count = await convex.mutation(api.settings.initializeDefaults, {});
    
    return c.json({
      success: true,
      data: { initialized: count },
    });
  } catch (error) {
    console.error("Error initializing settings:", error);
    return c.json({
      success: false,
      error: "Failed to initialize settings",
    }, 500);
  }
});

/**
 * GET /api/admin/cache/stats
 * 
 * Get cache statistics.
 * 
 * Response: Cache statistics object
 */
adminRoutes.get("/cache/stats", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    // Get cache config
    const cacheConfig = await convex.query(api.settings.getCacheConfig, {});
    
    // Get database cache stats
    const dbStats = await convex.query(api.cache.getStats, {});
    
    // Get filesystem cache stats (expand ~ to actual home directory)
    const fsStats = await getCacheStats(expandPath(cacheConfig.directory || "~/.CottMV/cache"));
    
    return c.json({
      success: true,
      data: {
        database: dbStats,
        filesystem: {
          ...fsStats,
          totalSizeFormatted: formatBytes(fsStats.totalSizeBytes),
        },
        config: {
          maxSizeGb: cacheConfig.maxSizeGb,
          ttlHours: cacheConfig.ttlHours,
          directory: cacheConfig.directory,
        },
      },
    });
  } catch (error) {
    console.error("Error getting cache stats:", error);
    return c.json({
      success: false,
      error: "Failed to get cache statistics",
    }, 500);
  }
});

/**
 * POST /api/admin/cache/cleanup
 * 
 * Run cache cleanup.
 * Deletes expired files and enforces size limits.
 * 
 * Response: Cleanup results
 */
adminRoutes.post("/cache/cleanup", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    // Get cache config
    const cacheConfig = await convex.query(api.settings.getCacheConfig, {});
    
    // Run filesystem cleanup (expand ~ to actual home directory)
    const result = await runCleanup({
      cacheDirectory: expandPath(cacheConfig.directory || "~/.CottMV/cache"),
      maxSizeBytes: (cacheConfig.maxSizeGb || 10) * 1024 * 1024 * 1024,
      ttlMs: (cacheConfig.ttlHours || 24) * 60 * 60 * 1000,
    });
    
    // Clean up database entries for deleted files
    const expiredEntries = await convex.query(api.cache.getExpired, {});
    if (expiredEntries.length > 0) {
      await convex.mutation(api.cache.removeMany, {
        ids: expiredEntries.map((e: any) => e._id),
      });
    }
    
    return c.json({
      success: true,
      data: {
        filesDeleted: result.filesDeleted,
        bytesFreed: result.bytesFreed,
        bytesFreedFormatted: formatBytes(result.bytesFreed),
        expiredFiles: result.expiredFiles.length,
        lruFiles: result.lruFiles.length,
        databaseEntriesCleaned: expiredEntries.length,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error("Error running cache cleanup:", error);
    return c.json({
      success: false,
      error: "Failed to run cache cleanup",
    }, 500);
  }
});

/**
 * GET /api/admin/r2/status
 * 
 * Check R2 connection status.
 * 
 * Response: R2 status and statistics
 */
adminRoutes.get("/r2/status", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    // Get R2 config
    const r2Config = await convex.query(api.settings.getR2Config, {});
    
    if (!r2Config.enabled) {
      return c.json({
        success: true,
        data: {
          enabled: false,
          connected: false,
          message: "R2 backup is disabled",
        },
      });
    }
    
    // Try to create R2 client
    const r2 = createR2Client(r2Config);
    
    if (!r2) {
      return c.json({
        success: true,
        data: {
          enabled: true,
          connected: false,
          message: "R2 credentials are incomplete",
        },
      });
    }
    
    // Try to get stats to verify connection
    try {
      const stats = await r2.getStats();
      
      return c.json({
        success: true,
        data: {
          enabled: true,
          connected: true,
          stats: {
            totalFiles: stats.totalFiles,
            totalSizeGb: stats.totalSizeGb,
            totalSizeFormatted: formatBytes(stats.totalSizeBytes),
          },
        },
      });
    } catch (err) {
      return c.json({
        success: true,
        data: {
          enabled: true,
          connected: false,
          message: "Failed to connect to R2",
          error: String(err),
        },
      });
    }
  } catch (error) {
    console.error("Error checking R2 status:", error);
    return c.json({
      success: false,
      error: "Failed to check R2 status",
    }, 500);
  }
});

/**
 * POST /api/admin/r2/backup
 * 
 * Start backup of unbacked-up media to R2.
 * 
 * Response: Backup results
 */
adminRoutes.post("/r2/backup", async (c) => {
  console.log("[R2 Backup] Starting backup request...");
  
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    console.log("[R2 Backup] Got Convex client");
    
    // Get R2 config
    console.log("[R2 Backup] Fetching R2 config...");
    let r2Config;
    try {
      r2Config = await convex.query(api.settings.getR2Config, {});
      console.log("[R2 Backup] R2 config retrieved:", {
        enabled: r2Config.enabled,
        hasAccessKeyId: !!r2Config.accessKeyId,
        hasSecretAccessKey: !!r2Config.secretAccessKey,
        hasBucketName: !!r2Config.bucketName,
        hasEndpoint: !!r2Config.endpoint,
        endpoint: r2Config.endpoint ? r2Config.endpoint.substring(0, 30) + "..." : "(empty)",
      });
    } catch (configErr) {
      console.error("[R2 Backup] Failed to fetch R2 config:", configErr);
      return c.json({
        success: false,
        error: `Failed to fetch R2 config: ${configErr}`,
      }, 500);
    }
    
    if (!r2Config.enabled) {
      console.log("[R2 Backup] R2 is disabled in settings");
      return c.json({
        success: false,
        error: "R2 backup is disabled. Enable it in settings first.",
      }, 400);
    }
    
    console.log("[R2 Backup] Creating R2 client...");
    const r2 = createR2Client(r2Config);
    
    if (!r2) {
      console.log("[R2 Backup] Failed to create R2 client - credentials incomplete");
      return c.json({
        success: false,
        error: "R2 credentials are incomplete. Please configure all R2 settings.",
      }, 400);
    }
    console.log("[R2 Backup] R2 client created successfully");
    
    // Get unbacked-up media
    console.log("[R2 Backup] Fetching unbacked-up media...");
    let unbackedUp;
    try {
      unbackedUp = await convex.query(api.media.getUnbackedUp, {});
      console.log(`[R2 Backup] Found ${unbackedUp.length} media files to backup`);
    } catch (queryErr) {
      console.error("[R2 Backup] Failed to fetch unbacked-up media:", queryErr);
      return c.json({
        success: false,
        error: `Failed to fetch media list: ${queryErr}`,
      }, 500);
    }
    
    if (unbackedUp.length === 0) {
      console.log("[R2 Backup] No files to backup - all media is already backed up");
      return c.json({
        success: true,
        data: {
          message: "All media is already backed up",
          backed: 0,
          failed: 0,
        },
      });
    }
    
    // Backup each file
    let backed = 0;
    let failed = 0;
    const errors: string[] = [];
    
    console.log(`[R2 Backup] Starting backup of ${unbackedUp.length} files...`);
    
    for (const media of unbackedUp) {
      // Expand ~ paths to absolute paths
      const filepath = expandPath(media.filepath);
      console.log(`[R2 Backup] Processing: ${media.title}`);
      console.log(`[R2 Backup]   Original path: ${media.filepath}`);
      console.log(`[R2 Backup]   Expanded path: ${filepath}`);
      
      try {
        // Check if file exists
        if (!existsSync(filepath)) {
          const errMsg = `File not found: ${filepath}`;
          console.log(`[R2 Backup] ${errMsg}`);
          errors.push(errMsg);
          failed++;
          continue;
        }
        
        // Get file size for logging
        let fileSize: number;
        try {
          fileSize = statSync(filepath).size;
          console.log(`[R2 Backup]   File size: ${formatFileSize(fileSize)}`);
        } catch {
          fileSize = 0;
        }
        
        // Generate R2 key using the utility function
        // Normalizes path separators and removes leading slashes
        const r2Key = generateR2Key(filepath, "media");
        console.log(`[R2 Backup]   R2 key: ${r2Key}`);
        
        // Upload to R2 with retry logic
        console.log(`[R2 Backup]   Uploading to R2...`);
        await uploadWithRetry(r2, filepath, r2Key, media.mimeType, 3);
        console.log(`[R2 Backup]   Upload complete`);
        
        // Update database
        console.log(`[R2 Backup]   Updating database...`);
        await convex.mutation(api.media.update, {
          id: media._id,
          r2Key,
          r2BackedUp: true,
        });
        console.log(`[R2 Backup]   Database updated`);
        
        backed++;
        console.log(`[R2 Backup] Successfully backed up: ${media.title} (${backed}/${unbackedUp.length})`);
      } catch (err) {
        const errMsg = `Failed to backup ${media.title}: ${err}`;
        console.error(`[R2 Backup] ${errMsg}`);
        errors.push(errMsg);
        failed++;
      }
    }
    
    console.log(`[R2 Backup] Backup complete. Backed: ${backed}, Failed: ${failed}`);
    
    return c.json({
      success: true,
      data: {
        backed,
        failed,
        total: unbackedUp.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("[R2 Backup] Unexpected error:", error);
    return c.json({
      success: false,
      error: `Failed to run R2 backup: ${error}`,
    }, 500);
  }
});

/**
 * GET /api/admin/stats
 * 
 * Get overall system statistics.
 * 
 * Response: System statistics object
 */
adminRoutes.get("/stats", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    // Get media stats
    const mediaStats = await convex.query(api.media.getStats, {});
    
    // Get cache stats
    const cacheStats = await convex.query(api.cache.getStats, {});
    
    // Get cache config
    const cacheConfig = await convex.query(api.settings.getCacheConfig, {});
    
    // Get R2 config
    const r2Config = await convex.query(api.settings.getR2Config, {});
    
    return c.json({
      success: true,
      data: {
        media: {
          totalCount: mediaStats.totalCount,
          totalSizeFormatted: formatBytes(mediaStats.totalSize),
          totalDurationHours: Math.round(mediaStats.totalDuration / 3600 * 10) / 10,
          backupPercentage: mediaStats.backupPercentage,
        },
        cache: {
          totalEntries: cacheStats.totalEntries,
          totalSizeFormatted: formatBytes(cacheStats.totalSizeBytes),
          activeCount: cacheStats.activeCount,
          expiredCount: cacheStats.expiredCount,
        },
        config: {
          cacheMaxSizeGb: cacheConfig.maxSizeGb,
          cacheTtlHours: cacheConfig.ttlHours,
          r2Enabled: r2Config.enabled,
        },
      },
    });
  } catch (error) {
    console.error("Error getting system stats:", error);
    return c.json({
      success: false,
      error: "Failed to get system statistics",
    }, 500);
  }
});

/**
 * POST /api/admin/r2/test
 * 
 * Test R2 connection with provided credentials.
 * Falls back to stored credentials for any missing fields.
 * 
 * Request Body:
 * - accessKeyId: R2 access key (optional, falls back to stored)
 * - secretAccessKey: R2 secret key (optional, falls back to stored)
 * - bucketName: R2 bucket name (optional, falls back to stored)
 * - endpoint: R2 endpoint URL (optional, falls back to stored)
 * 
 * Response: Connection test result
 */
adminRoutes.post("/r2/test", async (c) => {
  console.log("[R2 Test] Starting connection test...");
  
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const body = await c.req.json();
    
    // Get stored R2 config to use as fallback
    console.log("[R2 Test] Fetching stored R2 config...");
    const storedConfig = await convex.query(api.settings.getR2Config, {});
    console.log("[R2 Test] Stored config:", {
      hasAccessKeyId: !!storedConfig.accessKeyId,
      hasSecretAccessKey: !!storedConfig.secretAccessKey,
      hasBucketName: !!storedConfig.bucketName,
      hasEndpoint: !!storedConfig.endpoint,
    });
    
    // Use provided values or fall back to stored values
    const accessKeyId = body.accessKeyId || storedConfig.accessKeyId;
    const secretAccessKey = body.secretAccessKey || storedConfig.secretAccessKey;
    const bucketName = body.bucketName || storedConfig.bucketName;
    const endpoint = body.endpoint || storedConfig.endpoint;
    
    console.log("[R2 Test] Using credentials:", {
      accessKeyIdSource: body.accessKeyId ? "form" : "stored",
      secretAccessKeySource: body.secretAccessKey ? "form" : "stored",
      bucketNameSource: body.bucketName ? "form" : "stored",
      endpointSource: body.endpoint ? "form" : "stored",
      hasAllCredentials: !!(accessKeyId && secretAccessKey && bucketName && endpoint),
    });
    
    if (!accessKeyId || !secretAccessKey || !bucketName || !endpoint) {
      console.log("[R2 Test] Missing credentials:", {
        accessKeyId: !accessKeyId,
        secretAccessKey: !secretAccessKey,
        bucketName: !bucketName,
        endpoint: !endpoint,
      });
      return c.json({
        success: false,
        error: "All R2 credentials are required. Please fill in all fields and save settings first.",
      }, 400);
    }
    
    // Try to create client and list files
    try {
      console.log("[R2 Test] Creating R2 client...");
      const r2 = new R2Storage({
        accessKeyId,
        secretAccessKey,
        bucketName,
        endpoint,
      });
      
      // Try to list files (limited to 1) to verify connection
      console.log("[R2 Test] Testing connection by listing files...");
      await r2.listFiles(undefined, 1);
      
      console.log("[R2 Test] Connection successful!");
      return c.json({
        success: true,
        data: {
          connected: true,
          message: "Successfully connected to R2",
        },
      });
    } catch (err) {
      console.error("[R2 Test] Connection failed:", err);
      return c.json({
        success: true,
        data: {
          connected: false,
          message: "Failed to connect to R2",
          error: String(err),
        },
      });
    }
  } catch (error) {
    console.error("[R2 Test] Unexpected error:", error);
    return c.json({
      success: false,
      error: `Failed to test R2 connection: ${error}`,
    }, 500);
  }
});
