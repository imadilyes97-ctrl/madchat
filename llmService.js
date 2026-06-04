import { OpenAI } from 'openai';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Load the catalog for references
const CATALOG_PATH = path.join(process.cwd(), 'catalog.json');
let catalog = [];
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
} catch (e) {
  console.error("Failed to load catalog in llmService:", e.message);
}

// Helpers to check if keys are configured
function isOpenCodeConfigured() {
  return process.env.OPENCODE_API_KEY && !process.env.OPENCODE_API_KEY.includes('your_');
}

function isGoogleAIConfigured() {
  return process.env.GOOGLE_AI_API_KEY && !process.env.GOOGLE_AI_API_KEY.includes('your_');
}

// Initialize Clients
const openCodeClient = isOpenCodeConfigured()
  ? new OpenAI({
      apiKey: process.env.OPENCODE_API_KEY,
      baseURL: process.env.OPENCODE_BASE_URL || 'https://api.opencode.ai/v1',
    })
  : null;

const googleAIClient = isGoogleAIConfigured()
  ? new OpenAI({
      apiKey: process.env.GOOGLE_AI_API_KEY,
      baseURL: process.env.GOOGLE_AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
    })
  : null;

/**
 * 1. Text chat using DeepSeek via OpenCode Zen
 */
export async function callDeepSeek(history, systemPrompt) {
  const modelName = process.env.OPENCODE_MODEL || 'opencode/zen:deepseek v4 flash free';
  
  if (!isOpenCodeConfigured()) {
    console.warn("⚠️ OpenCode API Key not configured. Returning fallback mock response.");
    return getFallbackTextResponse(history);
  }

  try {
    const response = await openCodeClient.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history
      ],
      temperature: 0.7,
    });

    // Validate response structure before accessing
    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      console.warn("⚠️ OpenCode API returned an invalid/unexpected response. Falling back to mock.", JSON.stringify(response));
      return getFallbackTextResponse(history);
    }

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error calling OpenCode Zen (DeepSeek):", error.message || error);
    console.warn("⚠️ Falling back to mock response due to API error.");
    return getFallbackTextResponse(history);
  }
}

/**
 * 2. Image understanding using Gemini 2.0 Flash via Google AI Studio
 * It downloads the image, matches it to the catalog, and generates a descriptive system message.
 */
export async function callGeminiMultimodal(imageUrl) {
  const modelName = process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash';

  if (!isGoogleAIConfigured()) {
    console.warn("⚠️ Google AI Studio API Key not configured. Returning mock image analysis.");
    return "L'utilisateur a envoyé une image (Mock: Robe d'été Casual de couleur Rose).";
  }

  try {
    // Send request to Gemini 2.0 Flash via Google AI Studio
    const response = await googleAIClient.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Tu es un assistant visuel pour Yasmine, notre conseillère commerciale. 
Analyse cette image et identifie si le produit correspond à un article du catalogue ci-dessous.
Si oui, identifie sa couleur, sa coupe et son prix.
Si non, décris brièvement l'article (ex. "une robe de soirée noire satinée") pour que Yasmine puisse proposer une alternative.

Catalogue de produits :
${JSON.stringify(catalog, null, 2)}

Réponds UNIQUEMENT sous la forme d'une courte phrase de description système à insérer dans le chat historique.
Exemple de réponse attendue : "L'utilisateur a envoyé une photo de : Robe d'été Casual de couleur Bleue. Elle est disponible en stock à 4500 DZD."
Ou : "L'utilisateur a envoyé une photo de : Une robe de soirée rouge pailletée (Non disponible en stock)."
`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ]
    });

    // Validate response structure
    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      console.warn("⚠️ Google AI Studio returned an invalid response for image analysis. Falling back to mock.");
      return "L'utilisateur a envoyé une image (Mock: Robe d'été Casual de couleur Rose).";
    }

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error calling Gemini Multimodal (Google AI Studio):", error.message || error);
    console.warn("⚠️ Falling back to mock image analysis.");
    return "L'utilisateur a envoyé une image (Mock: Robe d'été Casual de couleur Rose).";
  }
}

/**
 * 3. Voice transcription using Gemini 2.0 Flash via Google AI Studio
 * Downloads the audio and sends it as base64.
 */
export async function transcribeAudioWithGemini(audioUrl) {
  const modelName = process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash';

  if (!isGoogleAIConfigured()) {
    console.warn("⚠️ Google AI Studio API Key not configured. Returning mock transcription.");
    return "bghit ncommandi ljean slim ftil size 40";
  }

  try {
    let base64Audio, format;

    if (audioUrl.startsWith('data:')) {
      // Handle data URL (base64 from browser recording/upload)
      const matches = audioUrl.match(/^data:audio\/(\w+);base64,(.+)$/);
      if (matches) {
        format = matches[1];
        base64Audio = matches[2];
      } else {
        throw new Error('Invalid audio data URL format');
      }
      console.log(`Received audio data URL (format: ${format}, length: ${base64Audio.length})`);
    } else {
      // Download from remote URL
      console.log(`Downloading audio from: ${audioUrl}`);
      const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(audioResponse.data);
      base64Audio = buffer.toString('base64');

      format = 'mp3';
      if (audioUrl.includes('.wav')) format = 'wav';
      if (audioUrl.includes('.ogg')) format = 'ogg';
      if (audioUrl.includes('.m4a')) format = 'm4a';
    }

    const response = await googleAIClient.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Transcris ce message vocal en texte mot à mot, sans ajouter AUCUN commentaire ou phrase d'introduction. 
Si la langue est un mélange de français et d'arabe algérien/marocain/tunisien (Darija), transcris exactement ce qui est prononcé, y compris les mots en darija écrits en caractères latins (ex: "chhal thaman", "bghit ncommandi", "salam", "wach 3andkom") ou arabes.
Ta réponse doit uniquement contenir la transcription brute.`
            },
            {
              type: 'input_audio',
              input_audio: {
                data: base64Audio,
                format: format
              }
            }
          ]
        }
      ]
    });

    // Validate response structure
    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      console.warn("⚠️ Google AI Studio returned an invalid response for audio transcription. Falling back to mock.");
      return "bghit ncommandi ljean slim ftil size 40";
    }

    const transcription = response.choices[0].message.content.trim();
    console.log(`Successfully transcribed audio: "${transcription}"`);
    return transcription;
  } catch (error) {
    console.error("Error transcribing audio with Gemini (Google AI Studio):", error.message || error);
    console.warn("⚠️ Falling back to mock transcription.");
    return "bghit ncommandi ljean slim ftil size 40";
  }
}

/**
 * Mock fallbacks for testing the code flow when API keys are not supplied.
 */
function getFallbackTextResponse(history) {
  const lastMessage = history[history.length - 1].content.toLowerCase();
  
  if (lastMessage.includes('salam') || lastMessage.includes('bonjour') || lastMessage.includes('hello')) {
    return "Bonjour ! 😊 Je suis Yasmine, ravie de vous accueillir ! Comment puis-je vous aider aujourd'hui ? مرحبا بيك، كيفاش نقدر نعاونك اليوم؟";
  }
  if (lastMessage.includes('jean') || lastMessage.includes('سروال')) {
    return "Parfait ! 🌸 On a notre Jean Slim Fit en stock à 3800 DZD. Il est super confortable et disponible en Bleu brut ou Noir. Est-ce que tu aimerais le commander ?";
  }
  if (lastMessage.includes('commandi') || lastMessage.includes('commander') || lastMessage.includes('prendre')) {
    return "Super choix ! 🎉 Pour préparer ta commande, j'ai besoin de quelques infos. D'abord, c'est à quel nom ?";
  }
  if (history.some(m => m.content.includes("c'est à quel nom")) && !history.some(m => m.content.includes("téléphone"))) {
    return "Merci ! 😊 Et quel est ton numéro de téléphone pour la livraison ?";
  }
  if (history.some(m => m.content.includes("téléphone")) && !history.some(m => m.content.includes("Wilaya"))) {
    return "Parfait ! Et tu habites dans quelle Wilaya et Commune ?";
  }
  if (history.some(m => m.content.includes("Wilaya")) && !history.some(m => m.content.includes("récapitulatif"))) {
    return "Super ! Voici le récapitulatif de ta commande :\n- Produit : Jean Slim Fit (Taille 40)\n- Prix : 3800 DZD\n- Destinataire : Client Test\n- Téléphone : 0555123456\n- Livraison : Alger Centre (Wilaya Alger)\n\nEst-ce que tout est correct pour toi ? (Dis oui ou صح/وايه pour valider)";
  }
  if (lastMessage.includes('oui') || lastMessage.includes('صح') || lastMessage.includes('واه') || lastMessage.includes('correct')) {
    return `\`\`\`json
{
  "event": "nouvelle_commande",
  "timestamp": "${new Date().toISOString()}",
  "client": {
    "nom": "Client Test",
    "telephone": "0555123456",
    "commune": "Alger Centre",
    "wilaya": "Alger",
    "langue": "fr"
  },
  "commande": {
    "produits": [
      {
        "nom_produit": "Jean Slim Fit",
        "quantite": 1,
        "prix_unitaire": 3800,
        "sous_total": 3800
      }
    ],
    "total": 3800,
    "devise": "DZD",
    "statut": "en_attente"
  },
  "meta": {
    "canal": "chatbot",
    "agent": "Yasmine",
    "version": "1.0"
  }
}
\`\`\`
Merci infiniment pour ta confiance ! 🙏✨ Ta commande est bien enregistrée et notre équipe va la préparer avec soin. Tu seras contacté(e) très bientôt pour la livraison. 😊❤️`;
  }
  
  return "Je suis là pour t'aider à choisir le produit idéal ! Dis-moi ce que tu cherches. 😊";
}
