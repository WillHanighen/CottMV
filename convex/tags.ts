/**
 * Tags Functions
 * ==============
 * 
 * This file contains all the database operations for tags.
 * Tags are used to organize and categorize media files.
 * 
 * Operations:
 * - List all tags
 * - Create new tags
 * - Update existing tags
 * - Delete tags
 * - Get tag usage counts
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * List all tags
 * 
 * Returns: Array of tag objects sorted by name
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const tags = await ctx.db.query("tags").collect();
    return tags.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Get a single tag by ID
 */
export const getById = query({
  args: { id: v.id("tags") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Get a tag by name
 */
export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tags")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();
  },
});

/**
 * Create a new tag
 * 
 * Returns: The ID of the newly created tag
 */
export const create = mutation({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if tag with same name already exists
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();
    
    if (existing) {
      throw new Error(`Tag "${args.name}" already exists`);
    }
    
    const now = Date.now();
    
    const tagId = await ctx.db.insert("tags", {
      name: args.name,
      color: args.color,
      createdAt: now,
      updatedAt: now,
    });
    
    return tagId;
  },
});

/**
 * Update an existing tag
 */
export const update = mutation({
  args: {
    id: v.id("tags"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    
    // If updating name, check for duplicates
    if (updates.name) {
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_name", (q) => q.eq("name", updates.name!))
        .first();
      
      if (existing && existing._id !== id) {
        throw new Error(`Tag "${updates.name}" already exists`);
      }
    }
    
    const fieldsToUpdate: Record<string, unknown> = {
      updatedAt: Date.now(),
    };
    
    if (updates.name !== undefined) fieldsToUpdate.name = updates.name;
    if (updates.color !== undefined) fieldsToUpdate.color = updates.color;
    
    await ctx.db.patch(id, fieldsToUpdate);
  },
});

/**
 * Delete a tag
 * 
 * Note: This will also remove the tag from all media files that use it
 */
export const remove = mutation({
  args: { id: v.id("tags") },
  handler: async (ctx, args) => {
    // Remove tag from all media files that use it
    const allMedia = await ctx.db.query("media").collect();
    
    for (const media of allMedia) {
      if (media.tags && media.tags.includes(args.id)) {
        const newTags = media.tags.filter((t) => t !== args.id);
        await ctx.db.patch(media._id, { 
          tags: newTags.length > 0 ? newTags : undefined,
          updatedAt: Date.now(),
        });
      }
    }
    
    // Delete the tag
    await ctx.db.delete(args.id);
  },
});

/**
 * Get tag usage counts
 * 
 * Returns: Object mapping tag IDs to their usage count
 */
export const getUsageCounts = query({
  args: {},
  handler: async (ctx) => {
    const allMedia = await ctx.db.query("media").collect();
    const counts: Record<string, number> = {};
    
    for (const media of allMedia) {
      if (media.tags) {
        for (const tagId of media.tags) {
          counts[tagId] = (counts[tagId] || 0) + 1;
        }
      }
    }
    
    return counts;
  },
});

/**
 * Get all tags with their usage counts
 * 
 * Returns: Array of tags with count property
 */
export const listWithCounts = query({
  args: {},
  handler: async (ctx) => {
    const tags = await ctx.db.query("tags").collect();
    const allMedia = await ctx.db.query("media").collect();
    
    // Count usage for each tag
    const counts: Record<string, number> = {};
    for (const media of allMedia) {
      if (media.tags) {
        for (const tagId of media.tags) {
          counts[tagId] = (counts[tagId] || 0) + 1;
        }
      }
    }
    
    // Add count to each tag
    const tagsWithCounts = tags.map((tag) => ({
      ...tag,
      count: counts[tag._id] || 0,
    }));
    
    return tagsWithCounts.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Create default tags if they don't exist
 * 
 * This is called on application startup to ensure common tags exist
 */
export const createDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const defaultTags = [
      { name: "Movies", color: "#E50914" },
      { name: "Music", color: "#1DB954" },
      { name: "Pictures", color: "#FF6B6B" },
      { name: "Memes", color: "#FFD93D" },
      { name: "Wallpapers", color: "#6C5CE7" },
      { name: "Screenshots", color: "#00B894" },
      { name: "Documents", color: "#74B9FF" },
      { name: "Videos", color: "#A29BFE" },
    ];
    
    const created: string[] = [];
    const now = Date.now();
    
    for (const tag of defaultTags) {
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_name", (q) => q.eq("name", tag.name))
        .first();
      
      if (!existing) {
        await ctx.db.insert("tags", {
          name: tag.name,
          color: tag.color,
          createdAt: now,
          updatedAt: now,
        });
        created.push(tag.name);
      }
    }
    
    return { created };
  },
});
