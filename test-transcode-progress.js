#!/usr/bin/env node

/**
 * Test script to verify transcoding progress fix
 */

const mediaId = 'j57cznq4kmv72csma3had747917zd6x6';
let quality = '720p';
const format = 'mp4';

console.log('Testing transcoding progress fix...');
console.log(`Media ID: ${mediaId}`);
console.log(`Quality: ${quality}`);
console.log(`Format: ${format}`);

// Test 1: Check if video needs transcoding
async function testStreamInfo() {
  console.log('\n=== Test 1: Stream Info ===');
  try {
    const response = await fetch(`http://localhost:3000/api/stream/${mediaId}/info`);
    const data = await response.json();
    console.log('Needs transcoding:', data.data?.needsTranscoding);
    console.log('Available qualities:', data.data?.availableQualities);
    return data.data?.needsTranscoding;
  } catch (error) {
    console.error('Error getting stream info:', error.message);
    return false;
  }
}

// Test 2: Test SSE progress endpoint
async function testProgressEndpoint() {
  console.log('\n=== Test 2: SSE Progress Endpoint ===');
  return new Promise((resolve) => {
    const eventSource = new EventSource(
      `http://localhost:3000/api/stream/${mediaId}/transcode-progress?quality=${quality}&format=${format}`
    );
    
    let eventCount = 0;
    const maxEvents = 10;
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`Event ${++eventCount}:`, data.event, data.percent || '', data.message || '');
        
        if (data.event === 'complete') {
          console.log('✅ Transcoding completed successfully!');
          eventSource.close();
          resolve(true);
        } else if (data.event === 'error') {
          console.log('❌ Transcoding failed:', data.message);
          eventSource.close();
          resolve(false);
        } else if (eventCount >= maxEvents) {
          console.log('⚠️  Received enough events, closing connection');
          eventSource.close();
          resolve(true);
        }
      } catch (err) {
        console.error('Error parsing event:', err);
      }
    };
    
    eventSource.onerror = (error) => {
      console.log('❌ SSE connection error:', error);
      eventSource.close();
      resolve(false);
    };
    
    // Timeout after 30 seconds
    setTimeout(() => {
      console.log('⏰ Test timeout, closing connection');
      eventSource.close();
      resolve(false);
    }, 30000);
  });
}

// Test 3: Test direct stream endpoint (should not interfere with progress)
async function testDirectStream() {
  console.log('\n=== Test 3: Direct Stream Endpoint ===');
  try {
    const response = await fetch(
      `http://localhost:3000/api/stream/${mediaId}?quality=${quality}&format=${format}`
    );
    
    if (response.status === 206) {
      console.log('✅ Direct stream working (partial content)');
      return true;
    } else if (response.status === 200) {
      console.log('✅ Direct stream working (full content)');
      return true;
    } else {
      console.log('⚠️  Direct stream status:', response.status);
      return false;
    }
  } catch (error) {
    console.error('Error testing direct stream:', error.message);
    return false;
  }
}

// Run tests
async function runTests() {
  const needsTranscoding = await testStreamInfo();
  
  if (!needsTranscoding) {
    console.log('Video does not need transcoding, testing with different quality...');
    // Test with a different quality that might need transcoding
    quality = '480p';
  }
  
  const progressWorks = await testProgressEndpoint();
  const streamWorks = await testDirectStream();
  
  console.log('\n=== Test Results ===');
  console.log('Progress endpoint:', progressWorks ? '✅ PASS' : '❌ FAIL');
  console.log('Direct stream:', streamWorks ? '✅ PASS' : '❌ FAIL');
  
  if (progressWorks && streamWorks) {
    console.log('\n🎉 All tests passed! The transcoding progress fix is working.');
  } else {
    console.log('\n⚠️  Some tests failed. The fix may need further refinement.');
  }
  
  process.exit(progressWorks && streamWorks ? 0 : 1);
}

runTests().catch(console.error);