import { OpenAI } from 'openai';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

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
 * Fallback text chat using Groq (used when OpenCode is down)
 */
export async function callGroqText(history, systemPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return "Désolée, le service de conversation n'est pas disponible pour le moment.";
  }

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
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
      console.warn("Invalid Groq response:", JSON.stringify(response.data));
      return "Désolée, je n'ai pas pu générer de réponse.";
    }

    return text;
  } catch (error) {
    console.error("Groq text error:", error.response?.data?.error?.message || error.message);
    return "Désolée, une erreur est survenue. Peux-tu reformuler ?";
  }
}

/**
 * 2. Analyse d'image via Groq (Llama 4 Scout - multimodal)
 * Convertit l'URL en base64 (Groq ne gère pas les redirects) puis envoie au modèle.
 */
export async function callGroqVision(imageUrl) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

  if (!apiKey) {
    return "";
  }

  try {
    let dataUrl = imageUrl;

    // Si l'URL n'est pas déjà un data URL, télécharger l'image et la convertir en base64
    if (!imageUrl.startsWith('data:')) {
      console.log(`[GroqVision] Downloading image from URL: ${imageUrl.substring(0, 80)}...`);
      const imgResp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000
      });
      const contentType = imgResp.headers['content-type'] || 'image/jpeg';
      const base64 = Buffer.from(imgResp.data).toString('base64');
      dataUrl = `data:${contentType};base64,${base64}`;
      console.log(`[GroqVision] Image downloaded, size: ${base64.length} bytes`);
    }

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: "Décris précisément ce que tu vois dans cette image en français. Si ce sont des vêtements, précise le type, la couleur, le style et tout détail pertinent. Si c'est un accessoire ou un autre produit, décris-le avec précision." },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ],
        temperature: 0.5,
        max_tokens: 300
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const text = response?.data?.choices?.[0]?.message?.content;
    if (!text) {
      console.warn("Invalid Groq vision response:", JSON.stringify(response.data));
      return "";
    }

    return text.trim();
  } catch (error) {
    const errDetail = error.response?.data || error.message;
    console.error("Groq vision error:", JSON.stringify(errDetail));
    return "";
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


