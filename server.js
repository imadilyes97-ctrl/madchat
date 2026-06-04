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
  callGeminiMultimodal, 
  transcribeAudioWithGemini 
} from './llmService.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const CATALOG_PATH = path.join(process.cwd(), 'catalog.json');

// Load catalog helper
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

// System prompt generator
function getSystemPrompt(session, catalog) {
  return `Tu es Yasmine, une conseillÃ¨re commerciale chaleureuse, expÃ©rimentÃ©e et passionnÃ©e par ton travail dans notre boutique en ligne.
Ton rÃ´le est d'accueillir les clients, les aider Ã  choisir les bons produits, les inciter Ã  passer commande, et collecter les informations nÃ©cessaires Ã  la livraison.
Tu n'es PAS un robot. Tu es une vraie personne attentionnÃ©e qui traite chaque client comme s'il Ã©tait unique.

Traits de caractÃ¨re :
- Chaleureuse, souriante, enthousiaste.
- Professionnelle mais dÃ©contractÃ©e (comme une amie experte).
- PersÃ©vÃ©rante mais douce (pas de vente agressive).
- Empathique : s'adapte au ton et au style du client.
- Emojis avec modÃ©ration, naturelle.

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
1. Accueil chaleureux.
2. DÃ©couverte du besoin (poser des questions ouvertes, proposer des articles pertinents avec prix clair).
3. Persuasion & gestion des objections (preuve sociale, rassurer).
4. Commande & Collecte d'informations :
   DÃ¨s que le client confirme qu'il veut passer commande (ex: "bghit ncommandi", "je prends la premiÃ¨re", "commander", etc.) :
   Tu passes en mode collecte. Demande les informations suivantes UNE PAR UNE de faÃ§on naturelle et amicale. Ne les demande JAMAIS d'un coup.
   
   Ordre de collecte :
   - Ã‰tape 1 : Nom complet
   - Ã‰tape 2 : NumÃ©ro de tÃ©lÃ©phone
   - Ã‰tape 3 : Wilaya / Commune (lieu de livraison)
   - Ã‰tape 4 : PrÃ©senter le rÃ©capitulatif complet de la commande pour validation finale.

INFORMATIONS ACTUELLES DE COMMANDE DU CLIENT :
- Nom complet : ${session.order.nom || "Non collectÃ©"}
- TÃ©lÃ©phone : ${session.order.telephone || "Non collectÃ©"}
- Wilaya / Commune : ${session.order.wilaya_commune || "Non collectÃ©"}
- Statut de l'Ã©tape : ${session.state}

5. VALIDATION ET WEBHOOK JSON :
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
    "total": 0,
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
Ensuite, envoie ton message de remerciement chaleureux final en utilisant le prÃ©nom du client.
`;
}

/**
 * Endpoint principal pour le Chatbot (ManyChat / Make / Custom Webhook)
 * ReÃ§oit : { userId, type: 'text'|'image'|'audio', content: 'texte ou URL' }
 */
app.post('/webhook', async (req, res) => {
  const { userId, type, content } = req.body;

  if (!userId || !type || !content) {
    return res.status(400).json({ error: "Missing required fields: userId, type, content" });
  }

  try {
    const session = getSession(userId);
    const catalog = loadCatalog();

    console.log(`[Webhook] Message received from ${userId} | Type: ${type}`);

    // --- Ã‰tape 1 : Router et traiter selon le type de message ---
    if (type === 'image') {
      // Message avec image -> Utiliser Gemini pour l'analyser
      const imageAnalysis = await callGeminiMultimodal(content);
      console.log(`[Webhook] Gemini image analysis: ${imageAnalysis}`);

      // Ajouter l'analyse comme directive systÃ¨me dans l'historique
      addToHistory(userId, 'system', `[SystÃ¨me] L'utilisateur a envoyÃ© une photo. Analyse visuelle : ${imageAnalysis}. RÃ©ponds en tant que Yasmine, montre de l'enthousiasme, confirme le produit et propose de commander.`);
      
    } else if (type === 'audio') {
      // Message vocal -> Utiliser Gemini pour transcrire
      const transcription = await transcribeAudioWithGemini(content);
      console.log(`[Webhook] Gemini transcribed audio: "${transcription}"`);

      // Ajouter le texte transcrit comme message de l'utilisateur
      addToHistory(userId, 'user', `(Message vocal transcrit) : ${transcription}`);
      
    } else {
      // Message texte normal -> L'ajouter Ã  l'historique
      addToHistory(userId, 'user', content);
    }

    // --- Ã‰tape 2 : Mettre Ã  jour l'Ã©tat logique interne de la collecte ---
    // (Nous mettons Ã  jour l'Ã©tat de session selon les rÃ©ponses pour aider le LLM)
    const history = getHistory(userId);
    const lastUserMsg = history[history.length - 1].content.toLowerCase();

    // DÃ©tection basique pour guider les Ã©tats
    if (session.state === STATES.DISCOVERY) {
      if (lastUserMsg.includes('commandi') || lastUserMsg.includes('commander') || lastUserMsg.includes('prendre') || lastUserMsg.includes('bghit')) {
        session.state = STATES.COLLECTING_NAME;
      }
    } else if (session.state === STATES.COLLECTING_NAME) {
      // On assume que le client donne son nom
      session.order.nom = history[history.length - 1].content;
      session.state = STATES.COLLECTING_PHONE;
    } else if (session.state === STATES.COLLECTING_PHONE) {
      // On extrait les chiffres du numÃ©ro de tÃ©lÃ©phone
      const phoneDigits = history[history.length - 1].content.replace(/\D/g, '');
      if (phoneDigits.length >= 8) {
        session.order.telephone = phoneDigits;
        session.state = STATES.COLLECTING_LOCATION;
      }
    } else if (session.state === STATES.COLLECTING_LOCATION) {
      session.order.wilaya_commune = history[history.length - 1].content;
      session.state = STATES.AWAITING_CONFIRMATION;
    }

    saveSession(userId, session);

    // --- Ã‰tape 3 : Appeler DeepSeek pour gÃ©nÃ©rer la rÃ©ponse ---
    const systemPrompt = getSystemPrompt(session, catalog);
    const rawReply = await callDeepSeek(history, systemPrompt);

    console.log(`[Webhook] DeepSeek raw response length: ${rawReply.length}`);

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

        console.log(`[Webhook] ðŸŽ‰ Order confirmed! JSON payload captured:`, orderDetails);

        // Envoyer Ã  n8n en arriÃ¨re-plan
        const n8nUrl = process.env.N8N_WEBHOOK_URL;
        if (n8nUrl && !n8nUrl.includes('your-n8n-instance')) {
          axios.post(n8nUrl, orderDetails)
            .then(() => console.log('[Webhook] Order successfully posted to n8n webhook!'))
            .catch(err => console.error('[Webhook] Failed to post to n8n webhook:', err.message));
        } else {
          console.log('[Webhook] âš ï¸ N8N_WEBHOOK_URL is not configured. Webhook dispatch skipped.');
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

    // Ajouter la rÃ©ponse nettoyÃ©e de Yasmine Ã  l'historique
    addToHistory(userId, 'assistant', cleanReply);

    // Renvoyer la rÃ©ponse formatÃ©e
    return res.json({
      reply: cleanReply,
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

// Servir le dossier public (chat UI)
app.use(express.static('public'));

// Route racine : affiche l'interface chat
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'chat.html'));
});

// Activer le serveur
app.listen(PORT, () => {
  console.log(`\nðŸš€ Yasmine Chatbot Backend running on http://localhost:${PORT}`);
  console.log(`- Webhook Endpoint: POST http://localhost:${PORT}/webhook`);
  console.log(`- Reset Session Endpoint: POST http://localhost:${PORT}/webhook/reset`);
  console.log(`- Sync Catalog Endpoint: POST/GET http://localhost:${PORT}/api/catalog\n`);
});

