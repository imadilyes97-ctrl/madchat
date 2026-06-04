import { OpenAI } from 'openai';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Helpers to check if keys are configured
function isGoogleAIConfigured() {
  return process.env.GOOGLE_AI_API_KEY && !process.env.GOOGLE_AI_API_KEY.includes('your_');
}

const GOOGLE_API_KEY = process.env.GOOGLE_AI_API_KEY;
const GOOGLE_MODEL = process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash';
const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Convert OpenAI-format history to Gemini-format contents
function toGeminiContents(history) {
  return history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : msg.role === 'system' ? 'user' : msg.role,
    parts: [{ text: String(msg.content) }]
  }));
}

function isOpenAIConfigured() {
  return process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your_');
}

const openaiClient = isOpenAIConfigured()
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

/**
 * 1. Text chat using DeepSeek via OpenCode API (direct axios)
 */
export async function callDeepSeek(history, systemPrompt) {
  const apiKey = process.env.OPENCODE_API_KEY;
  const baseURL = (process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
  const model = process.env.OPENCODE_MODEL || 'deepseek-v4-flash-free';

  if (!apiKey || apiKey.includes('your_')) {
    return "Désolée, le service de conversation n'est pas disponible pour le moment.";
  }

  try {
    const response = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history
        ],
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const text = response?.data?.choices?.[0]?.message?.content;
    if (!text) {
      console.warn("OpenCode invalid response:", JSON.stringify(response.data));
      return "Désolée, je n'ai pas pu générer de réponse.";
    }

    return text;
  } catch (error) {
    const errDetail = error.response?.data || error.message;
    console.error("OpenCode API error:", JSON.stringify(errDetail));
    return "Désolée, une erreur est survenue. Peux-tu reformuler ?";
  }
}

/**
 * Fallback text chat using Gemini (used when OpenCode is down)
 */
export async function callGeminiText(history, systemPrompt) {
  if (!isGoogleAIConfigured()) {
    return "Désolée, le service de conversation n'est pas disponible pour le moment.";
  }

  try {
    const contents = toGeminiContents(history);
    const body = {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.7 }
    };

    const response = await axios.post(
      `${GOOGLE_BASE_URL}/${GOOGLE_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
      body,
      { headers: { 'Content-Type': 'application/json' } }
    );

    const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn("Invalid Gemini response:", JSON.stringify(response.data));
      return "Désolée, je n'ai pas pu générer de réponse.";
    }

    return text;
  } catch (error) {
    console.error("Gemini text error:", error.response?.data?.error?.message || error.message);
    return "Désolée, une erreur est survenue. Peux-tu reformuler ?";
  }
}

/**
 * 2. Full conversation with image using Gemini (native API)
 */
export async function callGeminiWithImage(history, systemPrompt, imageUrl) {
  if (!isGoogleAIConfigured()) {
    return "Désolée, l'analyse d'image n'est pas disponible pour le moment.";
  }

  try {
    const contents = toGeminiContents(history);

    // Parse the image data URL
    const imgMatches = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!imgMatches) {
      throw new Error('Invalid image data URL');
    }
    const mimeType = imgMatches[1];
    const base64Data = imgMatches[2];

    // Add the image message
    contents.push({
      role: 'user',
      parts: [
        { text: "L'utilisateur a envoyé cette photo. Analyse-la et réponds en tant que Yasmine, conseillère commerciale." },
        { inline_data: { mime_type: mimeType, data: base64Data } }
      ]
    });

    const body = {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.7 }
    };

    const response = await axios.post(
      `${GOOGLE_BASE_URL}/${GOOGLE_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
      body,
      { headers: { 'Content-Type': 'application/json' } }
    );

    const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn("Invalid Gemini image response:", JSON.stringify(response.data));
      return "Désolée, je n'ai pas pu analyser l'image.";
    }

    return text;
  } catch (error) {
    console.error("Gemini image error:", error.response?.data?.error?.message || error.message);
    return "Désolée, je n'ai pas pu analyser l'image pour le moment.";
  }
}

/**
 * 4. Audio transcription using OpenAI Whisper
 */
export async function transcribeWithWhisper(audioUrl) {
  if (!isOpenAIConfigured()) {
    console.warn("OpenAI API Key not configured. Cannot transcribe audio.");
    return "[Transcription audio non disponible]";
  }

  try {
    let base64Audio, format, mimeType;
    let tmpFile = null;

    if (audioUrl.startsWith('data:')) {
      const matches = audioUrl.match(/^data:audio\/(\w+);base64,(.+)$/);
      if (matches) {
        format = matches[1];
        base64Audio = matches[2];
        mimeType = `audio/${format}`;
      } else {
        throw new Error('Invalid audio data URL format');
      }
      console.log(`Received audio data URL (format: ${format}, length: ${base64Audio.length})`);
    } else {
      console.log(`Downloading audio from: ${audioUrl}`);
      const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(audioResponse.data);
      base64Audio = buffer.toString('base64');
      format = 'mp3';
      if (audioUrl.includes('.wav')) format = 'wav';
      if (audioUrl.includes('.ogg')) format = 'ogg';
      if (audioUrl.includes('.m4a')) format = 'm4a';
      mimeType = `audio/${format}`;
    }

    const audioBuffer = Buffer.from(base64Audio, 'base64');
    tmpFile = path.join(os.tmpdir(), `audio_${Date.now()}.${format}`);
    fs.writeFileSync(tmpFile, audioBuffer);

    const result = await openaiClient.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(tmpFile),
      language: 'fr',
    });

    fs.unlinkSync(tmpFile);

    const text = result.text.trim();
    console.log(`Successfully transcribed audio with Whisper: "${text}"`);
    return text;
  } catch (error) {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    console.error("Error transcribing with Whisper:", error.message || error);
    return "[Transcription audio échouée]";
  }
}


