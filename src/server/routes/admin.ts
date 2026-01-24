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
import { processMediaForOCR } from "../../media/ocr.js";
import { expandPath, saveFile, deleteFile, calculateBufferHash } from "../../storage/local.js";
import { convertWebP, convertWebMToMp4 } from "../../media/transcoder.js";
import { getMediaType, getMimeType, getBasename } from "../../media/utils.js";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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

/**
 * GET /api/admin/ocr/stats
 * 
 * Get OCR processing statistics.
 * 
 * Response: OCR stats object
 */
adminRoutes.get("/ocr/stats", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const stats = await convex.query(api.media.getOCRStats, {});
    
    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error getting OCR stats:", error);
    return c.json({
      success: false,
      error: "Failed to get OCR statistics",
    }, 500);
  }
});

/**
 * POST /api/admin/ocr/process
 * 
 * Run OCR on media files that don't have OCR text yet.
 * 
 * Request Body:
 * - limit: Optional max number of files to process (default: 10)
 * 
 * Response: Processing results
 */
adminRoutes.post("/ocr/process", async (c) => {
  console.log("[OCR Process] Starting OCR processing...");
  
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const body = await c.req.json().catch(() => ({}));
    const limit = body.limit || 10;
    
    // Get media without OCR
    console.log(`[OCR Process] Fetching up to ${limit} media files without OCR...`);
    const mediaWithoutOCR = await convex.query(api.media.getWithoutOCR, { limit });
    
    if (mediaWithoutOCR.length === 0) {
      console.log("[OCR Process] No files need OCR processing");
      return c.json({
        success: true,
        data: {
          message: "All supported media already has OCR text",
          processed: 0,
          failed: 0,
        },
      });
    }
    
    console.log(`[OCR Process] Found ${mediaWithoutOCR.length} files to process`);
    
    let processed = 0;
    let failed = 0;
    const errors: string[] = [];
    
    for (const media of mediaWithoutOCR) {
      const filepath = expandPath(media.filepath);
      console.log(`[OCR Process] Processing: ${media.title} (${media.mediaType})`);
      
      try {
        // Check if file exists
        if (!existsSync(filepath)) {
          const errMsg = `File not found: ${filepath}`;
          console.log(`[OCR Process] ${errMsg}`);
          errors.push(`${media.title}: ${errMsg}`);
          // Mark as attempted even for missing files
          await convex.mutation(api.media.update, {
            id: media._id,
            ocrAttempted: true,
          });
          failed++;
          continue;
        }
        
        // Run OCR
        const ocrText = await processMediaForOCR(filepath, media.mediaType);
        
        if (ocrText) {
          // Update database with OCR text
          await convex.mutation(api.media.update, {
            id: media._id,
            ocrText,
            ocrAttempted: true,
          });
          console.log(`[OCR Process] Successfully processed: ${media.title} (${ocrText.length} chars)`);
          processed++;
        } else {
          console.log(`[OCR Process] No text found in: ${media.title}`);
          // Mark as attempted with empty string
          await convex.mutation(api.media.update, {
            id: media._id,
            ocrText: "",
            ocrAttempted: true,
          });
          processed++;
        }
      } catch (err) {
        const errMsg = `Failed to process ${media.title}: ${err}`;
        console.error(`[OCR Process] ${errMsg}`);
        errors.push(errMsg);
        // Mark as attempted even on error to prevent re-scanning
        try {
          await convex.mutation(api.media.update, {
            id: media._id,
            ocrAttempted: true,
          });
        } catch {
          // Ignore errors when marking as attempted
        }
        failed++;
      }
    }
    
    console.log(`[OCR Process] Complete. Processed: ${processed}, Failed: ${failed}`);
    
    return c.json({
      success: true,
      data: {
        processed,
        failed,
        total: mediaWithoutOCR.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("[OCR Process] Unexpected error:", error);
    return c.json({
      success: false,
      error: `Failed to run OCR processing: ${error}`,
    }, 500);
  }
});

/**
 * GET /api/admin/ocr/failed
 * 
 * Get count of files where OCR was attempted but failed (no text extracted).
 * 
 * Response: Failed OCR count
 */
adminRoutes.get("/ocr/failed", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const failedOCR = await convex.query(api.media.getFailedOCR, {});
    
    return c.json({
      success: true,
      data: failedOCR,
    });
  } catch (error) {
    console.error("Error getting failed OCR stats:", error);
    return c.json({
      success: false,
      error: "Failed to get failed OCR statistics",
    }, 500);
  }
});

/**
 * POST /api/admin/ocr/reset-failed
 * 
 * Reset OCR attempted flag for files that failed (attempted but no text).
 * This allows them to be re-processed by the OCR batch processing.
 * 
 * Response: Number of files reset
 */
adminRoutes.post("/ocr/reset-failed", async (c) => {
  console.log("[OCR Reset] Resetting failed OCR items...");
  
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    // Get failed OCR items
    const failedOCR = await convex.query(api.media.getFailedOCR, {});
    
    if (failedOCR.count === 0) {
      console.log("[OCR Reset] No failed OCR items to reset");
      return c.json({
        success: true,
        data: {
          message: "No failed OCR items to reset",
          reset: 0,
        },
      });
    }
    
    // Reset the OCR attempted flag for failed items
    const result = await convex.mutation(api.media.resetOcrAttempted, {
      mediaIds: failedOCR.mediaIds,
    });
    
    console.log(`[OCR Reset] Reset ${failedOCR.count} failed OCR items`);
    
    return c.json({
      success: true,
      data: {
        reset: failedOCR.count,
        message: `Reset ${failedOCR.count} items for re-processing`,
      },
    });
  } catch (error) {
    console.error("[OCR Reset] Unexpected error:", error);
    return c.json({
      success: false,
      error: `Failed to reset OCR items: ${error}`,
    }, 500);
  }
});

/**
 * GET /api/admin/convert/stats
 * 
 * Get statistics about WebP and WebM files that need conversion.
 * 
 * Response: Conversion stats object
 */
adminRoutes.get("/convert/stats", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const webpWebmFiles = await convex.query(api.media.getWebPWebMFiles, {});
    
    const webpCount = webpWebmFiles.filter((m: any) => m.extension?.toLowerCase() === "webp").length;
    const webmCount = webpWebmFiles.filter((m: any) => m.extension?.toLowerCase() === "webm").length;
    
    return c.json({
      success: true,
      data: {
        total: webpWebmFiles.length,
        webp: webpCount,
        webm: webmCount,
        files: webpWebmFiles.map((m: any) => ({
          id: m._id,
          title: m.title,
          filename: m.filename,
          extension: m.extension,
          size: m.size,
        })),
      },
    });
  } catch (error) {
    console.error("Error getting conversion stats:", error);
    return c.json({
      success: false,
      error: "Failed to get conversion statistics",
    }, 500);
  }
});

/**
 * POST /api/admin/convert/run
 * 
 * Convert existing WebP and WebM files to PNG/GIF and MP4 respectively.
 * - Static WebP -> PNG
 * - Animated WebP -> GIF
 * - WebM -> MP4
 * 
 * Request Body:
 * - limit: Optional max number of files to convert (default: 10)
 * 
 * Response: Conversion results
 */
adminRoutes.post("/convert/run", async (c) => {
  console.log("[Convert] Starting format conversion...");
  
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const body = await c.req.json().catch(() => ({}));
    const limit = body.limit || 10;
    
    // Get media directory from settings
    const mediaDirSetting = await convex.query(api.settings.get, { key: "media_directory" }) || "~/.CottMV";
    const mediaDir = expandPath(mediaDirSetting);
    
    // Get WebP/WebM files
    console.log(`[Convert] Fetching up to ${limit} WebP/WebM files...`);
    const filesToConvert = await convex.query(api.media.getWebPWebMFiles, { limit });
    
    if (filesToConvert.length === 0) {
      console.log("[Convert] No WebP/WebM files to convert");
      return c.json({
        success: true,
        data: {
          message: "No WebP or WebM files found to convert",
          converted: 0,
          failed: 0,
        },
      });
    }
    
    console.log(`[Convert] Found ${filesToConvert.length} files to convert`);
    
    let converted = 0;
    let failed = 0;
    const errors: string[] = [];
    const results: Array<{
      title: string;
      originalFormat: string;
      newFormat: string;
      success: boolean;
      error?: string;
    }> = [];
    
    for (const media of filesToConvert) {
      const filepath = expandPath(media.filepath);
      const ext = media.extension?.toLowerCase();
      console.log(`[Convert] Processing: ${media.title} (${ext})`);
      
      try {
        // Check if file exists
        if (!existsSync(filepath)) {
          const errMsg = `File not found: ${filepath}`;
          console.log(`[Convert] ${errMsg}`);
          errors.push(`${media.title}: ${errMsg}`);
          results.push({
            title: media.title,
            originalFormat: ext || "unknown",
            newFormat: "",
            success: false,
            error: "File not found",
          });
          failed++;
          continue;
        }
        
        // Read file
        const fileBuffer = await Bun.file(filepath).arrayBuffer();
        const buffer = Buffer.from(fileBuffer);
        
        // Write to temp file for conversion
        const tempPath = join(tmpdir(), `cottmv_convert_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
        await writeFile(tempPath, buffer);
        
        let conversionResult;
        let newMediaType: string;
        
        if (ext === "webp") {
          // Convert WebP to PNG (static) or GIF (animated)
          conversionResult = await convertWebP(tempPath);
          newMediaType = conversionResult.extension === "gif" ? "gif" : "image";
        } else if (ext === "webm") {
          // Convert WebM to MP4
          conversionResult = await convertWebMToMp4(tempPath);
          newMediaType = "video";
        } else {
          // Skip unknown formats
          console.log(`[Convert] Skipping unknown format: ${ext}`);
          try { await unlink(tempPath); } catch {}
          continue;
        }
        
        // Calculate new hash
        const newHash = calculateBufferHash(conversionResult.buffer);
        
        // Generate new filename
        const newFilename = `${getBasename(media.filename)}.${conversionResult.extension}`;
        
        // Save converted file to storage
        const saveResult = await saveFile(conversionResult.buffer, newFilename, mediaDir);
        
        // Update database record with new file info
        await convex.mutation(api.media.updateFileInfo, {
          id: media._id,
          filename: saveResult.filename,
          filepath: saveResult.filepath,
          mimeType: conversionResult.mimeType,
          extension: conversionResult.extension,
          mediaType: newMediaType as any,
          size: saveResult.size,
          fileHash: newHash,
        });
        
        // Delete original file
        try {
          await deleteFile(filepath);
          console.log(`[Convert] Deleted original file: ${filepath}`);
        } catch (deleteErr) {
          console.warn(`[Convert] Failed to delete original file: ${deleteErr}`);
        }
        
        // Clean up temp files
        try {
          await unlink(tempPath);
          await unlink(conversionResult.outputPath);
        } catch {
          // Ignore cleanup errors
        }
        
        console.log(`[Convert] Successfully converted: ${media.title} (${ext} -> ${conversionResult.extension})`);
        results.push({
          title: media.title,
          originalFormat: ext || "unknown",
          newFormat: conversionResult.extension,
          success: true,
        });
        converted++;
        
      } catch (err) {
        const errMsg = `Failed to convert ${media.title}: ${err}`;
        console.error(`[Convert] ${errMsg}`);
        errors.push(errMsg);
        results.push({
          title: media.title,
          originalFormat: ext || "unknown",
          newFormat: "",
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }
    
    console.log(`[Convert] Complete. Converted: ${converted}, Failed: ${failed}`);
    
    return c.json({
      success: true,
      data: {
        converted,
        failed,
        total: filesToConvert.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("[Convert] Unexpected error:", error);
    return c.json({
      success: false,
      error: `Failed to run format conversion: ${error}`,
    }, 500);
  }
});
