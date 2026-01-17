/**
 * Server Type Definitions
 * =======================
 * 
 * This file contains TypeScript type definitions for the server.
 * It extends Hono's context to include our custom properties.
 */

import { ConvexHttpClient } from "convex/browser";

/**
 * Custom variables available in Hono context
 * 
 * These are set in middleware and available in all route handlers.
 */
export interface Variables {
  /** Convex database client */
  convex: ConvexHttpClient;
}

/**
 * Environment bindings (for Cloudflare Workers compatibility)
 * Not used in Bun, but included for type completeness.
 */
export interface Bindings {
  CONVEX_URL: string;
}
