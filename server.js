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

	VOCABULAIRE DARIJA POUR LES COMMANDES (Ã  connaÃ®tre ABSOLUMENT) :
	- "b3atli" / "Ø¨Ø¹Ø«Ù„ÙŠ" = envoie-moi (ex: "b3atli tsawer" = envoie-moi des photos)
	- "tsawer" / "ØªØµØ§ÙˆØ±" = photos
	- "bghit" / "Ø¨ØºÙŠØª" = je veux (ex: "bghit nchri had" = je veux acheter)
	- "ncommandi" / "Ù†ÙƒÙˆÙ…Ø§Ù†Ø¯ÙŠ" = je commande
	- "nchri" / "Ù†Ø´Ø±ÙŠ" = j'achÃ¨te
	- "chhal" / "Ø´Ø­Ø§Ù„" = combien (ex: "chhal had" = combien Ã§a coÃ»te ?)
	- "chhal hada" / "Ø´Ø­Ø§Ù„ Ù‡Ø§Ø¯Ø§" = combien Ã§a coÃ»te
	- "hob" / "Ù‡ÙˆØ¨" = d'accord / je veux bien
	- "wellah" / "ÙˆØ§Ù„Ù„Ù‡" = vraiment
	- "saha" / "ØµØ­Ø©" = merci
	- "rabi yahafdek" / "Ø±Ø¨ÙŠ ÙŠØ­ÙØ¸Ùƒ" = merci / que Dieu te protÃ¨ge
	- "wach" / "ÙˆØ§Ø´" = est-ce que / quoi
	- "had" / "Ù‡Ø§Ø¯" = ce/cet
	- "hadou" / "Ù‡Ø§Ø¯Ùˆ" = ceux-ci
	- "hadi" / "Ù‡Ø§Ø¯ÙŠ" = celle-ci
	- "chkoun" / "Ø´ÙƒÙˆÙ†" = qui
	- "fayne" / "ÙØ§ÙŠÙ†" = oÃ¹
	- "l'wed" / "Ø§Ù„ÙˆØ§Ø¯" = la livraison
	- "khalas" / "Ø®Ù„Øµ" = payÃ© / d'accord
	- "rani" / "Ø±Ø§Ù†ÙŠ" = je suis
	- "maak" / "Ù…Ø¹Ø§Ùƒ" = avec toi
	- "habel" / "Ù‡Ø¨Ù„" = magnifique / j'adore
	- "ted" / "ØªÙŠØ¯" = donne (ex: "ted liya" = donne-moi)
	- "nshuf" / "Ù†Ø´ÙˆÙ" = je regarde / je vais voir
	- "doka" / "Ø¯ÙˆÙƒØ§" = tout de suite / maintenant
	- "bsif" / "Ø¨Ø³ÙŠÙ" = le prix
	- "ya3tik saha" / "ÙŠØ¹Ø·ÙŠÙƒ Ø§Ù„ØµØ­Ø©" = merci
	- "semahli" / "Ø³Ù…Ø­Ù„ÙŠ" = excuse-moi / dÃ©solÃ©
	- "mazal" / "Ù…Ø§Ø²Ø§Ù„" = encore / pas encore

	SI LE CLIENT PARLE EN DARIJA ALGÃ‰RIENNE :
	- Utilise les mots ci-dessus pour comprendre ce qu'il dit
	- RÃ©ponds dans la mÃªme darija algÃ©rienne (pas darija marocaine)
	- N'hÃ©site pas Ã  utiliser des mots darija dans tes rÃ©ponses
	- Sois naturelle, les algÃ©riens mÃ©langent toujours franÃ§ais et darija

ðŸ›ï¸ CATALOGUE & STOCK :
Tu ne prÃ©sentes que les produits en stock. Voici le catalogue actuel de nos articles :
${JSON.stringify(catalog, null, 2)}

	ðŸ“¬ FLOW DE CONVERSATION & COLLECTE D'INFOS :
	1. Accueil chaleureux avec : "${welcomeMsg}"
	2. Decouverte du besoin (poser des questions ouvertes, proposer des articles pertinents avec prix clair).
	3. Persuasion & gestion des objections (preuve sociale, rassurer).

	4. LIVRAISON : Des qu'un client montre de l'interet ou veut commander, mentionne TOUJOURS les frais de livraison. Chaque produit dans le catalogue a les champs "livraison_domicile" et "livraison_bureau". Dis toujours :
	   - "Livraison a domicile : [livraison_domicile] DZD"
	   - "Livraison au bureau/point relais : [livraison_bureau] DZD"
	   Exemple : "Ce produit est a [prix] DZD + [livraison_domicile] DZD de livraison a domicile (ou [livraison_bureau] DZD en point relais)."

	5. Commande & Collecte d'informations :
	   Des que le client confirme qu'il veut passer commande (ex: "bghit ncommandi", "je prends", "commander", etc.) :
	   Tu passes en mode collecte. Regarde d'abord les INFORMATIONS ACTUELLES ci-dessous pour voir ce qui est deja collecte.

	   REGLE IMPORTANTE - Messages avec TOUTES les infos en une fois :
	   Si le client donne plusieurs informations en un seul message (ex: "nom + telephone + wilaya" ou "nom + telephone" ou "telephone + wilaya"),
	   tu les acceptes et passes directement a l'etape suivante sans rien redemander.
	   Ne demande JAMAIS une information que le client a deja fournie !
	   Si tu vois que tout est deja rempli dans les INFORMATIONS ACTUELLES, presente directement le recapitulatif pour validation.

	   Ordre de collecte (pour ce qui manque seulement) :
	   - Etape 1 : Nom complet (si pas encore donne)
	   - Etape 2 : Numero de telephone (si pas encore donne)
	   - Etape 3 : Wilaya / Commune lieu de livraison (si pas encore donne)
	   - Etape 4 : Presenter le recapitulatif complet de la commande pour validation finale

	   GESTION DES MESSAGES VOCAUX TRANSCRITS :
	   Si le message commence par "(Message vocal transcrit)", c'est un message transforme en texte par reconnaissance vocale.
	   Si le message transcrit semble incoherent, confus, ou que tu ne comprends pas bien :
	   Reponds gentiment "Desolee, je n'ai pas bien compris le message vocal, peux-tu l'ecrire en message texte stp ?"

	INFORMATIONS ACTUELLES DE COMMANDE DU CLIENT :
	- Nom complet : ${session.order.nom || "Non collecte"}
	- Telephone : ${session.order.telephone || "Non collecte"}
	- Wilaya / Commune : ${session.order.wilaya_commune || "Non collecte"}
	- Statut de l'etape : ${session.state}
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
 * Fonction d'extraction intelligente des infos de commande
 * Detecte nom, telephone, wilaya dans un seul message
 */
const ALGERIAN_WILAYAS = [
  'adrar','chlef','laghouat','oum el bouaghi','batna','bejaia','biskra','bechar',
  'blida','bouira','tamanrasset','tebessa','tlemcen','tiaret','tizi ouzou','alger',
  'djelfa','jijel','setif','saida','skikda','sidi bel abbes','annaba','guelma',
  'constantin','medea','mostaganem','msila','mascara','ouargla','oran','el bayadh',
  'bordj bou areridj','boumerdes','el tarf','tindouf','tissemsilt','el oued','khenchela',
  'souk ahras','tipaza','mila','ain defla','naama','ain temouchent','ghardaia','relizane'
];

// Mots-clés Darija/Français qui signalent "je veux commander"
const ORDER_KEYWORDS = ['commandi','commander','prendre','bghit','ncommandi','nchri','hob',
  'je prends','je veux','bghit nchri','b3atli','ted liya','nchuf'];

// Mots-clés à filtrer du nom lors de l'extraction
const NAME_NOISE_KEYWORDS = [
  'je m\'appelle','mon nom est','je suis','c\'est','ana','ismi','rani',
  'moi c\'est','nom','nom complet','je m\'apelle',
  'bghit','ncommandi','nchri','commandi','hob','saha',
  'b3atli','ted liya','ted','nchuf','doka','khalas','wellah',
  's\'il vous plaît','svp','stp','merci',
  'oui','ouai','ouais','d\'accord','dakord','ok',
  'et','puis','avec',
  'bonjour','salam','salut','bsmellah','saha',
  'ya3tik saha','rabi yahafdek','semahli'
];

function extractOrderInfo(text) {
  const info = { nom: null, telephone: null, wilaya_commune: null, allFound: false };
  if (!text) return info;
  let cleaned = text;

  // 1. Extract phone (Algerian format: 05XX XX XX XX, 06XX, 07XX, +213 5XX, 00213 5XX)
  const phoneRegex = /(?:0[5-7])(?:[\s.-]?\d){8}|(?:\+213|00213)[5-7](?:[\s.-]?\d){8}|(?:05|06|07)\d{8}/g;
  const phoneMatch = cleaned.match(phoneRegex);
  if (phoneMatch) {
    const raw = phoneMatch[0];
    info.telephone = raw.replace(/[\s.-]/g, '');
    cleaned = cleaned.replace(raw, '').replace(/\s{2,}/g, ' ').trim();
  }

  // 2. Extract wilaya/commune (cherche aussi "wilaya X" et "w X")
  const wilayaPatterns = [
    /wilaya\s*(n[o°]?\s*)?(\d{1,2})\b/i,
    /w[.\s]*(\d{1,2})\b/i,
    /(?:à|a|â)\s*(alger|oran|constantin|annaba|setif|blida|bejaia|tizi|tlemcen|batna)\b/i
  ];
  for (const pat of wilayaPatterns) {
    const m = cleaned.match(pat);
    if (m) {
      info.wilaya_commune = m[0].replace(/^(wilaya\s*(n[o°]?\s*)?|w[.\s]*|à|a|â)\s*/i, '').trim();
      cleaned = cleaned.replace(m[0], '').replace(/\s{2,}/g, ' ').trim();
      break;
    }
  }

  // Fallback: cherche dans la liste des wilayas
  if (!info.wilaya_commune) {
    for (const wilaya of ALGERIAN_WILAYAS) {
      const lower = cleaned.toLowerCase();
      if (lower.includes(wilaya)) {
        const idx = lower.indexOf(wilaya);
        const start = Math.max(0, cleaned.substring(0, idx).lastIndexOf(',') + 1);
        const end = cleaned.indexOf(',', idx) !== -1 ? cleaned.indexOf(',', idx) : cleaned.length;
        info.wilaya_commune = cleaned.substring(start, end).replace(/^(et\s*|,?\s*)/i, '').trim();
        cleaned = cleaned.replace(cleaned.substring(start, end), '').replace(/\s{2,}/g, ' ').trim();
        break;
      }
    }
  }

  // 3. Clean remaining text to get name
  // Supprimer d'abord tous les mots-clés parasites (ordre et bruit)
  let nameText = cleaned
    .replace(new RegExp(NAME_NOISE_KEYWORDS.join('|'), 'gi'), ' ')
    .replace(/mon numero|telephone|tel|num\s*(\d)?|tél|portable|mobile/gi, ' ')
    .replace(/wilaya|commune|adresse|ville|de\s*:|lieu|livraison/gi, ' ')
    .replace(/et\s*(mon|le|la|de)?/gi, ' ')
    .replace(/[0-9+\s\-()]+/g, ' ')
    .replace(/['']/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (nameText && nameText.split(/\s+/).length <= 6 && nameText.length > 2) {
    // Capitalize properly
    nameText = nameText.split(/\s+/).map((word, i) => {
      // Prépositions restent en minuscule si au milieu
      if (i > 0 && ['de','du','des','le','la','el','ben','bin','ou','bni'].includes(word.toLowerCase())) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
    info.nom = nameText;
  }

  info.allFound = !!(info.nom && info.telephone && info.wilaya_commune);
  return info;
}

/**
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

	    // --- Etape 2 : Mettre a jour l'etat logique interne de la collecte ---
	    // Extraction intelligente des infos depuis le message (meme pendant DISCOVERY)
	    const history = getHistory(userId);
	    const lastUserMsgRaw = history[history.length - 1].content;
	    const lastContent = lastUserMsgRaw.replace(/^\(Message vocal transcrit\)\s*:\s*/, '');
	    const lastContentLower = lastContent.toLowerCase();
	
	    // Toujours essayer d'extraire les infos de commande, quelque soit l'etat
	    const extracted = extractOrderInfo(lastContent);
	
	    if (session.state === STATES.DISCOVERY) {
	      // Detecter l'intention de commander (Darija ou Francais)
	      const wantsToOrder = ORDER_KEYWORDS.some(kw => lastContentLower.includes(kw));
	
	      if (wantsToOrder || extracted.telephone || extracted.wilaya_commune) {
	        // Le client montre de l'interet -> commencer la collecte
	        // Appliquer les infos deja extraites pour ne pas redemander
	        if (extracted.nom) session.order.nom = extracted.nom;
	        if (extracted.telephone) session.order.telephone = extracted.telephone;
	        if (extracted.wilaya_commune) session.order.wilaya_commune = extracted.wilaya_commune;
	
	        // Skip aux etapes manquantes (ne pas redemander ce que le client a deja donne)
	        if (extracted.allFound) {
	          session.state = STATES.AWAITING_CONFIRMATION;
	        } else if (session.order.nom && session.order.telephone && !session.order.wilaya_commune) {
	          session.state = STATES.COLLECTING_LOCATION;
	        } else if (session.order.nom && !session.order.telephone) {
	          session.state = STATES.COLLECTING_PHONE;
	        } else {
	          session.state = STATES.COLLECTING_NAME;
	        }
	      }
	    } else {
	      // Etats de collecte actifs : utiliser l'extraction + la logique d'etat
	
	      if (session.state === STATES.COLLECTING_NAME) {
	        if (extracted.allFound) {
	          session.order.nom = extracted.nom;
	          session.order.telephone = extracted.telephone;
	          session.order.wilaya_commune = extracted.wilaya_commune;
	          session.state = STATES.AWAITING_CONFIRMATION;
	        } else if (extracted.telephone && extracted.wilaya_commune) {
	          if (extracted.nom) session.order.nom = extracted.nom;
	          else session.order.nom = lastContent;
	          session.order.telephone = extracted.telephone;
	          session.order.wilaya_commune = extracted.wilaya_commune;
	          session.state = STATES.AWAITING_CONFIRMATION;
	        } else if (extracted.telephone) {
	          if (extracted.nom) session.order.nom = extracted.nom;
	          else session.order.nom = lastContent.replace(extracted.telephone, '').trim();
	          session.order.telephone = extracted.telephone;
	          session.state = STATES.COLLECTING_LOCATION;
	        } else {
	          // Extraire le nom meme sans telephone
	          if (extracted.nom) session.order.nom = extracted.nom;
	          else session.order.nom = lastContent;
	          session.state = STATES.COLLECTING_PHONE;
	        }
	      } else if (session.state === STATES.COLLECTING_PHONE) {
	        if (extracted.allFound) {
	          session.order.telephone = extracted.telephone;
	          session.order.wilaya_commune = extracted.wilaya_commune;
	          if (extracted.nom) session.order.nom = extracted.nom;
	          session.state = STATES.AWAITING_CONFIRMATION;
	        } else if (extracted.telephone) {
	          session.order.telephone = extracted.telephone;
	          if (extracted.wilaya_commune) {
	            session.order.wilaya_commune = extracted.wilaya_commune;
	            session.state = STATES.AWAITING_CONFIRMATION;
	          } else {
	            session.state = STATES.COLLECTING_LOCATION;
	          }
	        }
	      } else if (session.state === STATES.COLLECTING_LOCATION) {
	        if (extracted.wilaya_commune) {
	          session.order.wilaya_commune = extracted.wilaya_commune;
	          session.state = STATES.AWAITING_CONFIRMATION;
	        } else if (lastContentLower.length > 3) {
	          // Fallback: considerer tout le message comme la localisation
	          session.order.wilaya_commune = lastContent;
	          session.state = STATES.AWAITING_CONFIRMATION;
	        }
	      }
	
	      // Rattrapage: si on a extrait un nom ou telephone qui manquait, les mettre a jour
	      if (extracted.nom && !session.order.nom) session.order.nom = extracted.nom;
	      if (extracted.telephone && !session.order.telephone) session.order.telephone = extracted.telephone;
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

