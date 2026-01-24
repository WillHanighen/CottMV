/**
 * Metadata Service
 * ================
 * 
 * This file provides a unified interface for fetching metadata
 * from various external APIs based on media type.
 * 
 * Supported sources:
 * - TMDB (TheMovieDB) for movies and TV shows
 * - MusicBrainz for music
 * - Open Library for books/documents
 */

import { createTMDBClient, createUnconfiguredTMDBClient, TMDBClient, type TMDBMetadata } from "./tmdb.js";
import { createMusicBrainzClient, type MusicMetadata } from "./musicbrainz.js";
import { createOpenLibraryClient, type BookMetadata } from "./openlibrary.js";
import { parseFilename } from "../media/utils.js";
import type { MediaType } from "../media/utils.js";

/**
 * Unified metadata result
 */
export interface MediaMetadata {
  externalId: string;
  externalSource: string;
  title: string;
  description?: string;
  year?: number;
  genre?: string;
  coverUrl?: string;
  artist?: string;
  album?: string;
  duration?: number;
}

/**
 * Metadata service for fetching external metadata
 */
export class MetadataService {
  private tmdb: TMDBClient | null = createTMDBClient();
  private musicbrainz = createMusicBrainzClient();
  private openlibrary = createOpenLibraryClient();
  
  /**
   * Check if TMDB is configured
   */
  isTMDBConfigured(): boolean {
    return this.tmdb !== null && this.tmdb.hasApiKey();
  }
  
  /**
   * Configure TMDB with an API key
   * This allows setting the API key from database settings
   */
  configureTMDB(apiKey: string | null | undefined): void {
    if (apiKey && apiKey.trim() !== "") {
      if (this.tmdb) {
        this.tmdb.setApiKey(apiKey.trim());
      } else {
        this.tmdb = createTMDBClient(apiKey.trim());
      }
      console.log("[MetadataService] TMDB configured with API key from settings");
    } else {
      // If no valid key provided, try from environment
      this.tmdb = createTMDBClient();
    }
  }
  
  /**
   * Fetch metadata for a media file based on its type
   */
  async fetchMetadata(
    filename: string,
    mediaType: MediaType
  ): Promise<MediaMetadata | null> {
    const parsed = parseFilename(filename);
    
    switch (mediaType) {
      case "video":
        return this.fetchVideoMetadata(parsed.title, parsed.year, parsed.season !== undefined);
      
      case "audio":
        return this.fetchAudioMetadata(parsed.title, parsed.artist, parsed.album);
      
      case "document":
        return this.fetchBookMetadata(parsed.title, parsed.artist);
      
      default:
        return null;
    }
  }
  
  /**
   * Fetch video metadata from TMDB
   */
  async fetchVideoMetadata(
    title: string,
    year?: number,
    isTVShow = false
  ): Promise<MediaMetadata | null> {
    if (!this.tmdb) {
      console.warn("TMDB API key not configured");
      return null;
    }
    
    try {
      let result: TMDBMetadata | null;
      
      if (isTVShow) {
        result = await this.tmdb.findTVShow(title, year);
      } else {
        result = await this.tmdb.findMovie(title, year);
      }
      
      if (!result) {
        // Try the other type if first search failed
        result = isTVShow 
          ? await this.tmdb.findMovie(title, year)
          : await this.tmdb.findTVShow(title, year);
      }
      
      if (!result) {
        return null;
      }
      
      return {
        externalId: result.externalId,
        externalSource: result.externalSource,
        title: result.title,
        description: result.description,
        year: result.year,
        genre: result.genre,
        coverUrl: result.coverUrl,
        duration: result.runtime ? result.runtime * 60 : undefined, // Convert minutes to seconds
      };
    } catch (error) {
      console.error("Error fetching video metadata:", error);
      return null;
    }
  }
  
  /**
   * Fetch audio metadata from MusicBrainz
   */
  async fetchAudioMetadata(
    title: string,
    artist?: string,
    album?: string
  ): Promise<MediaMetadata | null> {
    try {
      // Try to find as a song first
      let result = await this.musicbrainz.findSong(title, artist);
      
      // If no result and we have album info, try finding the album
      if (!result && album) {
        const albumResult = await this.musicbrainz.findAlbum(album, artist);
        if (albumResult) {
          result = {
            ...albumResult,
            title, // Keep original title
          };
        }
      }
      
      if (!result) {
        return null;
      }
      
      return {
        externalId: result.externalId,
        externalSource: result.externalSource,
        title: result.title,
        year: result.year,
        genre: result.genre,
        coverUrl: result.coverUrl,
        artist: result.artist,
        album: result.album,
        duration: result.duration,
      };
    } catch (error) {
      console.error("Error fetching audio metadata:", error);
      return null;
    }
  }
  
  /**
   * Fetch book metadata from Open Library
   */
  async fetchBookMetadata(
    title: string,
    author?: string
  ): Promise<MediaMetadata | null> {
    try {
      const result = await this.openlibrary.findBook(title, author);
      
      if (!result) {
        return null;
      }
      
      return {
        externalId: result.externalId,
        externalSource: result.externalSource,
        title: result.title,
        description: result.description,
        year: result.year,
        genre: result.genre,
        coverUrl: result.coverUrl,
        artist: result.artist, // Author
      };
    } catch (error) {
      console.error("Error fetching book metadata:", error);
      return null;
    }
  }
  
  /**
   * Search for video metadata
   */
  async searchVideos(query: string, year?: number): Promise<TMDBMetadata[]> {
    if (!this.tmdb) {
      return [];
    }
    
    try {
      const [movies, tvShows] = await Promise.all([
        this.tmdb.searchMovies(query, year),
        this.tmdb.searchTVShows(query, year),
      ]);
      
      // Combine and sort by popularity
      const results: TMDBMetadata[] = [];
      
      for (const movie of movies.slice(0, 5)) {
        results.push({
          externalId: movie.id.toString(),
          externalSource: "tmdb_movie",
          title: movie.title,
          description: movie.overview,
          year: movie.release_date ? parseInt(movie.release_date.slice(0, 4), 10) : undefined,
          genre: "",
          coverUrl: this.tmdb.getImageUrl(movie.poster_path),
          backdropUrl: this.tmdb.getImageUrl(movie.backdrop_path),
          rating: movie.vote_average,
          runtime: undefined,
        });
      }
      
      for (const show of tvShows.slice(0, 5)) {
        results.push({
          externalId: show.id.toString(),
          externalSource: "tmdb_tv",
          title: show.name,
          description: show.overview,
          year: show.first_air_date ? parseInt(show.first_air_date.slice(0, 4), 10) : undefined,
          genre: "",
          coverUrl: this.tmdb.getImageUrl(show.poster_path),
          backdropUrl: this.tmdb.getImageUrl(show.backdrop_path),
          rating: show.vote_average,
          runtime: undefined,
        });
      }
      
      return results;
    } catch (error) {
      console.error("Error searching videos:", error);
      return [];
    }
  }
}

/**
 * Create a metadata service instance
 */
export function createMetadataService(): MetadataService {
  return new MetadataService();
}

// Re-export types
export type { TMDBMetadata } from "./tmdb.js";
export type { MusicMetadata } from "./musicbrainz.js";
export type { BookMetadata } from "./openlibrary.js";
