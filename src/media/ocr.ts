/**
 * OCR Module
 * ==========
 * 
 * This module provides OCR (Optical Character Recognition) functionality
 * to extract text from images, GIFs, and videos for searchable content.
 * 
 * Uses Tesseract.js for OCR processing and ffmpeg for frame extraction.
 * 
 * OCR is run in isolated subprocesses to prevent memory corruption from
 * crashing the main server process.
 */

import { spawn, ChildProcess } from "child_process";
import { mkdir, unlink, readdir, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { nanoid } from "nanoid";
import { createWorker, Worker } from "tesseract.js";
import sharp from "sharp";
import { existsSync } from "fs";

/**
 * Maximum text length to store (10KB to avoid database bloat)
 */
const MAX_OCR_TEXT_LENGTH = 10 * 1024;

/**
 * Minimum confidence threshold for OCR results (0-100)
 * Text with confidence below this will be filtered out
 */
const MIN_OCR_CONFIDENCE = 50;

/**
 * Minimum line length to keep (filters out garbage single chars)
 */
const MIN_LINE_LENGTH = 2;

/**
 * Maximum ratio of special characters to total characters
 * Lines exceeding this are likely garbage
 */
const MAX_SPECIAL_CHAR_RATIO = 0.5;

/**
 * Temporary directory for frame extraction
 */
const TEMP_DIR = "/tmp/cottmv-ocr";

/**
 * Frame positions to extract from videos (as percentages)
 */
const VIDEO_FRAME_POSITIONS = [10, 30, 50, 70, 90];

/**
 * Maximum frames to extract from GIFs/animated images
 */
const MAX_GIF_FRAMES = 5;

/**
 * OCR timeout in milliseconds (60 seconds per image - large images need more time)
 */
const OCR_TIMEOUT_MS = 60000;

/**
 * Global worker instance for reuse (only used in subprocess mode)
 */
let globalWorker: Worker | null = null;
let workerBusy = false;
let workerCreationFailed = false;

/**
 * Whether to use subprocess isolation for OCR
 * This prevents memory corruption from crashing the main process
 */
const USE_SUBPROCESS_OCR = true;

/**
 * Timeout for subprocess OCR in milliseconds
 */
const SUBPROCESS_TIMEOUT_MS = 90000;

/**
 * Track failed images to skip them in future runs
 */
const failedImages = new Set<string>();

/**
 * Maximum failures before stopping a batch
 */
const MAX_BATCH_FAILURES = 3;

/**
 * Check if a file is an animated image (animated WebP, GIF, etc.)
 * Uses ffprobe to detect multiple frames and also checks for codec parameters
 */
async function isAnimatedImage(filepath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      "-v", "error", // Show errors to detect animation-related issues
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      filepath,
    ];

    const ffprobe = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.on("close", (code) => {
      // Check stderr for ANIM/ANMF chunks which indicate animated WebP
      if (stderr.includes("ANIM") || stderr.includes("ANMF")) {
        resolve(true);
        return;
      }

      if (code !== 0) {
        // If ffprobe fails with errors about animation, treat as animated
        resolve(stderr.includes("animation") || stderr.includes("ANIM"));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];
        
        // Check for multiple frames
        const nbFrames = parseInt(stream?.nb_frames || "1", 10);
        if (nbFrames > 1) {
          resolve(true);
          return;
        }
        
        // Check duration - animated images have duration
        const duration = parseFloat(data.format?.duration || "0");
        if (duration > 0 && stream?.codec_name === "webp") {
          resolve(true);
          return;
        }
        
        resolve(false);
      } catch {
        resolve(false);
      }
    });

    ffprobe.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Get or create the global OCR worker
 */
async function getWorker(): Promise<Worker> {
  if (workerCreationFailed) {
    throw new Error("OCR worker creation previously failed");
  }
  
  if (!globalWorker) {
    try {
      globalWorker = await createWorker("eng", 1, {
        logger: () => {}, // Suppress progress logs
      });
      
      // Configure Tesseract for better meme/image text detection
      // PSM 11 = Sparse text. Find as much text as possible in no particular order.
      // PSM 6 = Assume a single uniform block of text (default)
      await globalWorker.setParameters({
        tessedit_pageseg_mode: "11", // Sparse text - good for memes with scattered text
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?'\"-:;()@#$%&*",
      });
    } catch (err) {
      workerCreationFailed = true;
      throw err;
    }
  }
  return globalWorker;
}

/**
 * Reset the global worker (call after errors)
 */
async function resetWorker(): Promise<void> {
  if (globalWorker) {
    try {
      await globalWorker.terminate();
    } catch {
      // Ignore
    }
    globalWorker = null;
  }
  workerBusy = false;
}

/**
 * Run OCR in an isolated subprocess to prevent memory corruption crashes
 * from bringing down the main server process.
 * 
 * @param imagePath - Path to the image to process
 * @returns Extracted text or empty string on failure
 */
async function runOCRInSubprocess(imagePath: string): Promise<string> {
  // Skip images that have failed before
  if (failedImages.has(imagePath)) {
    console.log(`[OCR] Skipping previously failed image: ${imagePath}`);
    return "";
  }
  
  const sessionId = nanoid(8);
  const outputFile = join(TEMP_DIR, `ocr-result-${sessionId}.txt`);
  
  try {
    await mkdir(TEMP_DIR, { recursive: true });
    
    // Create a script that runs OCR and outputs the result
    const scriptContent = `
import { createWorker } from "tesseract.js";
import sharp from "sharp";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { nanoid } from "nanoid";

const imagePath = ${JSON.stringify(imagePath)};
const outputFile = ${JSON.stringify(outputFile)};
const tempDir = ${JSON.stringify(TEMP_DIR)};

const MAX_OCR_TEXT_LENGTH = 10 * 1024;
const MIN_OCR_CONFIDENCE = 50;
const MIN_LINE_LENGTH = 2;
const MAX_SPECIAL_CHAR_RATIO = 0.5;

function isGarbageLine(line) {
  if (line.length < MIN_LINE_LENGTH) return true;
  const alphanumeric = line.replace(/[^a-zA-Z0-9]/g, "").length;
  const total = line.length;
  if (total > 0 && (total - alphanumeric) / total > MAX_SPECIAL_CHAR_RATIO) return true;
  const garbagePatterns = [
    /^[|\\\\\\\/\\[\\]{}()<>]+$/,
    /^[.\\-_=+*]+$/,
    /^[0-9\\s]+$/,
    /^.{1,2}$/,
    /^[^a-zA-Z]*$/,
  ];
  for (const pattern of garbagePatterns) {
    if (pattern.test(line)) return true;
  }
  return false;
}

function cleanOCRText(text) {
  if (!text) return "";
  const lines = text.split("\\n").map(l => l.trim());
  const cleanLines = lines.filter(line => {
    if (!line) return false;
    return !isGarbageLine(line);
  });
  return cleanLines.join("\\n");
}

async function preprocessImage(inputPath, outputPath) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const maxDimension = 2000;
  const minDimension = 300;
  let width = metadata.width || 800;
  let height = metadata.height || 600;
  if (width < minDimension && height < minDimension) {
    const scale = minDimension / Math.min(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  } else if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  await sharp(inputPath)
    .resize(width, height, { fit: 'inside' })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .png()
    .toFile(outputPath);
}

async function main() {
  let preprocessedPath = null;
  let worker = null;
  
  try {
    await mkdir(tempDir, { recursive: true });
    
    // Preprocess image
    const sessionId = nanoid(8);
    preprocessedPath = join(tempDir, \`preprocess-sub-\${sessionId}.png\`);
    
    try {
      await preprocessImage(imagePath, preprocessedPath);
    } catch (prepErr) {
      // Use original if preprocessing fails
      preprocessedPath = null;
    }
    
    const processPath = preprocessedPath || imagePath;
    
    // Create worker and run OCR
    worker = await createWorker("eng", 1, {
      logger: () => {},
    });
    
    await worker.setParameters({
      tessedit_pageseg_mode: "11",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?'\\\"-:;()@#$%&*",
    });
    
    const result = await worker.recognize(processPath);
    
    // Process results
    let text = "";
    if (result.data.words && result.data.words.length > 0) {
      const confidentWords = result.data.words
        .filter(word => word.confidence >= MIN_OCR_CONFIDENCE)
        .map(word => word.text);
      
      if (confidentWords.length > 0) {
        const lines = [];
        let currentLine = [];
        let lastY = -1;
        
        for (const word of result.data.words) {
          if (word.confidence < MIN_OCR_CONFIDENCE) continue;
          const wordY = word.bbox?.y0 || 0;
          if (lastY !== -1 && Math.abs(wordY - lastY) > 10) {
            if (currentLine.length > 0) {
              lines.push(currentLine.join(" "));
              currentLine = [];
            }
          }
          currentLine.push(word.text);
          lastY = wordY;
        }
        
        if (currentLine.length > 0) {
          lines.push(currentLine.join(" "));
        }
        
        text = lines.join("\\n");
      } else {
        text = result.data.text;
      }
    } else {
      text = result.data.text;
    }
    
    const cleanedText = cleanOCRText(text.trim());
    
    // Write result to file
    await writeFile(outputFile, cleanedText, "utf-8");
    
    await worker.terminate();
    
    // Clean up preprocessed file
    if (preprocessedPath) {
      await unlink(preprocessedPath).catch(() => {});
    }
    
    process.exit(0);
  } catch (err) {
    console.error("[OCR Subprocess Error]", err);
    // Write empty result on error
    await writeFile(outputFile, "", "utf-8").catch(() => {});
    
    if (worker) {
      await worker.terminate().catch(() => {});
    }
    if (preprocessedPath) {
      await unlink(preprocessedPath).catch(() => {});
    }
    
    process.exit(1);
  }
}

main();
`;
    
    const scriptPath = join(TEMP_DIR, `ocr-script-${sessionId}.ts`);
    await writeFile(scriptPath, scriptContent, "utf-8");
    
    // Run the script in a subprocess from the project directory
    // This ensures node_modules can be resolved
    const projectRoot = join(import.meta.dir, "../..");
    
    return new Promise<string>((resolve) => {
      let resolved = false;
      
      const child = spawn("bun", ["run", scriptPath], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: SUBPROCESS_TIMEOUT_MS,
        cwd: projectRoot,
      });
      
      let stderr = "";
      
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      
      // Set a timeout to kill the process if it takes too long
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn(`[OCR] Subprocess timeout for ${imagePath}`);
          failedImages.add(imagePath);
          child.kill("SIGKILL");
          // Clean up
          unlink(scriptPath).catch(() => {});
          unlink(outputFile).catch(() => {});
          resolve("");
        }
      }, SUBPROCESS_TIMEOUT_MS);
      
      child.on("close", async (code, signal) => {
        clearTimeout(timeout);
        
        if (resolved) return;
        resolved = true;
        
        // Clean up script
        await unlink(scriptPath).catch(() => {});
        
        if (signal) {
          console.warn(`[OCR] Subprocess killed by signal ${signal} for ${imagePath}`);
          failedImages.add(imagePath);
          await unlink(outputFile).catch(() => {});
          resolve("");
          return;
        }
        
        if (code !== 0) {
          console.warn(`[OCR] Subprocess failed with code ${code} for ${imagePath}`);
          if (stderr) {
            console.warn(`[OCR] Subprocess stderr: ${stderr.slice(-500)}`);
          }
          failedImages.add(imagePath);
          await unlink(outputFile).catch(() => {});
          resolve("");
          return;
        }
        
        // Read result from output file
        try {
          const result = await readFile(outputFile, "utf-8");
          await unlink(outputFile).catch(() => {});
          resolve(result);
        } catch {
          resolve("");
        }
      });
      
      child.on("error", async (err) => {
        clearTimeout(timeout);
        
        if (resolved) return;
        resolved = true;
        
        console.warn(`[OCR] Subprocess error for ${imagePath}:`, err.message);
        failedImages.add(imagePath);
        await unlink(scriptPath).catch(() => {});
        await unlink(outputFile).catch(() => {});
        resolve("");
      });
    });
  } catch (err) {
    console.error(`[OCR] Failed to run subprocess for ${imagePath}:`, err);
    failedImages.add(imagePath);
    return "";
  }
}

/**
 * Preprocess an image to improve OCR quality
 * - Converts to grayscale
 * - Increases contrast
 * - Applies sharpening
 * - Normalizes size for better OCR
 * 
 * @param inputPath - Path to the original image
 * @param outputPath - Path to save the preprocessed image
 */
async function preprocessImageForOCR(inputPath: string, outputPath: string): Promise<void> {
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  
  // Calculate target dimensions - OCR works best at certain sizes
  // Too small = can't read, too large = slow and noisy
  const maxDimension = 2000;
  const minDimension = 300;
  
  let width = metadata.width || 800;
  let height = metadata.height || 600;
  
  // Scale up small images
  if (width < minDimension && height < minDimension) {
    const scale = minDimension / Math.min(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  // Scale down large images
  else if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  
  await sharp(inputPath)
    .resize(width, height, { fit: 'inside' })
    .grayscale() // Convert to grayscale - improves OCR accuracy
    .normalize() // Normalize contrast
    .sharpen({ sigma: 1.5 }) // Sharpen text edges
    .png() // Output as PNG for best quality
    .toFile(outputPath);
}

/**
 * Check if a line of text is likely garbage/noise
 * 
 * @param line - The line of text to check
 * @returns true if the line appears to be garbage
 */
function isGarbageLine(line: string): boolean {
  // Too short
  if (line.length < MIN_LINE_LENGTH) {
    return true;
  }
  
  // Count alphanumeric vs special characters
  const alphanumeric = line.replace(/[^a-zA-Z0-9]/g, "").length;
  const total = line.length;
  
  // If more than half is special characters, likely garbage
  if (total > 0 && (total - alphanumeric) / total > MAX_SPECIAL_CHAR_RATIO) {
    return true;
  }
  
  // Check for common garbage patterns
  const garbagePatterns = [
    /^[|\\\/\[\]{}()<>]+$/, // Only brackets/pipes
    /^[.\-_=+*]+$/, // Only punctuation
    /^[0-9\s]+$/, // Only numbers and spaces (usually not meaningful)
    /^.{1,2}$/, // Very short (1-2 chars)
    /^[^a-zA-Z]*$/, // No letters at all
  ];
  
  for (const pattern of garbagePatterns) {
    if (pattern.test(line)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Clean and filter OCR text to remove garbage
 * 
 * @param text - Raw OCR text
 * @returns Cleaned text with garbage removed
 */
function cleanOCRText(text: string): string {
  if (!text) return "";
  
  // Split into lines
  const lines = text.split("\n").map(l => l.trim());
  
  // Filter out garbage lines
  const cleanLines = lines.filter(line => {
    if (!line) return false;
    return !isGarbageLine(line);
  });
  
  return cleanLines.join("\n");
}

/**
 * Run OCR on a single image file using Tesseract.js
 * Uses subprocess isolation by default to prevent memory corruption crashes.
 * Falls back to in-process worker if subprocess is disabled.
 */
async function runOCR(imagePath: string, skipPreprocess: boolean = false): Promise<string> {
  // Use subprocess isolation to prevent crashes from bringing down the server
  if (USE_SUBPROCESS_OCR) {
    return runOCRInSubprocess(imagePath);
  }
  
  // Legacy in-process mode (not recommended - can crash the server)
  // Wait if worker is busy (sequential processing)
  while (workerBusy) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  workerBusy = true;
  
  let preprocessedPath: string | null = null;
  
  try {
    const worker = await getWorker();
    
    // Preprocess the image for better OCR results
    let processPath = imagePath;
    if (!skipPreprocess) {
      try {
        const sessionId = nanoid(8);
        preprocessedPath = join(TEMP_DIR, `preprocess-${sessionId}.png`);
        await mkdir(TEMP_DIR, { recursive: true });
        await preprocessImageForOCR(imagePath, preprocessedPath);
        processPath = preprocessedPath;
      } catch (prepErr) {
        console.warn(`[OCR] Preprocessing failed, using original:`, prepErr instanceof Error ? prepErr.message : prepErr);
        // Continue with original image if preprocessing fails
      }
    }
    
    // Create a promise race with timeout
    const resultPromise = worker.recognize(processPath);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("OCR timeout")), OCR_TIMEOUT_MS);
    });
    
    const result = await Promise.race([resultPromise, timeoutPromise]);
    
    // Filter results by confidence and clean up garbage
    let text = "";
    if (result.data.words && result.data.words.length > 0) {
      // Filter words by confidence threshold
      const confidentWords = result.data.words
        .filter((word: any) => word.confidence >= MIN_OCR_CONFIDENCE)
        .map((word: any) => word.text);
      
      // If we got confident words, reconstruct text from them
      // Otherwise fall back to the raw text
      if (confidentWords.length > 0) {
        // Use line-based reconstruction to preserve structure
        const lines: string[] = [];
        let currentLine: string[] = [];
        let lastY = -1;
        
        for (const word of result.data.words) {
          if (word.confidence < MIN_OCR_CONFIDENCE) continue;
          
          const wordY = word.bbox?.y0 || 0;
          
          // New line if Y position changed significantly
          if (lastY !== -1 && Math.abs(wordY - lastY) > 10) {
            if (currentLine.length > 0) {
              lines.push(currentLine.join(" "));
              currentLine = [];
            }
          }
          
          currentLine.push(word.text);
          lastY = wordY;
        }
        
        if (currentLine.length > 0) {
          lines.push(currentLine.join(" "));
        }
        
        text = lines.join("\n");
      } else {
        text = result.data.text;
      }
    } else {
      text = result.data.text;
    }
    
    // Clean up garbage from the text
    const cleanedText = cleanOCRText(text.trim());
    
    return cleanedText;
  } catch (err) {
    // Reset worker on any error to prevent corrupted state
    await resetWorker();
    throw err;
  } finally {
    workerBusy = false;
    
    // Clean up preprocessed file
    if (preprocessedPath) {
      await unlink(preprocessedPath).catch(() => {});
    }
  }
}

/**
 * Convert an image to PNG format using ImageMagick (convert command)
 * 
 * @param inputPath - Path to the source image
 * @param outputPath - Path to save the converted PNG
 */
async function convertToPngWithImageMagick(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ext = inputPath.toLowerCase().slice(inputPath.lastIndexOf("."));
    const isSvg = ext === ".svg";
    
    const args = isSvg
      ? [
          "-background", "white",
          "-density", "150",
          `${inputPath}[0]`,
          "-flatten",
          outputPath,
        ]
      : [
          `${inputPath}[0]`,
          outputPath,
        ];

    // Use 'convert' command (ImageMagick 6, commonly available)
    const convert = spawn("convert", args);
    let stderr = "";

    convert.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    convert.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ImageMagick failed: ${stderr || 'unknown error'}`));
        return;
      }
      resolve();
    });

    convert.on("error", (error) => {
      reject(new Error(`ImageMagick not available: ${error.message}`));
    });
  });
}

/**
 * Convert an image to PNG format using ffmpeg
 * 
 * @param inputPath - Path to the source image
 * @param outputPath - Path to save the converted PNG
 */
async function convertToPngWithFFmpeg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-vframes", "1",
      "-y",
      outputPath,
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg conversion failed: ${stderr.slice(-200) || 'unknown error'}`));
        return;
      }
      resolve();
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`FFmpeg not available: ${error.message}`));
    });
  });
}

/**
 * Convert an image to PNG format - tries multiple methods
 * 
 * @param inputPath - Path to the source image
 * @param outputPath - Path to save the converted PNG
 */
async function convertToPng(inputPath: string, outputPath: string): Promise<void> {
  const ext = inputPath.toLowerCase().slice(inputPath.lastIndexOf("."));
  
  // For WebP, try ffmpeg first (better WebP support)
  if (ext === ".webp") {
    try {
      await convertToPngWithFFmpeg(inputPath, outputPath);
      return;
    } catch (ffmpegErr) {
      console.log(`[OCR] FFmpeg WebP conversion failed, trying ImageMagick`);
    }
  }
  
  // Try ImageMagick
  try {
    await convertToPngWithImageMagick(inputPath, outputPath);
    return;
  } catch (imErr) {
    // For non-WebP, try ffmpeg as fallback
    if (ext !== ".webp") {
      try {
        await convertToPngWithFFmpeg(inputPath, outputPath);
        return;
      } catch {
        // Both failed
      }
    }
    throw imErr;
  }
}

/**
 * Convert WebP to PNG using sharp (excellent WebP support)
 * For animated WebP, extracts the first frame
 * 
 * @param inputPath - Path to the WebP file
 * @param outputPath - Path to save the PNG
 */
async function convertWebPWithSharp(inputPath: string, outputPath: string): Promise<void> {
  await sharp(inputPath, { animated: false, pages: 1 })
    .png()
    .toFile(outputPath);
}

/**
 * Extract frames from animated WebP using sharp
 * 
 * @param inputPath - Path to the WebP file
 * @param outputDir - Directory to save frames
 * @param maxFrames - Maximum number of frames to extract
 * @returns Array of frame file paths
 */
async function extractWebPFramesWithSharp(inputPath: string, outputDir: string, maxFrames: number = MAX_GIF_FRAMES): Promise<string[]> {
  const image = sharp(inputPath, { animated: true });
  const metadata = await image.metadata();
  
  const totalPages = metadata.pages || 1;
  if (totalPages <= 1) {
    // Not animated, just convert to PNG
    const pngPath = join(outputDir, `frame-0.png`);
    await convertWebPWithSharp(inputPath, pngPath);
    return [pngPath];
  }
  
  // Extract evenly distributed frames
  const framePaths: string[] = [];
  const step = Math.max(1, Math.floor(totalPages / maxFrames));
  
  for (let i = 0; i < totalPages && framePaths.length < maxFrames; i += step) {
    const framePath = join(outputDir, `frame-${framePaths.length}.png`);
    await sharp(inputPath, { animated: true, pages: 1, page: i })
      .png()
      .toFile(framePath);
    framePaths.push(framePath);
  }
  
  return framePaths;
}

/**
 * Convert WebP to PNG or extract frames if animated
 * Uses sharp which has excellent WebP support via libwebp
 * 
 * @param inputPath - Path to the WebP file
 * @param outputDir - Directory to save the output
 * @returns Object with output path(s) and whether it's animated
 */
async function convertWebP(inputPath: string, outputDir: string): Promise<{ outputPath: string; framePaths?: string[]; isAnimated: boolean }> {
  const sessionId = nanoid(8);
  
  try {
    // Check if animated using sharp metadata
    const metadata = await sharp(inputPath, { animated: true }).metadata();
    const isAnimated = (metadata.pages || 1) > 1;
    
    if (isAnimated) {
      console.log(`[OCR] WebP is animated (${metadata.pages} frames), extracting frames with sharp`);
      const frameDir = join(outputDir, `webp-frames-${sessionId}`);
      await mkdir(frameDir, { recursive: true });
      const framePaths = await extractWebPFramesWithSharp(inputPath, frameDir);
      return { outputPath: frameDir, framePaths, isAnimated: true };
    } else {
      // Static WebP - convert to PNG
      const pngPath = join(outputDir, `webp-${sessionId}.png`);
      await convertWebPWithSharp(inputPath, pngPath);
      return { outputPath: pngPath, isAnimated: false };
    }
  } catch (err) {
    console.error(`[OCR] Sharp WebP conversion failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

/**
 * Formats that need conversion before OCR
 * - WebP: Convert to PNG (static) or GIF (animated)
 * - SVG: Convert to PNG
 * - Others: Convert to PNG
 */
const FORMATS_NEEDING_CONVERSION = [".webp", ".svg", ".avif", ".heic", ".heif", ".tiff", ".bmp"];

/**
 * Extract text from a static image using Tesseract.js
 * 
 * Handles formats that Tesseract doesn't support natively by converting
 * them to PNG first using ImageMagick.
 * 
 * @param filepath - Path to the image file
 * @returns Extracted text or empty string if no text found
 */
export async function extractTextFromImage(filepath: string): Promise<string> {
  const ext = filepath.toLowerCase().slice(filepath.lastIndexOf("."));
  const needsConversion = FORMATS_NEEDING_CONVERSION.includes(ext);
  let processPath = filepath;
  let tempFiles: string[] = [];
  
  try {
    console.log(`[OCR] Processing image: ${filepath}`);
    await mkdir(TEMP_DIR, { recursive: true });
    
    // Special handling for WebP - use sharp for conversion
    if (ext === ".webp") {
      console.log(`[OCR] Converting WebP with sharp`);
      try {
        const result = await convertWebP(filepath, TEMP_DIR);
        
        if (result.isAnimated && result.framePaths) {
          // Process extracted frames directly
          console.log(`[OCR] WebP is animated, OCR'ing ${result.framePaths.length} frames`);
          tempFiles.push(...result.framePaths);
          tempFiles.push(result.outputPath); // The frame directory
          
          const frameTexts: string[] = [];
          for (const framePath of result.framePaths) {
            try {
              const text = await runOCR(framePath);
              console.log(`[OCR] Extracted ${text.length} characters from frame`);
              frameTexts.push(text);
            } catch (err) {
              console.warn(`[OCR] Failed to OCR frame:`, err instanceof Error ? err.message : err);
            }
          }
          
          const combinedText = deduplicateText(frameTexts);
          console.log(`[OCR] Extracted ${combinedText.length} characters from animated WebP (${result.framePaths.length} frames)`);
          return combinedText;
        } else {
          // Process as static PNG
          console.log(`[OCR] WebP converted to PNG (static)`);
          tempFiles.push(result.outputPath);
          processPath = result.outputPath;
        }
      } catch (convErr) {
        console.error(`[OCR] WebP conversion failed:`, convErr instanceof Error ? convErr.message : convErr);
        return "";
      }
    }
    // SVG needs special conversion - use sharp
    else if (ext === ".svg") {
      const sessionId = nanoid(8);
      const pngPath = join(TEMP_DIR, `svg-${sessionId}.png`);
      tempFiles.push(pngPath);
      
      console.log(`[OCR] Converting SVG to PNG with sharp`);
      try {
        await sharp(filepath, { density: 150 })
          .png()
          .toFile(pngPath);
        processPath = pngPath;
      } catch (convErr) {
        console.error(`[OCR] SVG conversion failed:`, convErr instanceof Error ? convErr.message : convErr);
        return "";
      }
    }
    // Other formats that need conversion
    else if (needsConversion) {
      const sessionId = nanoid(8);
      const pngPath = join(TEMP_DIR, `convert-${sessionId}.png`);
      tempFiles.push(pngPath);
      
      console.log(`[OCR] Converting ${ext} to PNG`);
      try {
        await convertToPng(filepath, pngPath);
        processPath = pngPath;
      } catch (convErr) {
        console.error(`[OCR] Conversion failed for ${filepath}:`, convErr instanceof Error ? convErr.message : convErr);
        return "";
      }
    }
    
    const text = await runOCR(processPath);
    console.log(`[OCR] Extracted ${text.length} characters from image`);
    
    return text;
  } catch (error) {
    console.error(`[OCR] Failed to process image ${filepath}:`, error);
    return "";
  } finally {
    // Clean up temp files and directories
    for (const tempPath of tempFiles) {
      await rm(tempPath, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Extract a single frame from a video at a specific time position
 * 
 * @param inputPath - Path to the video file
 * @param outputPath - Path to save the extracted frame
 * @param seekSeconds - Time position in seconds
 */
async function extractVideoFrame(
  inputPath: string,
  outputPath: string,
  seekSeconds: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-ss", seekSeconds.toString(),
      "-i", inputPath,
      "-vframes", "1",
      "-q:v", "2",
      "-y",
      outputPath,
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Frame extraction failed`));
        return;
      }
      resolve();
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });
  });
}

/**
 * Get video duration using ffprobe
 * 
 * @param inputPath - Path to the video file
 * @returns Duration in seconds
 */
async function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      inputPath,
    ];

    const ffprobe = spawn("ffprobe", args);
    let stdout = "";

    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("Failed to get video duration"));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const duration = parseFloat(data.format?.duration || "0");
        resolve(duration);
      } catch {
        reject(new Error("Failed to parse ffprobe output"));
      }
    });

    ffprobe.on("error", (error) => {
      reject(new Error(`Failed to start ffprobe: ${error.message}`));
    });
  });
}

/**
 * Extract text from a video by sampling frames at different positions
 * 
 * @param filepath - Path to the video file
 * @returns Combined extracted text from all frames
 */
export async function extractTextFromVideo(filepath: string): Promise<string> {
  const sessionId = nanoid(8);
  const tempDir = join(TEMP_DIR, `video-${sessionId}`);
  
  try {
    console.log(`[OCR] Processing video: ${filepath}`);
    
    // Create temp directory
    await mkdir(tempDir, { recursive: true });
    
    // Get video duration
    const duration = await getVideoDuration(filepath);
    if (duration <= 0) {
      console.warn(`[OCR] Could not determine video duration for ${filepath}`);
      return "";
    }
    
    // Extract frames at different positions
    const frameTexts: string[] = [];
    let consecutiveFailures = 0;
    
    for (let i = 0; i < VIDEO_FRAME_POSITIONS.length; i++) {
      // Stop if we've had too many consecutive failures (worker might be broken)
      if (consecutiveFailures >= 3) {
        console.warn(`[OCR] Too many consecutive failures, stopping video processing`);
        break;
      }
      
      const position = VIDEO_FRAME_POSITIONS[i];
      const seekTime = (duration * position) / 100;
      const framePath = join(tempDir, `frame-${i}.jpg`);
      
      try {
        await extractVideoFrame(filepath, framePath, seekTime);
        console.log(`[OCR] Processing image: ${framePath}`);
        const text = await runOCR(framePath);
        console.log(`[OCR] Extracted ${text.length} characters from image`);
        frameTexts.push(text);
        consecutiveFailures = 0; // Reset on success
        // Clean up frame file
        await unlink(framePath).catch(() => {});
      } catch (err) {
        consecutiveFailures++;
        console.warn(`[OCR] Failed to process frame ${i}:`, err instanceof Error ? err.message : err);
        // Clean up frame file even on error
        await unlink(framePath).catch(() => {});
      }
    }
    
    // Combine and deduplicate text
    const combinedText = deduplicateText(frameTexts);
    console.log(`[OCR] Extracted ${combinedText.length} characters from video (${VIDEO_FRAME_POSITIONS.length} frames)`);
    
    return combinedText;
  } catch (error) {
    console.error(`[OCR] Failed to process video ${filepath}:`, error);
    return "";
  } finally {
    // Clean up temp directory
    try {
      const files = await readdir(tempDir).catch(() => []);
      for (const file of files) {
        await unlink(join(tempDir, file)).catch(() => {});
      }
      await unlink(tempDir).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract frames from an animated image (GIF, animated WebP) using ffmpeg
 * 
 * @param inputPath - Path to the animated image file
 * @param outputDir - Directory to save extracted frames
 * @returns Array of extracted frame paths
 */
async function extractAnimatedFrames(
  inputPath: string,
  outputDir: string
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // Extract every Nth frame to limit total frames
    const args = [
      "-i", inputPath,
      "-vf", `select=not(mod(n\\,5))`, // Extract every 5th frame
      "-vsync", "vfr",
      "-frames:v", MAX_GIF_FRAMES.toString(),
      "-q:v", "2",
      "-y",
      join(outputDir, "frame-%03d.jpg"),
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`Frame extraction failed`));
        return;
      }

      try {
        const files = await readdir(outputDir);
        const framePaths = files
          .filter((f) => f.startsWith("frame-") && f.endsWith(".jpg"))
          .sort()
          .map((f) => join(outputDir, f));
        resolve(framePaths);
      } catch (error) {
        reject(error);
      }
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });
  });
}

/**
 * Extract text from an animated image (GIF or animated WebP) by sampling frames
 * 
 * @param filepath - Path to the animated image file
 * @returns Combined extracted text from all frames
 */
export async function extractTextFromAnimatedImage(filepath: string): Promise<string> {
  const sessionId = nanoid(8);
  const tempDir = join(TEMP_DIR, `anim-${sessionId}`);
  
  try {
    console.log(`[OCR] Processing animated image: ${filepath}`);
    
    // Create temp directory
    await mkdir(tempDir, { recursive: true });
    
    // Extract frames
    let framePaths: string[] = [];
    try {
      framePaths = await extractAnimatedFrames(filepath, tempDir);
    } catch (err) {
      console.warn(`[OCR] Failed to extract frames from ${filepath}:`, err);
      return "";
    }
    
    if (framePaths.length === 0) {
      console.warn(`[OCR] No frames extracted from ${filepath}`);
      return "";
    }
    
    // OCR each frame
    const frameTexts: string[] = [];
    let consecutiveFailures = 0;
    
    for (const framePath of framePaths) {
      // Stop if we've had too many consecutive failures
      if (consecutiveFailures >= 3) {
        console.warn(`[OCR] Too many consecutive failures, stopping animation processing`);
        break;
      }
      
      try {
        console.log(`[OCR] Processing image: ${framePath}`);
        const text = await runOCR(framePath);
        console.log(`[OCR] Extracted ${text.length} characters from image`);
        frameTexts.push(text);
        consecutiveFailures = 0; // Reset on success
        // Clean up frame file immediately
        await unlink(framePath).catch(() => {});
      } catch (err) {
        consecutiveFailures++;
        console.warn(`[OCR] Failed to OCR frame:`, err instanceof Error ? err.message : err);
        // Clean up frame file even on error
        await unlink(framePath).catch(() => {});
      }
    }
    
    // Combine and deduplicate text
    const combinedText = deduplicateText(frameTexts);
    console.log(`[OCR] Extracted ${combinedText.length} characters from animated image (${framePaths.length} frames)`);
    
    return combinedText;
  } catch (error) {
    console.error(`[OCR] Failed to process animated image ${filepath}:`, error);
    return "";
  } finally {
    // Clean up temp directory
    try {
      const files = await readdir(tempDir).catch(() => []);
      for (const file of files) {
        await unlink(join(tempDir, file)).catch(() => {});
      }
      await unlink(tempDir).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract text from a GIF by sampling frames
 * (Alias for extractTextFromAnimatedImage for backwards compatibility)
 * 
 * @param filepath - Path to the GIF file
 * @returns Combined extracted text from all frames
 */
export async function extractTextFromGif(filepath: string): Promise<string> {
  return extractTextFromAnimatedImage(filepath);
}

/**
 * Deduplicate and combine text from multiple frames
 * 
 * This removes duplicate lines and combines unique text from all frames.
 * Also filters out garbage lines.
 * Useful because consecutive frames often contain the same text.
 * 
 * @param texts - Array of text extracted from different frames
 * @returns Combined deduplicated text
 */
function deduplicateText(texts: string[]): string {
  const seenLines = new Set<string>();
  const uniqueLines: string[] = [];
  
  for (const text of texts) {
    if (!text) continue;
    
    // Split into lines and process each
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l);
    
    for (const line of lines) {
      // Skip garbage lines
      if (isGarbageLine(line)) {
        continue;
      }
      
      // Normalize whitespace for comparison
      const normalized = line.replace(/\s+/g, " ").toLowerCase();
      
      if (!seenLines.has(normalized)) {
        seenLines.add(normalized);
        uniqueLines.push(line);
      }
    }
  }
  
  // Join with newlines and limit length
  let result = uniqueLines.join("\n");
  
  if (result.length > MAX_OCR_TEXT_LENGTH) {
    result = result.substring(0, MAX_OCR_TEXT_LENGTH);
    // Try to cut at a word boundary
    const lastSpace = result.lastIndexOf(" ");
    if (lastSpace > MAX_OCR_TEXT_LENGTH * 0.9) {
      result = result.substring(0, lastSpace);
    }
  }
  
  return result;
}

/**
 * Process media file for OCR based on its type
 * 
 * This is the main entry point for OCR processing.
 * Routes to the appropriate extraction function based on media type.
 * 
 * @param filepath - Path to the media file
 * @param mediaType - Type of media (image, gif, video)
 * @returns Extracted text or undefined if no text found
 */
export async function processMediaForOCR(
  filepath: string,
  mediaType: string
): Promise<string | undefined> {
  let text = "";
  
  try {
    switch (mediaType) {
      case "image":
        text = await extractTextFromImage(filepath);
        break;
      case "gif":
        text = await extractTextFromGif(filepath);
        break;
      case "video":
        text = await extractTextFromVideo(filepath);
        break;
      default:
        // Unsupported media type for OCR
        return undefined;
    }
  } catch (error) {
    console.error(`[OCR] Error processing ${mediaType} ${filepath}:`, error);
    // Try to reset the worker on error
    await resetWorker();
    return undefined;
  }
  
  // Return undefined if no meaningful text was extracted
  if (!text || text.trim().length === 0) {
    return undefined;
  }
  
  return text.trim();
}

/**
 * Cleanup function to terminate the global worker
 * Call this when shutting down the server
 */
export async function cleanupOCR(): Promise<void> {
  await resetWorker();
}

/**
 * Check if an image path has previously failed OCR
 */
export function hasOCRFailed(imagePath: string): boolean {
  return failedImages.has(imagePath);
}

/**
 * Clear the failed images set (useful for retrying)
 */
export function clearFailedImages(): void {
  failedImages.clear();
}

/**
 * Get the number of images that have failed OCR
 */
export function getFailedImageCount(): number {
  return failedImages.size;
}

// Handle process exit to clean up worker
process.on("beforeExit", async () => {
  await cleanupOCR();
});
