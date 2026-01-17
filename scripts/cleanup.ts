#!/usr/bin/env bun
/**
 * Cache Cleanup Script
 * ====================
 * 
 * This script runs the cache cleanup process.
 * It can be run manually or scheduled via cron.
 * 
 * Usage:
 *   bun run cleanup
 *   
 * Or directly:
 *   bun run scripts/cleanup.ts
 * 
 * To schedule with cron (every hour):
 *   0 * * * * cd /path/to/cottmv && bun run cleanup
 */

import { runCleanup, getCacheStats, formatBytes, formatDuration } from "../src/media/cleanup.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { expandPath } from "../src/storage/local.js";

// Load environment variables
const CONVEX_URL = process.env.CONVEX_URL || "";

async function main() {
  console.log("🧹 CottMV Cache Cleanup");
  console.log("========================\n");

  if (!CONVEX_URL) {
    console.error("❌ Error: CONVEX_URL environment variable is not set");
    console.log("   Set it in your .env file or environment");
    process.exit(1);
  }

  // Create Convex client
  const convex = new ConvexHttpClient(CONVEX_URL);

  try {
    // Get cache configuration from database
    console.log("📋 Loading cache configuration...");
    const cacheConfig = await convex.query(api.settings.getCacheConfig, {});
    
    // Expand ~ to actual home directory
    const cacheDirectory = expandPath(cacheConfig.directory);
    
    console.log(`   Directory: ${cacheDirectory}`);
    console.log(`   Max Size: ${cacheConfig.maxSizeGb} GB`);
    console.log(`   TTL: ${cacheConfig.ttlHours} hours\n`);

    // Get current cache stats
    console.log("📊 Current cache status:");
    const beforeStats = await getCacheStats(cacheDirectory);
    console.log(`   Files: ${beforeStats.totalFiles}`);
    console.log(`   Size: ${formatBytes(beforeStats.totalSizeBytes)}`);
    if (beforeStats.oldestFile) {
      console.log(`   Oldest file: ${formatDuration(beforeStats.oldestFile.age)} old`);
    }
    console.log("");

    // Run cleanup
    console.log("🔄 Running cleanup...\n");
    const result = await runCleanup({
      cacheDirectory: cacheDirectory,
      maxSizeBytes: cacheConfig.maxSizeGb * 1024 * 1024 * 1024,
      ttlMs: cacheConfig.ttlHours * 60 * 60 * 1000,
    });

    // Report results
    console.log("✅ Cleanup complete!");
    console.log(`   Files deleted: ${result.filesDeleted}`);
    console.log(`   Space freed: ${formatBytes(result.bytesFreed)}`);
    
    if (result.expiredFiles.length > 0) {
      console.log(`   Expired files: ${result.expiredFiles.length}`);
    }
    if (result.lruFiles.length > 0) {
      console.log(`   LRU files: ${result.lruFiles.length}`);
    }
    
    if (result.errors.length > 0) {
      console.log("\n⚠️  Errors encountered:");
      for (const error of result.errors) {
        console.log(`   - ${error}`);
      }
    }

    // Clean up database entries
    console.log("\n🗄️  Cleaning database entries...");
    const expiredEntries = await convex.query(api.cache.getExpired, {});
    
    if (expiredEntries.length > 0) {
      await convex.mutation(api.cache.removeMany, {
        ids: expiredEntries.map((e: any) => e._id),
      });
      console.log(`   Removed ${expiredEntries.length} expired database entries`);
    } else {
      console.log("   No expired database entries");
    }

    // Show final stats
    console.log("\n📊 Final cache status:");
    const afterStats = await getCacheStats(cacheDirectory);
    console.log(`   Files: ${afterStats.totalFiles}`);
    console.log(`   Size: ${formatBytes(afterStats.totalSizeBytes)}`);
    
    console.log("\n✨ Done!");
  } catch (error) {
    console.error("\n❌ Cleanup failed:", error);
    process.exit(1);
  }
}

// Run the script
main();
