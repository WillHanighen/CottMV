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
        
        /* Toast Notification Styles */
        .toast-container {
          position: fixed;
          top: 1rem;
          right: 1rem;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          pointer-events: none;
        }
        .toast {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.875rem 1rem;
          border-radius: 0.5rem;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2);
          pointer-events: auto;
          animation: toast-slide-in 0.3s ease-out;
          max-width: 24rem;
        }
        .toast.toast-success {
          background: linear-gradient(135deg, #065f46 0%, #047857 100%);
          border: 1px solid #10b981;
        }
        .toast.toast-error {
          background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
          border: 1px solid #ef4444;
        }
        .toast.toast-info {
          background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%);
          border: 1px solid #3b82f6;
        }
        .toast.toast-warning {
          background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
          border: 1px solid #f59e0b;
        }
        .toast-icon {
          font-size: 1.25rem;
          flex-shrink: 0;
        }
        .toast-message {
          color: white;
          font-size: 0.875rem;
          line-height: 1.4;
        }
        .toast-close {
          margin-left: auto;
          padding: 0.25rem;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          border-radius: 0.25rem;
          transition: color 0.2s, background-color 0.2s;
          flex-shrink: 0;
        }
        .toast-close:hover {
          color: white;
          background-color: rgba(255, 255, 255, 0.1);
        }
        .toast.toast-hiding {
          animation: toast-slide-out 0.2s ease-in forwards;
        }
        @keyframes toast-slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes toast-slide-out {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
        
        /* Confirm Modal Styles */
        .confirm-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s, visibility 0.2s;
        }
        .confirm-modal-overlay.active {
          opacity: 1;
          visibility: visible;
        }
        .confirm-modal {
          background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
          border: 1px solid #374151;
          border-radius: 0.75rem;
          padding: 1.5rem;
          max-width: 28rem;
          width: 90%;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          transform: scale(0.95);
          transition: transform 0.2s;
        }
        .confirm-modal-overlay.active .confirm-modal {
          transform: scale(1);
        }
        .confirm-modal-icon {
          width: 3rem;
          height: 3rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1rem;
          font-size: 1.5rem;
        }
        .confirm-modal-icon.warning {
          background: rgba(245, 158, 11, 0.2);
        }
        .confirm-modal-icon.danger {
          background: rgba(239, 68, 68, 0.2);
        }
        .confirm-modal-icon.info {
          background: rgba(59, 130, 246, 0.2);
        }
        .confirm-modal-title {
          font-size: 1.125rem;
          font-weight: 600;
          color: white;
          text-align: center;
          margin-bottom: 0.5rem;
        }
        .confirm-modal-message {
          color: #9ca3af;
          text-align: center;
          font-size: 0.875rem;
          line-height: 1.5;
          margin-bottom: 1.5rem;
        }
        .confirm-modal-buttons {
          display: flex;
          gap: 0.75rem;
          justify-content: center;
        }
        .confirm-modal-btn {
          padding: 0.625rem 1.25rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }
        .confirm-modal-btn.cancel {
          background: #374151;
          color: #d1d5db;
        }
        .confirm-modal-btn.cancel:hover {
          background: #4b5563;
        }
        .confirm-modal-btn.confirm {
          background: #7c3aed;
          color: white;
        }
        .confirm-modal-btn.confirm:hover {
          background: #6d28d9;
        }
        .confirm-modal-btn.danger {
          background: #dc2626;
          color: white;
        }
        .confirm-modal-btn.danger:hover {
          background: #b91c1c;
        }
      </style>
    </head>
  `;
}

/**
 * Notification system HTML and JavaScript
 * Includes toast notifications and confirmation modals
 */
function notificationSystem(): string {
  return `
    <!-- Toast Container -->
    <div id="toast-container" class="toast-container"></div>
    
    <!-- Confirm Modal -->
    <div id="confirm-modal-overlay" class="confirm-modal-overlay">
      <div class="confirm-modal">
        <div id="confirm-modal-icon" class="confirm-modal-icon warning">⚠️</div>
        <h3 id="confirm-modal-title" class="confirm-modal-title">Confirm Action</h3>
        <p id="confirm-modal-message" class="confirm-modal-message">Are you sure you want to proceed?</p>
        <div class="confirm-modal-buttons">
          <button id="confirm-modal-cancel" class="confirm-modal-btn cancel">Cancel</button>
          <button id="confirm-modal-confirm" class="confirm-modal-btn confirm">Confirm</button>
        </div>
      </div>
    </div>
    
    <script>
      // Toast Notification System
      const ToastManager = {
        container: null,
        
        init() {
          this.container = document.getElementById('toast-container');
        },
        
        show(message, type = 'info', duration = 4000) {
          if (!this.container) this.init();
          
          const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
          };
          
          const toast = document.createElement('div');
          toast.className = 'toast toast-' + type;
          toast.innerHTML = 
            '<span class="toast-icon">' + icons[type] + '</span>' +
            '<span class="toast-message">' + this.escapeHtml(message) + '</span>' +
            '<button class="toast-close" onclick="ToastManager.dismiss(this.parentElement)">✕</button>';
          
          this.container.appendChild(toast);
          
          if (duration > 0) {
            setTimeout(() => this.dismiss(toast), duration);
          }
          
          return toast;
        },
        
        dismiss(toast) {
          if (!toast || toast.classList.contains('toast-hiding')) return;
          toast.classList.add('toast-hiding');
          setTimeout(() => toast.remove(), 200);
        },
        
        success(message, duration) {
          return this.show(message, 'success', duration);
        },
        
        error(message, duration = 6000) {
          return this.show(message, 'error', duration);
        },
        
        warning(message, duration) {
          return this.show(message, 'warning', duration);
        },
        
        info(message, duration) {
          return this.show(message, 'info', duration);
        },
        
        escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }
      };
      
      // Confirmation Modal System
      const ConfirmModal = {
        overlay: null,
        resolvePromise: null,
        
        init() {
          this.overlay = document.getElementById('confirm-modal-overlay');
          
          document.getElementById('confirm-modal-cancel').addEventListener('click', () => {
            this.close(false);
          });
          
          document.getElementById('confirm-modal-confirm').addEventListener('click', () => {
            this.close(true);
          });
          
          this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
              this.close(false);
            }
          });
          
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.overlay.classList.contains('active')) {
              this.close(false);
            }
          });
        },
        
        show(options = {}) {
          if (!this.overlay) this.init();
          
          const title = options.title || 'Confirm Action';
          const message = options.message || 'Are you sure you want to proceed?';
          const confirmText = options.confirmText || 'Confirm';
          const cancelText = options.cancelText || 'Cancel';
          const type = options.type || 'warning'; // warning, danger, info
          
          const icons = {
            warning: '⚠️',
            danger: '🗑️',
            info: 'ℹ️'
          };
          
          document.getElementById('confirm-modal-icon').className = 'confirm-modal-icon ' + type;
          document.getElementById('confirm-modal-icon').textContent = icons[type] || icons.warning;
          document.getElementById('confirm-modal-title').textContent = title;
          document.getElementById('confirm-modal-message').textContent = message;
          
          const confirmBtn = document.getElementById('confirm-modal-confirm');
          confirmBtn.textContent = confirmText;
          confirmBtn.className = 'confirm-modal-btn ' + (type === 'danger' ? 'danger' : 'confirm');
          
          document.getElementById('confirm-modal-cancel').textContent = cancelText;
          
          this.overlay.classList.add('active');
          document.body.style.overflow = 'hidden';
          confirmBtn.focus();
          
          return new Promise((resolve) => {
            this.resolvePromise = resolve;
          });
        },
        
        close(result) {
          this.overlay.classList.remove('active');
          document.body.style.overflow = '';
          if (this.resolvePromise) {
            this.resolvePromise(result);
            this.resolvePromise = null;
          }
        }
      };
      
      // Initialize on DOM ready
      document.addEventListener('DOMContentLoaded', () => {
        ToastManager.init();
        ConfirmModal.init();
      });
    </script>
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
            <form action="/" method="GET" class="relative" id="search-form">
              <input type="text" 
                     name="search" 
                     placeholder="Search media..." 
                     class="bg-gray-700 text-white px-4 py-2 rounded-lg pl-10 focus:outline-none focus:ring-2 focus:ring-purple-500 w-64"
                     id="search-input">
              <span class="absolute left-3 top-2.5 text-gray-400">🔍</span>
              <!-- Hidden inputs to preserve current filters during search -->
              <input type="hidden" name="sort" id="search-sort">
              <input type="hidden" name="dir" id="search-dir">
              <input type="hidden" name="type" id="search-type">
              <input type="hidden" name="tag" id="search-tag">
              <input type="hidden" name="ext" id="search-ext">
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
    const search = c.req.query("search") || undefined;
    const mediaType = (c.req.query("type") || undefined) as "video" | "audio" | "image" | "gif" | "document" | "other" | undefined;
    const extension = c.req.query("ext") || undefined;
    const tagId = c.req.query("tag") || undefined;
    const sortField = (c.req.query("sort") || undefined) as "title" | "createdAt" | "size" | "duration" | "year" | undefined;
    const sortDirection = (c.req.query("dir") || undefined) as "asc" | "desc" | undefined;
    
    // Get available tags for filtering
    let tags: Array<{ _id: string; name: string; color?: string; isNsfw?: boolean }> = [];
    let nsfwTagIds: Set<string> = new Set();
    try {
      tags = await convex.query(api.tags.list, {}) as any;
      // Get NSFW tag IDs for blurring thumbnails
      const nsfwTags = await convex.query(api.tags.getNsfwTags, {}) as any[];
      nsfwTagIds = new Set(nsfwTags.map((t: any) => t._id));
    } catch (e) {
      console.log("Tags not available yet:", e);
    }
    
    // Get media list with filters - all filters work together including with search
    let media;
    if (search) {
      // Search with all filters applied
      media = await convex.query(api.media.search, {
        searchTerm: search,
        mediaType: mediaType,
        tagId: tagId as any,
        extension,
        sortField: sortField || "createdAt",
        sortDirection: sortDirection || "desc",
      });
    } else if (tagId) {
      // Filter by tag with all other filters
      try {
        media = await convex.query(api.media.listByTag, { 
          tagId: tagId as any,
          mediaType,
          extension,
          sortField: sortField || "createdAt",
          sortDirection: sortDirection || "desc",
        });
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
    
    // Build base URL params that should persist
    const baseParams = new URLSearchParams();
    if (search) baseParams.set('search', search);
    if (sortField) baseParams.set('sort', sortField);
    if (sortDirection) baseParams.set('dir', sortDirection);
    if (extension) baseParams.set('ext', extension);
    
    // Helper to build filter URLs
    const buildFilterUrl = (overrides: Record<string, string | undefined>) => {
      const params = new URLSearchParams(baseParams);
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const queryStr = params.toString();
      return queryStr ? `/?${queryStr}` : '/';
    };
    
    // Build filter UI
    const filterTabs = `
      <div class="flex flex-wrap gap-2 mb-4">
        <a href="${buildFilterUrl({ type: undefined, tag: undefined })}"
           class="px-3 py-1.5 rounded-lg text-sm ${!mediaType && !tagId ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}">
          All (${Object.values(typeCounts).reduce((a: number, b: number) => a + b, 0)})
        </a>
        ${Object.entries(typeCounts)
          .filter(([_, count]) => count > 0)
          .map(([type, count]) => `
            <a href="${buildFilterUrl({ type, tag: tagId })}"
               class="px-3 py-1.5 rounded-lg text-sm ${mediaType === type ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}">
              ${getMediaTypeIcon(type)} ${type.charAt(0).toUpperCase() + type.slice(1)} (${count})
            </a>
          `).join('')}
      </div>
      ${tags.length > 0 ? `
        <div class="flex flex-wrap gap-2 mb-4">
          <span class="text-gray-400 text-sm py-1.5">🏷️ Tags:</span>
          ${tags.map(tag => `
            <a href="${buildFilterUrl({ tag: tag._id, type: mediaType })}"
               class="px-3 py-1.5 rounded-full text-sm transition-colors ${tagId === tag._id ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
               style="${tag.color && tagId !== tag._id ? `border: 1px solid ${tag.color}` : ''}">
              ${tag.name}
            </a>
          `).join('')}
          ${tagId ? `
            <a href="${buildFilterUrl({ tag: undefined })}"
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
      ? media.map((item: any) => {
          // Check if item has NSFW tag
          const isNsfw = item.tags && item.tags.some((tagId: string) => nsfwTagIds.has(tagId));
          const blurClass = isNsfw ? 'blur-xl' : '';
          
          let previewContent = '';
          
          if (item.mediaType === "image") {
            previewContent = `<img src="/api/stream/${item._id}" alt="${item.title}" class="w-full h-full object-cover ${blurClass}" loading="lazy">`;
          } else if (item.mediaType === "gif") {
            previewContent = `<img src="/api/stream/${item._id}" alt="${item.title}" class="w-full h-full object-cover ${blurClass}" loading="lazy">`;
          } else if (item.mediaType === "video") {
            previewContent = `<img src="/api/stream/thumbnail/${item._id}" alt="${item.title}" class="w-full h-full object-cover ${blurClass}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="hidden w-full h-full flex items-center justify-center"><span class="text-6xl">${getMediaTypeIcon(item.mediaType)}</span></div>`;
          } else if (item.mediaType === "audio" && item.coverUrl) {
            previewContent = `<img src="${item.coverUrl}" alt="${item.title}" class="w-full h-full object-cover ${blurClass}">`;
          } else {
            previewContent = `<span class="text-6xl">${getMediaTypeIcon(item.mediaType || 'other')}</span>`;
          }
          
          return `
            <a href="/watch/${item._id}" 
               class="bg-gray-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-purple-500 transition-all group">
              <div class="aspect-video bg-gray-700 flex items-center justify-center relative overflow-hidden">
                ${previewContent}
                <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center">
                  <span class="text-white text-4xl opacity-0 group-hover:opacity-100 transition-opacity">▶️</span>
                </div>
                ${isNsfw ? `
                  <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span class="bg-red-600 bg-opacity-90 text-white text-xs px-2 py-1 rounded font-bold">NSFW</span>
                  </div>
                ` : ""}
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
                ${item.mediaType === "gif" ? `
                  <span class="absolute top-2 right-2 bg-blue-600 bg-opacity-90 text-white text-xs px-2 py-1 rounded">
                    GIF
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
          `;
        }).join("")
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
          // Initialize search form hidden inputs from current URL params
          (function() {
            const url = new URL(window.location);
            const searchInput = document.getElementById('search-input');
            const sortInput = document.getElementById('search-sort');
            const dirInput = document.getElementById('search-dir');
            const typeInput = document.getElementById('search-type');
            const tagInput = document.getElementById('search-tag');
            const extInput = document.getElementById('search-ext');
            
            // Set search input value if present
            const searchValue = url.searchParams.get('search');
            if (searchInput && searchValue) {
              searchInput.value = searchValue;
            }
            
            // Set hidden inputs from current URL params
            if (sortInput) sortInput.value = url.searchParams.get('sort') || '';
            if (dirInput) dirInput.value = url.searchParams.get('dir') || '';
            if (typeInput) typeInput.value = url.searchParams.get('type') || '';
            if (tagInput) tagInput.value = url.searchParams.get('tag') || '';
            if (extInput) extInput.value = url.searchParams.get('ext') || '';
            
            // Remove empty hidden inputs before form submit
            const form = document.getElementById('search-form');
            if (form) {
              form.addEventListener('submit', function() {
                const hiddenInputs = form.querySelectorAll('input[type="hidden"]');
                hiddenInputs.forEach(function(input) {
                  if (!input.value) {
                    input.disabled = true;
                  }
                });
              });
            }
          })();
          
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
                ToastManager.success("Scan complete! Found " + data.data.scanned + " files, added " + data.data.added + " new.");
                setTimeout(() => window.location.reload(), 1500);
              } else {
                ToastManager.error("Scan failed: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Scan failed: " + err.message);
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
                ToastManager.success(data.message);
                setTimeout(() => window.location.reload(), 1500);
              } else {
                ToastManager.error("Metadata fetch failed: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Metadata fetch failed: " + err.message);
            } finally {
              btn.disabled = false;
              btn.textContent = "📥 Fetch Metadata";
            }
          }
        </script>
        ${notificationSystem()}
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
    const settings = await convex.query(api.settings.getAll, {});
    const defaultQuality = settings.default_video_quality?.value || "720p";
    
    // Get all tags for tag editing
    let allTags: Array<{ _id: string; name: string; color?: string; isNsfw?: boolean }> = [];
    let nsfwTagIds: Set<string> = new Set();
    try {
      allTags = await convex.query(api.tags.list, {}) as any;
      const nsfwTags = await convex.query(api.tags.getNsfwTags, {}) as any[];
      nsfwTagIds = new Set(nsfwTags.map((t: any) => t._id));
    } catch (e) {
      console.log("Tags not available yet:", e);
    }
    
    // Check if media has NSFW tag
    const isNsfw = media?.tags && media.tags.some((tagId: string) => nsfwTagIds.has(tagId));
    
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
    
    // Get media tags with details for display
    const mediaTags = media.tags ? allTags.filter(t => media.tags!.includes(t._id as any)) : [];
    const mediaTagsJson = JSON.stringify(mediaTags.map(t => t._id));
    const allTagsJson = JSON.stringify(allTags);
    
    const html = `
      <!DOCTYPE html>
      <html lang="en" class="dark">
      ${htmlHead(media.title)}
      <body class="bg-gray-900 text-white min-h-screen">
        ${navbar("", navUser)}
        
        ${isNsfw ? `
        <!-- NSFW Warning Modal -->
        <div id="nsfw-modal" class="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center">
          <div class="bg-gray-800 rounded-lg p-8 max-w-md mx-4 text-center">
            <span class="text-6xl mb-4 block">⚠️</span>
            <h2 class="text-2xl font-bold mb-4 text-red-500">NSFW Content Warning</h2>
            <p class="text-gray-300 mb-6">This content has been marked as NSFW (Not Safe For Work). Are you sure you want to view it?</p>
            <div class="flex gap-4 justify-center">
              <a href="/" class="bg-gray-600 hover:bg-gray-700 px-6 py-3 rounded-lg font-medium transition-colors">
                Go Back
              </a>
              <button onclick="confirmNsfw()" class="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg font-medium transition-colors">
                View Content
              </button>
            </div>
          </div>
        </div>
        ` : ''}
        
        <main id="main-content" class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 ${isNsfw ? 'hidden' : ''}">
          <a href="/" class="text-purple-400 hover:text-purple-300 mb-4 inline-block">
            ← Back to Library
          </a>
          
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <!-- Player Section -->
            <div class="lg:col-span-2">
              <div class="bg-gray-800 rounded-lg overflow-hidden">
                ${isVideo ? `
                  <div class="aspect-video bg-black relative" id="video-container">
                    <video id="player" 
                           class="w-full h-full" 
                           controls 
                           preload="none"
                           data-id="${media._id}">
                      Your browser does not support the video tag.
                    </video>
                    <div id="transcode-overlay" class="absolute inset-0 bg-gray-900 flex flex-col items-center justify-center z-10" style="display: none;">
                      <div class="text-center">
                        <div class="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p id="transcode-status" class="text-lg font-medium mb-2">Preparing video...</p>
                        <div class="w-64 bg-gray-700 rounded-full h-2 mb-2">
                          <div id="transcode-progress" class="bg-purple-500 h-2 rounded-full transition-all" style="width: 0%"></div>
                        </div>
                        <p id="transcode-percent" class="text-sm text-gray-400">0%</p>
                        <p id="transcode-eta" class="text-xs text-gray-500 mt-1"></p>
                      </div>
                    </div>
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
                      <div class="flex flex-wrap gap-2">
                        <button onclick="changeQuality('480p')" 
                                id="btn-480p"
                                class="quality-btn bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
                          480p
                        </button>
                        <button onclick="changeQuality('720p')" 
                                id="btn-720p"
                                class="quality-btn bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
                          720p
                        </button>
                        <button onclick="changeQuality('1080p')" 
                                id="btn-1080p"
                                class="quality-btn bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
                          1080p
                        </button>
                        <button onclick="changeQuality('1440p')" 
                                id="btn-1440p"
                                class="quality-btn bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
                          1440p
                        </button>
                        <button onclick="changeQuality('2160p')" 
                                id="btn-2160p"
                                class="quality-btn bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
                          4K
                        </button>
                        <button onclick="changeQuality('')" 
                                id="btn-original"
                                class="quality-btn bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors">
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
              <!-- Cover Image Section -->
              <div class="bg-gray-800 rounded-lg overflow-hidden">
                <div class="relative group">
                  ${media.customCover || media.coverUrl ? `
                    <img id="cover-image" 
                         src="/api/cover/${media._id}" 
                         alt="${media.title}" 
                         class="w-full object-cover"
                         onerror="this.style.display='none'; document.getElementById('cover-placeholder').style.display='flex';">
                    <div id="cover-placeholder" class="hidden w-full h-48 bg-gray-700 items-center justify-center">
                      <span class="text-gray-500 text-4xl">🎬</span>
                    </div>
                  ` : `
                    <div id="cover-placeholder" class="w-full h-48 bg-gray-700 flex items-center justify-center">
                      <span class="text-gray-500 text-4xl">${isVideo ? '🎬' : isAudio ? '🎵' : '📄'}</span>
                    </div>
                  `}
                  <!-- Overlay with upload/delete buttons -->
                  <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <label class="cursor-pointer bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg text-sm transition-colors">
                      📷 Upload Cover
                      <input type="file" 
                             id="cover-upload-input" 
                             accept="image/jpeg,image/png,image/webp,image/gif"
                             class="hidden"
                             onchange="uploadCover(this.files[0])">
                    </label>
                    ${media.customCover ? `
                      <button onclick="deleteCover()" 
                              class="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm transition-colors">
                        🗑️ Remove
                      </button>
                    ` : ''}
                  </div>
                </div>
                ${media.customCover ? `
                  <div class="px-3 py-2 text-xs text-gray-400 border-t border-gray-700">
                    ✨ Custom cover
                  </div>
                ` : media.coverUrl ? `
                  <div class="px-3 py-2 text-xs text-gray-400 border-t border-gray-700">
                    🌐 From ${media.externalSource || 'external source'}
                  </div>
                ` : ''}
              </div>
              
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
              
              <!-- Tags Section -->
              <div class="bg-gray-800 rounded-lg p-4">
                <h3 class="font-medium text-gray-300 mb-3">🏷️ Tags</h3>
                <div id="current-tags" class="flex flex-wrap gap-2 mb-3">
                  ${mediaTags.length > 0 ? mediaTags.map(tag => `
                    <span class="tag-item inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm"
                          style="background-color: ${tag.color || '#6B7280'}20; border: 1px solid ${tag.color || '#6B7280'}"
                          data-tag-id="${tag._id}">
                      ${tag.isNsfw ? '🔞 ' : ''}${tag.name}
                      <button onclick="removeTag('${tag._id}')" class="ml-1 text-gray-400 hover:text-red-400 text-xs">✕</button>
                    </span>
                  `).join('') : '<p class="text-gray-500 text-sm">No tags</p>'}
                </div>
                <div class="relative">
                  <select id="add-tag-select" 
                          onchange="addSelectedTag(this.value)"
                          class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="">Add a tag...</option>
                    ${allTags.filter(t => !mediaTags.some(mt => mt._id === t._id)).map(tag => `
                      <option value="${tag._id}" ${tag.isNsfw ? 'class="text-red-400"' : ''}>
                        ${tag.isNsfw ? '🔞 ' : ''}${tag.name}
                      </option>
                    `).join('')}
                  </select>
                </div>
              </div>
              
              <!-- Custom Metadata Section -->
              <div class="bg-gray-800 rounded-lg p-4">
                <div class="flex justify-between items-center mb-3">
                  <h3 class="font-medium text-gray-300">✏️ Edit Info</h3>
                  <button onclick="toggleEditMode()" id="edit-toggle" class="text-purple-400 hover:text-purple-300 text-sm">
                    Edit
                  </button>
                </div>
                <form id="metadata-form" class="space-y-3 hidden">
                  <div>
                    <label class="block text-xs text-gray-400 mb-1">Title</label>
                    <input type="text" 
                           id="edit-title" 
                           value="${media.title.replace(/"/g, '&quot;')}"
                           class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                  </div>
                  <div>
                    <label class="block text-xs text-gray-400 mb-1">Description</label>
                    <textarea id="edit-description" 
                              rows="3"
                              class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none">${media.description || ''}</textarea>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block text-xs text-gray-400 mb-1">Year</label>
                      <input type="number" 
                             id="edit-year" 
                             value="${media.year || ''}"
                             placeholder="YYYY"
                             class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                    </div>
                    <div>
                      <label class="block text-xs text-gray-400 mb-1">Genre</label>
                      <input type="text" 
                             id="edit-genre" 
                             value="${(media.genre || '').replace(/"/g, '&quot;')}"
                             class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                    </div>
                  </div>
                  <div>
                    <label class="block text-xs text-gray-400 mb-1">Artist / Author</label>
                    <input type="text" 
                           id="edit-artist" 
                           value="${(media.artist || '').replace(/"/g, '&quot;')}"
                           class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                  </div>
                  <div>
                    <label class="block text-xs text-gray-400 mb-1">Album</label>
                    <input type="text" 
                           id="edit-album" 
                           value="${(media.album || '').replace(/"/g, '&quot;')}"
                           class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                  </div>
                  <div>
                    <label class="block text-xs text-gray-400 mb-1">OCR Text <span class="text-gray-500">(extracted text for search)</span></label>
                    <textarea id="edit-ocrtext" 
                              rows="4"
                              placeholder="Text extracted from images/videos for search..."
                              class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none font-mono">${(media.ocrText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                    <p class="text-xs text-gray-500 mt-1">${media.ocrText ? `${media.ocrText.length} characters` : 'No OCR text'} ${media.ocrAttempted ? '• OCR attempted' : ''}</p>
                  </div>
                  <div class="flex gap-2 pt-2">
                    <button type="button" onclick="cancelEdit()" class="flex-1 bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded text-sm transition-colors">
                      Cancel
                    </button>
                    <button type="submit" class="flex-1 bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded text-sm transition-colors">
                      Save
                    </button>
                  </div>
                </form>
                <div id="metadata-display" class="space-y-2 text-sm">
                  ${media.description ? `<p class="text-gray-400"><span class="text-gray-500">Description:</span> ${media.description.substring(0, 100)}${media.description.length > 100 ? '...' : ''}</p>` : ''}
                  ${media.artist ? `<p class="text-gray-400"><span class="text-gray-500">Artist:</span> ${media.artist}</p>` : ''}
                  ${media.album ? `<p class="text-gray-400"><span class="text-gray-500">Album:</span> ${media.album}</p>` : ''}
                  ${media.ocrText ? `
                    <div class="mt-2 pt-2 border-t border-gray-700">
                      <p class="text-gray-500 text-xs mb-1">🔍 OCR Text (${media.ocrText.length} chars):</p>
                      <p class="text-gray-400 text-xs font-mono bg-gray-700/50 rounded p-2 max-h-20 overflow-y-auto">${media.ocrText.substring(0, 200).replace(/</g, '&lt;').replace(/>/g, '&gt;')}${media.ocrText.length > 200 ? '...' : ''}</p>
                    </div>
                  ` : ''}
                  ${!media.description && !media.artist && !media.album && !media.ocrText ? '<p class="text-gray-500">No custom metadata</p>' : ''}
                </div>
              </div>
            </div>
          </div>
        </main>
        
        <script>
          const player = document.getElementById("player");
          let currentTime = 0;
          let transcodingEventSource = null;
          let isTranscoding = false;
          let transcodingStarted = false;
          let currentQuality = "${defaultQuality}";
          const mediaId = "${media._id}";
          
          const isNsfwContent = ${isNsfw ? 'true' : 'false'};
          
          if (player) {
            // Don't auto-initialize for NSFW content - wait for user confirmation
            if (!isNsfwContent) {
              initVideoPlayer();
            }
            updateQualityButtons();
            
            // Save current time before changing source
            player.addEventListener("timeupdate", () => {
              currentTime = player.currentTime;
            });
            
            // Handle video errors - might need transcoding
            player.addEventListener("error", () => {
              console.log("Video error, checking if transcoding is needed...");
              if (!transcodingStarted) {
                startTranscodingIfNeeded();
              }
            });
          }
          
          async function initVideoPlayer() {
            if (!player) return;
            
            try {
              // Check if video needs transcoding
              const res = await fetch("/api/stream/" + mediaId + "/info");
              const data = await res.json();
              
              if (data.success && data.data.needsTranscoding) {
                // Show transcode overlay and start transcoding
                showTranscodeOverlay();
                transcodingStarted = true;
                const quality = currentQuality && data.data.availableQualities.includes(currentQuality) 
                  ? currentQuality 
                  : (data.data.availableQualities[1] || "720p");
                startTranscoding(mediaId, quality, "mp4");
              } else if (currentQuality) {
                // User has a specific quality preference - use SSE endpoint to check if cached
                // This shows progress overlay if transcoding is needed, or loads immediately if cached
                showTranscodeOverlay();
                transcodingStarted = true;
                startTranscoding(mediaId, currentQuality, "mp4");
              } else {
                // No quality specified, play original directly
                player.src = "/api/stream/" + mediaId;
                player.load();
                player.play().catch(e => {
                  console.log("Autoplay prevented:", e.message);
                });
              }
            } catch (err) {
              console.error("Error checking transcoding status:", err);
              // Try to play anyway
              player.src = "/api/stream/" + mediaId;
              player.load();
              player.play().catch(e => {
                console.log("Autoplay prevented:", e.message);
              });
            }
          }
          
          function showTranscodeOverlay() {
            const overlay = document.getElementById("transcode-overlay");
            const progressBar = document.getElementById("transcode-progress");
            const progressText = document.getElementById("transcode-percent");
            const statusText = document.getElementById("transcode-status");
            const etaText = document.getElementById("transcode-eta");
            
            if (overlay) {
              overlay.style.display = "flex";
              player.pause();
            }
          }
          
          function hideTranscodeOverlay() {
            const overlay = document.getElementById("transcode-overlay");
            if (overlay) {
              overlay.style.display = "none";
            }
            
            // Reset flags
            isTranscoding = false;
            transcodingStarted = false;
            
            // Close event source if open
            if (transcodingEventSource) {
              transcodingEventSource.close();
              transcodingEventSource = null;
            }
          }
          
          function startTranscoding(mediaId, quality, format) {
            // Close any existing connection
            if (transcodingEventSource) {
              transcodingEventSource.close();
            }
            
            isTranscoding = true;
            let transcodingComplete = false;
            const progressBar = document.getElementById("transcode-progress");
            const progressText = document.getElementById("transcode-percent");
            const statusText = document.getElementById("transcode-status");
            const etaText = document.getElementById("transcode-eta");
            
            // Connect to progress stream
            transcodingEventSource = new EventSource("/api/stream/" + mediaId + "/transcode-progress?quality=" + quality + "&format=" + format);
            
            transcodingEventSource.onmessage = function(event) {
              try {
                const data = JSON.parse(event.data);
                
                if (data.event === "status") {
                  if (statusText) statusText.textContent = data.message;
                } else if (data.event === "progress") {
                  if (progressBar) progressBar.style.width = data.percent + "%";
                  if (progressText) progressText.textContent = Math.round(data.percent) + "%";
                  if (statusText) statusText.textContent = data.message;
                  if (etaText && data.eta) etaText.textContent = "ETA: " + data.eta;
                } else if (data.event === "heartbeat") {
                  // Ignore heartbeat events, just connection keep-alive
                  return;
                } else if (data.event === "complete") {
                  transcodingComplete = true;
                  hideTranscodeOverlay();
                  
                  // Update player source
                  if (player) {
                    player.src = "/api/stream/" + mediaId + "?quality=" + quality;
                    player.load();
                    
                    // Restore playback position if we had one
                    if (currentTime > 0) {
                      player.currentTime = currentTime;
                    }
                    
                    // Try to play
                    player.play().catch(e => {
                      console.log("Playback error:", e.message);
                    });
                  }
                } else if (data.event === "error") {
                  if (statusText) statusText.textContent = "Error: " + data.message;
                  statusText.classList.add("text-red-500");
                  console.error("Transcoding error:", data.message);
                  isTranscoding = false;
                  transcodingStarted = false;
                }
              } catch (err) {
                console.error("Error parsing progress event:", err);
              }
            };
            
            transcodingEventSource.onerror = function() {
              // Only treat as error if transcoding didn't complete
              // EventSource triggers onerror when connection closes, even after "complete" event
              if (!transcodingComplete) {
                console.error("Transcoding stream error or connection closed prematurely");
                
                // Wait a moment before falling back to give transcoding a chance to complete
                setTimeout(() => {
                  if (!transcodingComplete) {
                    isTranscoding = false;
                    transcodingStarted = false;
                    
                    // Try to play the requested quality anyway (it might have completed server-side)
                    if (player) {
                      player.src = "/api/stream/" + mediaId + "?quality=" + quality;
                      player.load();
                      player.play().catch(e => {
                        // If that fails, try original
                        console.log("Quality stream failed, trying original:", e.message);
                        player.src = "/api/stream/" + mediaId;
                        player.load();
                        player.play().catch(() => {});
                      });
                    }
                  }
                }, 2000); // Wait 2 seconds before falling back
              } else {
                // Connection closed normally after completion
                isTranscoding = false;
                transcodingStarted = false;
              }
            };
          }
          
          async function startTranscodingIfNeeded() {
            // This function is called when video fails to load
            if (transcodingStarted || isTranscoding) return;
            
            showTranscodeOverlay();
            transcodingStarted = true;
            
            // Get stream info first
            try {
              const res = await fetch("/api/stream/" + mediaId + "/info");
              const data = await res.json();
              
              if (data.success && data.data.availableQualities) {
                const quality = currentQuality && data.data.availableQualities.includes(currentQuality) 
                  ? currentQuality 
                  : (data.data.availableQualities[1] || "720p");
                startTranscoding(mediaId, quality, "mp4");
              }
            } catch (err) {
              console.error("Error getting stream info:", err);
            }
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
          
          function updateQualityButtons() {
            const qualities = ['480p', '720p', '1080p', '1440p', '2160p', 'original'];
            qualities.forEach(q => {
              const btn = document.getElementById('btn-' + q);
              if (btn) {
                const isActive = currentQuality === q || (q === 'original' && currentQuality === '');
                if (isActive) {
                  btn.classList.remove('bg-gray-700', 'hover:bg-gray-600');
                  btn.classList.add('bg-purple-600', 'hover:bg-purple-700');
                } else {
                  btn.classList.remove('bg-purple-600', 'hover:bg-purple-700');
                  btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
                }
              }
            });
          }
          
          function changeQuality(quality) {
            if (!player) return;
            
            // If switching to original or no quality specified, load directly
            if (!quality) {
              currentQuality = quality;
              updateQualityButtons();
              const savedTime = currentTime;
              const wasPlaying = !player.paused;
              
              player.src = "/api/stream/" + mediaId;
              player.load();
              
              player.addEventListener("loadedmetadata", function onLoad() {
                player.currentTime = savedTime;
                if (wasPlaying) player.play();
                player.removeEventListener("loadedmetadata", onLoad);
              });
              return;
            }
            
            // For quality changes, always use the SSE endpoint
            // It will return "complete" immediately if the file is cached
            const savedTime = currentTime;
            const wasPlaying = !player.paused;
            currentQuality = quality;
            updateQualityButtons();
            
            // Show transcode overlay immediately - it will hide quickly if cached
            showTranscodeOverlay();
            transcodingStarted = true;
            
            // Close any existing connection
            if (transcodingEventSource) {
              transcodingEventSource.close();
            }
            
            isTranscoding = true;
            let transcodingComplete = false;
            const progressBar = document.getElementById("transcode-progress");
            const progressText = document.getElementById("transcode-percent");
            const statusText = document.getElementById("transcode-status");
            const etaText = document.getElementById("transcode-eta");
            
            // Connect to progress stream
            transcodingEventSource = new EventSource("/api/stream/" + mediaId + "/transcode-progress?quality=" + quality + "&format=mp4");
            
            transcodingEventSource.onmessage = function(event) {
              try {
                const data = JSON.parse(event.data);
                
                if (data.event === "status") {
                  if (statusText) statusText.textContent = data.message;
                } else if (data.event === "progress") {
                  if (progressBar) progressBar.style.width = data.percent + "%";
                  if (progressText) progressText.textContent = Math.round(data.percent) + "%";
                  if (statusText) statusText.textContent = data.message || "Transcoding...";
                  if (etaText && data.eta) etaText.textContent = "ETA: " + data.eta;
                } else if (data.event === "heartbeat") {
                  return;
                } else if (data.event === "complete") {
                  transcodingComplete = true;
                  hideTranscodeOverlay();
                  
                  // Update player source
                  if (player) {
                    player.src = "/api/stream/" + mediaId + "?quality=" + quality;
                    player.load();
                    
                    player.addEventListener("loadedmetadata", function onLoad() {
                      player.currentTime = savedTime;
                      if (wasPlaying) player.play();
                      player.removeEventListener("loadedmetadata", onLoad);
                    });
                  }
                  
                  transcodingEventSource.close();
                  transcodingEventSource = null;
                } else if (data.event === "error") {
                  if (statusText) statusText.textContent = "Error: " + data.message;
                  statusText.classList.add("text-red-500");
                  console.error("Transcoding error:", data.message);
                  isTranscoding = false;
                  transcodingStarted = false;
                }
              } catch (err) {
                console.error("Error parsing progress event:", err);
              }
            };
            
            transcodingEventSource.onerror = function() {
              if (!transcodingComplete) {
                console.error("Transcoding stream error or connection closed prematurely");
                
                setTimeout(() => {
                  if (!transcodingComplete) {
                    isTranscoding = false;
                    transcodingStarted = false;
                    hideTranscodeOverlay();
                    
                    // Try to play anyway
                    if (player) {
                      player.src = "/api/stream/" + mediaId + "?quality=" + quality;
                      player.load();
                      
                      player.addEventListener("loadedmetadata", function onLoad() {
                        player.currentTime = savedTime;
                        if (wasPlaying) player.play();
                        player.removeEventListener("loadedmetadata", onLoad);
                      });
                    }
                  }
                }, 2000);
              } else {
                isTranscoding = false;
                transcodingStarted = false;
              }
            };
          }
          
          async function fetchMetadata(mediaId) {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = "Fetching...";
            
            try {
              const res = await fetch("/api/metadata/fetch/" + mediaId, { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success("Metadata fetched successfully!");
                setTimeout(() => window.location.reload(), 1500);
              } else {
                ToastManager.error("Failed to fetch metadata: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Failed to fetch metadata: " + err.message);
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
                ToastManager.success("Metadata refreshed successfully!");
                setTimeout(() => window.location.reload(), 1500);
              } else {
                ToastManager.error("Failed to refresh metadata: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Failed to refresh metadata: " + err.message);
            } finally {
              btn.disabled = false;
              btn.textContent = "🔄 Refresh Metadata";
            }
          }
          
          // NSFW confirmation
          function confirmNsfw() {
            const modal = document.getElementById("nsfw-modal");
            const mainContent = document.getElementById("main-content");
            if (modal) modal.style.display = "none";
            if (mainContent) mainContent.classList.remove("hidden");
            
            // If there's a video player, initialize it after confirmation
            if (player) {
              initVideoPlayer();
            }
          }
          
          // Tag management
          const allTags = ${allTagsJson};
          let currentTags = ${mediaTagsJson};
          
          async function addSelectedTag(tagId) {
            if (!tagId) return;
            
            try {
              const res = await fetch("/api/tags/" + tagId + "/media/" + mediaId, { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success("Tag added successfully!");
                setTimeout(() => window.location.reload(), 1000);
              } else {
                ToastManager.error("Failed to add tag: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Failed to add tag: " + err.message);
            }
            
            // Reset select
            document.getElementById("add-tag-select").value = "";
          }
          
          async function removeTag(tagId) {
            const confirmed = await ConfirmModal.show({
              title: "Remove Tag",
              message: "Are you sure you want to remove this tag from this media?",
              confirmText: "Remove",
              type: "warning"
            });
            if (!confirmed) return;
            
            try {
              const res = await fetch("/api/tags/" + tagId + "/media/" + mediaId, { method: "DELETE" });
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success("Tag removed successfully!");
                setTimeout(() => window.location.reload(), 1000);
              } else {
                ToastManager.error("Failed to remove tag: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Failed to remove tag: " + err.message);
            }
          }
          
          // Metadata editing
          let editMode = false;
          
          function toggleEditMode() {
            editMode = !editMode;
            const form = document.getElementById("metadata-form");
            const display = document.getElementById("metadata-display");
            const toggle = document.getElementById("edit-toggle");
            
            if (editMode) {
              form.classList.remove("hidden");
              display.classList.add("hidden");
              toggle.textContent = "Cancel";
            } else {
              form.classList.add("hidden");
              display.classList.remove("hidden");
              toggle.textContent = "Edit";
            }
          }
          
          function cancelEdit() {
            editMode = false;
            const form = document.getElementById("metadata-form");
            const display = document.getElementById("metadata-display");
            const toggle = document.getElementById("edit-toggle");
            
            form.classList.add("hidden");
            display.classList.remove("hidden");
            toggle.textContent = "Edit";
          }
          
          // Handle metadata form submission
          document.getElementById("metadata-form")?.addEventListener("submit", async function(e) {
            e.preventDefault();
            
            const title = document.getElementById("edit-title").value.trim();
            const description = document.getElementById("edit-description").value.trim();
            const year = document.getElementById("edit-year").value ? parseInt(document.getElementById("edit-year").value) : undefined;
            const genre = document.getElementById("edit-genre").value.trim() || undefined;
            const artist = document.getElementById("edit-artist").value.trim() || undefined;
            const album = document.getElementById("edit-album").value.trim() || undefined;
            const ocrText = document.getElementById("edit-ocrtext").value.trim() || undefined;
            
            if (!title) {
              ToastManager.warning("Title is required");
              document.getElementById("edit-title").focus();
              return;
            }
            
            const submitBtn = this.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = "Saving...";
            
            try {
              const res = await fetch("/api/media/" + mediaId, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title,
                  description: description || undefined,
                  year,
                  genre,
                  artist,
                  album,
                  ocrText
                })
              });
              
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success("Changes saved successfully!");
                setTimeout(() => window.location.reload(), 1500);
              } else {
                ToastManager.error("Failed to save: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Failed to save: " + err.message);
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = "Save";
            }
          });
          
          // Cover image upload
          async function uploadCover(file) {
            if (!file) return;
            
            // Validate file type
            const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            if (!validTypes.includes(file.type)) {
              ToastManager.error("Invalid file type. Please upload a JPG, PNG, WebP, or GIF image.");
              return;
            }
            
            // Validate file size (10MB max)
            if (file.size > 10 * 1024 * 1024) {
              ToastManager.error("File too large. Maximum size is 10MB.");
              return;
            }
            
            ToastManager.info("Uploading cover...");
            
            const formData = new FormData();
            formData.append("file", file);
            
            try {
              const res = await fetch("/api/upload/cover/" + mediaId, {
                method: "POST",
                body: formData
              });
              
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success("Cover uploaded successfully!");
                setTimeout(() => window.location.reload(), 1000);
              } else {
                ToastManager.error("Failed to upload cover: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Failed to upload cover: " + err.message);
            }
            
            // Reset file input
            document.getElementById("cover-upload-input").value = "";
          }
          
          // Delete custom cover
          async function deleteCover() {
            const confirmed = await ConfirmModal.show({
              title: "Remove Cover",
              message: "Are you sure you want to remove the custom cover? The media will fall back to showing the external cover (if available) or no cover.",
              confirmText: "Remove",
              type: "warning"
            });
            if (!confirmed) return;
            
            try {
              const res = await fetch("/api/upload/cover/" + mediaId, {
                method: "DELETE"
              });
              
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success("Cover removed successfully!");
                setTimeout(() => window.location.reload(), 1000);
              } else {
                ToastManager.error("Failed to remove cover: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Failed to remove cover: " + err.message);
            }
          }
        </script>
        ${notificationSystem()}
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
    const ocrStats = await convex.query(api.media.getOCRStats, {});
    const failedOCR = await convex.query(api.media.getFailedOCR, {});
    
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
              <div class="space-y-6">
                <!-- TMDB API Key -->
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    🎬 TMDB API Key (Movies & TV Shows)
                  </label>
                  <div class="flex gap-2">
                    <input type="password" 
                           id="tmdb_api_key_input"
                           name="tmdb_api_key" 
                           placeholder="Enter TMDB API key"
                           value="${settings.tmdb_api_key?.value || ""}"
                           class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <button type="button" 
                            onclick="testTmdbApi()"
                            class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors text-sm whitespace-nowrap">
                      Test & Save
                    </button>
                  </div>
                  <p class="text-gray-500 text-sm mt-1">Get your API key from <a href="https://www.themoviedb.org/settings/api" target="_blank" class="text-purple-400 hover:text-purple-300">themoviedb.org</a>. Tests the key and saves it if valid.</p>
                </div>
                
                <!-- Metadata Provider Status -->
                <div class="border-t border-gray-700 pt-4">
                  <h3 class="text-sm font-medium text-gray-300 mb-3">Provider Status</h3>
                  <div id="metadataStatus" class="space-y-2 text-sm">
                    <!-- Will be populated by JavaScript -->
                    <div class="animate-pulse">
                      <div class="h-8 bg-gray-700 rounded mb-2"></div>
                      <div class="h-8 bg-gray-700 rounded mb-2"></div>
                      <div class="h-8 bg-gray-700 rounded"></div>
                    </div>
                  </div>
                </div>
                
                <!-- Batch Metadata Fetch -->
                <div class="border-t border-gray-700 pt-4">
                  <h3 class="text-sm font-medium text-gray-300 mb-3">Batch Operations</h3>
                  <div class="flex gap-2 flex-wrap">
                    <button type="button" 
                            onclick="batchFetchMetadata()"
                            class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition-colors text-sm">
                      📥 Fetch Missing Metadata
                    </button>
                  </div>
                  <p class="text-gray-500 text-sm mt-2">Automatically fetch metadata for media items that don't have any. Processes up to 20 items at a time.</p>
                </div>
                
                <!-- Provider Info -->
                <div class="border-t border-gray-700 pt-4">
                  <h3 class="text-sm font-medium text-gray-300 mb-3">Available Providers</h3>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div class="bg-gray-700/50 rounded-lg p-3">
                      <div class="font-medium text-white mb-1">🎬 TMDB</div>
                      <p class="text-gray-400 text-xs">Movies & TV shows. Requires API key.</p>
                    </div>
                    <div class="bg-gray-700/50 rounded-lg p-3">
                      <div class="font-medium text-white mb-1">🎵 MusicBrainz</div>
                      <p class="text-gray-400 text-xs">Music metadata & cover art. No API key needed.</p>
                    </div>
                    <div class="bg-gray-700/50 rounded-lg p-3">
                      <div class="font-medium text-white mb-1">📚 Open Library</div>
                      <p class="text-gray-400 text-xs">Book metadata & covers. No API key needed.</p>
                    </div>
                  </div>
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
                    <option value="1440p" ${settings.default_video_quality?.value === "1440p" ? "selected" : ""}>1440p</option>
                    <option value="2160p" ${settings.default_video_quality?.value === "2160p" ? "selected" : ""}>4K (2160p)</option>
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
            
            <!-- OCR Processing -->
            <section class="bg-gray-800 rounded-lg p-6">
              <h2 class="text-xl font-bold mb-4">🔍 OCR Text Search</h2>
              <p class="text-gray-400 mb-4">Extract text from images, GIFs, and videos to make them searchable by their content.</p>
              
              <!-- OCR Stats -->
              <div class="grid grid-cols-4 gap-4 mb-4">
                <div class="bg-gray-700/50 rounded-lg p-4 text-center">
                  <p class="text-2xl font-bold text-green-400">${ocrStats.withOCR}</p>
                  <p class="text-gray-400 text-sm">With OCR</p>
                </div>
                <div class="bg-gray-700/50 rounded-lg p-4 text-center">
                  <p class="text-2xl font-bold text-yellow-400" id="ocrWithoutCount">${ocrStats.withoutOCR}</p>
                  <p class="text-gray-400 text-sm">Need OCR</p>
                </div>
                <div class="bg-gray-700/50 rounded-lg p-4 text-center">
                  <p class="text-2xl font-bold text-red-400" id="ocrFailedCount">${failedOCR.count}</p>
                  <p class="text-gray-400 text-sm">Failed</p>
                </div>
                <div class="bg-gray-700/50 rounded-lg p-4 text-center">
                  <p class="text-2xl font-bold text-purple-400">${ocrStats.percentage}%</p>
                  <p class="text-gray-400 text-sm">Complete</p>
                </div>
              </div>
              
              <div class="flex flex-wrap items-center gap-4">
                <button type="button" 
                        onclick="runOCRProcessing()"
                        id="ocrProcessBtn"
                        ${ocrStats.withoutOCR === 0 ? 'disabled' : ''}
                        class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors">
                  🔍 Process Files Without OCR
                </button>
                <button type="button" 
                        onclick="retryFailedOCR()"
                        id="ocrRetryBtn"
                        ${failedOCR.count === 0 ? 'disabled' : ''}
                        class="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors">
                  🔄 Retry Failed OCR (${failedOCR.count})
                </button>
                <span class="text-gray-500 text-sm">Processes up to 10 files at a time</span>
              </div>
              <div id="ocrStatus" class="mt-4 hidden">
                <div class="bg-gray-700/50 rounded-lg p-4">
                  <p class="text-gray-300" id="ocrStatusText">Processing...</p>
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
                <div class="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-700/50">
                  <div class="flex items-center gap-2">
                    <span class="\${info.configured ? 'text-green-400' : 'text-yellow-400'} text-lg">
                      \${info.configured ? '✅' : '⚠️'}
                    </span>
                    <span class="text-gray-300">\${info.name}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-gray-500 text-xs">\${info.types?.join(', ') || ''}</span>
                    <span class="\${info.configured ? 'text-green-400' : 'text-yellow-400'} text-xs">
                      \${info.configured ? 'Ready' : 'Not configured'}
                    </span>
                  </div>
                </div>
              \`).join('');
            } catch (err) {
              console.error("Failed to load metadata status:", err);
              document.getElementById("metadataStatus").innerHTML = '<p class="text-red-400">Failed to load status</p>';
            }
          }
          loadMetadataStatus();
          
          // Test TMDB API and save if successful
          async function testTmdbApi() {
            const apiKey = document.getElementById("tmdb_api_key_input").value;
            
            if (!apiKey) {
              ToastManager.warning("Please enter a TMDB API key first");
              return;
            }
            
            ToastManager.info("Testing TMDB connection...");
            
            try {
              // Test by searching for a known movie
              const res = await fetch(\`https://api.themoviedb.org/3/movie/550?api_key=\${encodeURIComponent(apiKey)}\`);
              
              if (res.ok) {
                const data = await res.json();
                
                // Save the API key since it's valid
                const saveRes = await fetch("/api/admin/settings", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ 
                    settings: [{ key: "tmdb_api_key", value: apiKey }] 
                  }),
                });
                
                const saveData = await saveRes.json();
                
                if (saveData.success) {
                  ToastManager.success(\`TMDB connected and saved! Test: "\${data.title}" (\${data.release_date?.slice(0,4) || 'N/A'})\`);
                  // Refresh metadata status
                  loadMetadataStatus();
                } else {
                  ToastManager.warning(\`TMDB works but failed to save: \${saveData.error}\`);
                }
              } else if (res.status === 401) {
                ToastManager.error("Invalid API key. Please check your TMDB API key.");
              } else {
                ToastManager.error("TMDB API error: " + res.status);
              }
            } catch (err) {
              ToastManager.error("Connection failed: " + err.message);
            }
          }
          
          // Metadata fetch state
          let metadataFetchStopped = false;
          
          // Batch fetch metadata (continues until all done)
          async function batchFetchMetadata() {
            const btn = event.target;
            const confirmed = await ConfirmModal.show({
              title: "Fetch Missing Metadata",
              message: "This will fetch metadata for all media items that don't have any metadata yet. The process will continue until complete. You can stop at any time.",
              confirmText: "Start",
              type: "info"
            });
            if (!confirmed) return;
            
            metadataFetchStopped = false;
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '⏳ Fetching... <button type="button" onclick="stopMetadataFetch(event)" class="ml-2 bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded text-xs">Stop</button>';
            
            let totalSuccess = 0;
            let totalFailed = 0;
            let totalSkipped = 0;
            let batchCount = 0;
            
            while (!metadataFetchStopped) {
              batchCount++;
              ToastManager.info(\`Fetching batch \${batchCount}... (Success: \${totalSuccess}, Failed: \${totalFailed})\`);
              
              try {
                const res = await fetch("/api/metadata/batch-fetch", { method: "POST" });
                const data = await res.json();
                
                if (data.success) {
                  const r = data.results;
                  
                  if (r.total === 0) {
                    // No more items to process
                    break;
                  }
                  
                  totalSuccess += r.success;
                  totalFailed += r.failed;
                  totalSkipped += r.skipped;
                  
                  // If all items in batch were skipped, we might be done with fetchable items
                  if (r.success === 0 && r.failed === 0 && r.skipped === r.total) {
                    // Only skipped items left, stop processing
                    break;
                  }
                } else {
                  ToastManager.error("Batch failed: " + data.error);
                  totalFailed++;
                }
              } catch (err) {
                ToastManager.error("Batch error: " + err.message);
                totalFailed++;
              }
            }
            
            // Final status
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            
            if (metadataFetchStopped) {
              ToastManager.info(\`Metadata fetch stopped. Success: \${totalSuccess}, Failed: \${totalFailed}, Skipped: \${totalSkipped}\`);
            } else {
              ToastManager.success(\`Metadata fetch complete! Success: \${totalSuccess}, Failed: \${totalFailed}, Skipped: \${totalSkipped}\`);
            }
          }
          
          function stopMetadataFetch(event) {
            event.stopPropagation();
            metadataFetchStopped = true;
            ToastManager.info("Stopping after current batch...");
          }
          
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
                ToastManager.success("Settings saved successfully!");
              } else {
                ToastManager.error("Failed to save settings: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Failed to save settings: " + err.message);
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
                ToastManager.success("Successfully connected to R2!");
              } else {
                ToastManager.error("Connection failed: " + (data.data?.message || data.error));
              }
            } catch (err) {
              ToastManager.error("Connection test failed: " + err.message);
            }
          }
          
          // Run R2 backup
          async function runR2Backup() {
            const confirmed = await ConfirmModal.show({
              title: "Start R2 Backup",
              message: "This will backup all unbacked-up media files to R2 cloud storage. This may take a while depending on the number of files.",
              confirmText: "Start Backup",
              type: "info"
            });
            if (!confirmed) return;
            
            try {
              const res = await fetch("/api/admin/r2/backup", { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success("Backup complete! Backed up " + data.data.backed + " files.");
                setTimeout(() => window.location.reload(), 2000);
              } else {
                ToastManager.error("Backup failed: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Backup failed: " + err.message);
            }
          }
          
          // Run cache cleanup
          async function runCacheCleanup() {
            const confirmed = await ConfirmModal.show({
              title: "Run Cache Cleanup",
              message: "This will delete expired and excess cached files to free up disk space. This action cannot be undone.",
              confirmText: "Run Cleanup",
              type: "warning"
            });
            if (!confirmed) return;
            
            try {
              const res = await fetch("/api/admin/cache/cleanup", { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success("Cleanup complete! Deleted " + data.data.filesDeleted + " files, freed " + data.data.bytesFreedFormatted + ".");
                setTimeout(() => window.location.reload(), 2000);
              } else {
                ToastManager.error("Cleanup failed: " + data.error);
              }
            } catch (err) {
              ToastManager.error("Cleanup failed: " + err.message);
            }
          }
          
          // OCR processing state
          let ocrProcessingStopped = false;
          
          // Run OCR processing on files without OCR text (continues until all done)
          async function runOCRProcessing() {
            const btn = document.getElementById("ocrProcessBtn");
            const statusDiv = document.getElementById("ocrStatus");
            const statusText = document.getElementById("ocrStatusText");
            
            ocrProcessingStopped = false;
            btn.disabled = true;
            btn.innerHTML = '⏳ Processing... <button type="button" onclick="stopOCRProcessing(event)" class="ml-2 bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded text-xs">Stop</button>';
            statusDiv.classList.remove("hidden");
            
            let totalProcessed = 0;
            let totalFailed = 0;
            let batchCount = 0;
            
            while (!ocrProcessingStopped) {
              batchCount++;
              statusText.textContent = \`Running OCR batch \${batchCount}... Processed so far: \${totalProcessed}, Failed: \${totalFailed}\`;
              
              try {
                const res = await fetch("/api/admin/ocr/process", { 
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ limit: 10 })
                });
                const data = await res.json();
                
                if (data.success) {
                  const result = data.data;
                  
                  if (result.processed === 0 && result.failed === 0) {
                    // No more files to process
                    break;
                  }
                  
                  totalProcessed += result.processed;
                  totalFailed += result.failed;
                  
                  // Update the count display
                  const countEl = document.getElementById("ocrWithoutCount");
                  const newCount = parseInt(countEl.textContent) - result.processed;
                  countEl.textContent = Math.max(0, newCount);
                  
                  if (newCount <= 0) {
                    // All done
                    break;
                  }
                } else {
                  ToastManager.error("OCR batch failed: " + data.error);
                  totalFailed++;
                  // Continue with next batch despite error
                }
              } catch (err) {
                ToastManager.error("OCR batch error: " + err.message);
                totalFailed++;
                // Continue with next batch despite error
              }
            }
            
            // Final status
            const countEl = document.getElementById("ocrWithoutCount");
            const remaining = parseInt(countEl.textContent) || 0;
            
            if (ocrProcessingStopped) {
              ToastManager.info(\`OCR stopped. Processed: \${totalProcessed}, Failed: \${totalFailed}\`);
              statusText.textContent = \`Stopped. Processed \${totalProcessed} files, \${totalFailed} failed. \${remaining} remaining.\`;
              btn.disabled = remaining === 0;
              btn.textContent = remaining > 0 ? "🔍 Continue Processing" : "✅ All Files Processed";
            } else if (remaining === 0) {
              ToastManager.success(\`OCR complete! Processed: \${totalProcessed}, Failed: \${totalFailed}\`);
              statusText.textContent = "All supported media files now have OCR text!";
              btn.textContent = "✅ All Files Processed";
            } else {
              ToastManager.success(\`OCR finished. Processed: \${totalProcessed}, Failed: \${totalFailed}\`);
              statusText.textContent = \`Processed \${totalProcessed} files, \${totalFailed} failed. \${remaining} remaining.\`;
              btn.disabled = false;
              btn.textContent = "🔍 Process Remaining Files";
            }
          }
          
          function stopOCRProcessing(event) {
            event.stopPropagation();
            ocrProcessingStopped = true;
            ToastManager.info("Stopping after current batch...");
          }
          
          // Retry failed OCR items
          async function retryFailedOCR() {
            const btn = document.getElementById("ocrRetryBtn");
            const failedCountEl = document.getElementById("ocrFailedCount");
            const withoutCountEl = document.getElementById("ocrWithoutCount");
            
            btn.disabled = true;
            btn.textContent = "⏳ Resetting...";
            
            try {
              const res = await fetch("/api/admin/ocr/reset-failed", { method: "POST" });
              const data = await res.json();
              
              if (data.success) {
                const resetCount = data.data.reset;
                ToastManager.success(\`Reset \${resetCount} failed items for re-processing\`);
                
                // Update the counts
                failedCountEl.textContent = "0";
                const currentWithout = parseInt(withoutCountEl.textContent) || 0;
                withoutCountEl.textContent = currentWithout + resetCount;
                
                // Update buttons
                btn.textContent = "🔄 Retry Failed OCR (0)";
                
                // Enable the process button since there are now items to process
                const processBtn = document.getElementById("ocrProcessBtn");
                processBtn.disabled = false;
                processBtn.textContent = "🔍 Process Files Without OCR";
              } else {
                ToastManager.error("Reset failed: " + data.error);
                btn.disabled = false;
                btn.textContent = \`🔄 Retry Failed OCR (\${failedCountEl.textContent})\`;
              }
            } catch (err) {
              ToastManager.error("Reset failed: " + err.message);
              btn.disabled = false;
              btn.textContent = \`🔄 Retry Failed OCR (\${failedCountEl.textContent})\`;
            }
          }
        </script>
        ${notificationSystem()}
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
              ToastManager.warning('No files to upload');
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
        ${notificationSystem()}
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
              ToastManager.warning('Please enter a tag name');
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
                ToastManager.success(id ? 'Tag updated successfully!' : 'Tag created successfully!');
                setTimeout(() => window.location.reload(), 1000);
              } else {
                ToastManager.error('Failed to save tag: ' + data.error);
              }
            } catch (err) {
              ToastManager.error('Failed to save tag: ' + err.message);
            }
          }
          
          async function deleteTag(id, name, usageCount) {
            if (usageCount > 0) {
              ToastManager.error('Cannot delete tag "' + name + '" because it is used by ' + usageCount + ' file(s). Remove the tag from all files first.');
              return;
            }
            
            const confirmed = await ConfirmModal.show({
              title: 'Delete Tag',
              message: 'Are you sure you want to delete the tag "' + name + '"? This action cannot be undone.',
              confirmText: 'Delete',
              type: 'danger'
            });
            if (!confirmed) return;
            
            try {
              const res = await fetch('/api/tags/' + id, { method: 'DELETE' });
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success('Tag deleted successfully!');
                document.querySelector('[data-tag-id="' + id + '"]')?.remove();
              } else {
                ToastManager.error('Failed to delete tag: ' + data.error);
              }
            } catch (err) {
              ToastManager.error('Failed to delete tag: ' + err.message);
            }
          }
          
          async function createDefaultTags() {
            const confirmed = await ConfirmModal.show({
              title: 'Create Default Tags',
              message: 'This will create a set of default tags (Movies, Music, Pictures, etc.) to help organize your media library.',
              confirmText: 'Create Tags',
              type: 'info'
            });
            if (!confirmed) return;
            
            try {
              const res = await fetch('/api/tags/defaults', { method: 'POST' });
              const data = await res.json();
              
              if (data.success) {
                ToastManager.success('Created ' + data.data.created + ' default tags!');
                setTimeout(() => window.location.reload(), 1500);
              } else {
                ToastManager.error('Failed to create default tags: ' + data.error);
              }
            } catch (err) {
              ToastManager.error('Failed to create default tags: ' + err.message);
            }
          }
        </script>
        ${notificationSystem()}
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
