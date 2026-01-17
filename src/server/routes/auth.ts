/**
 * Authentication Routes
 * =====================
 * 
 * This file contains all the routes for GitHub OAuth authentication.
 * 
 * Routes:
 * - GET /login - Show login page
 * - GET /auth/github - Start GitHub OAuth flow
 * - GET /auth/callback - Handle GitHub OAuth callback
 * - POST /auth/logout - Log out the current user
 * - GET /auth/me - Get current user info (API)
 * 
 * How GitHub OAuth Works:
 * 1. User visits /auth/github
 * 2. We redirect them to GitHub with our client ID
 * 3. User authorizes our app on GitHub
 * 4. GitHub redirects to /auth/callback with a code
 * 5. We exchange the code for an access token
 * 6. We fetch user info from GitHub API
 * 7. We create/update user in database and create session
 * 8. We set a session cookie and redirect to home
 */

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  generateState,
  generateSessionToken,
  hashToken,
} from "../auth/github.js";
import {
  SESSION_COOKIE_NAME,
  COOKIE_OPTIONS,
  getAuth,
} from "../auth/middleware.js";
import { renderLoginPage } from "../templates/login.js";

const auth = new Hono();

/**
 * State cookie name for CSRF protection
 */
const STATE_COOKIE_NAME = "cottmv_oauth_state";

/**
 * Get environment variables for GitHub OAuth
 */
function getGitHubConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  
  return { clientId, clientSecret, appUrl };
}

/**
 * GET /login
 * Show the login page
 */
auth.get("/login", async (c) => {
  const authContext = getAuth(c);
  
  // If already logged in, redirect to home
  if (authContext.isAuthenticated) {
    return c.redirect("/");
  }
  
  const { clientId } = getGitHubConfig();
  const isConfigured = !!clientId;
  
  const html = renderLoginPage({ isConfigured });
  return c.html(html);
});

/**
 * GET /auth/github
 * Start the GitHub OAuth flow
 */
auth.get("/auth/github", async (c) => {
  const { clientId, appUrl } = getGitHubConfig();
  
  if (!clientId) {
    return c.html(renderLoginPage({
      isConfigured: false,
      error: "GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID.",
    }));
  }
  
  // Generate state for CSRF protection
  const state = generateState();
  
  // Store state in cookie
  setCookie(c, STATE_COOKIE_NAME, state, {
    ...COOKIE_OPTIONS,
    maxAge: 600, // 10 minutes
  });
  
  // Build callback URL
  const redirectUri = `${appUrl}/auth/github/callback`;
  
  // Redirect to GitHub
  const authUrl = getAuthorizationUrl(clientId, redirectUri, state);
  return c.redirect(authUrl);
});

/**
 * GET /auth/github/callback
 * Handle the GitHub OAuth callback
 */
auth.get("/auth/github/callback", async (c) => {
  const convex = c.get("convex") as ConvexHttpClient;
  const { clientId, clientSecret, appUrl } = getGitHubConfig();
  
  // Get code and state from query params
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  const errorDescription = c.req.query("error_description");
  
  // Check for OAuth errors
  if (error) {
    console.error("GitHub OAuth error:", error, errorDescription);
    return c.html(renderLoginPage({
      isConfigured: true,
      error: `GitHub authorization failed: ${errorDescription || error}`,
    }));
  }
  
  // Verify we have a code
  if (!code) {
    return c.html(renderLoginPage({
      isConfigured: true,
      error: "No authorization code received from GitHub.",
    }));
  }
  
  // Verify state matches (CSRF protection)
  const storedState = getCookie(c, STATE_COOKIE_NAME);
  if (!state || state !== storedState) {
    return c.html(renderLoginPage({
      isConfigured: true,
      error: "Invalid state parameter. Please try again.",
    }));
  }
  
  // Clear state cookie
  deleteCookie(c, STATE_COOKIE_NAME);
  
  // Check configuration
  if (!clientId || !clientSecret) {
    return c.html(renderLoginPage({
      isConfigured: false,
      error: "GitHub OAuth is not fully configured.",
    }));
  }
  
  try {
    // Exchange code for access token
    const accessToken = await exchangeCodeForToken(clientId, clientSecret, code);
    
    // Fetch user info from GitHub
    const githubUser = await fetchGitHubUser(accessToken);
    
    // Check if user exists in our database
    let user = await convex.query(api.users.getByGithubId, {
      githubId: githubUser.id,
    });
    
    // Check if this is the first user (should be admin)
    const allUsers = await convex.query(api.users.list, {});
    const isFirstUser = allUsers.length === 0;
    
    // Get admin usernames from settings
    const adminUsernamesSetting = await convex.query(api.settings.get, {
      key: "admin_usernames",
    });
    const adminUsernamesValue = typeof adminUsernamesSetting === "string"
      ? adminUsernamesSetting
      : adminUsernamesSetting?.value;
    const adminUsernames = adminUsernamesValue
      ?.split(",")
      .map((u: string) => u.trim().toLowerCase()) || [];
    
    // Check if this user should be an admin (first user or in admin list)
    const isAdmin = isFirstUser || adminUsernames.includes(githubUser.login.toLowerCase());
    
    if (user) {
      // Update last login
      await convex.mutation(api.users.updateLastLogin, { id: user._id });
      
      // Update role if admin status changed
      if (isAdmin && user.role !== "admin") {
        await convex.mutation(api.users.updateRole, { id: user._id, role: "admin" });
      }
    } else {
      // Create new user - first user is always admin
      const userId = await convex.mutation(api.users.create, {
        githubId: githubUser.id,
        username: githubUser.login,
        displayName: githubUser.name || undefined,
        email: githubUser.email || undefined,
        avatarUrl: githubUser.avatar_url,
        isAdmin,
      });
      
      // Fetch the created user
      user = await convex.query(api.users.getById, { id: userId });
    }
    
    if (!user) {
      throw new Error("Failed to create or fetch user");
    }
    
    // Generate session token
    const sessionToken = generateSessionToken();
    const tokenHash = await hashToken(sessionToken);
    
    // Create session in database
    await convex.mutation(api.sessions.create, {
      userId: user._id,
      tokenHash,
      userAgent: c.req.header("User-Agent"),
      ipAddress: c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP"),
    });
    
    // Set session cookie
    setCookie(c, SESSION_COOKIE_NAME, sessionToken, COOKIE_OPTIONS);
    
    // Redirect to home
    return c.redirect("/");
  } catch (err) {
    console.error("OAuth callback error:", err);
    return c.html(renderLoginPage({
      isConfigured: true,
      error: `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    }));
  }
});

/**
 * POST /auth/logout
 * Log out the current user
 */
auth.post("/auth/logout", async (c) => {
  const convex = c.get("convex") as ConvexHttpClient;
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  
  if (sessionToken) {
    try {
      // Delete session from database
      const tokenHash = await hashToken(sessionToken);
      await convex.mutation(api.sessions.deleteSession, { tokenHash });
    } catch (err) {
      console.error("Logout error:", err);
    }
  }
  
  // Clear session cookie
  deleteCookie(c, SESSION_COOKIE_NAME);
  
  // Redirect to login
  return c.redirect("/login");
});

/**
 * GET /auth/logout
 * Also support GET for logout (for simple links)
 */
auth.get("/auth/logout", async (c) => {
  const convex = c.get("convex") as ConvexHttpClient;
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  
  if (sessionToken) {
    try {
      const tokenHash = await hashToken(sessionToken);
      await convex.mutation(api.sessions.deleteSession, { tokenHash });
    } catch (err) {
      console.error("Logout error:", err);
    }
  }
  
  deleteCookie(c, SESSION_COOKIE_NAME);
  return c.redirect("/login");
});

/**
 * GET /auth/me
 * Get current user info (API endpoint)
 */
auth.get("/auth/me", async (c) => {
  const authContext = getAuth(c);
  
  if (!authContext.isAuthenticated || !authContext.user) {
    return c.json({ authenticated: false }, 401);
  }
  
  return c.json({
    authenticated: true,
    user: {
      id: authContext.user.id,
      username: authContext.user.username,
      displayName: authContext.user.displayName,
      avatarUrl: authContext.user.avatarUrl,
      role: authContext.user.role,
    },
  });
});

export default auth;
