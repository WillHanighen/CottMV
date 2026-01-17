/**
 * Layout Templates
 * ================
 * 
 * This file contains the base HTML layout and common components
 * used across all pages. It provides consistent styling and structure.
 */

import type { AuthContext } from "../auth/middleware";

/**
 * Base layout options
 */
interface BaseLayoutOptions {
  title: string;
  content: string;
  includeNav?: boolean;
  auth?: AuthContext;
  currentPage?: string;
}

/**
 * Common HTML head section
 * Includes meta tags, Tailwind CSS, and common styles
 */
function htmlHead(title: string): string {
  return `
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
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
export function navbar(currentPage: string, auth?: AuthContext): string {
  const links = [
    { href: "/", label: "Library", icon: "📚" },
  ];
  
  // Only show admin link to admins
  if (auth?.isAdmin) {
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
            ${auth?.isAuthenticated && auth.user ? `
              <div class="flex items-center gap-3">
                <div class="flex items-center gap-2">
                  ${auth.user.avatarUrl ? `
                    <img src="${auth.user.avatarUrl}" alt="${auth.user.username}" 
                         class="w-8 h-8 rounded-full border-2 border-gray-600">
                  ` : `
                    <div class="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white font-medium">
                      ${auth.user.username.charAt(0).toUpperCase()}
                    </div>
                  `}
                  <span class="text-gray-300 text-sm hidden sm:inline">${auth.user.displayName || auth.user.username}</span>
                  ${auth.isAdmin ? `
                    <span class="bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">Admin</span>
                  ` : ""}
                </div>
                <a href="/auth/logout" 
                   class="text-gray-400 hover:text-white text-sm transition-colors">
                  Logout
                </a>
              </div>
            ` : ""}
          </div>
        </div>
      </div>
    </nav>
  `;
}

/**
 * Base layout wrapper
 * Wraps content in a consistent HTML structure
 */
export function baseLayout(options: BaseLayoutOptions): string {
  const { title, content, includeNav = true, auth, currentPage = "" } = options;
  
  return `
    <!DOCTYPE html>
    <html lang="en" class="dark">
    ${htmlHead(title)}
    <body class="bg-gray-900 text-white min-h-screen">
      ${includeNav ? navbar(currentPage, auth) : ""}
      ${content}
    </body>
    </html>
  `;
}

/**
 * Error page template
 */
export function errorPage(title: string, message: string, backLink = "/"): string {
  return baseLayout({
    title: `${title} - CottMV`,
    content: `
      <div class="min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-red-500 mb-4">${title}</h1>
          <p class="text-gray-400">${message}</p>
          <a href="${backLink}" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg transition-colors">
            Go Back
          </a>
        </div>
      </div>
    `,
    includeNav: false,
  });
}

/**
 * 404 Not Found page
 */
export function notFoundPage(): string {
  return baseLayout({
    title: "Not Found - CottMV",
    content: `
      <div class="min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-6xl font-bold text-purple-500 mb-4">404</h1>
          <p class="text-gray-400">Page not found</p>
          <a href="/" class="inline-block mt-4 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg transition-colors">
            Back to Library
          </a>
        </div>
      </div>
    `,
    includeNav: false,
  });
}
