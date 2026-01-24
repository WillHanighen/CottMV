/**
 * TMDB (TheMovieDB) API Integration
 * ==================================
 * 
 * This file provides functions to fetch movie and TV show metadata
 * from TheMovieDB API.
 * 
 * API Documentation: https://developers.themoviedb.org/3
 * 
 * Features:
 * - Search for movies by title
 * - Search for TV shows by title
 * - Get detailed movie/show information
 * - Get poster and backdrop images
 */

/**
 * TMDB API base URL
 */
const TMDB_API_BASE = "https://api.themoviedb.org/3";

/**
 * TMDB image base URL
 */
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/**
 * Image sizes available from TMDB
 */
export const IMAGE_SIZES = {
  poster: {
    small: "w185",
    medium: "w342",
    large: "w500",
    original: "original",
  },
  backdrop: {
    small: "w300",
    medium: "w780",
    large: "w1280",
    original: "original",
  },
};

/**
 * Movie search result from TMDB
 */
export interface TMDBMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  vote_average: number;
  popularity: number;
}

/**
 * TV show search result from TMDB
 */
export interface TMDBTVShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  vote_average: number;
  popularity: number;
}

/**
 * Detailed movie information
 */
export interface TMDBMovieDetails {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  runtime: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: Array<{ id: number; name: string }>;
  vote_average: number;
  tagline: string;
  status: string;
  imdb_id: string | null;
}

/**
 * Detailed TV show information
 */
export interface TMDBTVShowDetails {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;
  last_air_date: string;
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  poster_path: string | null;
  backdrop_path: string | null;
  genres: Array<{ id: number; name: string }>;
  vote_average: number;
  tagline: string;
  status: string;
}

/**
 * Normalized metadata result
 */
export interface TMDBMetadata {
  externalId: string;
  externalSource: "tmdb_movie" | "tmdb_tv";
  title: string;
  description: string;
  year: number | undefined;
  genre: string;
  coverUrl: string | undefined;
  backdropUrl: string | undefined;
  rating: number;
  runtime: number | undefined;
}

/**
 * TMDB API client
 */
export class TMDBClient {
  private apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  /**
   * Update the API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }
  
  /**
   * Get the current API key (for checking if configured)
   */
  hasApiKey(): boolean {
    return !!this.apiKey && this.apiKey.trim() !== "";
  }
  
  /**
   * Make a request to the TMDB API
   */
  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${TMDB_API_BASE}${endpoint}`);
    url.searchParams.set("api_key", this.apiKey);
    
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
      },
    });
    
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`TMDB API error: ${response.status} ${response.statusText}`, errorBody);
      throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
  
  /**
   * Search for movies by title
   */
  async searchMovies(query: string, year?: number): Promise<TMDBMovie[]> {
    const params: Record<string, string> = { query };
    if (year) {
      params.year = year.toString();
    }
    
    const result = await this.request<{ results: TMDBMovie[] }>("/search/movie", params);
    return result.results;
  }
  
  /**
   * Search for TV shows by title
   */
  async searchTVShows(query: string, year?: number): Promise<TMDBTVShow[]> {
    const params: Record<string, string> = { query };
    if (year) {
      params.first_air_date_year = year.toString();
    }
    
    const result = await this.request<{ results: TMDBTVShow[] }>("/search/tv", params);
    return result.results;
  }
  
  /**
   * Get detailed movie information
   */
  async getMovieDetails(id: number): Promise<TMDBMovieDetails> {
    return this.request<TMDBMovieDetails>(`/movie/${id}`);
  }
  
  /**
   * Get detailed TV show information
   */
  async getTVShowDetails(id: number): Promise<TMDBTVShowDetails> {
    return this.request<TMDBTVShowDetails>(`/tv/${id}`);
  }
  
  /**
   * Get full image URL
   */
  getImageUrl(path: string | null, size: string = "w500"): string | undefined {
    if (!path) return undefined;
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
  }
  
  /**
   * Search and get best match for a movie
   */
  async findMovie(title: string, year?: number): Promise<TMDBMetadata | null> {
    const results = await this.searchMovies(title, year);
    
    if (results.length === 0) {
      return null;
    }
    
    // Get the best match (first result, usually most relevant)
    const movie = results[0];
    const details = await this.getMovieDetails(movie.id);
    
    return {
      externalId: movie.id.toString(),
      externalSource: "tmdb_movie",
      title: details.title,
      description: details.overview,
      year: details.release_date ? parseInt(details.release_date.slice(0, 4), 10) : undefined,
      genre: details.genres.map((g) => g.name).join(", "),
      coverUrl: this.getImageUrl(details.poster_path, IMAGE_SIZES.poster.medium),
      backdropUrl: this.getImageUrl(details.backdrop_path, IMAGE_SIZES.backdrop.medium),
      rating: details.vote_average,
      runtime: details.runtime,
    };
  }
  
  /**
   * Search and get best match for a TV show
   */
  async findTVShow(title: string, year?: number): Promise<TMDBMetadata | null> {
    const results = await this.searchTVShows(title, year);
    
    if (results.length === 0) {
      return null;
    }
    
    // Get the best match
    const show = results[0];
    const details = await this.getTVShowDetails(show.id);
    
    return {
      externalId: show.id.toString(),
      externalSource: "tmdb_tv",
      title: details.name,
      description: details.overview,
      year: details.first_air_date ? parseInt(details.first_air_date.slice(0, 4), 10) : undefined,
      genre: details.genres.map((g) => g.name).join(", "),
      coverUrl: this.getImageUrl(details.poster_path, IMAGE_SIZES.poster.medium),
      backdropUrl: this.getImageUrl(details.backdrop_path, IMAGE_SIZES.backdrop.medium),
      rating: details.vote_average,
      runtime: details.episode_run_time?.[0],
    };
  }
}

/**
 * Create a TMDB client from environment variable or provided key
 */
export function createTMDBClient(apiKey?: string): TMDBClient | null {
  const key = apiKey || process.env.TMDB_API_KEY;
  if (!key || key.trim() === "" || key === "your-tmdb-api-key") {
    console.warn("[TMDB] API key not configured. Set TMDB_API_KEY environment variable or configure in settings.");
    return null;
  }
  console.log("[TMDB] Client initialized with API key");
  return new TMDBClient(key.trim());
}

/**
 * Create an unconfigured TMDB client that can be configured later
 */
export function createUnconfiguredTMDBClient(): TMDBClient {
  return new TMDBClient("");
}
