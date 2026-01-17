/**
 * Tags API Routes
 * ===============
 * 
 * This file contains all the API endpoints for managing tags.
 * Handles:
 * - List all tags
 * - Create new tags
 * - Update existing tags
 * - Delete tags
 * - Get tag usage counts
 */

import { Hono } from "hono";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";

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
 * Create the tags routes
 */
export const tagsRoutes = new Hono<{ Variables: Variables }>();

/**
 * GET /api/tags
 * 
 * List all tags with usage counts
 */
tagsRoutes.get("/", async (c) => {
  try {
    const convex = c.get("convex");
    const tags = await convex.query(api.tags.listWithCounts, {});
    
    return c.json({
      success: true,
      data: tags,
    });
  } catch (error) {
    console.error("Error listing tags:", error);
    return c.json({
      success: false,
      error: "Failed to list tags",
    }, 500);
  }
});

/**
 * GET /api/tags/:id
 * 
 * Get a single tag by ID
 */
tagsRoutes.get("/:id", async (c) => {
  try {
    const convex = c.get("convex");
    const id = c.req.param("id");
    
    const tag = await convex.query(api.tags.getById, { id: id as any });
    
    if (!tag) {
      return c.json({
        success: false,
        error: "Tag not found",
      }, 404);
    }
    
    return c.json({
      success: true,
      data: tag,
    });
  } catch (error) {
    console.error("Error getting tag:", error);
    return c.json({
      success: false,
      error: "Failed to get tag",
    }, 500);
  }
});

/**
 * POST /api/tags
 * 
 * Create a new tag
 * 
 * Request Body:
 * - name: Tag name (required)
 * - color: Hex color code (optional)
 */
tagsRoutes.post("/", async (c) => {
  try {
    const convex = c.get("convex");
    const body = await c.req.json();
    
    const { name, color } = body;
    
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return c.json({
        success: false,
        error: "Tag name is required",
      }, 400);
    }
    
    // Validate color format if provided
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return c.json({
        success: false,
        error: "Invalid color format. Use hex format like #FF5733",
      }, 400);
    }
    
    const tagId = await convex.mutation(api.tags.create, {
      name: name.trim(),
      color: color || undefined,
    });
    
    return c.json({
      success: true,
      data: { id: tagId },
    }, 201);
  } catch (error) {
    console.error("Error creating tag:", error);
    const message = error instanceof Error ? error.message : "Failed to create tag";
    return c.json({
      success: false,
      error: message,
    }, message.includes("already exists") ? 409 : 500);
  }
});

/**
 * PUT /api/tags/:id
 * 
 * Update an existing tag
 * 
 * Request Body:
 * - name: New tag name (optional)
 * - color: New hex color code (optional)
 */
tagsRoutes.put("/:id", async (c) => {
  try {
    const convex = c.get("convex");
    const id = c.req.param("id");
    const body = await c.req.json();
    
    const { name, color } = body;
    
    // Validate name if provided
    if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
      return c.json({
        success: false,
        error: "Tag name cannot be empty",
      }, 400);
    }
    
    // Validate color format if provided
    if (color !== undefined && color !== null && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return c.json({
        success: false,
        error: "Invalid color format. Use hex format like #FF5733",
      }, 400);
    }
    
    await convex.mutation(api.tags.update, {
      id: id as any,
      name: name?.trim(),
      color: color || undefined,
    });
    
    return c.json({
      success: true,
    });
  } catch (error) {
    console.error("Error updating tag:", error);
    const message = error instanceof Error ? error.message : "Failed to update tag";
    return c.json({
      success: false,
      error: message,
    }, message.includes("already exists") ? 409 : 500);
  }
});

/**
 * DELETE /api/tags/:id
 * 
 * Delete a tag
 * Note: This will also remove the tag from all media files
 */
tagsRoutes.delete("/:id", async (c) => {
  try {
    const convex = c.get("convex");
    const id = c.req.param("id");
    
    await convex.mutation(api.tags.remove, { id: id as any });
    
    return c.json({
      success: true,
    });
  } catch (error) {
    console.error("Error deleting tag:", error);
    return c.json({
      success: false,
      error: "Failed to delete tag",
    }, 500);
  }
});

/**
 * POST /api/tags/defaults
 * 
 * Create default tags if they don't exist
 */
tagsRoutes.post("/defaults", async (c) => {
  try {
    const convex = c.get("convex");
    const result = await convex.mutation(api.tags.createDefaults, {});
    
    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error creating default tags:", error);
    return c.json({
      success: false,
      error: "Failed to create default tags",
    }, 500);
  }
});

/**
 * POST /api/tags/:id/media/:mediaId
 * 
 * Add a tag to a media file
 */
tagsRoutes.post("/:id/media/:mediaId", async (c) => {
  try {
    const convex = c.get("convex");
    const tagId = c.req.param("id");
    const mediaId = c.req.param("mediaId");
    
    await convex.mutation(api.media.addTag, {
      id: mediaId as any,
      tagId: tagId as any,
    });
    
    return c.json({
      success: true,
    });
  } catch (error) {
    console.error("Error adding tag to media:", error);
    return c.json({
      success: false,
      error: "Failed to add tag to media",
    }, 500);
  }
});

/**
 * DELETE /api/tags/:id/media/:mediaId
 * 
 * Remove a tag from a media file
 */
tagsRoutes.delete("/:id/media/:mediaId", async (c) => {
  try {
    const convex = c.get("convex");
    const tagId = c.req.param("id");
    const mediaId = c.req.param("mediaId");
    
    await convex.mutation(api.media.removeTag, {
      id: mediaId as any,
      tagId: tagId as any,
    });
    
    return c.json({
      success: true,
    });
  } catch (error) {
    console.error("Error removing tag from media:", error);
    return c.json({
      success: false,
      error: "Failed to remove tag from media",
    }, 500);
  }
});
