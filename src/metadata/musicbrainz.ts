/**
 * MusicBrainz API Integration
 * ===========================
 * 
 * This file provides functions to fetch music metadata from MusicBrainz.
 * MusicBrainz is a free, open music encyclopedia.
 * 
 * API Documentation: https://musicbrainz.org/doc/MusicBrainz_API
 * 
 * Features:
 * - Search for recordings (songs)
 * - Search for releases (albums)
 * - Search for artists
 * - Get cover art from Cover Art Archive
 */

/**
 * MusicBrainz API base URL
 */
const MUSICBRAINZ_API_BASE = "https://musicbrainz.org/ws/2";

/**
 * Cover Art Archive base URL
 */
const COVER_ART_BASE = "https://coverartarchive.org";

/**
 * User agent for API requests (required by MusicBrainz)
 */
const USER_AGENT = "CottMV/1.0.0 (https://github.com/cottmv)";

/**
 * Recording (song) from MusicBrainz
 */
export interface MBRecording {
  id: string;
  title: string;
  length?: number;
  "artist-credit"?: Array<{
    artist: {
      id: string;
      name: string;
    };
  }>;
  releases?: Array<{
    id: string;
    title: string;
    date?: string;
  }>;
}

/**
 * Release (album) from MusicBrainz
 */
export interface MBRelease {
  id: string;
  title: string;
  date?: string;
  "artist-credit"?: Array<{
    artist: {
      id: string;
      name: string;
    };
  }>;
  "release-group"?: {
    id: string;
    "primary-type"?: string;
  };
}

/**
 * Artist from MusicBrainz
 */
export interface MBArtist {
  id: string;
  name: string;
  "sort-name": string;
  type?: string;
  country?: string;
  "life-span"?: {
    begin?: string;
    end?: string;
  };
}

/**
 * Normalized music metadata result
 */
export interface MusicMetadata {
  externalId: string;
  externalSource: "musicbrainz";
  title: string;
  artist: string;
  album?: string;
  year?: number;
  genre?: string;
  coverUrl?: string;
  duration?: number;
}

/**
 * MusicBrainz API client
 */
export class MusicBrainzClient {
  private lastRequestTime = 0;
  private minRequestInterval = 1100; // MusicBrainz rate limit: 1 request per second
  
  /**
   * Wait to respect rate limits
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise((resolve) => 
        setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  }
  
  /**
   * Make a request to the MusicBrainz API
   */
  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    await this.rateLimit();
    
    const url = new URL(`${MUSICBRAINZ_API_BASE}${endpoint}`);
    url.searchParams.set("fmt", "json");
    
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    
    if (!response.ok) {
      throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
  
  /**
   * Search for recordings (songs)
   */
  async searchRecordings(query: string, artist?: string): Promise<MBRecording[]> {
    let searchQuery = `recording:"${query}"`;
    if (artist) {
      searchQuery += ` AND artist:"${artist}"`;
    }
    
    const result = await this.request<{ recordings: MBRecording[] }>("/recording", {
      query: searchQuery,
      limit: "10",
    });
    
    return result.recordings || [];
  }
  
  /**
   * Search for releases (albums)
   */
  async searchReleases(query: string, artist?: string): Promise<MBRelease[]> {
    let searchQuery = `release:"${query}"`;
    if (artist) {
      searchQuery += ` AND artist:"${artist}"`;
    }
    
    const result = await this.request<{ releases: MBRelease[] }>("/release", {
      query: searchQuery,
      limit: "10",
    });
    
    return result.releases || [];
  }
  
  /**
   * Search for artists
   */
  async searchArtists(query: string): Promise<MBArtist[]> {
    const result = await this.request<{ artists: MBArtist[] }>("/artist", {
      query: `artist:"${query}"`,
      limit: "10",
    });
    
    return result.artists || [];
  }
  
  /**
   * Get cover art URL for a release
   */
  async getCoverArtUrl(releaseId: string): Promise<string | undefined> {
    try {
      const response = await fetch(`${COVER_ART_BASE}/release/${releaseId}`, {
        headers: {
          "Accept": "application/json",
          "User-Agent": USER_AGENT,
        },
      });
      
      if (!response.ok) {
        return undefined;
      }
      
      const data = await response.json();
      
      // Find the front cover
      const frontCover = data.images?.find((img: any) => img.front);
      if (frontCover) {
        return frontCover.thumbnails?.["500"] || frontCover.image;
      }
      
      // Fall back to first image
      if (data.images?.length > 0) {
        return data.images[0].thumbnails?.["500"] || data.images[0].image;
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }
  
  /**
   * Find metadata for a song
   */
  async findSong(title: string, artist?: string): Promise<MusicMetadata | null> {
    const recordings = await this.searchRecordings(title, artist);
    
    if (recordings.length === 0) {
      return null;
    }
    
    const recording = recordings[0];
    const artistName = recording["artist-credit"]?.[0]?.artist?.name || artist || "Unknown Artist";
    const release = recording.releases?.[0];
    
    let coverUrl: string | undefined;
    if (release) {
      coverUrl = await this.getCoverArtUrl(release.id);
    }
    
    return {
      externalId: recording.id,
      externalSource: "musicbrainz",
      title: recording.title,
      artist: artistName,
      album: release?.title,
      year: release?.date ? parseInt(release.date.slice(0, 4), 10) : undefined,
      coverUrl,
      duration: recording.length ? Math.round(recording.length / 1000) : undefined,
    };
  }
  
  /**
   * Find metadata for an album
   */
  async findAlbum(title: string, artist?: string): Promise<MusicMetadata | null> {
    const releases = await this.searchReleases(title, artist);
    
    if (releases.length === 0) {
      return null;
    }
    
    const release = releases[0];
    const artistName = release["artist-credit"]?.[0]?.artist?.name || artist || "Unknown Artist";
    
    const coverUrl = await this.getCoverArtUrl(release.id);
    
    return {
      externalId: release.id,
      externalSource: "musicbrainz",
      title: release.title,
      artist: artistName,
      album: release.title,
      year: release.date ? parseInt(release.date.slice(0, 4), 10) : undefined,
      coverUrl,
    };
  }
}

/**
 * Create a MusicBrainz client
 * Note: MusicBrainz doesn't require an API key
 */
export function createMusicBrainzClient(): MusicBrainzClient {
  return new MusicBrainzClient();
}
