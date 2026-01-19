/**
 * Shared transcoding state manager to prevent race conditions
 * and coordinate progress across multiple endpoints
 */

interface TranscodeProgress {
  percent: number;
  eta?: string;
  message: string;
}

interface TranscodeState {
  mediaId: string;
  resolution: string;
  format: string;
  status: 'pending' | 'starting' | 'transcoding' | 'complete' | 'error';
  progress?: TranscodeProgress;
  outputPath?: string;
  error?: string;
  startTime: number;
  completeTime?: number;
  subscribers: Set<(event: string, data: any) => void>;
}

class TranscodeManager {
  private activeTranscodes = new Map<string, TranscodeState>();
  
  /**
   * Generate a unique key for a transcode job
   */
  private getTranscodeKey(mediaId: string, resolution: string, format: string): string {
    return `${mediaId}_${resolution}_${format}`;
  }
  
  /**
   * Check if a transcode is already in progress (actively transcoding)
   */
  isTranscoding(mediaId: string, resolution: string, format: string): boolean {
    const key = this.getTranscodeKey(mediaId, resolution, format);
    const state = this.activeTranscodes.get(key);
    // Only return true if actively transcoding, not just pending/starting
    return state ? (state.status === 'starting' || state.status === 'transcoding') : false;
  }
  
  /**
   * Get the current state of a transcode job
   */
  getTranscodeState(mediaId: string, resolution: string, format: string): TranscodeState | null {
    const key = this.getTranscodeKey(mediaId, resolution, format);
    return this.activeTranscodes.get(key) || null;
  }
  
  /**
   * Subscribe to progress events for a transcode job
   */
  subscribe(mediaId: string, resolution: string, format: string, callback: (event: string, data: any) => void): () => void {
    const key = this.getTranscodeKey(mediaId, resolution, format);
    let state = this.activeTranscodes.get(key);
    
    if (!state) {
      // Create new state if doesn't exist - use 'pending' status so isTranscoding() returns false
      state = {
        mediaId,
        resolution,
        format,
        status: 'pending' as const,
        startTime: Date.now(),
        subscribers: new Set(),
      };
      this.activeTranscodes.set(key, state);
    }
    
    // Add subscriber
    state.subscribers.add(callback);
    
    // Send current state immediately
    if (state.status === 'complete' && state.outputPath) {
      callback('complete', { path: state.outputPath });
    } else if (state.status === 'error' && state.error) {
      callback('error', { message: state.error });
    } else if (state.progress) {
      callback('progress', state.progress);
    }
    
    // Return unsubscribe function
    return () => {
      const currentState = this.activeTranscodes.get(key);
      if (currentState) {
        currentState.subscribers.delete(callback);
        // Clean up if no subscribers and not active
        if (currentState.subscribers.size === 0 && 
            (currentState.status === 'complete' || currentState.status === 'error' || currentState.status === 'pending')) {
          this.activeTranscodes.delete(key);
        }
      }
    };
  }
  
  /**
   * Start or continue a transcode job with progress tracking
   */
  async startTranscode(
    mediaId: string,
    resolution: string,
    format: string,
    transcodeFn: (onProgress: (percent: number) => void) => Promise<any>
  ): Promise<any> {
    const key = this.getTranscodeKey(mediaId, resolution, format);
    let state = this.activeTranscodes.get(key);
    
    if (!state) {
      state = {
        mediaId,
        resolution,
        format,
        status: 'starting',
        startTime: Date.now(),
        subscribers: new Set(),
      };
      this.activeTranscodes.set(key, state);
    }
    
    // If already complete, return cached result
    if (state.status === 'complete' && state.outputPath) {
      return { outputPath: state.outputPath };
    }
    
    // If already transcoding, wait for completion
    if (state.status === 'transcoding') {
      return new Promise((resolve, reject) => {
        const unsubscribe = this.subscribe(mediaId, resolution, format, (event, data) => {
          if (event === 'complete') {
            unsubscribe();
            // Convert 'path' to 'outputPath' for consistency with TranscodeResult interface
            resolve({
              outputPath: data.path,
              size: data.size,
              duration: data.duration,
            });
          } else if (event === 'error') {
            unsubscribe();
            reject(new Error(data.message));
          }
        });
      });
    }
    
    // Start transcoding
    state.status = 'transcoding';
    this.broadcast(key, 'status', { message: `Starting transcoding to ${resolution} ${format}...` });
    
    try {
      const result = await transcodeFn((percent) => {
        const eta = percent > 0 ? Math.round((100 - percent) / percent * 5) : null;
        const progress: TranscodeProgress = {
          percent: Math.min(99, percent),
          eta: eta ? `${eta}s` : undefined,
          message: `Transcoding... ${Math.round(percent)}%`,
        };
        
        state!.progress = progress;
        this.broadcast(key, 'progress', progress);
      });
      
      // Mark as complete
      state.status = 'complete';
      state.completeTime = Date.now();
      state.outputPath = result.outputPath;

      console.log(`TranscodeManager: Broadcasting complete event with path: ${result.outputPath}`);

      this.broadcast(key, 'complete', {
        path: result.outputPath,
        size: result.size,
        duration: result.duration,
      });
      
      return result;
    } catch (error) {
      // Mark as error
      state.status = 'error';
      state.error = error instanceof Error ? error.message : 'Unknown error';
      
      this.broadcast(key, 'error', { message: state.error });
      throw error;
    }
  }
  
  /**
   * Broadcast event to all subscribers
   */
  private broadcast(key: string, event: string, data: any): void {
    const state = this.activeTranscodes.get(key);
    if (state) {
      // Update state with complete data first
      if (event === 'complete') {
        state.outputPath = data.path;
        state.completeTime = Date.now();
      } else if (event === 'progress') {
        state.progress = data;
      } else if (event === 'error') {
        state.error = data.message;
      }

      // Use process.nextTick to ensure events are sent asynchronously
      process.nextTick(() => {
        const currentState = this.activeTranscodes.get(key);
        if (currentState && currentState.subscribers.size > 0) {
          // Create a copy of subscribers to iterate over (in case any get removed during iteration)
          const subscribers = Array.from(currentState.subscribers);
          for (const callback of subscribers) {
            // Check if subscriber is still in the set (might have been removed)
            if (!currentState.subscribers.has(callback)) continue;
            try {
              callback(event, data);
            } catch (err) {
              // Silently remove failed subscribers - they're likely closed connections
              currentState.subscribers.delete(callback);
            }
          }
        }
      });
    }
  }
  
  /**
   * Clean up old completed transcodes (older than 1 hour)
   */
  cleanup(): void {
    const oneHour = 60 * 60 * 1000;
    const now = Date.now();
    
    for (const [key, state] of this.activeTranscodes.entries()) {
      if ((state.status === 'complete' || state.status === 'error') && 
          state.completeTime && 
          (now - state.completeTime) > oneHour) {
        this.activeTranscodes.delete(key);
      }
    }
  }
}

// Export singleton instance
export const transcodeManager = new TranscodeManager();

// Auto-cleanup every 30 minutes
setInterval(() => {
  transcodeManager.cleanup();
}, 30 * 60 * 1000);