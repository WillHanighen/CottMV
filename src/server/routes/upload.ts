/**
 * Upload Routes
 * =============
 *
 * This file contains all the API endpoints for file uploads.
 * Handles:
 * - Single file upload
 * - Multiple file upload
 * - Duplicate detection
 * - Automatic file organization
 * - Database registration
 */

import { Hono } from "hono";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";

// Type for Hono context variables
type Variables = {
  convex: ConvexHttpClient;
  user?: {
    _id: string;
    githubId: string;
    username: string;
    role: string;
  };
};
import {
  saveFile,
  saveCover,
  deleteCover,
  initializeStorage,
  DEFAULT_MEDIA_DIR,
  calculateBufferHash,
  expandPath,
  validateDirectoryPath,
} from "../../storage/local.js";
import {
  getMediaType,
  getMimeType,
  getExtension,
  parseFilename,
  isSupportedExtension,
  getBasename,
} from "../../media/utils.js";
import { getVideoMetadata, convertWebP, convertWebMToMp4 } from "../../media/transcoder.js";
import { processMediaForOCR } from "../../media/ocr.js";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";

/**
 * Create the upload routes
 */
export const uploadRoutes = new Hono<{ Variables: Variables }>();

/**
 * Maximum file size (2GB)
 */
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * POST /api/upload
 *
 * Upload a single file
 *
 * Form Data:
 * - file: The file to upload
 * - title: Optional custom title
 * - tags: Optional comma-separated tag IDs or JSON array of tag IDs
 *
 * Response: Created media object
 */
uploadRoutes.post("/", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    // Get media directory from settings and expand path
    const mediaDirSetting = await convex.query(api.settings.get, { key: "media_directory" }) || DEFAULT_MEDIA_DIR;
    const mediaDir = expandPath(mediaDirSetting);
    
    // Validate the directory path
    const pathValidation = await validateDirectoryPath(mediaDir);
    if (!pathValidation.valid) {
      console.error(`[Upload] Invalid media directory: ${pathValidation.error}`);
      return c.json({
        success: false,
        error: `Invalid media directory: ${pathValidation.error}`,
      }, 500);
    }
    
    // Ensure storage is initialized
    const initResult = await initializeStorage(mediaDir);
    if (!initResult.success) {
      console.error(`[Upload] Failed to initialize storage: ${initResult.error}`);
      return c.json({
        success: false,
        error: `Failed to initialize storage: ${initResult.error}`,
      }, 500);
    }
    
    console.log(`[Upload] Using media directory: ${initResult.expandedPath}`);
    
    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const customTitle = formData.get("title") as string | null;
    const tagsString = formData.get("tags") as string | null;
    
    if (!file) {
      return c.json({
        success: false,
        error: "No file provided",
      }, 400);
    }
    
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return c.json({
        success: false,
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB`,
      }, 400);
    }
    
    // Check file extension
    let ext = getExtension(file.name);
    const originalExt = ext;
    if (!isSupportedExtension(ext)) {
      return c.json({
        success: false,
        error: `Unsupported file type: ${ext}`,
      }, 400);
    }
    
    // Read file buffer
    let buffer = Buffer.from(await file.arrayBuffer());
    let finalFilename = file.name;
    let mimeType = getMimeType(ext);
    let wasConverted = false;
    
    // Convert WebP and WebM files
    if (ext === ".webp" || ext === ".webm") {
      wasConverted = true;
      try {
        console.log(`[Upload] Converting ${ext} file: ${file.name}`);
        
        // Write to temp file for conversion
        const tempPath = join(tmpdir(), `cottmv_upload_${Date.now()}${ext}`);
        await writeFile(tempPath, buffer);
        
        let conversionResult;
        if (ext === ".webp") {
          // Convert WebP to PNG (static) or GIF (animated)
          conversionResult = await convertWebP(tempPath);
        } else {
          // Convert WebM to MP4
          conversionResult = await convertWebMToMp4(tempPath);
        }
        
        // Update buffer and metadata
        buffer = conversionResult.buffer;
        ext = `.${conversionResult.extension}`;
        mimeType = conversionResult.mimeType;
        finalFilename = `${getBasename(file.name)}.${conversionResult.extension}`;
        
        // Clean up temp files
        try {
          await unlink(tempPath);
          await unlink(conversionResult.outputPath);
        } catch {
          // Ignore cleanup errors
        }
        
        console.log(`[Upload] Converted ${file.name} -> ${finalFilename}`);
      } catch (err) {
        console.error(`[Upload] Conversion failed for ${file.name}:`, err);
        return c.json({
          success: false,
          error: `Failed to convert ${ext} file: ${err instanceof Error ? err.message : "Unknown error"}`,
        }, 500);
      }
    }
    
    // Calculate hash for duplicate detection
    const fileHash = calculateBufferHash(buffer);
    
    // Check for duplicates by hash
    const duplicateCheck = await convex.query(api.media.checkDuplicate, { fileHash });
    if (duplicateCheck.isDuplicate) {
      return c.json({
        success: false,
        error: "Duplicate file detected",
        duplicate: {
          id: duplicateCheck.existingMedia?._id,
          title: duplicateCheck.existingMedia?.title,
          filename: duplicateCheck.existingMedia?.filename,
        },
      }, 409);
    }
    
    // Save file to storage (using expanded path)
    const saveResult = await saveFile(buffer, finalFilename, initResult.expandedPath);
    
    // Parse filename for metadata hints
    const parsed = parseFilename(saveResult.filename);
    
    // Get media type
    const mediaType = saveResult.mediaType;
    
    // Try to get video/audio metadata
    let duration: number | undefined;
    if (mediaType === "video" || mediaType === "audio") {
      try {
        const metadata = await getVideoMetadata(saveResult.filepath);
        duration = metadata.duration;
      } catch {
        // Metadata extraction failed, continue without duration
      }
    }
    
    // Process OCR for images, GIFs, and videos
    let ocrText: string | undefined;
    let ocrAttempted = false;
    if (mediaType === "image" || mediaType === "gif" || mediaType === "video") {
      ocrAttempted = true; // Mark as attempted regardless of success
      try {
        ocrText = await processMediaForOCR(saveResult.filepath, mediaType);
      } catch (err) {
        console.warn("[Upload] OCR processing failed:", err);
        // Continue without OCR - it's not critical
      }
    }
    
    // Parse tags - support both comma-separated and JSON array formats
    let tagIds: string[] = [];
    if (tagsString) {
      try {
        // Try parsing as JSON first
        const parsed = JSON.parse(tagsString);
        if (Array.isArray(parsed)) {
          tagIds = parsed.filter(t => typeof t === 'string' && t.trim());
        }
      } catch {
        // Fall back to comma-separated format
        tagIds = tagsString.split(",").map(t => t.trim()).filter(t => t);
      }
    }
    
    // Create media record in database
    const mediaId = await convex.mutation(api.media.create, {
      title: customTitle || parsed.title,
      filename: saveResult.filename,
      filepath: saveResult.filepath,
      mimeType,
      extension: ext.replace(/^\./, ""),
      mediaType,
      size: saveResult.size,
      duration,
      year: parsed.year,
      artist: parsed.artist,
      album: parsed.album,
      ocrText,
      ocrAttempted: ocrAttempted || undefined,
      fileHash: saveResult.fileHash,
      tags: tagIds.length > 0 ? tagIds as any : undefined,
    });
    
    console.log(`[Upload] Successfully uploaded: ${saveResult.filename} -> ${saveResult.filepath}`);
    
    return c.json({
      success: true,
      data: {
        id: mediaId,
        filename: saveResult.filename,
        filepath: saveResult.filepath,
        size: saveResult.size,
        mediaType,
        subfolder: saveResult.subfolder,
        ...(wasConverted && {
          converted: true,
          originalFormat: originalExt.replace(/^\./, ""),
        }),
      },
    }, 201);
  } catch (error) {
    console.error("Error uploading file:", error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to upload file",
    }, 500);
  }
});

/**
 * POST /api/upload/multiple
 *
 * Upload multiple files at once with support for per-file or batch tagging
 *
 * Form Data:
 * - files: Array of files to upload
 * - tags: Optional batch tags (comma-separated or JSON array) applied to all files
 * - fileTags: Optional JSON object mapping filename to array of tag IDs for per-file tagging
 *             Example: {"file1.mp4": ["tag1", "tag2"], "file2.jpg": ["tag3"]}
 * - batchMode: Optional "true" to use batch tags, "false" for per-file tags (default: false)
 *
 * Response: Array of results for each file
 */
uploadRoutes.post("/multiple", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    
    // Get media directory from settings and expand path
    const mediaDirSetting = await convex.query(api.settings.get, { key: "media_directory" }) || DEFAULT_MEDIA_DIR;
    const mediaDir = expandPath(mediaDirSetting);
    
    // Validate the directory path
    const pathValidation = await validateDirectoryPath(mediaDir);
    if (!pathValidation.valid) {
      console.error(`[Upload] Invalid media directory: ${pathValidation.error}`);
      return c.json({
        success: false,
        error: `Invalid media directory: ${pathValidation.error}`,
      }, 500);
    }
    
    // Ensure storage is initialized
    const initResult = await initializeStorage(mediaDir);
    if (!initResult.success) {
      console.error(`[Upload] Failed to initialize storage: ${initResult.error}`);
      return c.json({
        success: false,
        error: `Failed to initialize storage: ${initResult.error}`,
      }, 500);
    }
    
    console.log(`[Upload Multiple] Using media directory: ${initResult.expandedPath}`);
    
    // Parse multipart form data
    const formData = await c.req.formData();
    const files = formData.getAll("files") as File[];
    const tagsString = formData.get("tags") as string | null;
    const fileTagsString = formData.get("fileTags") as string | null;
    const batchMode = formData.get("batchMode") === "true";
    
    if (!files || files.length === 0) {
      return c.json({
        success: false,
        error: "No files provided",
      }, 400);
    }
    
    // Parse batch tags (for batch mode)
    let batchTagIds: string[] = [];
    if (tagsString) {
      try {
        const parsed = JSON.parse(tagsString);
        if (Array.isArray(parsed)) {
          batchTagIds = parsed.filter(t => typeof t === 'string' && t.trim());
        }
      } catch {
        batchTagIds = tagsString.split(",").map(t => t.trim()).filter(t => t);
      }
    }
    
    // Parse per-file tags (for individual mode)
    let fileTagsMap: Record<string, string[]> = {};
    if (fileTagsString) {
      try {
        const parsed = JSON.parse(fileTagsString);
        if (typeof parsed === 'object' && parsed !== null) {
          fileTagsMap = parsed;
        }
      } catch (e) {
        console.warn("[Upload] Failed to parse fileTags:", e);
      }
    }
    
    const results: Array<{
      filename: string;
      success: boolean;
      error?: string;
      data?: {
        id: string;
        filepath: string;
        size: number;
        mediaType: string;
        tags?: string[];
        converted?: boolean;
        originalFormat?: string;
        convertedFilename?: string;
      };
    }> = [];
    
    for (const file of files) {
      try {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          results.push({
            filename: file.name,
            success: false,
            error: "File too large",
          });
          continue;
        }
        
        // Check file extension
        let ext = getExtension(file.name);
        const originalExt = ext;
        if (!isSupportedExtension(ext)) {
          results.push({
            filename: file.name,
            success: false,
            error: `Unsupported file type: ${ext}`,
          });
          continue;
        }
        
        // Read file buffer
        let buffer = Buffer.from(await file.arrayBuffer());
        let finalFilename = file.name;
        let mimeType = getMimeType(ext);
        let wasConverted = false;
        
        // Convert WebP and WebM files
        if (ext === ".webp" || ext === ".webm") {
          wasConverted = true;
          try {
            console.log(`[Upload Multiple] Converting ${ext} file: ${file.name}`);
            
            // Write to temp file for conversion
            const tempPath = join(tmpdir(), `cottmv_upload_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
            await writeFile(tempPath, buffer);
            
            let conversionResult;
            if (ext === ".webp") {
              // Convert WebP to PNG (static) or GIF (animated)
              conversionResult = await convertWebP(tempPath);
            } else {
              // Convert WebM to MP4
              conversionResult = await convertWebMToMp4(tempPath);
            }
            
            // Update buffer and metadata
            buffer = conversionResult.buffer;
            ext = `.${conversionResult.extension}`;
            mimeType = conversionResult.mimeType;
            finalFilename = `${getBasename(file.name)}.${conversionResult.extension}`;
            
            // Clean up temp files
            try {
              await unlink(tempPath);
              await unlink(conversionResult.outputPath);
            } catch {
              // Ignore cleanup errors
            }
            
            console.log(`[Upload Multiple] Converted ${file.name} -> ${finalFilename}`);
          } catch (err) {
            console.error(`[Upload Multiple] Conversion failed for ${file.name}:`, err);
            results.push({
              filename: file.name,
              success: false,
              error: `Failed to convert ${ext} file: ${err instanceof Error ? err.message : "Unknown error"}`,
            });
            continue;
          }
        }
        
        // Calculate hash for duplicate detection
        const fileHash = calculateBufferHash(buffer);
        
        // Check for duplicates
        const duplicateCheck = await convex.query(api.media.checkDuplicate, { fileHash });
        if (duplicateCheck.isDuplicate) {
          results.push({
            filename: file.name,
            success: false,
            error: "Duplicate file",
          });
          continue;
        }
        
        // Save file (using expanded path)
        const saveResult = await saveFile(buffer, finalFilename, initResult.expandedPath);
        
        // Parse filename for metadata
        const parsed = parseFilename(saveResult.filename);
        
        // Get duration for video/audio
        let duration: number | undefined;
        if (saveResult.mediaType === "video" || saveResult.mediaType === "audio") {
          try {
            const metadata = await getVideoMetadata(saveResult.filepath);
            duration = metadata.duration;
          } catch {
            // Continue without duration
          }
        }
        
        // Process OCR for images, GIFs, and videos
        let ocrText: string | undefined;
        let ocrAttempted = false;
        if (saveResult.mediaType === "image" || saveResult.mediaType === "gif" || saveResult.mediaType === "video") {
          ocrAttempted = true; // Mark as attempted regardless of success
          try {
            ocrText = await processMediaForOCR(saveResult.filepath, saveResult.mediaType);
          } catch (err) {
            console.warn(`[Upload Multiple] OCR processing failed for ${file.name}:`, err);
            // Continue without OCR - it's not critical
          }
        }
        
        // Determine which tags to use: batch mode uses batch tags, otherwise use per-file tags
        let tagIds: string[] = [];
        if (batchMode) {
          tagIds = batchTagIds;
        } else {
          // Look up per-file tags by filename
          tagIds = fileTagsMap[file.name] || [];
        }
        
        // Create media record
        const mediaId = await convex.mutation(api.media.create, {
          title: parsed.title,
          filename: saveResult.filename,
          filepath: saveResult.filepath,
          mimeType,
          extension: ext.replace(/^\./, ""),
          mediaType: saveResult.mediaType,
          size: saveResult.size,
          duration,
          year: parsed.year,
          artist: parsed.artist,
          album: parsed.album,
          ocrText,
          ocrAttempted: ocrAttempted || undefined,
          fileHash: saveResult.fileHash,
          tags: tagIds.length > 0 ? tagIds as any : undefined,
        });
        
        console.log(`[Upload Multiple] Successfully uploaded: ${saveResult.filename} -> ${saveResult.filepath}`);
        
        results.push({
          filename: file.name,
          success: true,
          data: {
            id: mediaId,
            filepath: saveResult.filepath,
            size: saveResult.size,
            mediaType: saveResult.mediaType,
            tags: tagIds,
            ...(wasConverted && {
              converted: true,
              originalFormat: originalExt.replace(/^\./, ""),
              convertedFilename: saveResult.filename,
            }),
          },
        });
      } catch (error) {
        console.error(`[Upload Multiple] Error uploading ${file.name}:`, error);
        results.push({
          filename: file.name,
          success: false,
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    return c.json({
      success: true,
      data: {
        total: files.length,
        successful: successCount,
        failed: failCount,
        batchMode,
        results,
      },
    });
  } catch (error) {
    console.error("Error uploading files:", error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to upload files",
    }, 500);
  }
});

/**
 * POST /api/upload/check-duplicate
 *
 * Check if a file would be a duplicate before uploading
 *
 * Supports two modes:
 * 1. JSON body with filename and size (quick check by filename/size)
 * 2. Form Data with file (accurate check by file hash)
 *
 * JSON Body:
 * - filename: The filename to check
 * - size: The file size in bytes
 *
 * Form Data:
 * - file: The file to check
 *
 * Response: Duplicate status
 */
uploadRoutes.post("/check-duplicate", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const contentType = c.req.header("content-type") || "";
    
    // Check if this is a JSON request (quick check by filename/size)
    if (contentType.includes("application/json")) {
      const body = await c.req.json();
      const { filename, size } = body;
      
      if (!filename) {
        return c.json({
          success: false,
          error: "No filename provided",
        }, 400);
      }
      
      // Check for duplicates by filename (less accurate but faster)
      const duplicateCheck = await convex.query(api.media.checkDuplicateByFilename, {
        filename
      });
      
      return c.json({
        success: true,
        data: {
          isDuplicate: duplicateCheck.isDuplicate,
          existingFile: duplicateCheck.existingMedia ? {
            id: duplicateCheck.existingMedia._id,
            title: duplicateCheck.existingMedia.title,
            filename: duplicateCheck.existingMedia.filename,
          } : null,
        },
      });
    }
    
    // Form data request (accurate check by file hash)
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return c.json({
        success: false,
        error: "No file provided",
      }, 400);
    }
    
    // Read file and calculate hash
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = calculateBufferHash(buffer);
    
    // Check for duplicates by hash (most accurate)
    const duplicateCheck = await convex.query(api.media.checkDuplicate, { fileHash });
    
    return c.json({
      success: true,
      data: {
        isDuplicate: duplicateCheck.isDuplicate,
        existingFile: duplicateCheck.existingMedia ? {
          id: duplicateCheck.existingMedia._id,
          title: duplicateCheck.existingMedia.title,
          filename: duplicateCheck.existingMedia.filename,
        } : null,
      },
    });
  } catch (error) {
    console.error("Error checking duplicate:", error);
    return c.json({
      success: false,
      error: "Failed to check duplicate",
    }, 500);
  }
});

/**
 * GET /api/upload/supported-types
 * 
 * Get list of supported file types
 * Note: WebP files are automatically converted to PNG (static) or GIF (animated)
 * Note: WebM files are automatically converted to MP4
 */
uploadRoutes.get("/supported-types", (c) => {
  return c.json({
    success: true,
    data: {
      video: [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg", ".3gp", ".ts", ".mts"],
      audio: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".opus"],
      image: [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".svg", ".tiff", ".ico"],
      gif: [".gif"],
      document: [".pdf", ".doc", ".docx", ".epub", ".mobi"],
      conversions: {
        ".webp": "Converted to PNG (static) or GIF (animated)",
        ".webm": "Converted to MP4",
      },
    },
  });
});

/**
 * Supported cover image extensions
 */
const SUPPORTED_COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/**
 * Maximum cover file size (10MB)
 */
const MAX_COVER_SIZE = 10 * 1024 * 1024;

/**
 * POST /api/upload/cover/:id
 *
 * Upload a custom cover image for a media item
 *
 * Form Data:
 * - file: The cover image file (jpg, jpeg, png, webp, gif)
 *
 * Response: Updated media object with new cover path
 */
uploadRoutes.post("/cover/:id", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const mediaId = c.req.param("id");
    
    // Verify media item exists
    const media = await convex.query(api.media.get, { id: mediaId as any });
    if (!media) {
      return c.json({
        success: false,
        error: "Media not found",
      }, 404);
    }
    
    // Get media directory from settings and expand path
    const mediaDirSetting = await convex.query(api.settings.get, { key: "media_directory" }) || DEFAULT_MEDIA_DIR;
    const mediaDir = expandPath(mediaDirSetting);
    
    // Validate the directory path
    const pathValidation = await validateDirectoryPath(mediaDir);
    if (!pathValidation.valid) {
      console.error(`[Upload Cover] Invalid media directory: ${pathValidation.error}`);
      return c.json({
        success: false,
        error: `Invalid media directory: ${pathValidation.error}`,
      }, 500);
    }
    
    // Ensure storage is initialized
    const initResult = await initializeStorage(mediaDir);
    if (!initResult.success) {
      console.error(`[Upload Cover] Failed to initialize storage: ${initResult.error}`);
      return c.json({
        success: false,
        error: `Failed to initialize storage: ${initResult.error}`,
      }, 500);
    }
    
    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return c.json({
        success: false,
        error: "No file provided",
      }, 400);
    }
    
    // Check file size
    if (file.size > MAX_COVER_SIZE) {
      return c.json({
        success: false,
        error: `Cover image too large. Maximum size is ${MAX_COVER_SIZE / (1024 * 1024)}MB`,
      }, 400);
    }
    
    // Check file extension
    const ext = getExtension(file.name).toLowerCase();
    if (!SUPPORTED_COVER_EXTENSIONS.includes(ext)) {
      return c.json({
        success: false,
        error: `Unsupported image type: ${ext}. Supported types: ${SUPPORTED_COVER_EXTENSIONS.join(", ")}`,
      }, 400);
    }
    
    // Read file buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Save cover file
    const saveResult = await saveCover(buffer, mediaId, file.name, initResult.expandedPath);
    
    // Update media record with new cover path
    await convex.mutation(api.media.update, {
      id: mediaId as any,
      customCover: saveResult.filepath,
    });
    
    console.log(`[Upload Cover] Successfully uploaded cover for ${mediaId}: ${saveResult.filepath}`);
    
    return c.json({
      success: true,
      data: {
        mediaId,
        coverPath: saveResult.filepath,
        filename: saveResult.filename,
        size: saveResult.size,
      },
    }, 201);
  } catch (error) {
    console.error("Error uploading cover:", error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to upload cover",
    }, 500);
  }
});

/**
 * DELETE /api/upload/cover/:id
 *
 * Delete a custom cover image for a media item
 *
 * Response: Success status
 */
uploadRoutes.delete("/cover/:id", async (c) => {
  try {
    const convex = c.get("convex") as ConvexHttpClient;
    const mediaId = c.req.param("id");
    
    // Verify media item exists
    const media = await convex.query(api.media.get, { id: mediaId as any });
    if (!media) {
      return c.json({
        success: false,
        error: "Media not found",
      }, 404);
    }
    
    // Get media directory from settings and expand path
    const mediaDirSetting = await convex.query(api.settings.get, { key: "media_directory" }) || DEFAULT_MEDIA_DIR;
    const mediaDir = expandPath(mediaDirSetting);
    
    // Delete the cover file
    const deleted = await deleteCover(mediaId, mediaDir);
    
    // Clear customCover in database
    await convex.mutation(api.media.update, {
      id: mediaId as any,
      customCover: undefined,
    });
    
    console.log(`[Upload Cover] Deleted cover for ${mediaId}`);
    
    return c.json({
      success: true,
      data: {
        mediaId,
        deleted,
      },
    });
  } catch (error) {
    console.error("Error deleting cover:", error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete cover",
    }, 500);
  }
});
