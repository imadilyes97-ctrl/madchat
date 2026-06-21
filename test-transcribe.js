// Test script to verify the Groq + OpenAI audio transcription
// Usage: node test-transcribe.js
import { transcribeWithWhisper } from './llmService.js';

async function testTranscription() {
  console.log('=== Audio Transcription Test ===\n');

  // Test 1 : URL audio publique (Gettysburg Address en anglais)
  console.log('--- Test 1: Public audio URL (English) ---');
  const url1 = 'https://www2.cs.uic.edu/~i101/SoundFiles/gettysburg10.wav';
  console.time('Test 1');
  const result1 = await transcribeWithWhisper(url1);
  console.timeEnd('Test 1');
  console.log('Result:', result1);
  console.log('Status:', result1.startsWith('[') ? '❌ FAILED' : '✅ SUCCESS');
  console.log();

  // Test 2 : URL protégée simulée (avec headers navigateur)
  console.log('--- Test 2: Another public audio ---');
  const url2 = 'https://www.w3schools.com/html/horse.mp3';
  console.time('Test 2');
  const result2 = await transcribeWithWhisper(url2);
  console.timeEnd('Test 2');
  console.log('Result:', result2);
  console.log('Status:', result2.startsWith('[') ? '❌ FAILED' : '✅ SUCCESS');
  console.log();

  // Test 3 : URL invalide (pour tester le fallback)
  console.log('--- Test 3: Invalid URL (fallback test) ---');
  const url3 = 'https://invalid-domain-12345.com/audio.mp3';
  console.time('Test 3');
  const result3 = await transcribeWithWhisper(url3);
  console.timeEnd('Test 3');
  console.log('Result:', result3);
  console.log('Status:', result3.startsWith('[') ? '⚠️ EXPECTED FAILURE' : 'Unexpected success');
  console.log();

  console.log('=== Tests completed ===');
}

testTranscription().catch(console.error);
