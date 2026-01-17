/**
 * Cloudflare R2 Storage Module
 * ============================
 * 
 * This module handles backup and retrieval of media files to/from Cloudflare R2.
 * R2 is Cloudflare's S3-compatible object storage service.
 * 
 * Why R2?
 * - S3-compatible API (works with existing AWS SDK)
 * - No egress fees (free to download your data)
 * - Affordable storage pricing
 * - Global distribution via Cloudflare's network
 * 
 * Key Concepts:
 * - Bucket: A container for storing objects (like a folder)
 * - Object: A file stored in the bucket
 * - Key: The unique identifier/path for an object in the bucket
 * - Multipart Upload: Uploading large files in chunks
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "fs";
import { stat, mkdir } from "fs/promises";
import { dirname } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/**
 * R2 Configuration
 * 
 * These values come from your Cloudflare dashboard:
 * 1. Go to R2 in your Cloudflare dashboard
 * 2. Create a bucket if you haven't already
 * 3. Go to "Manage R2 API Tokens" to create access keys
 */
export interface R2Config {
  /** Your R2 Access Key ID */
  accessKeyId: string;
  /** Your R2 Secret Access Key */
  secretAccessKey: string;
  /** Your R2 bucket name */
  bucketName: string;
  /** Your R2 endpoint URL (e.g., https://xxx.r2.cloudflarestorage.com) */
  endpoint: string;
}

/**
 * R2 Storage Client
 * 
 * This class wraps the AWS S3 SDK to provide a simple interface
 * for uploading, downloading, and managing files in R2.
 */
export class R2Storage {
  private client: S3Client;
  private bucketName: string;

  /**
   * Create a new R2 storage client
   * 
   * @param config - R2 configuration
   * 
   * @example
   * ```typescript
   * const r2 = new R2Storage({
   *   accessKeyId: "your-access-key",
   *   secretAccessKey: "your-secret-key",
   *   bucketName: "media-backup",
   *   endpoint: "https://xxx.r2.cloudflarestorage.com",
   * });
   * ```
   */
  constructor(config: R2Config) {
    // Validate configuration
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error("R2 access credentials are required");
    }
    if (!config.bucketName) {
      throw new Error("R2 bucket name is required");
    }
    if (!config.endpoint) {
      throw new Error("R2 endpoint is required");
    }

    this.bucketName = config.bucketName;

    // Create S3 client configured for R2
    const clientConfig: S3ClientConfig = {
      region: "auto", // R2 uses "auto" for region
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };

    this.client = new S3Client(clientConfig);
  }

  /**
   * Upload a file to R2
   * 
   * @param localPath - Path to the local file
   * @param r2Key - Key (path) to store the file under in R2
   * @param contentType - MIME type of the file (optional)
   * @returns Object with upload details
   * 
   * @example
   * ```typescript
   * await r2.uploadFile(
   *   "/media/movies/inception.mp4",
   *   "movies/inception.mp4",
   *   "video/mp4"
   * );
   * ```
   */
  async uploadFile(
    localPath: string,
    r2Key: string,
    contentType?: string
  ): Promise<{ key: string; size: number }> {
    // Get file size for progress tracking
    const fileStats = await stat(localPath);
    const fileSize = fileStats.size;

    // Create a read stream for the file
    const fileStream = createReadStream(localPath);

    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: r2Key,
      Body: fileStream,
      ContentType: contentType || "application/octet-stream",
      ContentLength: fileSize,
    });

    await this.client.send(command);

    return {
      key: r2Key,
      size: fileSize,
    };
  }

  /**
   * Download a file from R2
   * 
   * @param r2Key - Key of the file in R2
   * @param localPath - Path to save the file locally
   * @returns Object with download details
   * 
   * @example
   * ```typescript
   * await r2.downloadFile(
   *   "movies/inception.mp4",
   *   "/media/restored/inception.mp4"
   * );
   * ```
   */
  async downloadFile(
    r2Key: string,
    localPath: string
  ): Promise<{ key: string; size: number }> {
    // Ensure the directory exists
    await mkdir(dirname(localPath), { recursive: true });

    // Get the object from R2
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: r2Key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`No body in response for key: ${r2Key}`);
    }

    // Stream the response to a file
    const writeStream = createWriteStream(localPath);
    
    // Convert the response body to a Node.js readable stream
    const bodyStream = response.Body as Readable;
    await pipeline(bodyStream, writeStream);

    return {
      key: r2Key,
      size: response.ContentLength || 0,
    };
  }

  /**
   * Delete a file from R2
   * 
   * @param r2Key - Key of the file to delete
   * 
   * @example
   * ```typescript
   * await r2.deleteFile("movies/old-movie.mp4");
   * ```
   */
  async deleteFile(r2Key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: r2Key,
    });

    await this.client.send(command);
  }

  /**
   * Check if a file exists in R2
   * 
   * @param r2Key - Key to check
   * @returns true if the file exists, false otherwise
   */
  async fileExists(r2Key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: r2Key,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      // HeadObject throws an error if the object doesn't exist
      return false;
    }
  }

  /**
   * Get metadata about a file in R2
   * 
   * @param r2Key - Key of the file
   * @returns Object with file metadata
   */
  async getFileInfo(r2Key: string): Promise<{
    key: string;
    size: number;
    lastModified: Date | undefined;
    contentType: string | undefined;
  }> {
    const command = new HeadObjectCommand({
      Bucket: this.bucketName,
      Key: r2Key,
    });

    const response = await this.client.send(command);

    return {
      key: r2Key,
      size: response.ContentLength || 0,
      lastModified: response.LastModified,
      contentType: response.ContentType,
    };
  }

  /**
   * List files in R2 with a given prefix
   * 
   * @param prefix - Prefix to filter files (like a folder path)
   * @param maxKeys - Maximum number of files to return (default 1000)
   * @returns Array of file information objects
   * 
   * @example
   * ```typescript
   * // List all files in the "movies" folder
   * const files = await r2.listFiles("movies/");
   * ```
   */
  async listFiles(
    prefix?: string,
    maxKeys: number = 1000
  ): Promise<Array<{
    key: string;
    size: number;
    lastModified: Date | undefined;
  }>> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await this.client.send(command);

    return (response.Contents || []).map((item) => ({
      key: item.Key || "",
      size: item.Size || 0,
      lastModified: item.LastModified,
    }));
  }

  /**
   * Generate a pre-signed URL for direct download
   * 
   * Pre-signed URLs allow temporary direct access to a file
   * without exposing your credentials. Useful for:
   * - Allowing users to download files directly from R2
   * - Streaming video directly from R2
   * 
   * @param r2Key - Key of the file
   * @param expiresIn - URL expiration time in seconds (default 1 hour)
   * @returns Pre-signed URL string
   * 
   * @example
   * ```typescript
   * const url = await r2.getSignedUrl("movies/inception.mp4", 3600);
   * // User can now download directly from this URL for 1 hour
   * ```
   */
  async getSignedDownloadUrl(
    r2Key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: r2Key,
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Get storage statistics
   * 
   * @returns Object with storage statistics
   */
  async getStats(): Promise<{
    totalFiles: number;
    totalSizeBytes: number;
    totalSizeGb: number;
  }> {
    let totalFiles = 0;
    let totalSizeBytes = 0;
    let continuationToken: string | undefined;

    // Paginate through all objects
    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);

      for (const item of response.Contents || []) {
        totalFiles++;
        totalSizeBytes += item.Size || 0;
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return {
      totalFiles,
      totalSizeBytes,
      totalSizeGb: Math.round((totalSizeBytes / (1024 * 1024 * 1024)) * 100) / 100,
    };
  }
}

/**
 * Create an R2 storage client from configuration
 * 
 * This is a convenience function that creates an R2Storage instance
 * if the configuration is valid, or returns null if R2 is not configured.
 * 
 * @param config - R2 configuration (may have empty values)
 * @returns R2Storage instance or null
 */
export function createR2Client(config: Partial<R2Config>): R2Storage | null {
  // Check if all required fields are present
  if (
    !config.accessKeyId ||
    !config.secretAccessKey ||
    !config.bucketName ||
    !config.endpoint
  ) {
    return null;
  }

  try {
    return new R2Storage(config as R2Config);
  } catch {
    return null;
  }
}

/**
 * Generate an R2 key from a local file path
 * 
 * Converts a local file path to a suitable R2 key.
 * Removes leading slashes and normalizes path separators.
 * 
 * @param localPath - Local file path
 * @param prefix - Optional prefix to add (e.g., "media/")
 * @returns R2 key string
 * 
 * @example
 * ```typescript
 * const key = generateR2Key("/media/movies/inception.mp4", "backup/");
 * // Returns: "backup/media/movies/inception.mp4"
 * ```
 */
export function generateR2Key(localPath: string, prefix: string = ""): string {
  // Normalize path separators and remove leading slashes
  let key = localPath.replace(/\\/g, "/").replace(/^\/+/, "");
  
  // Add prefix if provided
  if (prefix) {
    const normalizedPrefix = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
    key = `${normalizedPrefix}/${key}`;
  }
  
  return key;
}
