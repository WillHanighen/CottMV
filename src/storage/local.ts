/**
 * Local Storage Manager
 * =====================
 *
 * This module handles local file storage with automatic organization.
 * Files are organized into subfolders based on their media type:
 *
 * ~/.CottMV/
 * ├── videos/
 * ├── audio/
 * ├── images/
 * ├── gifs/
 * ├── documents/
 * └── other/
 *
 * Features:
 * - Automatic directory creation on startup
 * - File type-based organization
 * - Duplicate detection via file hash
 * - Safe file naming (sanitization)
 * - Proper path expansion for ~ and $HOME
 */

import { mkdir, stat, writeFile, unlink, readdir, rename, access } from "fs/promises";
import { join, basename, extname, isAbsolute, resolve } from "path";
import { createHash } from "crypto";
import { createReadStream, constants } from "fs";
import { homedir } from "os";
import { getMediaType, type MediaType } from "../media/utils.js";

/**
 * Default media directory path
 */
export const DEFAULT_MEDIA_DIR = join(homedir(), ".CottMV");

/**
 * Expand path with ~ or $HOME to absolute path
 * Also validates the path is accessible
 *
 * @param inputPath - Path that may contain ~ or $HOME
 * @returns Expanded absolute path
 */
export function expandPath(inputPath: string): string {
  if (!inputPath) {
    return DEFAULT_MEDIA_DIR;
  }
  
  let expandedPath = inputPath.trim();
  
  // Expand ~ to home directory
  if (expandedPath.startsWith("~/")) {
    expandedPath = join(homedir(), expandedPath.slice(2));
  } else if (expandedPath === "~") {
    expandedPath = homedir();
  }
  
  // Expand $HOME to home directory
  expandedPath = expandedPath.replace(/\$HOME/g, homedir());
  
  // Expand environment variables like ${HOME}
  expandedPath = expandedPath.replace(/\$\{(\w+)\}/g, (_, varName) => {
    return process.env[varName] || "";
  });
  
  // Make path absolute if it isn't already
  if (!isAbsolute(expandedPath)) {
    expandedPath = resolve(expandedPath);
  }
  
  return expandedPath;
}

/**
 * Validate that a directory path is accessible and writable
 *
 * @param dirPath - Directory path to validate
 * @returns Object with validation result and error message if any
 */
export async function validateDirectoryPath(dirPath: string): Promise<{
  valid: boolean;
  error?: string;
  expandedPath: string;
}> {
  const expandedPath = expandPath(dirPath);
  
  try {
    // Check if path exists
    const stats = await stat(expandedPath);
    
    if (!stats.isDirectory()) {
      return {
        valid: false,
        error: `Path exists but is not a directory: ${expandedPath}`,
        expandedPath,
      };
    }
    
    // Check if writable
    await access(expandedPath, constants.W_OK);
    
    return { valid: true, expandedPath };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // Directory doesn't exist - we'll create it
      return { valid: true, expandedPath };
    }
    
    if (error.code === "EACCES") {
      return {
        valid: false,
        error: `Permission denied: Cannot write to ${expandedPath}`,
        expandedPath,
      };
    }
    
    return {
      valid: false,
      error: `Cannot access path: ${error.message}`,
      expandedPath,
    };
  }
}

/**
 * Subfolder names for each media type
 */
export const MEDIA_TYPE_FOLDERS: Record<MediaType, string> = {
  video: "videos",
  audio: "audio",
  image: "images",
  gif: "gifs",
  document: "documents",
  other: "other",
};

/**
 * Covers folder name
 */
export const COVERS_FOLDER = "covers";

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Base directory for media storage */
  baseDir: string;
}

/**
 * Result of a file save operation
 */
export interface SaveResult {
  /** Full path to the saved file */
  filepath: string;
  /** Filename (without path) */
  filename: string;
  /** File size in bytes */
  size: number;
  /** SHA-256 hash of the file */
  fileHash: string;
  /** Media type category */
  mediaType: MediaType;
  /** Subfolder where file was saved */
  subfolder: string;
}

/**
 * Initialize the storage directory structure
 * Creates the base directory and all subfolders if they don't exist
 *
 * @param baseDir - Base directory path (defaults to ~/.CottMV/). Supports ~ and $HOME expansion.
 * @returns Object with the expanded path and any validation errors
 */
export async function initializeStorage(baseDir: string = DEFAULT_MEDIA_DIR): Promise<{
  success: boolean;
  expandedPath: string;
  error?: string;
}> {
  // Expand the path (handles ~, $HOME, etc.)
  const expandedPath = expandPath(baseDir);
  
  // Validate the path
  const validation = await validateDirectoryPath(expandedPath);
  if (!validation.valid) {
    console.error(`[Storage] Invalid path: ${validation.error}`);
    return {
      success: false,
      expandedPath,
      error: validation.error,
    };
  }
  
  try {
    // Create base directory
    await mkdir(expandedPath, { recursive: true });
    
    // Create subfolders for each media type
    for (const folder of Object.values(MEDIA_TYPE_FOLDERS)) {
      const folderPath = join(expandedPath, folder);
      await mkdir(folderPath, { recursive: true });
    }
    
    // Create covers folder
    const coversPath = join(expandedPath, COVERS_FOLDER);
    await mkdir(coversPath, { recursive: true });
    
    console.log(`[Storage] Initialized storage at ${expandedPath}`);
    return { success: true, expandedPath };
  } catch (error: any) {
    const errorMsg = `Failed to create storage directories: ${error.message}`;
    console.error(`[Storage] ${errorMsg}`);
    return {
      success: false,
      expandedPath,
      error: errorMsg,
    };
  }
}

/**
 * Check if storage is initialized
 *
 * @param baseDir - Base directory path (supports ~ and $HOME expansion)
 * @returns true if all directories exist
 */
export async function isStorageInitialized(baseDir: string = DEFAULT_MEDIA_DIR): Promise<boolean> {
  // Expand the path
  const expandedPath = expandPath(baseDir);
  
  try {
    const baseStat = await stat(expandedPath);
    if (!baseStat.isDirectory()) return false;
    
    for (const folder of Object.values(MEDIA_TYPE_FOLDERS)) {
      const folderPath = join(expandedPath, folder);
      const folderStat = await stat(folderPath);
      if (!folderStat.isDirectory()) return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize a filename to be safe for filesystem
 * Removes or replaces problematic characters
 * 
 * @param filename - Original filename
 * @returns Sanitized filename
 */
export function sanitizeFilename(filename: string): string {
  // Remove or replace problematic characters
  let sanitized = filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") // Replace invalid chars with underscore
    .replace(/\s+/g, "_") // Replace whitespace with underscore
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_+|_+$/g, ""); // Trim underscores from ends
  
  // Ensure filename isn't empty
  if (!sanitized || sanitized === ".") {
    sanitized = "unnamed_file";
  }
  
  // Limit length (keep extension)
  const ext = extname(sanitized);
  const name = basename(sanitized, ext);
  if (name.length > 200) {
    sanitized = name.slice(0, 200) + ext;
  }
  
  return sanitized;
}

/**
 * Generate a unique filename if file already exists
 * Appends a number suffix: file.mp4 -> file_1.mp4 -> file_2.mp4
 * 
 * @param dir - Directory path
 * @param filename - Desired filename
 * @returns Unique filename
 */
export async function getUniqueFilename(dir: string, filename: string): Promise<string> {
  const ext = extname(filename);
  const name = basename(filename, ext);
  let uniqueName = filename;
  let counter = 1;
  
  while (true) {
    try {
      await stat(join(dir, uniqueName));
      // File exists, try next number
      uniqueName = `${name}_${counter}${ext}`;
      counter++;
    } catch {
      // File doesn't exist, we can use this name
      break;
    }
  }
  
  return uniqueName;
}

/**
 * Calculate SHA-256 hash of a file
 * 
 * @param filepath - Path to the file
 * @returns Hex-encoded hash string
 */
export async function calculateFileHash(filepath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filepath);
    
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Calculate SHA-256 hash of a buffer
 * 
 * @param buffer - File data buffer
 * @returns Hex-encoded hash string
 */
export function calculateBufferHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Get the subfolder path for a media type
 * 
 * @param baseDir - Base directory path
 * @param mediaType - Media type category
 * @returns Full path to the subfolder
 */
export function getSubfolderPath(baseDir: string, mediaType: MediaType): string {
  const folder = MEDIA_TYPE_FOLDERS[mediaType] || MEDIA_TYPE_FOLDERS.other;
  return join(baseDir, folder);
}

/**
 * Save a file to the appropriate subfolder based on its type
 *
 * @param buffer - File data buffer
 * @param originalFilename - Original filename
 * @param baseDir - Base directory path (supports ~ and $HOME expansion)
 * @returns Save result with file info
 * @throws Error if storage initialization fails or file cannot be written
 */
export async function saveFile(
  buffer: Buffer,
  originalFilename: string,
  baseDir: string = DEFAULT_MEDIA_DIR
): Promise<SaveResult> {
  // Expand the path (handles ~, $HOME, etc.)
  const expandedBaseDir = expandPath(baseDir);
  
  // Ensure storage is initialized
  if (!await isStorageInitialized(expandedBaseDir)) {
    const initResult = await initializeStorage(expandedBaseDir);
    if (!initResult.success) {
      throw new Error(`Failed to initialize storage: ${initResult.error}`);
    }
  }
  
  // Sanitize filename
  const sanitizedFilename = sanitizeFilename(originalFilename);
  
  // Determine media type from extension
  const ext = extname(sanitizedFilename).toLowerCase();
  const mediaType = getMediaType(ext);
  
  // Get subfolder path
  const subfolder = MEDIA_TYPE_FOLDERS[mediaType];
  const subfolderPath = join(expandedBaseDir, subfolder);
  
  // Ensure subfolder exists
  try {
    await mkdir(subfolderPath, { recursive: true });
  } catch (error: any) {
    throw new Error(`Failed to create subfolder ${subfolderPath}: ${error.message}`);
  }
  
  // Get unique filename
  const uniqueFilename = await getUniqueFilename(subfolderPath, sanitizedFilename);
  const filepath = join(subfolderPath, uniqueFilename);
  
  // Calculate hash before saving
  const fileHash = calculateBufferHash(buffer);
  
  // Write file with error handling
  try {
    await writeFile(filepath, buffer);
  } catch (error: any) {
    throw new Error(`Failed to write file to ${filepath}: ${error.message}`);
  }
  
  // Verify file was written correctly
  let fileStats;
  try {
    fileStats = await stat(filepath);
    
    // Verify file size matches buffer size
    if (fileStats.size !== buffer.length) {
      throw new Error(`File size mismatch: expected ${buffer.length} bytes, got ${fileStats.size} bytes`);
    }
  } catch (error: any) {
    if (error.message.includes('File size mismatch')) {
      throw error;
    }
    throw new Error(`Failed to verify saved file: ${error.message}`);
  }
  
  console.log(`[Storage] Saved file: ${filepath} (${fileStats.size} bytes)`);
  
  return {
    filepath,
    filename: uniqueFilename,
    size: fileStats.size,
    fileHash,
    mediaType,
    subfolder,
  };
}

/**
 * Move an existing file to the appropriate subfolder
 * 
 * @param sourcePath - Current file path
 * @param baseDir - Base directory path
 * @returns Save result with new file info
 */
export async function moveFile(
  sourcePath: string,
  baseDir: string = DEFAULT_MEDIA_DIR
): Promise<SaveResult> {
  // Ensure storage is initialized
  if (!await isStorageInitialized(baseDir)) {
    await initializeStorage(baseDir);
  }
  
  const originalFilename = basename(sourcePath);
  const sanitizedFilename = sanitizeFilename(originalFilename);
  
  // Determine media type from extension
  const ext = extname(sanitizedFilename).toLowerCase();
  const mediaType = getMediaType(ext);
  
  // Get subfolder path
  const subfolder = MEDIA_TYPE_FOLDERS[mediaType];
  const subfolderPath = join(baseDir, subfolder);
  
  // Get unique filename
  const uniqueFilename = await getUniqueFilename(subfolderPath, sanitizedFilename);
  const destPath = join(subfolderPath, uniqueFilename);
  
  // Calculate hash before moving
  const fileHash = await calculateFileHash(sourcePath);
  
  // Move file
  await rename(sourcePath, destPath);
  
  // Get file stats
  const fileStats = await stat(destPath);
  
  return {
    filepath: destPath,
    filename: uniqueFilename,
    size: fileStats.size,
    fileHash,
    mediaType,
    subfolder,
  };
}

/**
 * Delete a file from storage
 * 
 * @param filepath - Path to the file to delete
 * @returns true if deleted successfully
 */
export async function deleteFile(filepath: string): Promise<boolean> {
  try {
    await unlink(filepath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all files in a subfolder
 * 
 * @param baseDir - Base directory path
 * @param mediaType - Media type to list (optional, lists all if not specified)
 * @returns Array of file paths
 */
export async function listFiles(
  baseDir: string = DEFAULT_MEDIA_DIR,
  mediaType?: MediaType
): Promise<string[]> {
  const files: string[] = [];
  
  const foldersToScan = mediaType 
    ? [MEDIA_TYPE_FOLDERS[mediaType]]
    : Object.values(MEDIA_TYPE_FOLDERS);
  
  for (const folder of foldersToScan) {
    const folderPath = join(baseDir, folder);
    try {
      const entries = await readdir(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          files.push(join(folderPath, entry.name));
        }
      }
    } catch {
      // Folder doesn't exist or can't be read
    }
  }
  
  return files;
}

/**
 * Result of a cover save operation
 */
export interface CoverSaveResult {
  /** Full path to the saved cover */
  filepath: string;
  /** Filename (without path) */
  filename: string;
  /** File size in bytes */
  size: number;
}

/**
 * Save a cover image for a media item
 * Cover files are named with the media ID for easy lookup
 *
 * @param buffer - Image data buffer
 * @param mediaId - ID of the media item this cover is for
 * @param originalFilename - Original filename (for extension)
 * @param baseDir - Base directory path (supports ~ and $HOME expansion)
 * @returns Save result with file info
 */
export async function saveCover(
  buffer: Buffer,
  mediaId: string,
  originalFilename: string,
  baseDir: string = DEFAULT_MEDIA_DIR
): Promise<CoverSaveResult> {
  // Expand the path
  const expandedBaseDir = expandPath(baseDir);
  
  // Ensure storage is initialized
  if (!await isStorageInitialized(expandedBaseDir)) {
    const initResult = await initializeStorage(expandedBaseDir);
    if (!initResult.success) {
      throw new Error(`Failed to initialize storage: ${initResult.error}`);
    }
  }
  
  // Ensure covers folder exists
  const coversPath = join(expandedBaseDir, COVERS_FOLDER);
  await mkdir(coversPath, { recursive: true });
  
  // Get extension from original filename
  const ext = extname(originalFilename).toLowerCase() || ".jpg";
  
  // Create filename based on media ID (ensures one cover per media item)
  const filename = `${mediaId}${ext}`;
  const filepath = join(coversPath, filename);
  
  // Delete existing cover if any (to allow replacement)
  try {
    const entries = await readdir(coversPath);
    for (const entry of entries) {
      if (entry.startsWith(mediaId + ".")) {
        await unlink(join(coversPath, entry));
      }
    }
  } catch {
    // Ignore errors when trying to delete old covers
  }
  
  // Write the new cover file
  try {
    await writeFile(filepath, buffer);
  } catch (error: any) {
    throw new Error(`Failed to write cover file to ${filepath}: ${error.message}`);
  }
  
  // Verify and get file stats
  const fileStats = await stat(filepath);
  
  console.log(`[Storage] Saved cover: ${filepath} (${fileStats.size} bytes)`);
  
  return {
    filepath,
    filename,
    size: fileStats.size,
  };
}

/**
 * Delete a cover image for a media item
 *
 * @param mediaId - ID of the media item
 * @param baseDir - Base directory path
 * @returns true if deleted, false if not found
 */
export async function deleteCover(
  mediaId: string,
  baseDir: string = DEFAULT_MEDIA_DIR
): Promise<boolean> {
  const expandedBaseDir = expandPath(baseDir);
  const coversPath = join(expandedBaseDir, COVERS_FOLDER);
  
  try {
    const entries = await readdir(coversPath);
    for (const entry of entries) {
      if (entry.startsWith(mediaId + ".")) {
        await unlink(join(coversPath, entry));
        console.log(`[Storage] Deleted cover: ${entry}`);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get storage statistics
 * 
 * @param baseDir - Base directory path
 * @returns Object with storage stats
 */
export async function getStorageStats(baseDir: string = DEFAULT_MEDIA_DIR): Promise<{
  totalFiles: number;
  totalSize: number;
  byType: Record<string, { count: number; size: number }>;
}> {
  const stats = {
    totalFiles: 0,
    totalSize: 0,
    byType: {} as Record<string, { count: number; size: number }>,
  };
  
  for (const [mediaType, folder] of Object.entries(MEDIA_TYPE_FOLDERS)) {
    const folderPath = join(baseDir, folder);
    stats.byType[mediaType] = { count: 0, size: 0 };
    
    try {
      const entries = await readdir(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = join(folderPath, entry.name);
          const fileStat = await stat(filePath);
          stats.totalFiles++;
          stats.totalSize += fileStat.size;
          stats.byType[mediaType].count++;
          stats.byType[mediaType].size += fileStat.size;
        }
      }
    } catch {
      // Folder doesn't exist or can't be read
    }
  }
  
  return stats;
}
