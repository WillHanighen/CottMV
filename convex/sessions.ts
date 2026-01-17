/**
 * Sessions Convex Functions
 * =========================
 * 
 * This file handles user session management for authentication.
 * Sessions are created when users log in and validated on each request.
 * 
 * Security Notes:
 * - Session tokens are hashed before storage (never store plain tokens!)
 * - Sessions have an expiry time (default 7 days)
 * - Old sessions are cleaned up periodically
 * 
 * Functions:
 * - create: Create a new session for a user
 * - getByToken: Find a session by its token hash
 * - validate: Check if a session is valid and return the user
 * - delete: Delete a specific session (logout)
 * - deleteAllForUser: Delete all sessions for a user
 * - cleanupExpired: Remove expired sessions
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Session duration in milliseconds (7 days)
 */
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create a new session for a user
 * Called after successful OAuth login
 * 
 * @param userId - The user's Convex ID
 * @param tokenHash - SHA-256 hash of the session token
 * @param userAgent - Browser/client info (optional)
 * @param ipAddress - Client IP address (optional)
 * @returns The session ID
 */
export const create = mutation({
  args: {
    userId: v.id("users"),
    tokenHash: v.string(),
    userAgent: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const sessionId = await ctx.db.insert("sessions", {
      userId: args.userId,
      tokenHash: args.tokenHash,
      expiresAt: now + SESSION_DURATION_MS,
      createdAt: now,
      userAgent: args.userAgent,
      ipAddress: args.ipAddress,
    });
    
    return sessionId;
  },
});

/**
 * Get a session by its token hash
 * Used for session validation
 */
export const getByToken = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
  },
});

/**
 * Validate a session and return the associated user
 * This is the main function used by the auth middleware
 * 
 * @param tokenHash - SHA-256 hash of the session token
 * @returns The user if session is valid, null otherwise
 */
export const validate = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    // Find the session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
    
    // Check if session exists and is not expired
    if (!session || session.expiresAt < Date.now()) {
      return null;
    }
    
    // Get the user
    const user = await ctx.db.get(session.userId);
    
    if (!user) {
      return null;
    }
    
    return {
      session,
      user,
    };
  },
});

/**
 * Delete a specific session (logout)
 */
export const deleteSession = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
    
    if (session) {
      await ctx.db.delete(session._id);
    }
  },
});

/**
 * Delete all sessions for a user
 * Used when user wants to log out everywhere
 */
export const deleteAllForUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
    
    return sessions.length;
  },
});

/**
 * Clean up expired sessions
 * Should be called periodically (e.g., daily)
 */
export const cleanupExpired = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    
    // Get all expired sessions
    const expiredSessions = await ctx.db
      .query("sessions")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
      .collect();
    
    // Delete them
    for (const session of expiredSessions) {
      await ctx.db.delete(session._id);
    }
    
    return expiredSessions.length;
  },
});

/**
 * Extend a session's expiry time
 * Called when user is active to keep them logged in
 */
export const extend = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
    
    if (session && session.expiresAt > Date.now()) {
      await ctx.db.patch(session._id, {
        expiresAt: Date.now() + SESSION_DURATION_MS,
      });
      return true;
    }
    
    return false;
  },
});
