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
import { existsSync } from "fs";
import { expandPath } from "../../storage/local.js";

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
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    // Get R2 config
    const r2Config = await convex.query(api.settings.getR2Config, {});
    
    if (!r2Config.enabled) {
      return c.json({
        success: false,
        error: "R2 backup is disabled",
      }, 400);
    }
    
    const r2 = createR2Client(r2Config);
    
    if (!r2) {
      return c.json({
        success: false,
        error: "R2 credentials are incomplete",
      }, 400);
    }
    
    // Get unbacked-up media
    const unbackedUp = await convex.query(api.media.getUnbackedUp, {});
    
    if (unbackedUp.length === 0) {
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
    
    for (const media of unbackedUp) {
      try {
        // Check if file exists
        if (!existsSync(media.filepath)) {
          errors.push(`File not found: ${media.filepath}`);
          failed++;
          continue;
        }
        
        // Generate R2 key
        const r2Key = generateR2Key(media.filepath, "media");
        
        // Upload to R2
        await r2.uploadFile(media.filepath, r2Key, media.mimeType);
        
        // Update database
        await convex.mutation(api.media.update, {
          id: media._id,
          r2Key,
          r2BackedUp: true,
        });
        
        backed++;
      } catch (err) {
        errors.push(`Failed to backup ${media.title}: ${err}`);
        failed++;
      }
    }
    
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
    console.error("Error running R2 backup:", error);
    return c.json({
      success: false,
      error: "Failed to run R2 backup",
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
 * 
 * Request Body:
 * - accessKeyId: R2 access key
 * - secretAccessKey: R2 secret key
 * - bucketName: R2 bucket name
 * - endpoint: R2 endpoint URL
 * 
 * Response: Connection test result
 */
adminRoutes.post("/r2/test", async (c) => {
  try {
    const body = await c.req.json();
    
    const { accessKeyId, secretAccessKey, bucketName, endpoint } = body;
    
    if (!accessKeyId || !secretAccessKey || !bucketName || !endpoint) {
      return c.json({
        success: false,
        error: "All R2 credentials are required",
      }, 400);
    }
    
    // Try to create client and list files
    try {
      const r2 = new R2Storage({
        accessKeyId,
        secretAccessKey,
        bucketName,
        endpoint,
      });
      
      // Try to list files (limited to 1) to verify connection
      await r2.listFiles(undefined, 1);
      
      return c.json({
        success: true,
        data: {
          connected: true,
          message: "Successfully connected to R2",
        },
      });
    } catch (err) {
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
    console.error("Error testing R2 connection:", error);
    return c.json({
      success: false,
      error: "Failed to test R2 connection",
    }, 500);
  }
});
