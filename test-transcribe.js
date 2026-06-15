// Test script to verify the transcription endpoint works locally
import axios from 'axios';

async function testTranscribeEndpoint() {
  try {
    console.log('Testing local transcription endpoint...');

    // Test with a sample audio file (you can replace this with a real audio URL)
    const testAudioUrl = 'https://www2.cs.uic.edu/~i101/SoundFiles/gettysburg10.wav';

    const response = await axios.post('http://localhost:3000/api/transcribe', {
      token: 'dd305b2138a5b5e6705e5bf375da7e13bdc026902a7d47e8dd437f09ab4ab1a6',
      audioUrl: testAudioUrl
    });

    console.log('✅ Transcription successful!');
    console.log('Response:', response.data);

  } catch (error) {
    console.error('❌ Transcription failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Start the test after a short delay to allow server to start
testTranscribeEndpoint().catch(console.error);