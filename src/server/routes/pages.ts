/**
 * Page Routes (SSR)
 * =================
 * 
 * This file contains all the server-side rendered HTML pages.
 * Instead of using a frontend framework like React, we render
 * HTML directly on the server using template strings.
 * 
 * Benefits of SSR:
 * - Faster initial page load
 * - Better SEO (search engines can read the content)
 * - Works without JavaScript enabled
 * - Simpler architecture for small applications
 * 
 * The pages use Tailwind CSS for styling, which is compiled
 * separately and served as a static CSS file.
 */

import { Hono } from "hono";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { formatBytes, formatDuration } from "../../media/cleanup.js";
import { getAuth, type AuthContext } from "../auth/middleware.js";
import { navbar as navbarComponent } from "../templates/layout.js";

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

/**
 * Create the page routes
 */
export const pageRoutes = new Hono<{ Variables: Variables }>();

/**
 * Common HTML head section
 * Includes meta tags, Tailwind CSS, and common styles
 */
function htmlHead(title: string): string {
  return `
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} | CottMV</title>
      <link href="/static/css/output.css" rel="stylesheet">
      <style>
        /* Custom scrollbar for dark theme */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #1f2937;
        }
        ::-webkit-scrollbar-thumb {
          background: #4b5563;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }
      </style>
    </head>
  `;
}

/**
 * Navigation bar component with user info
 */
function navbar(currentPage: string, user?: { username: string; role: string }): string {
  const links = [
    { href: "/", label: "Library", icon: "📚" },
    { href: "/upload", label: "Upload", icon: "📤" },
  ];
  
  // Add admin link only for admin users
  if (user?.role === "admin") {
    links.push({ href: "/admin", label: "Settings", icon: "⚙️" });
  }
  
  return `
    <nav class="bg-gray-800 border-b border-gray-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center">
            <a href="/" class="flex items-center">
              <span class="text-2xl mr-2">🎬</span>
              <span class="text-xl font-bold text-white">CottMV</span>
            </a>
            <div class="ml-10 flex items-baseline space-x-4">
              ${links.map(link => `
                <a href="${link.href}" 
                   class="px-3 py-2 rounded-md text-sm font-medium ${
                     currentPage === link.href 
                       ? "bg-gray-900 text-white" 
                       : "text-gray-300 hover:bg-gray-700 hover:text-white"
                   } transition-colors">
                  ${link.icon} ${link.label}
                </a>
              `).join("")}
            </div>
          </div>
          <div class="flex items-center gap-4">
            <form action="/" method="GET" class="relative">
              <input type="text" 
                     name="search" 
                     placeholder="Search media..." 
                     class="bg-gray-700 text-white px-4 py-2 rounded-lg pl-10 focus:outline-none focus:ring-2 focus:ring-purple-500 w-64">
              <span class="absolute left-3 top-2.5 text-gray-400">🔍</span>
            </form>
            ${user ? `
              <div class="flex items-center gap-2 text-sm">
                <span class="text-gray-400">@${user.username}</span>
                ${user.role === "admin" ? '<span class="bg-purple-600 text-white text-xs px-2 py-0.5 rounded">Admin</span>' : ''}
                <form action="/auth/logout" method="POST" class="inline">
                  <button type="submit" class="text-gray-400 hover:text-white transition-colors">
                    Logout
                  </button>
                </form>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    </nav>
  `;
}

/**
 * Format duration in seconds to human-readable format
 */
function formatVideoDuration(seconds: number | undefined): string {
  if (!seconds) return "Unknown";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${secs}s`;
}

/**
 * Get emoji icon for media type
 */
function getMediaTypeIcon(mediaType: string): string {
  switch (mediaType) {
    case "video": return "🎬";
    case "audio": return "🎵";
    case "image": return "🖼️";
    case "gif": return "🎞️";
    case "document": return "📄";
    default: return "📁";
  }
}

/**
 * GET /
 * 
 * Home page - displays the media library with filtering and sorting
 */
pageRoutes.get("/", async (c) => {
  try {
    const convex = c.get("convex");
    const auth = getAuth(c);
    const search = c.req.query("search");
    const mediaType = c.req.query("type") as "video" | "audio" | "image" | "gif" | "document" | "other" | undefined;
    const extension = c.req.query("ext");
    const tagId = c.req.query("tag");
    const sortField = c.req.query("sort") as "title" | "createdAt" | "size" | "duration" | "year" | undefined;
    const sortDirection = c.req.query("dir") as "asc" | "desc" | undefined;
    
    // Get available tags for filtering
    let tags: Array<{ _id: string; name: string; color?: string }> = [];
    try {
      tags = await convex.query(api.tags.list, {}) as any;
    } catch (e) {
      console.log("Tags not available yet:", e);
    }
    
    // Get media list with filters
    let media;
    if (search) {
      media = await convex.query(api.media.search, {
        searchTerm: search,
        mediaType: mediaType,
      });
    } else if (tagId) {
      // Filter by tag
      try {
        media = await convex.query(api.media.listByTag, { tagId: tagId as any });
      } catch (e) {
        console.log("Tag filtering not available:", e);
        media = [];
      }
    } else {
      media = await convex.query(api.media.listFiltered, {
        mediaType,
        extension,
        sortField: sortField || "createdAt",
        sortDirection: sortDirection || "desc",
      });
    }
    
    // Get filter options
    const extensions = await convex.query(api.media.getExtensions, {});
    const typeCounts = await convex.query(api.media.getMediaTypeCounts, {});
    
    // Build filter UI
    const filterTabs = `
      <div class="flex flex-wrap gap-2 mb-4">
        <a href="/?sort=${sortField || 'createdAt'}&dir=${sortDirection || 'desc'}"
           class="px-3 py-1.5 rounded-lg text-sm ${!mediaType && !tagId ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}">
          All (${Object.values(typeCounts).reduce((a: number, b: number) => a + b, 0)})
        </a>
        ${Object.entries(typeCounts)
          .filter(([_, count]) => count > 0)
          .map(([type, count]) => `
            <a href="/?type=${type}&sort=${sortField || 'createdAt'}&dir=${sortDirection || 'desc'}"
               class="px-3 py-1.5 rounded-lg text-sm ${mediaType === type ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}">
              ${getMediaTypeIcon(type)} ${type.charAt(0).toUpperCase() + type.slice(1)} (${count})
            </a>
          `).join('')}
      </div>
      ${tags.length > 0 ? `
        <div class="flex flex-wrap gap-2 mb-4">
          <span class="text-gray-400 text-sm py-1.5">🏷️ Tags:</span>
          ${tags.map(tag => `
            <a href="/?tag=${tag._id}"
               class="px-3 py-1.5 rounded-full text-sm transition-colors ${tagId === tag._id ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
               style="${tag.color && tagId !== tag._id ? `border: 1px solid ${tag.color}` : ''}">
              ${tag.name}
            </a>
          `).join('')}
          ${tagId ? `
            <a href="/?sort=${sortField || 'createdAt'}&dir=${sortDirection || 'desc'}"
               class="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white transition-colors">
              ✕ Clear tag filter
            </a>
          ` : ''}
        </div>
      ` : ''}
    `;
    
    // Build sort dropdown
    const sortOptions = `
      <div class="flex items-center gap-2">
        <label class="text-gray-400 text-sm">Sort by:</label>
        <select onchange="updateSort(this.value)" class="bg-gray-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500">
          <option value="createdAt-desc" ${sortField === 'createdAt' && sortDirection === 'desc' ? 'selected' : ''}>Newest First</option>
          <option value="createdAt-asc" ${sortField === 'createdAt' && sortDirection === 'asc' ? 'selected' : ''}>Oldest First</option>
          <option value="title-asc" ${sortField === 'title' && sortDirection === 'asc' ? 'selected' : ''}>Title A-Z</option>
          <option value="title-desc" ${sortField === 'title' && sortDirection === 'desc' ? 'selected' : ''}>Title Z-A</option>
          <option value="size-desc" ${sortField === 'size' && sortDirection === 'desc' ? 'selected' : ''}>Largest First</option>
          <option value="size-asc" ${sortField === 'size' && sortDirection === 'asc' ? 'selected' : ''}>Smallest First</option>
          <option value="year-desc" ${sortField === 'year' && sortDirection === 'desc' ? 'selected' : ''}>Year (Newest)</option>
          <option value="year-asc" ${sortField === 'year' && sortDirection === 'asc' ? 'selected' : ''}>Year (Oldest)</option>
        </select>
        ${extensions.length > 0 ? `
          <select onchange="updateExtension(this.value)" class="bg-gray-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500">
            <option value="">All Formats</option>
            ${extensions.map(ext => `
              <option value="${ext}" ${extension === ext ? 'selected' : ''}>.${ext}</option>
            `).join('')}
          </select>
        ` : ''}
      </div>
    `;
    
    // Generate media cards
    const mediaCards = media.length > 0 
      ? media.map((item: any) => `
          <a href="/watch/${item._id}" 
             class="bg-gray-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-purple-500 transition-all group">
            <div class="aspect-video bg-gray-700 flex items-center justify-center relative">
              ${item.coverUrl 
                ? `<img src="${item.coverUrl}" alt="${item.title}" class="w-full h-full object-cover">`
                : item.thumbnail 
                  ? `<img src="${item.thumbnail}" alt="${item.title}" class="w-full h-full object-cover">`
                  : `<span class="text-6xl">${getMediaTypeIcon(item.mediaType || 'other')}</span>`
              }
              <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center">
                <span class="text-white text-4xl opacity-0 group-hover:opacity-100 transition-opacity">▶️</span>
              </div>
              ${item.duration ? `
                <span class="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                  ${formatVideoDuration(item.duration)}
                </span>
              ` : ""}
              ${item.year ? `
                <span class="absolute top-2 left-2 bg-purple-600 bg-opacity-90 text-white text-xs px-2 py-1 rounded">
                  ${item.year}
                </span>
              ` : ""}
            </div>
            <div class="p-4">
              <h3 class="text-white font-medium truncate">${item.title}</h3>
              <div class="flex items-center justify-between mt-1">
                <p class="text-gray-400 text-sm">${formatBytes(item.size)}</p>
                ${item.extension ? `<span class="text-gray-500 text-xs uppercase">.${item.extension}</span>` : ''}
              </div>
              ${item.artist ? `<p class="text-gray-500 text-sm truncate mt-1">${item.artist}</p>` : ''}
              ${item.genre ? `<p class="text-gray-600 text-xs truncate mt-1">${item.genre}</p>` : ''}
            </div>
          </a>
        `).join("")
      : `
          <div class="col-span-full text-center py-12">
            <span class="text-6xl mb-4 block">📭</span>
            <h3 class="text-xl text-gray-400">No media found</h3>
            <p class="text-gray-500 mt-2">
              ${search 
                ? `No results for "${search}". Try a different search term.`
                : mediaType
                  ? `No ${mediaType} files found.`
                  : "Add some files to your media directory and scan for new files."
              }
            </p>
            ${!search && !mediaType ? `
              <a href="/admin" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg transition-colors">
                Go to Settings
              </a>
            ` : ""}
          </div>
        `;
    
    // Use auth.user for navbar to ensure correct role is displayed
    const navUser = auth.user ? { username: auth.user.username, role: auth.user.role } : undefined;
    
    const html = `
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Library")}
      <body class="bg-gray-900 text-white min-h-screen">
        ${navbar("/", navUser)}
        
        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div class="flex items-center justify-between mb-6">
            <h1 class="text-3xl font-bold">
              ${search ? `Search: "${search}"` : "Media Library"}
            </h1>
            <div class="flex items-center gap-2">
              <button onclick="fetchAllMetadata()" 
                      class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm">
                📥 Fetch Metadata
              </button>
              <button onclick="scanMedia()" 
                      class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                🔄 Scan for New Media
              </button>
            </div>
          </div>
          
          <!-- Filters -->
          <div class="mb-6">
            ${filterTabs}
            <div class="flex items-center justify-between">
              ${sortOptions}
              <span class="text-gray-500 text-sm">${media.length} items</span>
            </div>
          </div>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            ${mediaCards}
          </div>
        </main>
        
        <script>
          function updateSort(value) {
            const [field, dir] = value.split('-');
            const url = new URL(window.location);
            url.searchParams.set('sort', field);
            url.searchParams.set('dir', dir);
            window.location = url;
          }
          
          function updateExtension(value) {
            const url = new URL(window.location);
            if (value) {
              url.searchParams.set('ext', value);
            } else {
              url.searchParams.delete('ext');
            }
            window.location = url;
          }
          
          async function scanMedia() {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = "Scanning...";
            
            try {
              const res = await fetch("/api/media/scan", { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                alert(\`Scan complete! Found \${data.data.scanned} files, added \${data.data.added} new.\`);
                window.location.reload();
              } else {
                alert("Scan failed: " + data.error);
              }
            } catch (err) {
              alert("Scan failed: " + err.message);
            } finally {
              btn.disabled = false;
              btn.textContent = "🔄 Scan for New Media";
            }
          }
          
          async function fetchAllMetadata() {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = "Fetching...";
            
            try {
              const res = await fetch("/api/metadata/batch-fetch", { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                alert(data.message);
                window.location.reload();
              } else {
                alert("Metadata fetch failed: " + data.error);
              }
            } catch (err) {
              alert("Metadata fetch failed: " + err.message);
            } finally {
              btn.disabled = false;
              btn.textContent = "📥 Fetch Metadata";
            }
          }
        </script>
      </body>
      </html>
    `;
    
    return c.html(html);
  } catch (error) {
    console.error("Error rendering home page:", error);
    return c.html(`
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Error")}
      <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-red-500 mb-4">Error</h1>
          <p class="text-gray-400">Failed to load media library</p>
          <a href="/" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg">
            Try Again
          </a>
        </div>
      </body>
      </html>
    `, 500);
  }
});

/**
 * GET /watch/:id
 * 
 * Video player page with metadata display
 */
pageRoutes.get("/watch/:id", async (c) => {
  try {
    const convex = c.get("convex");
    const auth = getAuth(c);
    const id = c.req.param("id");
    
    const media = await convex.query(api.media.getById, { id: id as any });
    
    if (!media) {
      return c.html(`
        <!DOCTYPE html>
        <html lang="en" class="dark">
        ${htmlHead("Not Found")}
        <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
          <div class="text-center">
            <h1 class="text-6xl font-bold text-purple-500 mb-4">404</h1>
            <p class="text-gray-400">Media not found</p>
            <a href="/" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg">
              Back to Library
            </a>
          </div>
        </body>
        </html>
      `, 404);
    }
    
    // Determine the media type
    const isVideo = media.mediaType === "video" || media.mimeType?.startsWith("video/");
    const isAudio = media.mediaType === "audio" || media.mimeType?.startsWith("audio/");
    const isImage = media.mediaType === "image" || (media.mimeType?.startsWith("image/") && !media.mimeType?.includes("gif"));
    const isGif = media.mediaType === "gif" || media.mimeType?.includes("gif");
    const isDocument = media.mediaType === "document";
    
    // Use auth.user for navbar to ensure correct role is displayed
    const navUser = auth.user ? { username: auth.user.username, role: auth.user.role } : undefined;
    
    const html = `
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead(media.title)}
      <body class="bg-gray-900 text-white min-h-screen">
        ${navbar("", navUser)}
        
        <main class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <a href="/" class="text-purple-400 hover:text-purple-300 mb-4 inline-block">
            ← Back to Library
          </a>
          
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <!-- Player Section -->
            <div class="lg:col-span-2">
              <div class="bg-gray-800 rounded-lg overflow-hidden">
                ${isVideo ? `
                  <div class="aspect-video bg-black">
                    <video id="player" 
                           class="w-full h-full" 
                           controls 
                           autoplay
                           preload="metadata">
                      <source src="/api/stream/${id}" type="${media.mimeType}">
                      Your browser does not support the video tag.
                    </video>
                  </div>
                ` : isAudio ? `
                  <div class="p-8 flex flex-col items-center justify-center bg-gradient-to-br from-purple-900 to-gray-900">
                    ${media.coverUrl ? `
                      <img src="${media.coverUrl}" alt="${media.title}" class="w-64 h-64 object-cover rounded-lg shadow-2xl mb-6">
                    ` : `
                      <div class="w-64 h-64 bg-gray-700 rounded-lg flex items-center justify-center mb-6">
                        <span class="text-8xl">🎵</span>
                      </div>
                    `}
                    <audio id="player" controls autoplay class="w-full max-w-md">
                      <source src="/api/stream/${id}" type="${media.mimeType}">
                      Your browser does not support the audio tag.
                    </audio>
                  </div>
                ` : isImage ? `
                  <div class="flex items-center justify-center p-4 bg-gray-900 min-h-[300px]">
                    <img src="/api/stream/${id}" 
                         alt="${media.title}" 
                         class="w-auto h-auto object-contain rounded-lg shadow-lg cursor-zoom-in"
                         onclick="toggleFullscreen(this)"
                         loading="lazy"
                         style="max-width: min(90%, 800px); max-height: 70vh;">
                  </div>
                ` : isGif ? `
                  <div class="flex items-center justify-center p-4 bg-gray-900 min-h-[300px]">
                    <img src="/api/stream/${id}" 
                         alt="${media.title}" 
                         class="w-auto h-auto object-contain rounded-lg shadow-lg cursor-zoom-in"
                         onclick="toggleFullscreen(this)"
                         loading="lazy"
                         style="max-width: min(90%, 800px); max-height: 70vh;">
                  </div>
                ` : isDocument ? `
                  <div class="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-gray-800 to-gray-900 min-h-[400px]">
                    <span class="text-8xl mb-6">📄</span>
                    <p class="text-gray-400 mb-4">Document: ${media.extension?.toUpperCase() || 'Unknown format'}</p>
                    <a href="/api/stream/${id}" 
                       download="${media.filename}"
                       class="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg font-medium transition-colors">
                      📥 Download Document
                    </a>
                    ${media.mimeType === 'application/pdf' ? `
                      <iframe src="/api/stream/${id}" 
                              class="w-full h-[60vh] mt-6 rounded-lg border border-gray-700"
                              title="${media.title}">
                      </iframe>
                    ` : ''}
                  </div>
                ` : `
                  <div class="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-gray-800 to-gray-900 min-h-[300px]">
                    <span class="text-6xl mb-4">${getMediaTypeIcon(media.mediaType || 'other')}</span>
                    <p class="text-gray-400 mb-4">${media.extension?.toUpperCase() || 'Unknown'} file</p>
                    <a href="/api/stream/${id}" 
                       download="${media.filename}"
                       class="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg font-medium transition-colors">
                      📥 Download File
                    </a>
                  </div>
                `}
                
                <div class="p-6">
                  <h1 class="text-2xl font-bold mb-2">${media.title}</h1>
                  ${media.artist ? `<p class="text-gray-400 mb-2">${media.artist}${media.album ? ` • ${media.album}` : ''}</p>` : ''}
                  ${media.year ? `<span class="inline-block bg-purple-600 text-white text-sm px-2 py-1 rounded mr-2">${media.year}</span>` : ''}
                  ${media.genre ? `<span class="text-gray-500 text-sm">${media.genre}</span>` : ''}
                  
                  ${media.description ? `
                    <p class="text-gray-400 mt-4 text-sm leading-relaxed">${media.description}</p>
                  ` : ''}
                  
                  ${isVideo ? `
                    <div class="mt-6">
                      <h3 class="text-lg font-medium mb-3">Quality Options</h3>
                      <div class="flex gap-2">
                        <button onclick="changeQuality('480p')" 
                                class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
                          480p
                        </button>
                        <button onclick="changeQuality('720p')" 
                                class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition-colors">
                          720p
                        </button>
                        <button onclick="changeQuality('1080p')" 
                                class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
                          1080p
                        </button>
                        <button onclick="changeQuality('')" 
                                class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
                          Original
                        </button>
                      </div>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
            
            <!-- Info Sidebar -->
            <div class="space-y-4">
              ${media.coverUrl && isVideo ? `
                <div class="bg-gray-800 rounded-lg overflow-hidden">
                  <img src="${media.coverUrl}" alt="${media.title}" class="w-full object-cover">
                </div>
              ` : ''}
              
              <div class="bg-gray-800 rounded-lg p-4 space-y-3">
                <h3 class="font-medium text-gray-300">File Info</h3>
                <div class="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p class="text-gray-500">Duration</p>
                    <p class="text-white">${formatVideoDuration(media.duration)}</p>
                  </div>
                  <div>
                    <p class="text-gray-500">Size</p>
                    <p class="text-white">${formatBytes(media.size)}</p>
                  </div>
                  <div>
                    <p class="text-gray-500">Format</p>
                    <p class="text-white">${media.extension?.toUpperCase() || media.mimeType?.split("/")[1]?.toUpperCase() || 'Unknown'}</p>
                  </div>
                  <div>
                    <p class="text-gray-500">Backed Up</p>
                    <p class="text-white">${media.r2BackedUp ? "✅ Yes" : "❌ No"}</p>
                  </div>
                </div>
              </div>
              
              <div class="bg-gray-800 rounded-lg p-4">
                <h3 class="font-medium text-gray-300 mb-3">Metadata</h3>
                ${media.externalId ? `
                  <p class="text-gray-500 text-sm mb-2">Source: ${media.externalSource}</p>
                  <button onclick="refreshMetadata('${id}')" 
                          class="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors text-sm">
                    🔄 Refresh Metadata
                  </button>
                ` : `
                  <p class="text-gray-500 text-sm mb-2">No metadata found</p>
                  <button onclick="fetchMetadata('${id}')" 
                          class="w-full bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition-colors text-sm">
                    📥 Fetch Metadata
                  </button>
                `}
              </div>
            </div>
          </div>
        </main>
        
        <script>
          const player = document.getElementById("player");
          let currentTime = 0;
          
          if (player) {
            // Save current time before changing source
            player.addEventListener("timeupdate", () => {
              currentTime = player.currentTime;
            });
          }
          
          // Toggle fullscreen for images
          function toggleFullscreen(img) {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else {
              // Create a fullscreen wrapper with the image
              const wrapper = document.createElement('div');
              wrapper.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out;';
              const fullImg = img.cloneNode();
              fullImg.style.cssText = 'max-width:95vw;max-height:95vh;object-fit:contain;';
              wrapper.appendChild(fullImg);
              wrapper.onclick = () => wrapper.remove();
              document.body.appendChild(wrapper);
              // Close on escape
              const handleEsc = (e) => {
                if (e.key === 'Escape') {
                  wrapper.remove();
                  document.removeEventListener('keydown', handleEsc);
                }
              };
              document.addEventListener('keydown', handleEsc);
            }
          }
          
          function changeQuality(quality) {
            if (!player) return;
            const savedTime = currentTime;
            const wasPlaying = !player.paused;
            
            // Update source
            const baseUrl = "/api/stream/${id}";
            const url = quality ? baseUrl + "?quality=" + quality : baseUrl;
            
            player.src = url;
            player.load();
            
            // Restore position and play state
            player.addEventListener("loadedmetadata", function onLoad() {
              player.currentTime = savedTime;
              if (wasPlaying) player.play();
              player.removeEventListener("loadedmetadata", onLoad);
            });
          }
          
          async function fetchMetadata(mediaId) {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = "Fetching...";
            
            try {
              const res = await fetch("/api/metadata/fetch/" + mediaId, { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                alert("Metadata fetched successfully!");
                window.location.reload();
              } else {
                alert("Failed to fetch metadata: " + data.error);
              }
            } catch (err) {
              alert("Failed to fetch metadata: " + err.message);
            } finally {
              btn.disabled = false;
              btn.textContent = "📥 Fetch Metadata";
            }
          }
          
          async function refreshMetadata(mediaId) {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = "Refreshing...";
            
            try {
              const res = await fetch("/api/metadata/fetch/" + mediaId, { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                alert("Metadata refreshed successfully!");
                window.location.reload();
              } else {
                alert("Failed to refresh metadata: " + data.error);
              }
            } catch (err) {
              alert("Failed to refresh metadata: " + err.message);
            } finally {
              btn.disabled = false;
              btn.textContent = "🔄 Refresh Metadata";
            }
          }
        </script>
      </body>
      </html>
    `;
    
    return c.html(html);
  } catch (error) {
    console.error("Error rendering watch page:", error);
    return c.html(`
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Error")}
      <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-red-500 mb-4">Error</h1>
          <p class="text-gray-400">Failed to load video</p>
          <a href="/" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg">
            Back to Library
          </a>
        </div>
      </body>
      </html>
    `, 500);
  }
});

/**
 * GET /admin
 *
 * Admin settings page
 *
 * Note: Server-side admin validation is handled by adminMiddleware in index.ts
 * The check below is kept for defense-in-depth and to provide a nice error page
 * if somehow the middleware is bypassed or misconfigured.
 */
pageRoutes.get("/admin", async (c) => {
  try {
    const convex = c.get("convex");
    const auth = getAuth(c);
    const user = c.get("user") as { _id: string; githubId: string; username: string; role: string } | undefined;
    
    // Debug logging
    console.log("[Admin Page] Auth context:", JSON.stringify(auth, null, 2));
    console.log("[Admin Page] User from context:", JSON.stringify(user, null, 2));
    
    // Defense-in-depth: Check if user is admin (server middleware should have already validated this)
    // This provides a nice error page if the middleware is somehow bypassed
    if (!auth.isAdmin) {
      console.warn("[Admin Page] Non-admin user reached admin page - middleware may be misconfigured");
      return c.html(`
        <!DOCTYPE html>
        <html lang="en" class="dark">
        ${htmlHead("Access Denied")}
        <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
          <div class="text-center">
            <h1 class="text-6xl font-bold text-red-500 mb-4">403</h1>
            <p class="text-gray-400">You don't have permission to access this page</p>
            <a href="/" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg">
              Back to Library
            </a>
          </div>
        </body>
        </html>
      `, 403);
    }
    
    // Get all settings
    const settings = await convex.query(api.settings.getAll, {});
    
    // Get stats
    const mediaStats = await convex.query(api.media.getStats, {});
    const cacheStats = await convex.query(api.cache.getStats, {});
    
    // Use auth.user for navbar to ensure correct role is displayed
    const navUser = auth.user ? { username: auth.user.username, role: auth.user.role } : undefined;
    
    const html = `
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Settings")}
      <body class="bg-gray-900 text-white min-h-screen">
        ${navbar("/admin", navUser)}
        
        <main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 class="text-3xl font-bold mb-8">Settings</h1>
          
          <!-- Stats Overview -->
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div class="bg-gray-800 rounded-lg p-6">
              <h3 class="text-gray-400 text-sm">Total Media</h3>
              <p class="text-3xl font-bold">${mediaStats.totalCount}</p>
              <p class="text-gray-500 text-sm">${formatBytes(mediaStats.totalSize)}</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-6">
              <h3 class="text-gray-400 text-sm">Cache Size</h3>
              <p class="text-3xl font-bold">${cacheStats.totalSizeGb} GB</p>
              <p class="text-gray-500 text-sm">${cacheStats.totalEntries} files</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-6">
              <h3 class="text-gray-400 text-sm">Backup Status</h3>
              <p class="text-3xl font-bold">${mediaStats.backupPercentage}%</p>
              <p class="text-gray-500 text-sm">${mediaStats.backedUpCount} / ${mediaStats.totalCount} backed up</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-6">
              <h3 class="text-gray-400 text-sm">Media Types</h3>
              <div class="text-sm mt-2 space-y-1">
                ${Object.entries(mediaStats.byType || {})
                  .filter(([_, count]) => count > 0)
                  .map(([type, count]) => `
                    <div class="flex justify-between">
                      <span class="text-gray-400">${getMediaTypeIcon(type)} ${type}</span>
                      <span class="text-white">${count}</span>
                    </div>
                  `).join('')}
              </div>
            </div>
          </div>
          
          <!-- Settings Form -->
          <form id="settingsForm" class="space-y-8">
            <!-- Media Settings -->
            <section class="bg-gray-800 rounded-lg p-6">
              <h2 class="text-xl font-bold mb-4">📁 Media Settings</h2>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Media Directory
                  </label>
                  <input type="text"
                         name="media_directory"
                         value="${settings.media_directory?.value || "~/.CottMV"}"
                         class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <p class="text-gray-500 text-sm mt-1">${settings.media_directory?.description || ""}</p>
                </div>
              </div>
            </section>
            
            <!-- Admin Settings -->
            <section class="bg-gray-800 rounded-lg p-6">
              <h2 class="text-xl font-bold mb-4">👤 Admin Settings</h2>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Admin GitHub Usernames (comma-separated)
                  </label>
                  <input type="text" 
                         name="admin_usernames" 
                         value="${settings.admin_usernames?.value || ""}"
                         placeholder="username1, username2"
                         class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <p class="text-gray-500 text-sm mt-1">GitHub usernames that should have admin access</p>
                </div>
              </div>
            </section>
            
            <!-- Metadata Settings -->
            <section class="bg-gray-800 rounded-lg p-6">
              <h2 class="text-xl font-bold mb-4">📊 Metadata Settings</h2>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    TMDB API Key
                  </label>
                  <input type="password" 
                         name="tmdb_api_key" 
                         placeholder="Enter TMDB API key"
                         class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <p class="text-gray-500 text-sm mt-1">Get your API key from <a href="https://www.themoviedb.org/settings/api" target="_blank" class="text-purple-400 hover:text-purple-300">themoviedb.org</a></p>
                </div>
                <div id="metadataStatus" class="text-sm">
                  <!-- Will be populated by JavaScript -->
                </div>
              </div>
            </section>
            
            <!-- Cache Settings -->
            <section class="bg-gray-800 rounded-lg p-6">
              <h2 class="text-xl font-bold mb-4">💾 Cache Settings</h2>
              <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-300 mb-2">
                      Max Cache Size (GB)
                    </label>
                    <input type="number" 
                           name="cache_max_size_gb" 
                           value="${settings.cache_max_size_gb?.value || "10"}"
                           min="1"
                           class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-300 mb-2">
                      Cache TTL (Hours)
                    </label>
                    <input type="number" 
                           name="cache_ttl_hours" 
                           value="${settings.cache_ttl_hours?.value || "24"}"
                           min="1"
                           class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Cache Directory
                  </label>
                  <input type="text"
                         name="cache_directory"
                         value="${settings.cache_directory?.value || "~/.CottMV/cache"}"
                         class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                </div>
                <button type="button" 
                        onclick="runCacheCleanup()"
                        class="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded-lg transition-colors">
                  🧹 Run Cache Cleanup
                </button>
              </div>
            </section>
            
            <!-- R2 Settings -->
            <section class="bg-gray-800 rounded-lg p-6">
              <h2 class="text-xl font-bold mb-4">☁️ Cloudflare R2 Backup</h2>
              <div class="space-y-4">
                <div class="flex items-center gap-3">
                  <input type="checkbox" 
                         name="r2_enabled" 
                         id="r2_enabled"
                         ${settings.r2_enabled?.value === "true" ? "checked" : ""}
                         class="w-5 h-5 rounded bg-gray-700 border-gray-600 text-purple-600 focus:ring-purple-500">
                  <label for="r2_enabled" class="text-sm font-medium text-gray-300">
                    Enable R2 Backup
                  </label>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    R2 Endpoint URL
                  </label>
                  <input type="text" 
                         name="r2_endpoint" 
                         value="${settings.r2_endpoint?.value || ""}"
                         placeholder="https://xxx.r2.cloudflarestorage.com"
                         class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Bucket Name
                  </label>
                  <input type="text" 
                         name="r2_bucket_name" 
                         value="${settings.r2_bucket_name?.value || ""}"
                         class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Access Key ID
                  </label>
                  <input type="text" 
                         name="r2_access_key_id" 
                         value="${settings.r2_access_key_id?.value || ""}"
                         class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Secret Access Key
                  </label>
                  <input type="password" 
                         name="r2_secret_access_key" 
                         placeholder="Enter new key to change"
                         class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                </div>
                <div class="flex gap-2">
                  <button type="button" 
                          onclick="testR2Connection()"
                          class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors">
                    🔌 Test Connection
                  </button>
                  <button type="button" 
                          onclick="runR2Backup()"
                          class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors">
                    ☁️ Run Backup Now
                  </button>
                </div>
              </div>
            </section>
            
            <!-- Tag Management -->
            <section class="bg-gray-800 rounded-lg p-6">
              <h2 class="text-xl font-bold mb-4">🏷️ Tag Management</h2>
              <p class="text-gray-400 mb-4">Manage tags for organizing your media files</p>
              <a href="/settings/tags"
                 class="inline-block bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition-colors">
                Manage Tags →
              </a>
            </section>
            
            <!-- Transcoding Settings -->
            <section class="bg-gray-800 rounded-lg p-6">
              <h2 class="text-xl font-bold mb-4">🎬 Transcoding Settings</h2>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Default Video Quality
                  </label>
                  <select name="default_video_quality"
                          class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="480p" ${settings.default_video_quality?.value === "480p" ? "selected" : ""}>480p</option>
                    <option value="720p" ${settings.default_video_quality?.value === "720p" || !settings.default_video_quality?.value ? "selected" : ""}>720p</option>
                    <option value="1080p" ${settings.default_video_quality?.value === "1080p" ? "selected" : ""}>1080p</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Output Format
                  </label>
                  <select name="transcode_format"
                          class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="mp4" ${settings.transcode_format?.value === "mp4" || !settings.transcode_format?.value ? "selected" : ""}>MP4 (H.264)</option>
                    <option value="webm" ${settings.transcode_format?.value === "webm" ? "selected" : ""}>WebM (VP9)</option>
                  </select>
                </div>
              </div>
            </section>
            
            <!-- Save Button -->
            <div class="flex justify-end">
              <button type="submit" 
                      class="bg-purple-600 hover:bg-purple-700 px-8 py-3 rounded-lg font-medium transition-colors">
                💾 Save Settings
              </button>
            </div>
          </form>
        </main>
        
        <script>
          // Load metadata status on page load
          async function loadMetadataStatus() {
            try {
              const res = await fetch("/api/metadata/status");
              const data = await res.json();
              
              const statusDiv = document.getElementById("metadataStatus");
              statusDiv.innerHTML = Object.entries(data).map(([key, info]) => \`
                <div class="flex items-center justify-between py-2 border-b border-gray-700">
                  <span class="text-gray-300">\${info.name}</span>
                  <span class="\${info.configured ? 'text-green-400' : 'text-yellow-400'}">
                    \${info.configured ? '✅ Configured' : '⚠️ Not configured'}
                  </span>
                </div>
              \`).join('');
            } catch (err) {
              console.error("Failed to load metadata status:", err);
            }
          }
          loadMetadataStatus();
          
          // Save settings
          document.getElementById("settingsForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const settings = [];
            
            for (const [key, value] of formData.entries()) {
              // Handle checkbox
              if (key === "r2_enabled") {
                settings.push({ key, value: "true" });
              } else if (value) {
                settings.push({ key, value: String(value) });
              }
            }
            
            // Handle unchecked checkbox
            if (!formData.has("r2_enabled")) {
              settings.push({ key: "r2_enabled", value: "false" });
            }
            
            try {
              const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ settings }),
              });
              
              const data = await res.json();
              
              if (data.success) {
                alert("Settings saved successfully!");
              } else {
                alert("Failed to save settings: " + data.error);
              }
            } catch (err) {
              alert("Failed to save settings: " + err.message);
            }
          });
          
          // Test R2 connection
          async function testR2Connection() {
            const form = document.getElementById("settingsForm");
            const formData = new FormData(form);
            
            try {
              const res = await fetch("/api/admin/r2/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accessKeyId: formData.get("r2_access_key_id"),
                  secretAccessKey: formData.get("r2_secret_access_key"),
                  bucketName: formData.get("r2_bucket_name"),
                  endpoint: formData.get("r2_endpoint"),
                }),
              });
              
              const data = await res.json();
              
              if (data.success && data.data.connected) {
                alert("✅ Successfully connected to R2!");
              } else {
                alert("❌ Connection failed: " + (data.data?.message || data.error));
              }
            } catch (err) {
              alert("❌ Connection test failed: " + err.message);
            }
          }
          
          // Run R2 backup
          async function runR2Backup() {
            if (!confirm("Start backup of all unbacked-up media to R2?")) return;
            
            try {
              const res = await fetch("/api/admin/r2/backup", { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                alert(\`Backup complete! Backed up \${data.data.backed} files.\`);
                window.location.reload();
              } else {
                alert("Backup failed: " + data.error);
              }
            } catch (err) {
              alert("Backup failed: " + err.message);
            }
          }
          
          // Run cache cleanup
          async function runCacheCleanup() {
            if (!confirm("Run cache cleanup? This will delete expired and excess cached files.")) return;
            
            try {
              const res = await fetch("/api/admin/cache/cleanup", { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                alert(\`Cleanup complete! Deleted \${data.data.filesDeleted} files, freed \${data.data.bytesFreedFormatted}.\`);
                window.location.reload();
              } else {
                alert("Cleanup failed: " + data.error);
              }
            } catch (err) {
              alert("Cleanup failed: " + err.message);
            }
          }
        </script>
      </body>
      </html>
    `;
    
    return c.html(html);
  } catch (error) {
    console.error("Error rendering admin page:", error);
    return c.html(`
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Error")}
      <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-red-500 mb-4">Error</h1>
          <p class="text-gray-400">Failed to load settings</p>
          <a href="/" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg">
            Back to Library
          </a>
        </div>
      </body>
      </html>
    `, 500);
  }
});

/**
 * GET /upload
 *
 * File upload page with drag-and-drop interface
 */
pageRoutes.get("/upload", async (c) => {
  try {
    const convex = c.get("convex");
    const auth = getAuth(c);
    
    // Use auth.user for navbar to ensure correct role is displayed
    const navUser = auth.user ? { username: auth.user.username, role: auth.user.role } : undefined;
    
    // Get available tags for the tag selector
    let tags: Array<{ _id: string; name: string; color?: string }> = [];
    try {
      // Try to get tags - this may fail if tags table doesn't exist yet
      tags = await convex.query(api.tags.list, {}) as any;
    } catch (e) {
      console.log("Tags not available yet:", e);
    }
    
    const html = `
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Upload")}
      <body class="bg-gray-900 text-white min-h-screen">
        ${navbar("/upload", navUser)}
        
        <main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 class="text-3xl font-bold mb-8">Upload Media</h1>
          
          <!-- Upload Zone -->
          <div id="dropZone"
               class="border-2 border-dashed border-gray-600 rounded-xl p-12 text-center hover:border-purple-500 transition-colors cursor-pointer bg-gray-800/50">
            <div class="space-y-4">
              <div class="text-6xl">📁</div>
              <div>
                <p class="text-xl text-gray-300">Drag and drop files here</p>
                <p class="text-gray-500 mt-2">or click to browse</p>
              </div>
              <input type="file"
                     id="fileInput"
                     multiple
                     class="hidden"
                     accept="video/*,audio/*,image/*,.gif,.pdf,.doc,.docx,.txt,.md">
              <button onclick="document.getElementById('fileInput').click()"
                      class="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg font-medium transition-colors">
                Select Files
              </button>
            </div>
          </div>
          
          <!-- Supported Formats -->
          <div class="mt-4 text-center text-sm text-gray-500">
            <p>Supported formats: Videos (mp4, mkv, avi, webm), Audio (mp3, flac, wav, ogg), Images (jpg, png, webp, gif), Documents (pdf, doc, txt)</p>
          </div>
          
          <!-- Tagging Mode Toggle -->
          <div class="mt-8 bg-gray-800 rounded-lg p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h2 class="text-lg font-medium">📌 Tagging Mode</h2>
                <p class="text-gray-400 text-sm mt-1" id="taggingModeDescription">
                  Assign specific tags to each file individually
                </p>
              </div>
              <div class="flex items-center gap-3">
                <span id="individualModeLabel" class="text-sm font-medium text-purple-400">Individual</span>
                <button type="button"
                        id="batchModeToggle"
                        onclick="toggleTaggingMode()"
                        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800 bg-gray-600"
                        role="switch"
                        aria-checked="false"
                        aria-label="Toggle batch tagging mode">
                  <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-1"></span>
                </button>
                <span id="batchModeLabel" class="text-sm font-medium text-gray-400">Batch</span>
              </div>
            </div>
            
            <!-- Batch Mode Tag Selector (hidden by default) -->
            <div id="batchTagSelector" class="hidden">
              <p class="text-gray-400 text-sm mb-3">Select tags to apply to ALL uploaded files:</p>
              <div class="flex flex-wrap gap-2">
                ${tags.length > 0 ? tags.map(tag => `
                  <label class="inline-flex items-center cursor-pointer batch-tag-label">
                    <input type="checkbox"
                           name="batchTags"
                           value="${tag._id}"
                           class="hidden peer batch-tag-checkbox">
                    <span class="px-3 py-1.5 rounded-full text-sm border-2 border-gray-600 peer-checked:border-purple-500 peer-checked:bg-purple-500/20 transition-all"
                          style="${tag.color ? `border-color: ${tag.color}` : ''}">
                      ${tag.name}
                    </span>
                  </label>
                `).join('') : `
                  <p class="text-gray-500 text-sm">No tags available. <a href="/settings/tags" class="text-purple-400 hover:text-purple-300">Create tags in settings</a></p>
                `}
              </div>
            </div>
            
            <!-- Individual Mode Info (shown by default) -->
            <div id="individualModeInfo">
              <p class="text-gray-500 text-sm">
                ${tags.length > 0
                  ? 'Add files to the queue below, then assign tags to each file individually.'
                  : 'No tags available. <a href="/settings/tags" class="text-purple-400 hover:text-purple-300">Create tags in settings</a>'}
              </p>
            </div>
          </div>
          
          <!-- Available Tags Reference (for individual mode) -->
          <script id="availableTagsData" type="application/json">
            ${JSON.stringify(tags.map(tag => ({ id: tag._id, name: tag.name, color: tag.color || null })))}
          </script>
          
          <!-- Upload Queue -->
          <div id="uploadQueue" class="mt-8 space-y-4 hidden">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-medium">📤 Upload Queue</h2>
              <div class="flex gap-2">
                <button onclick="clearCompleted()"
                        class="text-sm text-gray-400 hover:text-white transition-colors">
                  Clear Completed
                </button>
                <button onclick="uploadAll()"
                        id="uploadAllBtn"
                        class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  Upload All
                </button>
              </div>
            </div>
            <div id="queueList" class="space-y-3">
              <!-- Queue items will be added here -->
            </div>
          </div>
          
          <!-- Upload Summary -->
          <div id="uploadSummary" class="mt-8 bg-gray-800 rounded-lg p-6 hidden">
            <h2 class="text-lg font-medium mb-4">✅ Upload Complete</h2>
            <div id="summaryContent" class="space-y-2">
              <!-- Summary will be populated here -->
            </div>
            <div class="mt-4 flex gap-2">
              <a href="/" class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                View Library
              </a>
              <button onclick="resetUploader()"
                      class="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                Upload More
              </button>
            </div>
          </div>
        </main>
        
        <script>
          // State
          let uploadQueue = [];
          let batchSelectedTags = [];
          let isBatchMode = false;
          
          // Load available tags from embedded JSON
          const availableTags = JSON.parse(document.getElementById('availableTagsData').textContent || '[]');
          
          // DOM elements
          const dropZone = document.getElementById('dropZone');
          const fileInput = document.getElementById('fileInput');
          const queueContainer = document.getElementById('uploadQueue');
          const queueList = document.getElementById('queueList');
          const uploadSummary = document.getElementById('uploadSummary');
          const summaryContent = document.getElementById('summaryContent');
          const batchModeToggle = document.getElementById('batchModeToggle');
          const batchTagSelector = document.getElementById('batchTagSelector');
          const individualModeInfo = document.getElementById('individualModeInfo');
          const individualModeLabel = document.getElementById('individualModeLabel');
          const batchModeLabel = document.getElementById('batchModeLabel');
          const taggingModeDescription = document.getElementById('taggingModeDescription');
          
          // Toggle tagging mode
          function toggleTaggingMode() {
            isBatchMode = !isBatchMode;
            
            // Update toggle button appearance
            const toggleSpan = batchModeToggle.querySelector('span');
            if (isBatchMode) {
              batchModeToggle.classList.remove('bg-gray-600');
              batchModeToggle.classList.add('bg-purple-600');
              toggleSpan.classList.remove('translate-x-1');
              toggleSpan.classList.add('translate-x-6');
              batchModeToggle.setAttribute('aria-checked', 'true');
              
              // Update labels
              individualModeLabel.classList.remove('text-purple-400');
              individualModeLabel.classList.add('text-gray-400');
              batchModeLabel.classList.remove('text-gray-400');
              batchModeLabel.classList.add('text-purple-400');
              
              // Show batch selector, hide individual info
              batchTagSelector.classList.remove('hidden');
              individualModeInfo.classList.add('hidden');
              
              // Update description
              taggingModeDescription.textContent = 'Selected tags will apply to ALL files in this upload session';
            } else {
              batchModeToggle.classList.remove('bg-purple-600');
              batchModeToggle.classList.add('bg-gray-600');
              toggleSpan.classList.remove('translate-x-6');
              toggleSpan.classList.add('translate-x-1');
              batchModeToggle.setAttribute('aria-checked', 'false');
              
              // Update labels
              individualModeLabel.classList.remove('text-gray-400');
              individualModeLabel.classList.add('text-purple-400');
              batchModeLabel.classList.remove('text-purple-400');
              batchModeLabel.classList.add('text-gray-400');
              
              // Hide batch selector, show individual info
              batchTagSelector.classList.add('hidden');
              individualModeInfo.classList.remove('hidden');
              
              // Update description
              taggingModeDescription.textContent = 'Assign specific tags to each file individually';
            }
            
            // Re-render queue items to show/hide per-file tag selectors
            uploadQueue.forEach(item => {
              if (item.status === 'pending') {
                renderQueueItem(item);
              }
            });
          }
          
          // Batch tag selection
          document.querySelectorAll('.batch-tag-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
              if (e.target.checked) {
                batchSelectedTags.push(e.target.value);
              } else {
                batchSelectedTags = batchSelectedTags.filter(t => t !== e.target.value);
              }
            });
          });
          
          // Drag and drop handlers
          dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('border-purple-500', 'bg-purple-500/10');
          });
          
          dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-purple-500', 'bg-purple-500/10');
          });
          
          dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-purple-500', 'bg-purple-500/10');
            handleFiles(e.dataTransfer.files);
          });
          
          dropZone.addEventListener('click', () => {
            fileInput.click();
          });
          
          fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
            fileInput.value = ''; // Reset for re-selection
          });
          
          // Handle files
          function handleFiles(files) {
            if (files.length === 0) return;
            
            for (const file of files) {
              addToQueue(file);
            }
            
            queueContainer.classList.remove('hidden');
            uploadSummary.classList.add('hidden');
          }
          
          // Add file to queue
          function addToQueue(file) {
            const id = 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            const queueItem = {
              id,
              file,
              status: 'pending', // pending, uploading, success, error, duplicate
              progress: 0,
              error: null,
              mediaId: null,
              tags: [], // Per-file tags (for individual mode)
            };
            
            uploadQueue.push(queueItem);
            renderQueueItem(queueItem);
          }
          
          // Toggle tag for a specific file (individual mode)
          function toggleFileTag(itemId, tagId) {
            const item = uploadQueue.find(i => i.id === itemId);
            if (!item) return;
            
            const tagIndex = item.tags.indexOf(tagId);
            if (tagIndex === -1) {
              item.tags.push(tagId);
            } else {
              item.tags.splice(tagIndex, 1);
            }
            
            // Update the tag button appearance
            const tagBtn = document.querySelector(\`[data-file-tag="\${itemId}-\${tagId}"]\`);
            if (tagBtn) {
              if (item.tags.includes(tagId)) {
                tagBtn.classList.add('border-purple-500', 'bg-purple-500/20');
                tagBtn.classList.remove('border-gray-600');
              } else {
                tagBtn.classList.remove('border-purple-500', 'bg-purple-500/20');
                tagBtn.classList.add('border-gray-600');
              }
            }
          }
          
          // Generate per-file tag selector HTML
          function getFileTagSelectorHtml(item) {
            if (availableTags.length === 0) {
              return '<p class="text-gray-500 text-xs mt-2">No tags available</p>';
            }
            
            return \`
              <div class="mt-3 pt-3 border-t border-gray-600">
                <p class="text-xs text-gray-400 mb-2">Tags:</p>
                <div class="flex flex-wrap gap-1.5">
                  \${availableTags.map(tag => {
                    const isSelected = item.tags.includes(tag.id);
                    const colorStyle = tag.color ? \`border-color: \${tag.color}\` : '';
                    return \`
                      <button type="button"
                              data-file-tag="\${item.id}-\${tag.id}"
                              onclick="toggleFileTag('\${item.id}', '\${tag.id}')"
                              class="px-2 py-1 rounded-full text-xs border-2 transition-all \${isSelected ? 'border-purple-500 bg-purple-500/20' : 'border-gray-600 hover:border-gray-500'}"
                              style="\${!isSelected && tag.color ? colorStyle : ''}">
                        \${tag.name}
                      </button>
                    \`;
                  }).join('')}
                </div>
              </div>
            \`;
          }
          
          // Render queue item
          function renderQueueItem(item) {
            const existingEl = document.getElementById(item.id);
            const showTagSelector = !isBatchMode && item.status === 'pending' && availableTags.length > 0;
            
            const html = \`
              <div id="\${item.id}" class="bg-gray-700 rounded-lg p-4">
                <div class="flex items-center gap-4">
                  <div class="text-3xl">\${getFileIcon(item.file.type)}</div>
                  <div class="flex-1 min-w-0">
                    <p class="font-medium truncate">\${item.file.name}</p>
                    <p class="text-sm text-gray-400">\${formatFileSize(item.file.size)}</p>
                    \${item.status === 'uploading' ? \`
                      <div class="mt-2 bg-gray-600 rounded-full h-2 overflow-hidden">
                        <div class="bg-purple-500 h-full transition-all duration-300" style="width: \${item.progress}%"></div>
                      </div>
                    \` : ''}
                    \${item.status === 'error' ? \`
                      <p class="text-sm text-red-400 mt-1">\${item.error}</p>
                    \` : ''}
                    \${item.status === 'duplicate' ? \`
                      <p class="text-sm text-yellow-400 mt-1">Duplicate file detected</p>
                    \` : ''}
                  </div>
                  <div class="flex items-center gap-2">
                    \${item.status === 'pending' ? \`
                      <button onclick="removeFromQueue('\${item.id}')" class="text-gray-400 hover:text-red-400 transition-colors">
                        ✕
                      </button>
                    \` : ''}
                    \${item.status === 'uploading' ? \`
                      <span class="text-purple-400">Uploading...</span>
                    \` : ''}
                    \${item.status === 'success' ? \`
                      <span class="text-green-400">✓ Done</span>
                    \` : ''}
                    \${item.status === 'error' ? \`
                      <button onclick="retryUpload('\${item.id}')" class="text-yellow-400 hover:text-yellow-300 transition-colors">
                        Retry
                      </button>
                    \` : ''}
                    \${item.status === 'duplicate' ? \`
                      <button onclick="forceUpload('\${item.id}')" class="text-yellow-400 hover:text-yellow-300 transition-colors text-sm">
                        Upload Anyway
                      </button>
                    \` : ''}
                  </div>
                </div>
                \${showTagSelector ? getFileTagSelectorHtml(item) : ''}
              </div>
            \`;
            
            if (existingEl) {
              existingEl.outerHTML = html;
            } else {
              queueList.insertAdjacentHTML('beforeend', html);
            }
          }
          
          // Get file icon based on type
          function getFileIcon(mimeType) {
            if (mimeType.startsWith('video/')) return '🎬';
            if (mimeType.startsWith('audio/')) return '🎵';
            if (mimeType.startsWith('image/gif')) return '🎞️';
            if (mimeType.startsWith('image/')) return '🖼️';
            if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return '📄';
            return '📁';
          }
          
          // Format file size
          function formatFileSize(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
          }
          
          // Remove from queue
          function removeFromQueue(id) {
            uploadQueue = uploadQueue.filter(item => item.id !== id);
            document.getElementById(id)?.remove();
            
            if (uploadQueue.length === 0) {
              queueContainer.classList.add('hidden');
            }
          }
          
          // Clear completed
          function clearCompleted() {
            uploadQueue = uploadQueue.filter(item => {
              if (item.status === 'success' || item.status === 'duplicate') {
                document.getElementById(item.id)?.remove();
                return false;
              }
              return true;
            });
            
            if (uploadQueue.length === 0) {
              queueContainer.classList.add('hidden');
            }
          }
          
          // Upload all files
          async function uploadAll() {
            const pendingItems = uploadQueue.filter(item => item.status === 'pending');
            
            if (pendingItems.length === 0) {
              alert('No files to upload');
              return;
            }
            
            document.getElementById('uploadAllBtn').disabled = true;
            document.getElementById('uploadAllBtn').textContent = 'Uploading...';
            
            for (const item of pendingItems) {
              await uploadFile(item, false);
            }
            
            document.getElementById('uploadAllBtn').disabled = false;
            document.getElementById('uploadAllBtn').textContent = 'Upload All';
            
            showSummary();
          }
          
          // Upload single file
          async function uploadFile(item, force = false) {
            item.status = 'uploading';
            item.progress = 0;
            renderQueueItem(item);
            
            try {
              // Check for duplicates first (unless forcing)
              if (!force) {
                const checkRes = await fetch('/api/upload/check-duplicate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    filename: item.file.name,
                    size: item.file.size,
                  }),
                });
                
                const checkData = await checkRes.json();
                
                if (checkData.success && checkData.data.isDuplicate) {
                  item.status = 'duplicate';
                  item.error = 'File already exists: ' + checkData.data.existingFile?.title;
                  renderQueueItem(item);
                  return;
                }
              }
              
              // Create form data
              const formData = new FormData();
              formData.append('file', item.file);
              
              // Add tags based on mode
              if (isBatchMode) {
                // Batch mode: use batch selected tags for all files
                if (batchSelectedTags.length > 0) {
                  formData.append('tags', JSON.stringify(batchSelectedTags));
                }
              } else {
                // Individual mode: use per-file tags
                if (item.tags.length > 0) {
                  formData.append('tags', JSON.stringify(item.tags));
                }
              }
              
              // Upload with progress tracking
              const xhr = new XMLHttpRequest();
              
              await new Promise((resolve, reject) => {
                xhr.upload.addEventListener('progress', (e) => {
                  if (e.lengthComputable) {
                    item.progress = Math.round((e.loaded / e.total) * 100);
                    renderQueueItem(item);
                  }
                });
                
                xhr.addEventListener('load', () => {
                  if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                      const response = JSON.parse(xhr.responseText);
                      if (response.success) {
                        item.status = 'success';
                        item.mediaId = response.data.mediaId;
                      } else {
                        item.status = 'error';
                        item.error = response.error || 'Upload failed';
                      }
                    } catch (e) {
                      item.status = 'error';
                      item.error = 'Invalid response from server';
                    }
                    resolve();
                  } else {
                    item.status = 'error';
                    item.error = 'Upload failed: ' + xhr.statusText;
                    resolve();
                  }
                });
                
                xhr.addEventListener('error', () => {
                  item.status = 'error';
                  item.error = 'Network error';
                  resolve();
                });
                
                xhr.open('POST', '/api/upload');
                xhr.send(formData);
              });
              
              renderQueueItem(item);
              
            } catch (err) {
              item.status = 'error';
              item.error = err.message || 'Upload failed';
              renderQueueItem(item);
            }
          }
          
          // Retry upload
          function retryUpload(id) {
            const item = uploadQueue.find(i => i.id === id);
            if (item) {
              item.status = 'pending';
              item.error = null;
              renderQueueItem(item);
              uploadFile(item, false);
            }
          }
          
          // Force upload (ignore duplicate)
          function forceUpload(id) {
            const item = uploadQueue.find(i => i.id === id);
            if (item) {
              item.status = 'pending';
              item.error = null;
              renderQueueItem(item);
              uploadFile(item, true);
            }
          }
          
          // Show upload summary
          function showSummary() {
            const successful = uploadQueue.filter(i => i.status === 'success').length;
            const failed = uploadQueue.filter(i => i.status === 'error').length;
            const duplicates = uploadQueue.filter(i => i.status === 'duplicate').length;
            
            if (successful === 0 && failed === 0 && duplicates === 0) return;
            
            summaryContent.innerHTML = \`
              <div class="grid grid-cols-3 gap-4 text-center">
                <div class="bg-green-500/20 rounded-lg p-4">
                  <p class="text-2xl font-bold text-green-400">\${successful}</p>
                  <p class="text-sm text-gray-400">Uploaded</p>
                </div>
                <div class="bg-yellow-500/20 rounded-lg p-4">
                  <p class="text-2xl font-bold text-yellow-400">\${duplicates}</p>
                  <p class="text-sm text-gray-400">Duplicates</p>
                </div>
                <div class="bg-red-500/20 rounded-lg p-4">
                  <p class="text-2xl font-bold text-red-400">\${failed}</p>
                  <p class="text-sm text-gray-400">Failed</p>
                </div>
              </div>
            \`;
            
            uploadSummary.classList.remove('hidden');
          }
          
          // Reset uploader
          function resetUploader() {
            uploadQueue = [];
            queueList.innerHTML = '';
            queueContainer.classList.add('hidden');
            uploadSummary.classList.add('hidden');
            batchSelectedTags = [];
            document.querySelectorAll('.batch-tag-checkbox').forEach(cb => cb.checked = false);
            
            // Reset to individual mode
            if (isBatchMode) {
              toggleTaggingMode();
            }
          }
        </script>
      </body>
      </html>
    `;
    
    return c.html(html);
  } catch (error) {
    console.error("Error rendering upload page:", error);
    return c.html(`
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Error")}
      <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-red-500 mb-4">Error</h1>
          <p class="text-gray-400">Failed to load upload page</p>
          <a href="/" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg">
            Back to Library
          </a>
        </div>
      </body>
      </html>
    `, 500);
  }
});

/**
 * GET /settings/tags
 *
 * Tag management page
 */
pageRoutes.get("/settings/tags", async (c) => {
  try {
    const convex = c.get("convex");
    const auth = getAuth(c);
    
    // Note: Admin check is handled by middleware in index.ts
    // The middleware at /settings/* requires admin role
    
    // Use auth.user for navbar to ensure correct role is displayed
    const navUser = auth.user ? { username: auth.user.username, role: auth.user.role } : undefined;
    
    // Get tags with usage counts
    // Note: The Convex function returns 'count' property, not 'usageCount'
    let tagsWithCounts: Array<{ _id: string; name: string; color?: string; count: number }> = [];
    try {
      tagsWithCounts = await convex.query(api.tags.listWithCounts, {}) as any;
    } catch (e) {
      console.log("Tags not available yet:", e);
    }
    
    const html = `
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Tag Management")}
      <style>
        /* Modal animations */
        .modal-overlay {
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        .modal-overlay.active {
          opacity: 1;
          visibility: visible;
        }
        .modal-content {
          transform: scale(0.95) translateY(-20px);
          opacity: 0;
          transition: transform 0.3s ease, opacity 0.3s ease;
        }
        .modal-overlay.active .modal-content {
          transform: scale(1) translateY(0);
          opacity: 1;
        }
        /* Backdrop blur */
        .backdrop-blur-sm {
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        /* Modal centering fix */
        .modal-center {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
      </style>
      <body class="bg-gray-900 text-white min-h-screen">
        ${navbar("/admin", navUser)}
        
        <main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div class="flex items-center justify-between mb-8">
            <div>
              <a href="/admin" class="text-purple-400 hover:text-purple-300 text-sm mb-2 inline-block">
                ← Back to Settings
              </a>
              <h1 class="text-3xl font-bold">Tag Management</h1>
            </div>
            <button onclick="showCreateModal()"
                    class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg font-medium transition-colors">
              + Create Tag
            </button>
          </div>
          
          <!-- Tags List -->
          <div class="bg-gray-800 rounded-lg overflow-hidden shadow-lg">
            <table class="w-full">
              <thead class="bg-gray-700/80">
                <tr>
                  <th class="px-6 py-4 text-left text-sm font-semibold text-gray-200">Tag</th>
                  <th class="px-6 py-4 text-left text-sm font-semibold text-gray-200">Color</th>
                  <th class="px-6 py-4 text-left text-sm font-semibold text-gray-200">Files</th>
                  <th class="px-6 py-4 text-right text-sm font-semibold text-gray-200">Actions</th>
                </tr>
              </thead>
              <tbody id="tagsList" class="divide-y divide-gray-700/50">
                ${tagsWithCounts.length > 0 ? tagsWithCounts.map(tag => {
                  const count = tag.count ?? 0;
                  return `
                  <tr data-tag-id="${tag._id}" class="hover:bg-gray-700/30 transition-colors">
                    <td class="px-6 py-4">
                      <span class="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium"
                            style="background-color: ${tag.color || '#6b7280'}20; border: 2px solid ${tag.color || '#6b7280'}; color: ${tag.color || '#9ca3af'}">
                        ${tag.name}
                      </span>
                    </td>
                    <td class="px-6 py-4">
                      <div class="flex items-center gap-3">
                        <div class="w-7 h-7 rounded-full border-2 border-gray-600 shadow-inner"
                             style="background-color: ${tag.color || '#6b7280'}"></div>
                        <span class="text-gray-400 text-sm font-mono">${tag.color || 'Default'}</span>
                      </div>
                    </td>
                    <td class="px-6 py-4">
                      <span class="inline-flex items-center px-3 py-1 rounded-md text-sm font-medium ${count > 0 ? 'bg-purple-500/20 text-purple-300' : 'bg-gray-700 text-gray-400'}">
                        ${count} file${count !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-right">
                      <button onclick="showEditModal('${tag._id}', '${tag.name.replace(/'/g, "\\'")}', '${tag.color || ''}')"
                              class="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors mr-2">
                        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                        Edit
                      </button>
                      <button onclick="deleteTag('${tag._id}', '${tag.name.replace(/'/g, "\\'")}', ${count})"
                              class="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors ${count > 0 ? 'opacity-50 cursor-not-allowed' : ''}"
                              ${count > 0 ? 'title="Cannot delete: tag is in use"' : ''}>
                        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                        Delete
                      </button>
                    </td>
                  </tr>
                `}).join('') : `
                  <tr>
                    <td colspan="4" class="px-6 py-16 text-center">
                      <div class="flex flex-col items-center">
                        <div class="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mb-4">
                          <svg class="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
                          </svg>
                        </div>
                        <p class="text-lg text-gray-400 mb-2">No tags created yet</p>
                        <p class="text-sm text-gray-500 mb-4">Create tags to organize your media files</p>
                        <button onclick="createDefaultTags()"
                                class="inline-flex items-center px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors whitespace-nowrap">
                          <svg class="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                          </svg>
                          Create default tags
                        </button>
                      </div>
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
          
          <!-- Quick Actions -->
          ${tagsWithCounts.length > 0 ? `
          <div class="mt-6">
            <button onclick="createDefaultTags()"
                    class="inline-flex items-center bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap">
              <svg class="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
              </svg>
              Create Default Tags
            </button>
          </div>
          ` : ''}
        </main>
        
        <!-- Create/Edit Modal with Overlay -->
        <div id="tagModal" class="modal-overlay modal-center z-50" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <!-- Backdrop with blur -->
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick="hideModal()"></div>
          
          <!-- Modal Content -->
          <div class="modal-content relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 mx-auto">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700">
              <h2 id="modalTitle" class="text-xl font-bold text-white">Create Tag</h2>
              <button onclick="hideModal()"
                      class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
                      aria-label="Close modal">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
            
            <!-- Form -->
            <form id="tagForm" onsubmit="saveTag(event)" class="p-6">
              <input type="hidden" id="tagId" value="">
              
              <div class="space-y-5">
                <!-- Name Input -->
                <div>
                  <label for="tagName" class="block text-sm font-medium text-gray-300 mb-2">
                    Tag Name <span class="text-red-400">*</span>
                  </label>
                  <input type="text"
                         id="tagName"
                         required
                         placeholder="Enter tag name..."
                         class="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all">
                </div>
                
                <!-- Color Input -->
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    Color <span class="text-gray-500">(optional)</span>
                  </label>
                  <div class="flex items-center gap-3">
                    <div class="relative">
                      <input type="color"
                             id="tagColor"
                             value="#8b5cf6"
                             class="w-14 h-12 rounded-lg cursor-pointer bg-transparent border-2 border-gray-600 hover:border-gray-500 transition-colors">
                    </div>
                    <input type="text"
                           id="tagColorText"
                           placeholder="#8b5cf6"
                           class="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all">
                    <button type="button"
                            onclick="clearColor()"
                            class="px-3 py-2 text-gray-400 hover:text-white text-sm rounded-lg hover:bg-gray-700 transition-colors">
                      Clear
                    </button>
                  </div>
                </div>
                
                <!-- Color Presets -->
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-3">Quick Colors</label>
                  <div class="flex flex-wrap gap-2">
                    ${['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#1f2937'].map(color => `
                      <button type="button"
                              onclick="setColor('${color}')"
                              class="w-9 h-9 rounded-lg border-2 border-transparent hover:border-white hover:scale-110 transition-all shadow-md"
                              style="background-color: ${color}"
                              title="${color}">
                      </button>
                    `).join('')}
                  </div>
                </div>
                
                <!-- Preview -->
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">Preview</label>
                  <div class="bg-gray-700/30 rounded-lg p-4 flex items-center justify-center">
                    <span id="tagPreview" class="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium"
                          style="background-color: #8b5cf620; border: 2px solid #8b5cf6; color: #8b5cf6">
                      Tag Name
                    </span>
                  </div>
                </div>
              </div>
              
              <!-- Footer -->
              <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
                <button type="button"
                        onclick="hideModal()"
                        class="px-5 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors">
                  Cancel
                </button>
                <button type="submit"
                        class="px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors">
                  Save Tag
                </button>
              </div>
            </form>
          </div>
        </div>
        
        <script>
          const modal = document.getElementById('tagModal');
          const tagIdInput = document.getElementById('tagId');
          const tagNameInput = document.getElementById('tagName');
          const tagColorInput = document.getElementById('tagColor');
          const tagColorTextInput = document.getElementById('tagColorText');
          const modalTitle = document.getElementById('modalTitle');
          const tagPreview = document.getElementById('tagPreview');
          
          // Focus trap elements
          let focusableElements = [];
          let firstFocusable = null;
          let lastFocusable = null;
          
          // Update preview
          function updatePreview() {
            const name = tagNameInput.value.trim() || 'Tag Name';
            const color = tagColorTextInput.value.trim() || '#8b5cf6';
            tagPreview.textContent = name;
            tagPreview.style.backgroundColor = color + '20';
            tagPreview.style.borderColor = color;
            tagPreview.style.color = color;
          }
          
          // Sync color inputs
          tagColorInput.addEventListener('input', (e) => {
            tagColorTextInput.value = e.target.value;
            updatePreview();
          });
          
          tagColorTextInput.addEventListener('input', (e) => {
            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
              tagColorInput.value = e.target.value;
            }
            updatePreview();
          });
          
          tagNameInput.addEventListener('input', updatePreview);
          
          function setColor(color) {
            tagColorInput.value = color;
            tagColorTextInput.value = color;
            updatePreview();
          }
          
          function clearColor() {
            tagColorInput.value = '#8b5cf6';
            tagColorTextInput.value = '';
            updatePreview();
          }
          
          function setupFocusTrap() {
            focusableElements = modal.querySelectorAll(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            firstFocusable = focusableElements[0];
            lastFocusable = focusableElements[focusableElements.length - 1];
          }
          
          function handleTabKey(e) {
            if (e.key !== 'Tab') return;
            
            if (e.shiftKey) {
              if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable.focus();
              }
            } else {
              if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable.focus();
              }
            }
          }
          
          function showCreateModal() {
            modalTitle.textContent = 'Create Tag';
            tagIdInput.value = '';
            tagNameInput.value = '';
            clearColor();
            updatePreview();
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            setupFocusTrap();
            tagNameInput.focus();
            modal.addEventListener('keydown', handleTabKey);
          }
          
          function showEditModal(id, name, color) {
            modalTitle.textContent = 'Edit Tag';
            tagIdInput.value = id;
            tagNameInput.value = name;
            if (color) {
              tagColorInput.value = color;
              tagColorTextInput.value = color;
            } else {
              clearColor();
            }
            updatePreview();
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            setupFocusTrap();
            tagNameInput.focus();
            modal.addEventListener('keydown', handleTabKey);
          }
          
          function hideModal() {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            modal.removeEventListener('keydown', handleTabKey);
          }
          
          // Close modal on Escape key
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
              hideModal();
            }
          });
          
          async function saveTag(e) {
            e.preventDefault();
            
            const id = tagIdInput.value;
            const name = tagNameInput.value.trim();
            const color = tagColorTextInput.value.trim() || null;
            
            if (!name) {
              alert('Please enter a tag name');
              tagNameInput.focus();
              return;
            }
            
            try {
              const url = id ? '/api/tags/' + id : '/api/tags';
              const method = id ? 'PUT' : 'POST';
              
              const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color }),
              });
              
              const data = await res.json();
              
              if (data.success) {
                window.location.reload();
              } else {
                alert('Failed to save tag: ' + data.error);
              }
            } catch (err) {
              alert('Failed to save tag: ' + err.message);
            }
          }
          
          async function deleteTag(id, name, usageCount) {
            if (usageCount > 0) {
              alert('Cannot delete tag "' + name + '" because it is used by ' + usageCount + ' file(s). Remove the tag from all files first.');
              return;
            }
            
            if (!confirm('Are you sure you want to delete the tag "' + name + '"?')) {
              return;
            }
            
            try {
              const res = await fetch('/api/tags/' + id, { method: 'DELETE' });
              const data = await res.json();
              
              if (data.success) {
                document.querySelector('[data-tag-id="' + id + '"]')?.remove();
              } else {
                alert('Failed to delete tag: ' + data.error);
              }
            } catch (err) {
              alert('Failed to delete tag: ' + err.message);
            }
          }
          
          async function createDefaultTags() {
            if (!confirm('Create default tags (Movies, Music, Pictures, etc.)?')) {
              return;
            }
            
            try {
              const res = await fetch('/api/tags/defaults', { method: 'POST' });
              const data = await res.json();
              
              if (data.success) {
                alert('Created ' + data.data.created + ' default tags');
                window.location.reload();
              } else {
                alert('Failed to create default tags: ' + data.error);
              }
            } catch (err) {
              alert('Failed to create default tags: ' + err.message);
            }
          }
        </script>
      </body>
      </html>
    `;
    
    return c.html(html);
  } catch (error) {
    console.error("Error rendering tag management page:", error);
    return c.html(`
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead("Error")}
      <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-red-500 mb-4">Error</h1>
          <p class="text-gray-400">Failed to load tag management page</p>
          <a href="/admin" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg">
            Back to Settings
          </a>
        </div>
      </body>
      </html>
    `, 500);
  }
});
