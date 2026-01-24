/**
 * Video Transcoder Module
 * =======================
 * 
 * This module handles video transcoding using FFmpeg.
 * Transcoding converts videos from one format/quality to another,
 * which is necessary when:
 * - The browser doesn't support the original video format
 * - The user wants a lower quality stream to save bandwidth
 * - The original file is too large for smooth streaming
 * 
 * Key Concepts:
 * - Codec: The algorithm used to encode/decode video (e.g., H.264, VP9)
 * - Container: The file format that holds the video (e.g., MP4, WebM)
 * - Resolution: The video dimensions (e.g., 1920x1080 for 1080p)
 * - Bitrate: How much data per second (higher = better quality, larger file)
 */

import { spawn } from "child_process";
import { mkdir, stat, unlink } from "fs/promises";
import { dirname, join, basename } from "path";
import { nanoid } from "nanoid";

/**
 * Supported output resolutions with their settings
 * 
 * Each resolution has:
 * - width/height: Output dimensions
 * - videoBitrate: Target video bitrate (affects quality and file size)
 * - audioBitrate: Target audio bitrate
 */
export const RESOLUTIONS = {
  "480p": {
    width: 854,
    height: 480,
    videoBitrate: "1000k",
    audioBitrate: "128k",
  },
  "720p": {
    width: 1280,
    height: 720,
    videoBitrate: "2500k",
    audioBitrate: "192k",
  },
  "1080p": {
    width: 1920,
    height: 1080,
    videoBitrate: "5000k",
    audioBitrate: "256k",
  },
  "1440p": {
    width: 2560,
    height: 1440,
    videoBitrate: "10000k",
    audioBitrate: "320k",
  },
  "2160p": {
    width: 3840,
    height: 2160,
    videoBitrate: "20000k",
    audioBitrate: "320k",
  },
} as const;

export type Resolution = keyof typeof RESOLUTIONS;

/**
 * Supported output formats
 * 
 * MP4 with H.264: Best compatibility (works in all browsers)
 * WebM with VP9: Better compression, good browser support
 */
export const FORMATS = {
  mp4: {
    extension: "mp4",
    videoCodec: "libx264",
    audioCodec: "aac",
    // Additional FFmpeg options for MP4
    extraArgs: [
      "-movflags", "+faststart", // Enables streaming before download completes
      "-preset", "medium",       // Balance between speed and compression
      "-crf", "23",              // Constant Rate Factor (18-28 is good, lower = better)
    ],
  },
  webm: {
    extension: "webm",
    videoCodec: "libvpx-vp9",
    audioCodec: "libopus",
    extraArgs: [
      "-deadline", "good",       // Balance between speed and quality
      "-cpu-used", "2",          // 0-5, higher = faster but lower quality
    ],
  },
} as const;

export type Format = keyof typeof FORMATS;

/**
 * Options for transcoding a video
 */
export interface TranscodeOptions {
  /** Path to the input video file */
  inputPath: string;
  /** Directory to save the transcoded file */
  outputDir: string;
  /** Target resolution (480p, 720p, 1080p) */
  resolution: Resolution;
  /** Output format (mp4, webm) */
  format: Format;
  /** Optional: callback for progress updates (0-100) */
  onProgress?: (percent: number) => void;
}

/**
 * Result of a successful transcode operation
 */
export interface TranscodeResult {
  /** Path to the transcoded file */
  outputPath: string;
  /** Size of the transcoded file in bytes */
  size: number;
  /** Duration of the transcoding process in milliseconds */
  duration: number;
}

/**
 * Get video metadata using FFprobe
 * 
 * FFprobe is a tool that comes with FFmpeg for analyzing media files.
 * We use it to get information like duration, resolution, and codecs.
 * 
 * @param inputPath - Path to the video file
 * @returns Object with video metadata
 */
export async function getVideoMetadata(inputPath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  bitrate: number;
}> {
  return new Promise((resolve, reject) => {
    // FFprobe command to get JSON output with stream information
    const args = [
      "-v", "quiet",           // Suppress unnecessary output
      "-print_format", "json", // Output as JSON
      "-show_format",          // Include format information
      "-show_streams",         // Include stream information
      inputPath,
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
      if (code !== 0) {
        reject(new Error(`FFprobe failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        
        // Find video and audio streams
        const videoStream = data.streams?.find(
          (s: any) => s.codec_type === "video"
        );
        const audioStream = data.streams?.find(
          (s: any) => s.codec_type === "audio"
        );

        resolve({
          duration: parseFloat(data.format?.duration || "0"),
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          videoCodec: videoStream?.codec_name || "unknown",
          audioCodec: audioStream?.codec_name || "unknown",
          bitrate: parseInt(data.format?.bit_rate || "0", 10),
        });
      } catch (error) {
        reject(new Error(`Failed to parse FFprobe output: ${error}`));
      }
    });

    ffprobe.on("error", (error) => {
      reject(new Error(`Failed to start FFprobe: ${error.message}`));
    });
  });
}

/**
 * Check if FFmpeg is installed and available
 * 
 * @returns true if FFmpeg is available, false otherwise
 */
export async function checkFFmpegInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", ["-version"]);
    
    ffmpeg.on("close", (code) => {
      resolve(code === 0);
    });
    
    ffmpeg.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Transcode a video file
 * 
 * This is the main function that converts a video to a different format/quality.
 * It spawns an FFmpeg process and monitors its progress.
 * 
 * @param options - Transcoding options
 * @returns Promise that resolves with the result when transcoding completes
 * 
 * @example
 * ```typescript
 * const result = await transcodeVideo({
 *   inputPath: "/media/movie.mkv",
 *   outputDir: "/cache/transcoded",
 *   resolution: "720p",
 *   format: "mp4",
 *   onProgress: (percent) => console.log(`Progress: ${percent}%`),
 * });
 * console.log(`Transcoded to: ${result.outputPath}`);
 * ```
 */
export async function transcodeVideo(
  options: TranscodeOptions
): Promise<TranscodeResult> {
  const { inputPath, outputDir, resolution, format, onProgress } = options;
  const startTime = Date.now();

  // Get resolution and format settings
  const resSettings = RESOLUTIONS[resolution];
  const formatSettings = FORMATS[format];

  // Generate unique output filename
  const inputBasename = basename(inputPath, "." + inputPath.split(".").pop());
  const outputFilename = `${inputBasename}_${resolution}_${nanoid(8)}.${formatSettings.extension}`;
  const outputPath = join(outputDir, outputFilename);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Get input video duration for progress calculation
  const metadata = await getVideoMetadata(inputPath);
  const totalDuration = metadata.duration;

  return new Promise((resolve, reject) => {
    // Build FFmpeg arguments
    const args = [
      "-i", inputPath,                              // Input file
      "-c:v", formatSettings.videoCodec,            // Video codec
      "-c:a", formatSettings.audioCodec,            // Audio codec
      "-vf", `scale=${resSettings.width}:${resSettings.height}:force_original_aspect_ratio=decrease,pad=${resSettings.width}:${resSettings.height}:(ow-iw)/2:(oh-ih)/2`, // Scale and pad
      "-b:v", resSettings.videoBitrate,             // Video bitrate
      "-b:a", resSettings.audioBitrate,             // Audio bitrate
      ...formatSettings.extraArgs,                  // Format-specific options
      "-progress", "pipe:1",                        // Output progress to stdout
      "-y",                                         // Overwrite output file
      outputPath,                                   // Output file
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    // Parse progress output from FFmpeg
    ffmpeg.stdout.on("data", (data) => {
      const output = data.toString();
      
      // FFmpeg outputs progress as key=value pairs
      // We're looking for "out_time_ms" which is the current position
      const timeMatch = output.match(/out_time_ms=(\d+)/);
      if (timeMatch && onProgress && totalDuration > 0) {
        const currentMs = parseInt(timeMatch[1], 10) / 1000000; // Convert to seconds
        const percent = Math.min(100, Math.round((currentMs / totalDuration) * 100));
        onProgress(percent);
      }
    });

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        // Clean up partial output file on failure
        try {
          await unlink(outputPath);
        } catch {
          // Ignore cleanup errors
        }
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Get the size of the output file
        const stats = await stat(outputPath);
        
        resolve({
          outputPath,
          size: stats.size,
          duration: Date.now() - startTime,
        });
      } catch (error) {
        reject(new Error(`Failed to get output file stats: ${error}`));
      }
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });
  });
}

/**
 * Generate a thumbnail from a video
 * 
 * Creates a JPEG image from a specific point in the video.
 * By default, captures from 10% into the video to avoid black frames.
 * 
 * @param inputPath - Path to the video file
 * @param outputPath - Path to save the thumbnail
 * @param seekPercent - Where in the video to capture (0-100, default 10)
 * @returns Promise that resolves when thumbnail is created
 */
export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  seekPercent: number = 10
): Promise<void> {
  // Get video duration to calculate seek position
  const metadata = await getVideoMetadata(inputPath);
  const seekTime = (metadata.duration * seekPercent) / 100;

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const args = [
      "-ss", seekTime.toString(),  // Seek to position
      "-i", inputPath,             // Input file
      "-vframes", "1",             // Capture only 1 frame
      "-vf", "scale=320:-1",       // Scale to 320px width, maintain aspect ratio
      "-q:v", "2",                 // JPEG quality (2-31, lower is better)
      "-y",                        // Overwrite output
      outputPath,
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Thumbnail generation failed: ${stderr}`));
        return;
      }
      resolve();
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });
  });
}

/**
 * Check if a video needs transcoding for browser playback
 * 
 * Most browsers support:
 * - MP4 with H.264 video and AAC audio
 * - WebM with VP8/VP9 video and Vorbis/Opus audio
 * 
 * @param inputPath - Path to the video file
 * @returns Object indicating if transcoding is needed and why
 */
export async function needsTranscoding(inputPath: string): Promise<{
  needed: boolean;
  reason?: string;
  suggestedFormat: Format;
}> {
  try {
    const metadata = await getVideoMetadata(inputPath);
    
    // Check if video codec is browser-compatible
    const compatibleVideoCodecs = ["h264", "vp8", "vp9", "av1"];
    const compatibleAudioCodecs = ["aac", "mp3", "vorbis", "opus"];
    
    const videoCompatible = compatibleVideoCodecs.includes(
      metadata.videoCodec.toLowerCase()
    );
    const audioCompatible = compatibleAudioCodecs.includes(
      metadata.audioCodec.toLowerCase()
    );
    
    if (!videoCompatible) {
      return {
        needed: true,
        reason: `Video codec '${metadata.videoCodec}' is not browser-compatible`,
        suggestedFormat: "mp4",
      };
    }
    
    if (!audioCompatible) {
      return {
        needed: true,
        reason: `Audio codec '${metadata.audioCodec}' is not browser-compatible`,
        suggestedFormat: "mp4",
      };
    }
    
    // Check file extension for container compatibility
    const extension = inputPath.split(".").pop()?.toLowerCase();
    const compatibleContainers = ["mp4", "webm", "m4v", "mov"];
    
    if (extension && !compatibleContainers.includes(extension)) {
      return {
        needed: true,
        reason: `Container format '${extension}' may not be browser-compatible`,
        suggestedFormat: "mp4",
      };
    }
    
    return {
      needed: false,
      suggestedFormat: "mp4",
    };
  } catch (error) {
    // If we can't analyze the file, assume transcoding is needed
    return {
      needed: true,
      reason: `Could not analyze file: ${error}`,
      suggestedFormat: "mp4",
    };
  }
}

/**
 * Check if a WebP image is animated
 * 
 * Checks the file bytes directly for ANIM/ANMF chunks which indicate animation.
 * This is more reliable than FFprobe since FFmpeg's webp decoder has limited
 * support for animated WebP files.
 * 
 * WebP file structure:
 * - Bytes 0-3: "RIFF"
 * - Bytes 8-11: "WEBP"
 * - Extended format with animation contains "ANIM" and "ANMF" chunks
 * 
 * @param inputPath - Path to the WebP file
 * @returns true if animated, false if static
 */
export async function isAnimatedWebP(inputPath: string): Promise<boolean> {
  try {
    // Read the file
    const fileBuffer = await Bun.file(inputPath).arrayBuffer();
    const buffer = Buffer.from(fileBuffer);
    
    // Check for RIFF header
    if (buffer.length < 12) return false;
    const riff = buffer.slice(0, 4).toString('ascii');
    const webp = buffer.slice(8, 12).toString('ascii');
    
    if (riff !== 'RIFF' || webp !== 'WEBP') {
      console.log(`[Transcoder] Not a valid WebP file: ${inputPath}`);
      return false;
    }
    
    // Search for ANIM or ANMF chunks in the file
    // These chunks indicate an animated WebP
    const fileStr = buffer.toString('binary');
    const hasANIM = fileStr.includes('ANIM');
    const hasANMF = fileStr.includes('ANMF');
    
    const isAnimated = hasANIM || hasANMF;
    console.log(`[Transcoder] WebP animation check for ${inputPath}: ANIM=${hasANIM}, ANMF=${hasANMF}, isAnimated=${isAnimated}`);
    
    return isAnimated;
  } catch (error) {
    console.error(`[Transcoder] Error checking WebP animation: ${error}`);
    return false;
  }
}

/**
 * Result of a file conversion operation
 */
export interface ConversionResult {
  /** Path to the converted file */
  outputPath: string;
  /** Size of the converted file in bytes */
  size: number;
  /** New filename */
  filename: string;
  /** New extension (without dot) */
  extension: string;
  /** New MIME type */
  mimeType: string;
  /** Buffer containing the converted file data */
  buffer: Buffer;
}

/**
 * Convert a WebP image to PNG (for static images)
 * 
 * @param inputPath - Path to the WebP file
 * @returns Conversion result with PNG data
 */
export async function convertWebPToPng(inputPath: string): Promise<ConversionResult> {
  const inputBasename = basename(inputPath, ".webp");
  const outputFilename = `${inputBasename}.png`;
  const outputPath = join(dirname(inputPath), outputFilename);

  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-y",
      outputPath,
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`WebP to PNG conversion failed: ${stderr}`));
        return;
      }

      try {
        const stats = await stat(outputPath);
        const buffer = await Bun.file(outputPath).arrayBuffer();
        
        resolve({
          outputPath,
          size: stats.size,
          filename: outputFilename,
          extension: "png",
          mimeType: "image/png",
          buffer: Buffer.from(buffer),
        });
      } catch (error) {
        reject(new Error(`Failed to read converted PNG: ${error}`));
      }
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });
  });
}

/**
 * Convert a WebP image to GIF (for animated images)
 * 
 * Tries multiple approaches in order:
 * 1. ImageMagick's convert (best animated WebP support)
 * 2. FFmpeg with libwebp_anim demuxer
 * 3. FFmpeg standard approach
 * 
 * @param inputPath - Path to the animated WebP file
 * @returns Conversion result with GIF data
 */
export async function convertWebPToGif(inputPath: string): Promise<ConversionResult> {
  const inputBasename = basename(inputPath, ".webp");
  const outputFilename = `${inputBasename}.gif`;
  const outputPath = join(dirname(inputPath), outputFilename);

  // Try ImageMagick convert first (best animated WebP support)
  const tryImageMagick = (): Promise<ConversionResult> => {
    return new Promise((resolve, reject) => {
      // ImageMagick convert command for animated WebP to GIF
      const args = [
        inputPath,
        "-coalesce",  // Ensure proper frame handling
        outputPath,
      ];

      const convert = spawn("convert", args);
      let stderr = "";

      convert.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      convert.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`ImageMagick conversion failed: ${stderr}`));
          return;
        }

        try {
          const stats = await stat(outputPath);
          const buffer = await Bun.file(outputPath).arrayBuffer();
          
          resolve({
            outputPath,
            size: stats.size,
            filename: outputFilename,
            extension: "gif",
            mimeType: "image/gif",
            buffer: Buffer.from(buffer),
          });
        } catch (error) {
          reject(new Error(`Failed to read converted GIF: ${error}`));
        }
      });

      convert.on("error", (error) => {
        reject(new Error(`Failed to start ImageMagick: ${error.message}`));
      });
    });
  };

  // Try FFmpeg conversion
  const tryFFmpeg = (useLibwebpAnim: boolean): Promise<ConversionResult> => {
    return new Promise((resolve, reject) => {
      const args = useLibwebpAnim
        ? [
            "-f", "libwebp_anim",
            "-i", inputPath,
            "-vf", "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
            "-loop", "0",
            "-y",
            outputPath,
          ]
        : [
            "-i", inputPath,
            "-vf", "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
            "-loop", "0",
            "-y",
            outputPath,
          ];

      const ffmpeg = spawn("ffmpeg", args);
      let stderr = "";

      ffmpeg.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ffmpeg.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg conversion failed: ${stderr}`));
          return;
        }

        try {
          const stats = await stat(outputPath);
          const buffer = await Bun.file(outputPath).arrayBuffer();
          
          resolve({
            outputPath,
            size: stats.size,
            filename: outputFilename,
            extension: "gif",
            mimeType: "image/gif",
            buffer: Buffer.from(buffer),
          });
        } catch (error) {
          reject(new Error(`Failed to read converted GIF: ${error}`));
        }
      });

      ffmpeg.on("error", (error) => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });
    });
  };

  // Try methods in order of reliability for animated WebP
  
  // 1. Try ImageMagick (best support for animated WebP)
  try {
    console.log(`[Transcoder] Trying animated WebP conversion with ImageMagick...`);
    return await tryImageMagick();
  } catch (error) {
    console.log(`[Transcoder] ImageMagick failed: ${error}`);
  }

  // 2. Try FFmpeg with libwebp_anim demuxer
  try {
    console.log(`[Transcoder] Trying animated WebP conversion with FFmpeg libwebp_anim...`);
    return await tryFFmpeg(true);
  } catch (error) {
    console.log(`[Transcoder] FFmpeg libwebp_anim failed: ${error}`);
  }

  // 3. Try FFmpeg standard approach (last resort)
  console.log(`[Transcoder] Trying animated WebP conversion with FFmpeg standard...`);
  return await tryFFmpeg(false);
}

/**
 * Convert a WebM video to MP4
 * 
 * Uses H.264 video codec and AAC audio for maximum compatibility
 * 
 * @param inputPath - Path to the WebM file
 * @returns Conversion result with MP4 data
 */
export async function convertWebMToMp4(inputPath: string): Promise<ConversionResult> {
  const inputBasename = basename(inputPath, ".webm");
  const outputFilename = `${inputBasename}.mp4`;
  const outputPath = join(dirname(inputPath), outputFilename);

  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-preset", "medium",
      "-crf", "23",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`WebM to MP4 conversion failed: ${stderr}`));
        return;
      }

      try {
        const stats = await stat(outputPath);
        const buffer = await Bun.file(outputPath).arrayBuffer();
        
        resolve({
          outputPath,
          size: stats.size,
          filename: outputFilename,
          extension: "mp4",
          mimeType: "video/mp4",
          buffer: Buffer.from(buffer),
        });
      } catch (error) {
        reject(new Error(`Failed to read converted MP4: ${error}`));
      }
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });
  });
}

/**
 * Convert a WebP file to the appropriate format
 * Static WebP -> PNG, Animated WebP -> GIF
 * 
 * @param inputPath - Path to the WebP file
 * @returns Conversion result
 */
export async function convertWebP(inputPath: string): Promise<ConversionResult> {
  const isAnimated = await isAnimatedWebP(inputPath);
  
  if (isAnimated) {
    console.log(`[Transcoder] Converting animated WebP to GIF: ${inputPath}`);
    return convertWebPToGif(inputPath);
  } else {
    console.log(`[Transcoder] Converting static WebP to PNG: ${inputPath}`);
    return convertWebPToPng(inputPath);
  }
}
