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

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1'
  });
}

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
 * 4a. Audio transcription using Groq Whisper (multilingual, fast, already configured)
 */
export async function transcribeWithGroq(audioUrl) {
  const groqClient = getGroqClient();
  if (!groqClient) {
    console.warn("Groq API Key not configured. Cannot transcribe audio.");
    return null;
  }

  let tmpFile = null;
  try {
    let audioBuffer, format;

    if (audioUrl.startsWith('data:')) {
      const matches = audioUrl.match(/^data:audio\/(\w+);base64,(.+)$/);
      if (!matches) throw new Error('Invalid audio data URL format');
      format = matches[1];
      audioBuffer = Buffer.from(matches[2], 'base64');
      console.log(`[GroqTranscribe] Data URL audio (format: ${format}, size: ${audioBuffer.length})`);
    } else {
      console.log(`[GroqTranscribe] Downloading audio from: ${audioUrl.substring(0, 100)}...`);
      const audioResponse = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'audio/*, */*',
          'Accept-Language': 'fr,fr-FR;q=0.9,en;q=0.8',
          'Referer': 'https://www.facebook.com/'
        }
      });
      audioBuffer = Buffer.from(audioResponse.data);
      format = detectAudioFormat(audioUrl, audioResponse.headers['content-type']);
      console.log(`[GroqTranscribe] Audio downloaded (${audioBuffer.length} bytes, format: ${format})`);
    }

    tmpFile = path.join(os.tmpdir(), `groq_audio_${Date.now()}.${format}`);
    fs.writeFileSync(tmpFile, audioBuffer);

    const result = await groqClient.audio.transcriptions.create({
      model: 'whisper-large-v3-turbo',
      file: fs.createReadStream(tmpFile),
      prompt: "Ce message vocal peut contenir un mélange de français et d'arabe algérien (darija), avec des chiffres et des noms de villes algériennes.",
    });

    try { fs.unlinkSync(tmpFile); } catch (_) {}

    const text = result.text?.trim();
    if (!text) {
      console.warn('[GroqTranscribe] Empty response');
      return null;
    }
    console.log(`[GroqTranscribe] ✅ "${text.substring(0, 120)}..."`);
    return text;
  } catch (error) {
    if (tmpFile && fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
    const errDetail = error.response?.data || error.message;
    console.error("[GroqTranscribe] Error:", JSON.stringify(errDetail));
    return null;
  }
}

/** Détecter le format audio depuis l'URL et le content-type */
function detectAudioFormat(url, contentType) {
  if (url) {
    if (url.includes('.wav')) return 'wav';
    if (url.includes('.ogg')) return 'ogg';
    if (url.includes('.m4a')) return 'm4a';
    if (url.includes('.webm')) return 'webm';
    if (url.includes('.mp4')) return 'm4a';
    if (url.includes('.oga')) return 'ogg';
    if (url.includes('.opus')) return 'ogg';
  }
  if (contentType) {
    if (contentType.includes('wav') || contentType.includes('wave')) return 'wav';
    if (contentType.includes('ogg') || contentType.includes('opus')) return 'ogg';
    if (contentType.includes('m4a') || contentType.includes('mp4')) return 'm4a';
    if (contentType.includes('webm')) return 'webm';
  }
  return 'mp3';
}

/**
 * 4b. Télécharger un fichier audio depuis une URL (avec retry et headers navigateur)
 */
async function downloadAudio(url) {
  const attempts = [
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Accept': 'audio/*,*/*', 'Referer': 'https://www.facebook.com/' } },
    { headers: { 'User-Agent': 'curl/8.0', 'Accept': '*/*' } },
    {}
  ];
  for (let i = 0; i < attempts.length; i++) {
    try {
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000, headers: attempts[i].headers });
      if (resp.data?.length > 100) return { buffer: Buffer.from(resp.data), contentType: resp.headers['content-type'] };
      console.warn(`[Download] Attempt ${i + 1} returned only ${resp.data?.length} bytes`);
    } catch (e) {
      console.warn(`[Download] Attempt ${i + 1} failed: ${e.message}`);
    }
  }
  return null;
}

/**
 * 4c. Transcribe audio with fallbacks: try local file path → OpenAI → Groq
 */
export async function transcribeWithWhisper(audioUrl) {
  if (!audioUrl || typeof audioUrl !== 'string') {
    console.error("[Whisper] Invalid audio URL:", audioUrl);
    return "[Transcription audio échouée]";
  }

  // Helper: envoyer un fichier à Whisper (OpenAI ou Groq)
  async function transcribeFile(filePath, model, client, label) {
    try {
      const result = await client.audio.transcriptions.create({
        model,
        file: fs.createReadStream(filePath),
        // Pas de language: 'fr' fixe → Whisper auto-détecte la langue
        // Ça permet de transcrire correctement l'arabe algérien (darija)
        prompt: "Ce message vocal peut contenir un mélange de français et d'arabe algérien (darija), avec des chiffres et des noms de produits.",
      });
      return result.text?.trim() || null;
    } catch (err) {
      console.warn(`[Whisper/${label}] API error:`, err.message);
      return null;
    }
  }

  // Étape 1 : Vérifier si c'est déjà un chemin fichier local
  if (fs.existsSync(audioUrl)) {
    console.log(`[Whisper] Local file detected: ${audioUrl}`);
    if (openaiClient) {
      const t = await transcribeFile(audioUrl, 'whisper-1', openaiClient, 'OpenAI/local');
      if (t) { console.log(`[Whisper] ✅ Local file transcribed via OpenAI: "${t.substring(0, 120)}"`); return t; }
    }
    const groq = getGroqClient();
    if (groq) {
      const t = await transcribeFile(audioUrl, 'whisper-large-v3-turbo', groq, 'Groq/local');
      if (t) { console.log(`[Whisper] ✅ Local file transcribed via Groq: "${t.substring(0, 120)}"`); return t; }
    }
    return "[Transcription audio échouée]";
  }

  // Étape 2 : Télécharger l'audio depuis l'URL
  console.log(`[Whisper] Downloading audio from: ${audioUrl.substring(0, 120)}...`);
  const download = await downloadAudio(audioUrl);
  if (!download) {
    console.error("[Whisper] All download attempts failed");
    return "[Transcription audio échouée]";
  }

  const format = detectAudioFormat(audioUrl, download.contentType);
  const tmpFile = path.join(os.tmpdir(), `audio_${Date.now()}.${format}`);
  fs.writeFileSync(tmpFile, download.buffer);
  console.log(`[Whisper] Downloaded ${download.buffer.length} bytes (format: ${format})`);

  try {
    // Essai A : OpenAI Whisper
    if (openaiClient) {
      const t = await transcribeFile(tmpFile, 'whisper-1', openaiClient, 'OpenAI');
      if (t) { try { fs.unlinkSync(tmpFile); } catch (_) {} console.log(`[Whisper] ✅ OpenAI: "${t.substring(0, 120)}"`); return t; }
    }

    // Essai B : Groq Whisper (déjà configuré, plus rapide)
    const groq = getGroqClient();
    if (groq) {
      const t = await transcribeFile(tmpFile, 'whisper-large-v3-turbo', groq, 'Groq');
      if (t) { try { fs.unlinkSync(tmpFile); } catch (_) {} console.log(`[Whisper] ✅ Groq fallback: "${t.substring(0, 120)}"`); return t; }
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }

  console.error("[Whisper] All transcription services failed");
  return "[Transcription audio échouée]";
}


