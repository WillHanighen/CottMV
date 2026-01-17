/**
 * Authentication Middleware
 * =========================
 * 
 * This file contains Hono middleware for authentication and authorization.
 * It protects routes by checking for valid sessions and user roles.
 * 
 * Middleware:
 * - authMiddleware: Requires a valid session (any logged-in user)
 * - adminMiddleware: Requires admin role
 * - optionalAuthMiddleware: Attaches user if logged in, but doesn't require it
 * 
 * How it works:
 * 1. Check for session token in cookie
 * 2. Hash the token and look up the session in the database
 * 3. If valid, attach user info to the request context
 * 4. If invalid, redirect to login page
 */

import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { hashToken } from "./github.js";

/**
 * Cookie name for the session token
 */
export const SESSION_COOKIE_NAME = "cottmv_session";

/**
 * Cookie options for security
 */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

/**
 * User type attached to request context
 */
export interface AuthUser {
  id: string;
  githubId: number;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  role: "user" | "admin";
}

/**
 * Extended context type with user info
 */
export interface AuthContext {
  user?: AuthUser;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

/**
 * Get the Convex client from context
 */
function getConvexClient(c: Context): ConvexHttpClient {
  return c.get("convex") as ConvexHttpClient;
}

/**
 * Authentication middleware
 * Requires a valid session to access the route
 * Redirects to login page if not authenticated
 */
export async function authMiddleware(c: Context, next: Next) {
  const convex = getConvexClient(c);
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  
  // No session token - redirect to login
  if (!sessionToken) {
    // For API routes, return 401
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Unauthorized", message: "Please log in" }, 401);
    }
    // For pages, redirect to login
    return c.redirect("/login");
  }
  
  try {
    // Hash the token and validate the session
    const tokenHash = await hashToken(sessionToken);
    const result = await convex.query(api.sessions.validate, { tokenHash });
    
    if (!result) {
      // Invalid or expired session - clear cookie and redirect
      deleteCookie(c, SESSION_COOKIE_NAME);
      
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: "Unauthorized", message: "Session expired" }, 401);
      }
      return c.redirect("/login");
    }
    
    // Debug logging
    console.log("[Auth Middleware] Session validated, user:", JSON.stringify(result.user, null, 2));
    
    // Attach user info to context
    const authContext: AuthContext = {
      user: {
        id: result.user._id,
        githubId: result.user.githubId,
        username: result.user.username,
        displayName: result.user.displayName,
        email: result.user.email,
        avatarUrl: result.user.avatarUrl,
        role: result.user.role as "user" | "admin",
      },
      isAuthenticated: true,
      isAdmin: result.user.role === "admin",
    };
    
    c.set("auth", authContext);
    
    // Also set "user" for pages.ts compatibility
    const userForPages = {
      _id: result.user._id,
      githubId: String(result.user.githubId),
      username: result.user.username,
      role: result.user.role,
    };
    console.log("[Auth Middleware] Setting user for pages:", JSON.stringify(userForPages, null, 2));
    c.set("user", userForPages);
    
    await next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Internal error", message: "Authentication failed" }, 500);
    }
    return c.redirect("/login");
  }
}

/**
 * Admin middleware
 * Requires admin role to access the route
 * Must be used AFTER authMiddleware
 */
export async function adminMiddleware(c: Context, next: Next) {
  const auth = c.get("auth") as AuthContext | undefined;
  
  if (!auth?.isAuthenticated) {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Unauthorized", message: "Please log in" }, 401);
    }
    return c.redirect("/login");
  }
  
  if (!auth.isAdmin) {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Forbidden", message: "Admin access required" }, 403);
    }
    // Redirect non-admins to home page
    return c.redirect("/");
  }
  
  await next();
}

/**
 * Optional authentication middleware
 * Attaches user info if logged in, but doesn't require it
 * Useful for pages that show different content based on auth status
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  const convex = getConvexClient(c);
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  
  // Default to not authenticated
  let authContext: AuthContext = {
    isAuthenticated: false,
    isAdmin: false,
  };
  
  if (sessionToken) {
    try {
      const tokenHash = await hashToken(sessionToken);
      const result = await convex.query(api.sessions.validate, { tokenHash });
      
      if (result) {
        authContext = {
          user: {
            id: result.user._id,
            githubId: result.user.githubId,
            username: result.user.username,
            displayName: result.user.displayName,
            email: result.user.email,
            avatarUrl: result.user.avatarUrl,
            role: result.user.role,
          },
          isAuthenticated: true,
          isAdmin: result.user.role === "admin",
        };
      }
    } catch (error) {
      console.error("Optional auth middleware error:", error);
      // Continue without auth
    }
  }
  
  c.set("auth", authContext);
  await next();
}

/**
 * Helper to get auth context from request
 */
export function getAuth(c: Context): AuthContext {
  return c.get("auth") as AuthContext || { isAuthenticated: false, isAdmin: false };
}

/**
 * Helper to get current user from request
 * Throws if not authenticated
 */
export function requireUser(c: Context): AuthUser {
  const auth = getAuth(c);
  if (!auth.user) {
    throw new Error("User not authenticated");
  }
  return auth.user;
}
