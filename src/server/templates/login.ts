/**
 * Login Page Template
 * ===================
 * 
 * This file contains the HTML template for the login page.
 * It shows a GitHub login button and any error messages.
 */

import { baseLayout } from "./layout.js";

interface LoginPageProps {
  isConfigured: boolean;
  error?: string;
}

/**
 * Render the login page
 */
export function renderLoginPage(props: LoginPageProps): string {
  const { isConfigured, error } = props;
  
  const content = `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div class="max-w-md w-full mx-4">
        <!-- Logo and Title -->
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-20 h-20 bg-purple-600 rounded-2xl mb-4 shadow-lg shadow-purple-500/30">
            <svg class="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <h1 class="text-3xl font-bold text-white mb-2">CottMV</h1>
          <p class="text-slate-400">Your Personal Media Vault</p>
        </div>
        
        <!-- Login Card -->
        <div class="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-slate-700/50">
          <h2 class="text-xl font-semibold text-white text-center mb-6">Sign in to continue</h2>
          
          ${error ? `
            <div class="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p class="text-red-300 text-sm">${escapeHtml(error)}</p>
              </div>
            </div>
          ` : ""}
          
          ${isConfigured ? `
            <a href="/auth/github" 
               class="flex items-center justify-center gap-3 w-full px-6 py-3 bg-slate-700 hover:bg-slate-600 
                      text-white font-medium rounded-lg transition-colors duration-200 
                      border border-slate-600 hover:border-slate-500">
              <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path fill-rule="evenodd" clip-rule="evenodd" 
                  d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              Sign in with GitHub
            </a>
          ` : `
            <div class="text-center">
              <div class="mb-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div class="flex items-start gap-3">
                  <svg class="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div class="text-left">
                    <p class="text-amber-300 text-sm font-medium">GitHub OAuth Not Configured</p>
                    <p class="text-amber-300/70 text-sm mt-1">
                      Please set the following environment variables:
                    </p>
                    <ul class="text-amber-300/70 text-sm mt-2 list-disc list-inside">
                      <li>GITHUB_CLIENT_ID</li>
                      <li>GITHUB_CLIENT_SECRET</li>
                    </ul>
                  </div>
                </div>
              </div>
              <p class="text-slate-400 text-sm">
                See the <a href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app" 
                           target="_blank" class="text-purple-400 hover:text-purple-300 underline">
                  GitHub OAuth documentation
                </a> for setup instructions.
              </p>
            </div>
          `}
        </div>
        
        <!-- Footer -->
        <p class="text-center text-slate-500 text-sm mt-6">
          CottMV - A beginner-friendly media vault
        </p>
      </div>
    </div>
  `;
  
  return baseLayout({
    title: "Login - CottMV",
    content,
    includeNav: false,
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
