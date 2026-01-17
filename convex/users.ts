/**
 * Users Convex Functions
 * ======================
 * 
 * This file contains all the database operations for user management.
 * Users are created/updated when they log in via GitHub OAuth.
 * 
 * Functions:
 * - getByGithubId: Find a user by their GitHub ID
 * - getByUsername: Find a user by their GitHub username
 * - getById: Get a user by their Convex ID
 * - create: Create a new user
 * - updateLastLogin: Update user's last login time
 * - updateRole: Change a user's role (admin only)
 * - listAdmins: Get all admin users
 * - isAdmin: Check if a user is an admin
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Get a user by their GitHub ID
 * Used during OAuth login to check if user exists
 */
export const getByGithubId = query({
  args: { githubId: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", args.githubId))
      .first();
  },
});

/**
 * Get a user by their GitHub username
 * Used for admin allowlist checking
 */
export const getByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
  },
});

/**
 * Get a user by their Convex ID
 * Used for session validation
 */
export const getById = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Create a new user from GitHub OAuth data
 * Called when a user logs in for the first time
 */
export const create = mutation({
  args: {
    githubId: v.number(),
    username: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const userId = await ctx.db.insert("users", {
      githubId: args.githubId,
      username: args.username,
      displayName: args.displayName,
      email: args.email,
      avatarUrl: args.avatarUrl,
      role: args.isAdmin ? "admin" : "user",
      createdAt: now,
      lastLoginAt: now,
    });
    
    return userId;
  },
});

/**
 * Update a user's last login time
 * Called each time a user logs in
 */
export const updateLastLogin = mutation({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      lastLoginAt: Date.now(),
    });
  },
});

/**
 * Update a user's role
 * Only admins can change roles
 */
export const updateRole = mutation({
  args: {
    id: v.id("users"),
    role: v.union(v.literal("user"), v.literal("admin")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      role: args.role,
    });
  },
});

/**
 * List all admin users
 * Used for admin management UI
 */
export const listAdmins = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .collect();
  },
});

/**
 * Check if a user is an admin by their ID
 */
export const isAdmin = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.id);
    return user?.role === "admin";
  },
});

/**
 * List all users (admin only)
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});
