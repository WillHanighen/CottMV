/**
 * Convex Database Schema
 * ======================
 * 
 * This file defines the structure of our database tables.
 * Think of it like a blueprint for what data we'll store.
 * 
 * Tables:
 * - users: Stores GitHub OAuth user data and roles
 * - sessions: Stores user authentication sessions
 * - media: Stores information about each media file
 * - settings: Stores app configuration (R2 credentials, cache settings, etc.)
 * - transcodedCache: Tracks transcoded video files for cleanup
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Media type categories for filtering
 */
export const MEDIA_TYPES = ["video", "audio", "image", "gif", "document", "other"] as const;

/**
 * User roles for access control
 */
export const USER_ROLES = ["user", "admin"] as const;

export default defineSchema({
  /**
   * Users Table
   * -----------
   * Stores GitHub OAuth user information.
   * 
   * Fields:
   * - githubId: Unique GitHub user ID
   * - username: GitHub username
   * - displayName: User's display name from GitHub
   * - email: User's email (may be null if private)
   * - avatarUrl: URL to GitHub profile picture
   * - role: User role (user or admin)
   * - createdAt: When the user first logged in
   * - lastLoginAt: When the user last logged in
   */
  users: defineTable({
    githubId: v.number(),
    username: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("admin")),
    createdAt: v.number(),
    lastLoginAt: v.number(),
  })
    .index("by_github_id", ["githubId"])
    .index("by_username", ["username"])
    .index("by_role", ["role"]),

  /**
   * Sessions Table
   * --------------
   * Stores user authentication sessions.
   * 
   * Fields:
   * - userId: Reference to the user
   * - token: Unique session token (stored as hash)
   * - expiresAt: When the session expires
   * - createdAt: When the session was created
   * - userAgent: Browser/client info
   * - ipAddress: Client IP (for security)
   */
  sessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    userAgent: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["tokenHash"])
    .index("by_expiry", ["expiresAt"]),

  /**
   * Media Table
   * -----------
   * Each row represents a media file in your library.
   * 
   * Fields:
   * - title: Display name for the media
   * - filename: Original filename on disk
   * - filepath: Full path to the file on the server
   * - mimeType: Media format (e.g., "video/mp4", "audio/mp3")
   * - extension: File extension (e.g., "mp4", "mp3", "jpg")
   * - mediaType: Category (video, audio, image, gif, document, other)
   * - size: File size in bytes
   * - duration: Media length in seconds (for video/audio)
   * - thumbnail: Path to generated thumbnail image
   * - coverUrl: URL to cover image from external API
   * - r2Key: Key in R2 bucket if backed up
   * - r2BackedUp: Whether the file has been backed up to R2
   * 
   * External Metadata Fields:
   * - externalId: ID from external API (TMDB, MusicBrainz, etc.)
   * - externalSource: Which API the metadata came from
   * - description: Description/synopsis from external API
   * - year: Release year
   * - genre: Genre(s) as comma-separated string
   * - artist: Artist/author name (for music/books)
   * - album: Album name (for music)
   * - metadataFetchedAt: When metadata was last fetched
   * 
   * - createdAt: When the file was added to the library
   * - updatedAt: When the record was last modified
   */
  media: defineTable({
    title: v.string(),
    filename: v.string(),
    filepath: v.string(),
    mimeType: v.string(),
    extension: v.string(),
    mediaType: v.union(
      v.literal("video"),
      v.literal("audio"),
      v.literal("image"),
      v.literal("gif"),
      v.literal("document"),
      v.literal("other")
    ),
    size: v.number(),
    duration: v.optional(v.number()),
    thumbnail: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    r2BackedUp: v.boolean(),
    // External metadata
    externalId: v.optional(v.string()),
    externalSource: v.optional(v.string()),
    description: v.optional(v.string()),
    year: v.optional(v.number()),
    genre: v.optional(v.string()),
    artist: v.optional(v.string()),
    album: v.optional(v.string()),
    metadataFetchedAt: v.optional(v.number()),
    // Tags - array of tag IDs
    tags: v.optional(v.array(v.id("tags"))),
    // File hash for duplicate detection
    fileHash: v.optional(v.string()),
    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_filename", ["filename"])
    .index("by_backup_status", ["r2BackedUp"])
    .index("by_media_type", ["mediaType"])
    .index("by_extension", ["extension"])
    .index("by_external_id", ["externalSource", "externalId"])
    .index("by_file_hash", ["fileHash"]),

  /**
   * Tags Table
   * ----------
   * Stores user-defined tags for organizing media files.
   *
   * Fields:
   * - name: Tag display name (e.g., "Movies", "Music", "Memes")
   * - color: Optional hex color for the tag (e.g., "#FF5733")
   * - isNsfw: Whether this tag marks content as NSFW (blurs thumbnails, asks before playing)
   * - createdAt: When the tag was created
   * - updatedAt: When the tag was last modified
   */
  tags: defineTable({
    name: v.string(),
    color: v.optional(v.string()),
    isNsfw: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"]),

  /**
   * Settings Table
   * --------------
   * Stores application configuration as key-value pairs.
   * This allows admins to configure the app through the UI.
   * 
   * Common settings:
   * - r2_access_key_id: Cloudflare R2 access key
   * - r2_secret_access_key: Cloudflare R2 secret key
   * - r2_bucket_name: Name of the R2 bucket
   * - r2_endpoint: R2 endpoint URL
   * - cache_max_size_gb: Maximum size of transcoded cache in GB
   * - cache_ttl_hours: How long to keep transcoded files
   * - media_directory: Where to look for media files
   * - github_client_id: GitHub OAuth client ID
   * - github_client_secret: GitHub OAuth client secret
   * - admin_usernames: Comma-separated list of admin GitHub usernames
   * - tmdb_api_key: TheMovieDB API key
   * - lastfm_api_key: Last.fm API key
   */
  settings: defineTable({
    key: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"]),

  /**
   * Transcoded Cache Table
   * ----------------------
   * Tracks transcoded video files so we can clean them up.
   * When a video is transcoded for streaming, we cache the result
   * to avoid re-transcoding. This table helps manage that cache.
   * 
   * Fields:
   * - mediaId: Reference to the original media file
   * - transcodedPath: Path to the transcoded file
   * - format: Output format (e.g., "mp4", "webm")
   * - resolution: Output resolution (e.g., "720p", "1080p")
   * - size: Size of transcoded file in bytes
   * - createdAt: When the transcoded file was created
   * - lastAccessedAt: When the file was last streamed
   * - expiresAt: When this cache entry should be deleted
   */
  transcodedCache: defineTable({
    mediaId: v.id("media"),
    transcodedPath: v.string(),
    format: v.string(),
    resolution: v.string(),
    size: v.number(),
    createdAt: v.number(),
    lastAccessedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_media", ["mediaId"])
    .index("by_expiry", ["expiresAt"]),
});
