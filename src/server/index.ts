/**
 * Main Server Entry Point
 * =======================
 * 
 * This is the main server file that sets up the Hono web framework
 * and defines all the routes for the application.
 * 
 * Hono is a lightweight, fast web framework that works great with Bun.
 * It's similar to Express.js but more modern and TypeScript-friendly.
 * 
 * The server handles:
 * - Authentication via GitHub OAuth
 * - Serving the frontend pages (SSR)
 * - API endpoints for media operations
 * - Video streaming
 * - Admin settings
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { ConvexHttpClient } from "convex/browser";

// Import route handlers
import { mediaRoutes } from "./routes/media.js";
import { streamRoutes } from "./routes/stream.js";
import { adminRoutes } from "./routes/admin.js";
import { pageRoutes } from "./routes/pages.js";
import authRoutes from "./routes/auth.js";
import { metadataRoutes } from "./routes/metadata.js";
import { uploadRoutes } from "./routes/upload.js";
import { tagsRoutes } from "./routes/tags.js";

// Import authentication middleware
import { authMiddleware, adminMiddleware, optionalAuthMiddleware } from "./auth/middleware.js";

// Import storage initialization
import { initializeStorage, DEFAULT_MEDIA_DIR } from "../storage/local.js";

// Import API functions
import { api } from "../../convex/_generated/api";

/**
 * Environment variables configuration
 * 
 * These are loaded from .env file or system environment
 */
const CONVEX_URL = process.env.CONVEX_URL || "";
const PORT = parseInt(process.env.PORT || "3000", 10);

/**
 * Type for Hono context variables
 */
type Variables = {
  convex: ConvexHttpClient;
  user?: {latest
    _id: string;
    githubId: string;
    username: string;
    role: string;
  };
};

/**
 * Create the main Hono application
 */
const app = new Hono<{ Variables: Variables }>();

/**
 * Create Convex client for database operations
 * 
 * The ConvexHttpClient is used for server-side database operations.
 * It connects to your Convex deployment using the URL from your dashboard.
 */
const convex = new ConvexHttpClient(CONVEX_URL);

/**
 * Middleware Setup
 * ================
 * 
 * Middleware are functions that run before your route handlers.
 * They can modify requests, add headers, log information, etc.
 */

// Logger middleware - logs all requests to the console
// Helpful for debugging and monitoring
app.use("*", logger());

// CORS middleware - allows cross-origin requests
// Needed if your frontend is served from a different domain
app.use("*", cors({
  origin: "*", // In production, restrict this to your domain
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Make Convex client available to all routes
app.use("*", async (c, next) => {
  c.set("convex", convex);
  await next();
});

/**
 * Static File Serving
 * ===================
 * 
 * Serve static files from the public directory.
 * This includes CSS, JavaScript, images, etc.
 */
app.use("/static/*", serveStatic({ root: "./public" }));

/**
 * Health Check Endpoint
 * =====================
 * 
 * A simple endpoint to check if the server is running.
 * Useful for monitoring and load balancers.
 * This endpoint is public (no auth required).
 */
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

/**
 * Authentication Routes (Public)
 * ==============================
 * 
 * These routes handle login, logout, and OAuth callbacks.
 * They must be public to allow users to authenticate.
 */
app.route("/", authRoutes);

/**
 * Protected Routes
 * ================
 *
 * All routes below require authentication.
 * The authMiddleware checks for a valid session cookie.
 */

// Admin page route - requires admin role (must be before general page routes)
// This ensures server-side validation of admin access
app.use("/admin", authMiddleware, adminMiddleware);

// Settings routes - require admin role (specific route for tags)
app.use("/settings/tags", authMiddleware, adminMiddleware);

// Page routes - SSR HTML pages (require authentication)
app.use("/", authMiddleware);
app.route("/", pageRoutes);

// Media API routes - CRUD operations for media files (require authentication)
app.use("/api/media/*", authMiddleware);
app.route("/api/media", mediaRoutes);

// Stream routes - Video streaming endpoints (require authentication)
app.use("/api/stream/*", authMiddleware);
app.route("/api/stream", streamRoutes);

// Upload routes - File upload endpoints (require authentication)
app.use("/api/upload/*", authMiddleware);
app.route("/api/upload", uploadRoutes);

// Tags routes - Tag management endpoints (require authentication)
app.use("/api/tags/*", authMiddleware);
app.route("/api/tags", tagsRoutes);

// Admin routes - Settings and administration (require admin role)
app.use("/api/admin/*", authMiddleware, adminMiddleware);
app.route("/api/admin", adminRoutes);

// Metadata routes - External metadata fetching (require authentication)
app.use("/api/metadata/*", authMiddleware);
app.route("/api/metadata", metadataRoutes);

/**
 * 404 Handler
 * ===========
 * 
 * Catch-all route for undefined paths.
 * Returns a friendly error page.
 */
app.notFound((c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 - Not Found | CottMV</title>
      <link href="/static/css/output.css" rel="stylesheet">
    </head>
    <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
      <div class="text-center">
        <h1 class="text-6xl font-bold text-purple-500 mb-4">404</h1>
        <p class="text-xl text-gray-400 mb-8">Page not found</p>
        <a href="/" class="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg transition-colors">
          Go Home
        </a>
      </div>
    </body>
    </html>
  `, 404);
});

/**
 * Error Handler
 * =============
 * 
 * Global error handler for uncaught exceptions.
 * Logs the error and returns a friendly error page.
 */
app.onError((err, c) => {
  console.error("Server error:", err);
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Error | CottMV</title>
      <link href="/static/css/output.css" rel="stylesheet">
    </head>
    <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
      <div class="text-center">
        <h1 class="text-6xl font-bold text-red-500 mb-4">Error</h1>
        <p class="text-xl text-gray-400 mb-8">Something went wrong</p>
        <a href="/" class="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg transition-colors">
          Go Home
        </a>
      </div>
    </body>
    </html>
  `, 500);
});

/**
 * Initialize Storage on Startup
 * =============================
 *
 * Create the media directory structure if it doesn't exist.
 * This runs asynchronously when the server starts.
 */
async function initializeApp() {
  try {
    // Get media directory from settings or use default
    let mediaDir = DEFAULT_MEDIA_DIR;
    try {
      const settingsDir = await convex.query(api.settings.get, { key: "media_directory" });
      if (settingsDir) {
        mediaDir = settingsDir;
      }
    } catch {
      // Settings not available yet, use default
    }
    
    // Initialize storage directory structure
    await initializeStorage(mediaDir);
    console.log(`[Storage] Media directory initialized at: ${mediaDir}`);
    
    // Create default tags if they don't exist
    try {
      await convex.mutation(api.tags.createDefaults, {});
      console.log("[Tags] Default tags initialized");
    } catch {
      // Tags API not available yet or already created
    }
  } catch (error) {
    console.error("[Init] Failed to initialize app:", error);
  }
}

// Run initialization
initializeApp();

/**
 * Start the Server
 * ================
 *
 * Export the app for Bun to serve.
 * Bun will automatically start the server when you run this file.
 */
console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎬 CottMV - Cottage Media Vault                         ║
║                                                           ║
║   Server starting on http://localhost:${PORT}/               ║
║   Media directory: ${DEFAULT_MEDIA_DIR}/             ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

export default {
  port: PORT,
  fetch: app.fetch,
  // Increase idle timeout for long-running requests like transcoding
  // Default is 10 seconds, max is 255 seconds (~4 minutes)
  idleTimeout: 255,
};

// Also export the app for testing
export { app, convex };
