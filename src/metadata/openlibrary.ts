/**
 * Open Library API Integration
 * ============================
 * 
 * This file provides functions to fetch book metadata from Open Library.
 * Open Library is a free, open-source library catalog.
 * 
 * API Documentation: https://openlibrary.org/developers/api
 * 
 * Features:
 * - Search for books by title
 * - Search for books by author
 * - Get book cover images
 * - Get detailed book information
 */

/**
 * Open Library API base URL
 */
const OPENLIBRARY_API_BASE = "https://openlibrary.org";

/**
 * Open Library covers base URL
 */
const COVERS_BASE = "https://covers.openlibrary.org";

/**
 * Book search result from Open Library
 */
export interface OLBook {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  subject?: string[];
  publisher?: string[];
  language?: string[];
  number_of_pages_median?: number;
}

/**
 * Book details from Open Library
 */
export interface OLBookDetails {
  key: string;
  title: string;
  description?: string | { value: string };
  covers?: number[];
  subjects?: Array<{ name: string }>;
  first_publish_date?: string;
  authors?: Array<{ author: { key: string } }>;
}

/**
 * Author details from Open Library
 */
export interface OLAuthor {
  key: string;
  name: string;
  bio?: string | { value: string };
  birth_date?: string;
  death_date?: string;
}

/**
 * Normalized book metadata result
 */
export interface BookMetadata {
  externalId: string;
  externalSource: "openlibrary";
  title: string;
  artist: string; // Author
  description?: string;
  year?: number;
  genre?: string;
  coverUrl?: string;
  isbn?: string;
  pages?: number;
}

/**
 * Open Library API client
 */
export class OpenLibraryClient {
  /**
   * Make a request to the Open Library API
   */
  private async request<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "CottMV/1.0.0",
      },
    });
    
    if (!response.ok) {
      throw new Error(`Open Library API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
  
  /**
   * Search for books
   */
  async searchBooks(query: string, author?: string): Promise<OLBook[]> {
    let searchUrl = `${OPENLIBRARY_API_BASE}/search.json?q=${encodeURIComponent(query)}&limit=10`;
    
    if (author) {
      searchUrl += `&author=${encodeURIComponent(author)}`;
    }
    
    const result = await this.request<{ docs: OLBook[] }>(searchUrl);
    return result.docs || [];
  }
  
  /**
   * Get book details by work key
   */
  async getBookDetails(workKey: string): Promise<OLBookDetails> {
    // Ensure the key starts with /works/
    const key = workKey.startsWith("/works/") ? workKey : `/works/${workKey}`;
    return this.request<OLBookDetails>(`${OPENLIBRARY_API_BASE}${key}.json`);
  }
  
  /**
   * Get author details
   */
  async getAuthor(authorKey: string): Promise<OLAuthor> {
    // Ensure the key starts with /authors/
    const key = authorKey.startsWith("/authors/") ? authorKey : `/authors/${authorKey}`;
    return this.request<OLAuthor>(`${OPENLIBRARY_API_BASE}${key}.json`);
  }
  
  /**
   * Get cover image URL
   */
  getCoverUrl(coverId: number | undefined, size: "S" | "M" | "L" = "M"): string | undefined {
    if (!coverId) return undefined;
    return `${COVERS_BASE}/b/id/${coverId}-${size}.jpg`;
  }
  
  /**
   * Get cover URL by ISBN
   */
  getCoverUrlByISBN(isbn: string, size: "S" | "M" | "L" = "M"): string {
    return `${COVERS_BASE}/b/isbn/${isbn}-${size}.jpg`;
  }
  
  /**
   * Extract description text from Open Library format
   */
  private extractDescription(desc: string | { value: string } | undefined): string | undefined {
    if (!desc) return undefined;
    if (typeof desc === "string") return desc;
    return desc.value;
  }
  
  /**
   * Find metadata for a book
   */
  async findBook(title: string, author?: string): Promise<BookMetadata | null> {
    const books = await this.searchBooks(title, author);
    
    if (books.length === 0) {
      return null;
    }
    
    const book = books[0];
    
    // Try to get more details
    let description: string | undefined;
    let subjects: string[] = [];
    
    if (book.key) {
      try {
        const details = await this.getBookDetails(book.key);
        description = this.extractDescription(details.description);
        subjects = details.subjects?.map((s) => s.name) || [];
      } catch {
        // Continue without details
      }
    }
    
    // Use subjects from search if we didn't get them from details
    if (subjects.length === 0 && book.subject) {
      subjects = book.subject.slice(0, 5);
    }
    
    return {
      externalId: book.key.replace("/works/", ""),
      externalSource: "openlibrary",
      title: book.title,
      artist: book.author_name?.join(", ") || "Unknown Author",
      description,
      year: book.first_publish_year,
      genre: subjects.join(", "),
      coverUrl: this.getCoverUrl(book.cover_i, "M"),
      isbn: book.isbn?.[0],
      pages: book.number_of_pages_median,
    };
  }
  
  /**
   * Search by ISBN
   */
  async findByISBN(isbn: string): Promise<BookMetadata | null> {
    const searchUrl = `${OPENLIBRARY_API_BASE}/search.json?isbn=${encodeURIComponent(isbn)}&limit=1`;
    const result = await this.request<{ docs: OLBook[] }>(searchUrl);
    
    if (!result.docs || result.docs.length === 0) {
      return null;
    }
    
    const book = result.docs[0];
    
    return {
      externalId: book.key.replace("/works/", ""),
      externalSource: "openlibrary",
      title: book.title,
      artist: book.author_name?.join(", ") || "Unknown Author",
      year: book.first_publish_year,
      genre: book.subject?.slice(0, 5).join(", "),
      coverUrl: this.getCoverUrlByISBN(isbn, "M"),
      isbn,
      pages: book.number_of_pages_median,
    };
  }
}

/**
 * Create an Open Library client
 * Note: Open Library doesn't require an API key
 */
export function createOpenLibraryClient(): OpenLibraryClient {
  return new OpenLibraryClient();
}
