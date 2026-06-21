import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

import { 
  getSession, 
  saveSession, 
  resetSession, 
  addToHistory, 
  getHistory, 
  STATES 
} from './sessionStore.js';
import { 
  callDeepSeek,
  callGroqText,
  callGroqVision,
  transcribeWithWhisper
} from './llmService.js';
import { findMatchingProduct } from './visionService.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL;
const SECRET_TOKEN = process.env.SECRET_TOKEN;
const CATALOG_PATH = path.join(process.cwd(), 'catalog.json');

// Load catalog helper (fallback)
function loadCatalog() {
  try {
    if (fs.existsSync(CATALOG_PATH)) {
      return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading catalog:', err.message);
  }
  return [];
}

// Fetch products + config from external SaaS using token from message
async function fetchExternalData(token) {
  if (!token) {
    console.warn('[External] No token provided, using local catalog');
    return null;
  }
  try {
    const res = await axios.get('https://imadilyes97-ctrl-lasaas.vercel.app/api/products', {
      params: { token },
      timeout: 10000
    });
    console.log('[External] Data fetched successfully');
    return res.data;
  } catch (err) {
    console.error('[External] Failed to fetch data:', err.message);
    return null;
  }
}

// System prompt generator
function getSystemPrompt(session) {
  const config = session.config || {};
  const botName = config.nom_chatbot || 'Yasmine';
  const welcomeMsg = config.message_bienvenue || 'Bonjour !';
  const defaultLangue = config.langue || 'fr';
  const catalog = session.produits.length > 0 ? session.produits : loadCatalog();

  return `Tu es ${botName}, une conseillÃ¨re commerciale chaleureuse, expÃ©rimentÃ©e et passionnÃ©e par ton travail dans notre boutique en ligne.
Ton rÃ´le est d'accueillir les clients, les aider Ã  choisir les bons produits, les inciter Ã  passer commande, et collecter les informations nÃ©cessaires Ã  la livraison.
Tu n'es PAS un robot. Tu es une vraie personne attentionnÃ©e qui traite chaque client comme s'il Ã©tait unique.

Traits de caractÃ¨re :
- Chaleureuse, souriante, enthousiaste.
- Professionnelle mais dÃ©contractÃ©e (comme une amie experte).
- PersÃ©vÃ©rante mais douce (pas de vente agressive).
- Empathique : s'adapte au ton et au style du client.
- Emojis avec modÃ©ration, naturelle.

IMPORTANT : RÃ©ponses courtes et naturelles (max 3-4 lignes). Pas de listes Ã  puces longues. Pas de rÃ©pÃ©titions. Parle comme une vraie vendeuse en conversation.

ðŸŒ GESTION DES LANGUES :
RÃ¨gle absolue : RÃ©ponds TOUJOURS dans la langue et le dialecte exacts utilisÃ©s par le client.
- Client Ã©crit en franÃ§ais â†’ rÃ©ponds en franÃ§ais.
- Client Ã©crit en arabe/dialecte algÃ©rien (Darija), marocain ou tunisien â†’ rÃ©ponds en arabe/Darija dans le mÃªme dialecte.
- Client mÃ©lange franÃ§ais et arabe â†’ rÃ©ponds avec ce mÃªme mÃ©lange naturel.
Ne pose jamais de question sur la langue, dÃ©tecte-la automatiquement.

ðŸ›ï¸ CATALOGUE & STOCK :
Tu ne prÃ©sentes que les produits en stock. Voici le catalogue actuel de nos articles :
${JSON.stringify(catalog, null, 2)}

ðŸ’¬ FLOW DE CONVERSATION & COLLECTE D'INFOS (UNE PAR UNE) :
1. Accueil chaleureux avec : "${welcomeMsg}"
2. DÃ©couverte du besoin (poser des questions ouvertes, proposer des articles pertinents avec prix clair).
3. Persuasion & gestion des objections (preuve sociale, rassurer).

4. LIVRAISON : Des qu'un client montre de l'interet ou veut commander, mentionne TOUJOURS les frais de livraison. Chaque produit dans le catalogue a les champs "livraison_domicile" et "livraison_bureau". Dis toujours :
   - "Livraison a domicile : [livraison_domicile] DZD"
   - "Livraison au bureau/point relais : [livraison_bureau] DZD"
   Exemple : "Ce produit est a [prix] DZD + [livraison_domicile] DZD de livraison a domicile (ou [livraison_bureau] DZD en point relais)."

5. Commande & Collecte d'informations :
   DÃ¨s que le client confirme qu'il veut passer commande (ex: "bghit ncommandi", "je prends la premiÃ¨re", "commander", etc.) :
   Tu passes en mode collecte. Demande les informations suivantes UNE PAR UNE de faÃ§on naturelle et amicale. Ne les demande JAMAIS d'un coup.
   
   Ordre de collecte :
   - Ã‰tape 1 : Nom complet
   - Ã‰tape 2 : NumÃ©ro de tÃ©lÃ©phone
   - Ã‰tape 3 : Wilaya / Commune (lieu de livraison)
   - Ã‰tape 4 : PrÃ©senter le rÃ©capitulatif complet de la commande pour validation finale (inclure produit(s), couleur, taille, prix, frais de livraison et total gÃ©nÃ©ral).

INFORMATIONS ACTUELLES DE COMMANDE DU CLIENT :
- Nom complet : ${session.order.nom || "Non collectÃ©"}
- TÃ©lÃ©phone : ${session.order.telephone || "Non collectÃ©"}
- Wilaya / Commune : ${session.order.wilaya_commune || "Non collectÃ©"}
- Statut de l'Ã©tape : ${session.state}

6. VALIDATION ET WEBHOOK JSON :
Lorsque le client valide dÃ©finitivement son rÃ©capitulatif (avec "oui", "c'est bon", "ØµØ­", "ÙˆØ§Ù‡", etc.) :
Tu dois gÃ©nÃ©rer EXACTEMENT ce JSON structurÃ© pour notre systÃ¨me n8n dans ta rÃ©ponse. Remplis les champs avec les donnÃ©es collectÃ©es :
\`\`\`json
{
  "event": "nouvelle_commande",
  "timestamp": "${new Date().toISOString()}",
  "client": {
    "nom": "{{NOM_COMPLET}}",
    "telephone": "{{TELEPHONE}}",
    "commune": "{{COMMUNE}}",
    "wilaya": "{{WILAYA}}",
    "langue": "{{fr|ar}}"
  },
  "commande": {
    "produits": [
      {
        "nom_produit": "{{NOM_PRODUIT_1}}",
        "quantite": 1,
        "prix_unitaire": 0,
        "sous_total": 0
      }
    ],
    "couleur": "{{COULEUR_CHOISIE}}",
    "taille": "{{TAILLE_CHOISIE}}",
    "total": 0,
    "devise": "DZD",
    "statut": "en_attente"
  },
  "meta": {
    "canal": "chatbot",
    "agent": "${botName}",
    "version": "1.0"
  }
}
\`\`\`
Ensuite, envoie ton message de remerciement chaleureux final en utilisant le prÃ©nom du client.
`;
}

/**
 * Endpoint principal pour le Chatbot (ManyChat / Make / Custom Webhook)
 * ReÃ§oit : { userId, type: 'text'|'image'|'audio', content: 'texte ou URL', token?, metaToken? }
 *   - metaToken : Facebook Page Access Token (nÃ©cessaire pour tÃ©lÃ©charger les audios depuis le CDN Facebook)
 */
app.post('/webhook', async (req, res) => {
  const { userId, type, content, token, metaToken } = req.body;

  if (!userId || !type || !content) {
    return res.status(400).json({ error: "Missing required fields: userId, type, content" });
  }

  try {
    const session = getSession(userId);

    // Store token in session if provided (to avoid re-calling API on every message)
    if (token) {
      session.token = token;
    }

    // Fetch external data at conversation start (new session or missing products)
    if ((!session.produits || session.produits.length === 0) && session.token) {
      const externalData = await fetchExternalData(session.token);
      if (externalData) {
        session.produits = externalData.produits || [];
        session.config = externalData.config || null;
        saveSession(userId, session);
        console.log('[Webhook] External data loaded into session');
      }
    }

    const catalog = session.produits.length > 0 ? session.produits : loadCatalog();

    console.log(`[Webhook] Message received from ${userId} | Type: ${type}`);

    // --- Ã‰tape 1 : Router et traiter selon le type de message ---
    if (type === 'image') {
      if (session.token && catalog.length > 0) {
        console.log(`[Webhook] Image received, matching against ${catalog.length} products...`);
        const matchedProduct = await findMatchingProduct(content, session.token);

        if (matchedProduct) {
          addToHistory(userId, 'user', `[Image envoyée]`);
          addToHistory(userId, 'system', `[Système] Le client a envoyé une photo. J'ai analysé l'image et trouvé une correspondance avec notre produit :
- Nom : ${matchedProduct.nom}
- Prix : ${matchedProduct.prix} DZD
- Tailles disponibles : ${matchedProduct.tailles?.join(', ')}
- Couleurs disponibles : ${matchedProduct.couleurs?.join(', ')}
- Stock : ${matchedProduct.stock} unités
Propose ce produit au client et demande-lui sa taille et couleur préférée.`);
        } else {
          addToHistory(userId, 'user', `[Image envoyée]`);
          addToHistory(userId, 'system', `[Système] Le client a envoyé une photo d'un produit. J'ai analysé l'image mais je n'ai pas trouvé de correspondance exacte dans notre catalogue. Dis-lui poliment que ce produit n'est pas disponible et propose-lui de voir nos produits disponibles.`);
        }
      } else {
        // Fallback: simple description without product matching
        console.log(`[Webhook] Image received (no token/catalog), sending to Groq vision...`);
        const groqDescription = await callGroqVision(content);

        if (groqDescription) {
          addToHistory(userId, 'user', `[Image envoyée]`);
          addToHistory(userId, 'system', `[Système] Le client a envoyé une image : ${groqDescription}. Réponds en tant que Yasmine, conseillère commerciale, en commentant l'image de façon naturelle et en aidant le client.`);
        } else {
          addToHistory(userId, 'user', '[Image envoyée]');
          addToHistory(userId, 'system', "[Système] L'utilisateur a envoyé une photo mais l'analyse d'image est temporairement indisponible. Réponds en tant que Yasmine, demande poliment à l'utilisateur de décrire ce qu'il cherche ou ce qu'il a envoyé.");
        }
      }
    } else if (type === 'audio') {
      // Message vocal -> Transcription via le dashboard (qui a le metaToken Facebook)
      // ou en fallback direct via Groq/OpenAI Whisper
      console.log(`[Webhook] Audio message received, content preview: ${(content || '').substring(0, 120)}`);
      console.log(`[Webhook] metaToken ${metaToken ? 'fourni' : 'NON fourni'}, token ${token ? 'fourni' : 'NON fourni'}`);

      let transcription = null;

      // Essai 1 : Via le dashboard /api/transcribe (si on a metaToken)
      if (metaToken && token) {
        const dashboardUrl = process.env.APP_URL || 'https://imadilyes97-ctrl-lasaas.vercel.app';
        console.log(`[Webhook] Attempting transcription via dashboard proxy (${dashboardUrl}/api/transcribe)...`);
        try {
          const proxyResp = await axios.post(`${dashboardUrl}/api/transcribe`, {
            token,
            audioUrl: content,
            metaToken
          }, { timeout: 60000 });
          if (proxyResp.data?.text) {
            transcription = proxyResp.data.text;
            console.log(`[Webhook] Dashboard transcription success: "${transcription.substring(0, 120)}..."`);
          } else {
            console.warn('[Webhook] Dashboard returned no text:', JSON.stringify(proxyResp.data));
          }
        } catch (proxyErr) {
          console.warn('[Webhook] Dashboard proxy failed:', proxyErr.response?.data || proxyErr.message);
        }
      } else {
        console.log('[Webhook] No metaToken available, skipping dashboard proxy');
      }

      // Essai 2 : Transcription directe (fallback si le proxy n'a pas marchÃ©)
      if (!transcription) {
        console.log('[Webhook] Trying direct transcription...');
        transcription = await transcribeWithWhisper(content);
      }

      console.log(`[Webhook] Final transcription result: "${(transcription || '').substring(0, 200)}"`);

      if (!transcription || transcription.startsWith('[')) {
        const raison = transcription || '[Transcription impossible]';
        console.warn(`[Webhook] Audio transcription failed: ${raison}`);
        addToHistory(userId, 'system', `[Système] L'utilisateur a envoyé un message vocal. La transcription a échoué (${raison}). Réponds en tant que Yasmine, informe poliment que tu n'as pas pu comprendre le message et demande de réécrire en texte.`);
      } else {
        console.log(`[Webhook] Audio transcribed successfully: "${transcription.substring(0, 100)}..."`);
        addToHistory(userId, 'user', `(Message vocal transcrit) : ${transcription}`);
      }

    } else {
      // Message texte normal -> L'ajouter Ã  l'historique
      addToHistory(userId, 'user', content);
    }

    // --- Ã‰tape 2 : Mettre Ã  jour l'Ã©tat logique interne de la collecte ---
    // (Nous mettons Ã  jour l'Ã©tat de session selon les rÃ©ponses pour aider le LLM)
    const history = getHistory(userId);
    const lastUserMsg = history[history.length - 1].content.toLowerCase();

    // DÃ©tection basique pour guider les Ã©tats
    const lastContent = history[history.length - 1].content.replace(/^\(Message vocal transcrit\)\s*:\s*/, '');
    const lastContentLower = lastContent.toLowerCase();

    if (session.state === STATES.DISCOVERY) {
      if (lastContentLower.includes('commandi') || lastContentLower.includes('commander') || lastContentLower.includes('prendre') || lastContentLower.includes('bghit')) {
        session.state = STATES.COLLECTING_NAME;
      }
    } else if (session.state === STATES.COLLECTING_NAME) {
      session.order.nom = lastContent;
      session.state = STATES.COLLECTING_PHONE;
    } else if (session.state === STATES.COLLECTING_PHONE) {
      const phoneDigits = lastContent.replace(/\D/g, '');
      if (phoneDigits.length >= 8) {
        session.order.telephone = phoneDigits;
        session.state = STATES.COLLECTING_LOCATION;
      }
    } else if (session.state === STATES.COLLECTING_LOCATION) {
      session.order.wilaya_commune = lastContent;
      session.state = STATES.AWAITING_CONFIRMATION;
    }

    saveSession(userId, session);

    // --- Ã‰tape 3 : Appeler DeepSeek pour gÃ©nÃ©rer la rÃ©ponse ---
    const systemPrompt = getSystemPrompt(session);
    let rawReply = await callDeepSeek(history, systemPrompt);

    // Fallback automatique si DeepSeek est indisponible
    if (rawReply === "Désolée, une erreur est survenue. Peux-tu reformuler ?" || rawReply === "Désolée, je n'ai pas pu générer de réponse.") {
      console.warn("[Webhook] DeepSeek failed, falling back to Groq.");
      rawReply = await callGroqText(history, systemPrompt);
    }

    console.log(`[Webhook] Raw response length: ${rawReply.length}`);

    // --- Ã‰tape 4 : Intercepter le JSON final pour n8n ---
    let cleanReply = rawReply;
    let orderCreated = false;
    let orderDetails = null;

    // Regex pour capturer le bloc JSON
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = rawReply.match(jsonRegex);

    if (match) {
      try {
        const jsonString = match[1].trim();
        orderDetails = JSON.parse(jsonString);
        orderCreated = true;

        console.log(`[Webhook] Order confirmed! JSON payload captured:`, orderDetails);

        // Envoyer Ã  l'application externe
        if (APP_URL && SECRET_TOKEN) {
          const externalPayload = {
            token: SECRET_TOKEN,
            nom: orderDetails.client?.nom || '',
            telephone: orderDetails.client?.telephone || '',
            wilaya: orderDetails.client?.wilaya || '',
            commune: orderDetails.client?.commune || '',
            produits: orderDetails.commande?.produits?.map(p => p.nom_produit).join(', ') || '',
            couleur: orderDetails.commande?.couleur || '',
            taille: orderDetails.commande?.taille || '',
            total: orderDetails.commande?.total || 0,
            statut: 'en_attente'
          };
          axios.post(`${APP_URL}/api/webhook`, externalPayload)
            .then(() => console.log('[Webhook] Order successfully posted to external app!'))
            .catch(err => console.error('[Webhook] Failed to post to external app:', err.message));
        }

        // Envoyer Ã  n8n en arriÃ¨re-plan
        const n8nUrl = process.env.N8N_WEBHOOK_URL;
        if (n8nUrl && !n8nUrl.includes('your-n8n-instance')) {
          axios.post(n8nUrl, orderDetails)
            .then(() => console.log('[Webhook] Order successfully posted to n8n webhook!'))
            .catch(err => console.error('[Webhook] Failed to post to n8n webhook:', err.message));
        } else {
          console.log('[Webhook] N8N_WEBHOOK_URL is not configured. Webhook dispatch skipped.');
        }

        // Mettre Ã  jour la session en Ã©tat complÃ©tÃ©
        session.state = STATES.ORDER_COMPLETED;
        session.order.nom = orderDetails.client.nom;
        session.order.telephone = orderDetails.client.telephone;
        session.order.wilaya_commune = `${orderDetails.client.commune}, ${orderDetails.client.wilaya}`;
        session.order.produits = orderDetails.commande.produits;
        session.order.total = orderDetails.commande.total;
        session.order.langue = orderDetails.client.langue;
        saveSession(userId, session);

        // Nettoyer la rÃ©ponse pour ne pas afficher le bloc de code brut au client Messenger/Instagram
        cleanReply = rawReply.replace(jsonRegex, '').trim();
      } catch (err) {
        console.error('[Webhook] Error parsing order JSON from model reply:', err.message);
      }
    }

    // --- Ã‰tape 5 : Extraire les photos des liens Markdown dans la rÃ©ponse ---
    // DeepSeek peut gÃ©nÃ©rer des liens comme [Nom Produit](url_photo_ou_produit)
    // On extrait les photos correspondantes depuis le catalogue
    const photosExtraites = [];
    let texteFinal = cleanReply;

    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let linkMatch;

    while ((linkMatch = markdownLinkRegex.exec(cleanReply)) !== null) {
      const linkText = linkMatch[1].toLowerCase().trim();
      const linkUrl = linkMatch[2].trim();

      // Chercher si ce lien correspond Ã  un produit du catalogue
      const produitTrouve = catalog.find(p =>
        p.nom?.toLowerCase().includes(linkText) ||
        linkText.includes(p.nom?.toLowerCase())
      );

      if (produitTrouve) {
        // Extraire les photos du produit trouvÃ©
        if (produitTrouve.photo_url) {
          photosExtraites.push(produitTrouve.photo_url);
        }
        if (produitTrouve.photos_produit?.length) {
          for (const photo of produitTrouve.photos_produit) {
            if (!photosExtraites.includes(photo)) {
              photosExtraites.push(photo);
            }
          }
        }
      } else if (/\.(jpg|jpeg|png|gif|webp|avif)(\?.*)?$/i.test(linkUrl)) {
        // Le lien lui-mÃªme est une image
        photosExtraites.push(linkUrl);
      }
    }

    // Nettoyer le texte : remplacer les liens Markdown par leur texte seul
    texteFinal = texteFinal.replace(markdownLinkRegex, (_, text) => text.trim());

    // Ajouter la rÃ©ponse nettoyÃ©e de Yasmine Ã  l'historique
    addToHistory(userId, 'assistant', texteFinal);

    // Construire les messages ordonnÃ©s pour Make/n8n
    // Format simple : un tableau d'actions que Make peut itÃ©rer directement
    const messages = [];

    // 1. Texte toujours en premier
    if (texteFinal.trim()) {
      messages.push({
        type: 'text',
        content: texteFinal.trim()
      });
    }

    // 2. Photos ensuite (une par une)
    for (const photoUrl of photosExtraites) {
      messages.push({
        type: 'image',
        url: photoUrl
      });
    }

    // Renvoyer la rÃ©ponse formatÃ©e
    // Make/n8n n'a qu'Ã  boucler sur "messages[]" :
    // - si type = "text" -> Send Message
    // - si type = "image" -> Send Image Attachment
    return res.json({
      reply: texteFinal,
      photos: photosExtraites,
      messages,
      orderCreated,
      orderDetails
    });

  } catch (error) {
    console.error("[Webhook Error]:", error);
    return res.status(500).json({ error: "Internal server error occurred", details: error.message });
  }
});

// Endpoint pour rÃ©initialiser la session (utile pour retester)
app.post('/webhook/reset', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  
  resetSession(userId);
  console.log(`[Webhook] Session reset for user ${userId}`);
  res.json({ success: true, message: `Session reset for ${userId}` });
});

// Endpoint pour mettre Ã  jour le catalogue depuis n8n
app.post('/api/catalog', (req, res) => {
  const newCatalog = req.body;
  if (!Array.isArray(newCatalog)) {
    return res.status(400).json({ error: "Catalog must be a JSON array of products" });
  }

  try {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(newCatalog, null, 2), 'utf8');
    console.log('[API] Product catalog updated successfully!');
    res.json({ success: true, message: "Catalog updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to write catalog file", details: err.message });
  }
});

// Endpoint pour lire le catalogue actuel
app.get('/api/catalog', (req, res) => {
  res.json(loadCatalog());
});

// Endpoint pour la transcription audio (utilisÃ© par n8n)
app.post('/api/transcribe', async (req, res) => {
  const { token, audioUrl } = req.body;

  if (!audioUrl) {
    return res.status(400).json({ error: "Missing audioUrl parameter" });
  }

  // VÃ©rifier le token si fourni
  if (token && token !== SECRET_TOKEN) {
    return res.status(403).json({ error: "Invalid token" });
  }

  try {
    console.log(`[Transcribe API] Received transcription request for: ${audioUrl}`);
    const transcription = await transcribeWithWhisper(audioUrl);

    console.log(`[Transcribe API] Transcription successful: "${transcription}"`);
    return res.json({
      success: true,
      text: transcription
    });
  } catch (error) {
    console.error("[Transcribe API] Error:", error.message);
    return res.status(500).json({
      error: "Transcription failed",
      details: error.message
    });
  }
});

// Servir le dossier public (chat UI)
app.use(express.static('public'));

// Route racine : affiche l'interface chat
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'chat.html'));
});

// Activer le serveur (local) ou exporter pour Vercel
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\nðŸš€ Yasmine Chatbot Backend running on http://localhost:${PORT}`);
    console.log(`- Webhook Endpoint: POST http://localhost:${PORT}/webhook`);
    console.log(`- Reset Session Endpoint: POST http://localhost:${PORT}/webhook/reset`);
    console.log(`- Sync Catalog Endpoint: POST/GET http://localhost:${PORT}/api/catalog\n`);
  });
}

export default app;

