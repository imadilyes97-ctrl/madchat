import axios from 'axios';

async function imageUrlToDataUrl(imageUrl) {
  const resp = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 10000
  });
  const contentType = resp.headers['content-type'] || 'image/jpeg';
  const base64 = Buffer.from(resp.data).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

async function analyzeImageWithGroq(imageUrl, prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const dataUrl = imageUrl.startsWith('data:') ? imageUrl : await imageUrlToDataUrl(imageUrl);

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.2-11b-vision-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt }
        ]
      }],
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

  const content = response.data.choices[0].message.content;
  return JSON.parse(content.replace(/```json|```/g, '').trim());
}

export async function findMatchingProduct(clientImageUrl, token) {
  const startTime = Date.now();

  const VISUAL_PROMPT = `Décris ce vêtement/produit en détail en JSON avec ces champs exactement:
{
  "type": "type de vêtement (jean, robe, sac, etc.)",
  "couleur": "couleur principale",
  "couleurs_secondaires": ["autres couleurs"],
  "matiere": "tissu ou matière",
  "style": "slim, large, casual, etc.",
  "details": "détails visuels importants"
}
Réponds UNIQUEMENT avec le JSON, rien d'autre.`;

  const PRODUCT_VISUAL_PROMPT = `Décris ce produit en JSON:
{
  "type": "type de produit",
  "couleur": "couleur principale",
  "couleurs_secondaires": ["autres couleurs"],
  "matiere": "matière",
  "style": "style",
  "details": "détails visuels"
}
Réponds UNIQUEMENT avec le JSON.`;

  // Étape 1 : Analyser l'image du client
  console.log('[VisionService] Analyzing client image...');
  let clientDescription;
  try {
    clientDescription = await analyzeImageWithGroq(clientImageUrl, VISUAL_PROMPT);
    console.log('[VisionService] Client image analysis complete:', JSON.stringify(clientDescription));
  } catch (err) {
    console.error('[VisionService] Failed to analyze client image:', err.message);
    return null;
  }

  // Étape 2 : Récupérer les produits de la SaaS
  console.log('[VisionService] Fetching products from SaaS...');
  let produits;
  try {
    const productsResp = await axios.get(
      `${process.env.APP_URL}/api/products?token=${token}`,
      { timeout: 10000 }
    );
    produits = productsResp.data.produits || [];
    console.log(`[VisionService] Fetched ${produits.length} products`);
  } catch (err) {
    console.error('[VisionService] Failed to fetch products:', err.message);
    return null;
  }

  // Étape 3 : Analyser chaque photo de produit
  const productsWithDescriptions = [];

  for (const produit of produits) {
    if (!produit.photo_url) continue;

    // Utiliser le cache description_visuelle si la SaaS le fournit
    if (produit.description_visuelle) {
      productsWithDescriptions.push({
        ...produit,
        description_visuelle: produit.description_visuelle
      });
      continue;
    }

    try {
      console.log(`[VisionService] Analyzing product image: ${produit.nom || produit.photo_url.substring(0, 50)}...`);
      const prodDescription = await analyzeImageWithGroq(produit.photo_url, PRODUCT_VISUAL_PROMPT);
      productsWithDescriptions.push({
        ...produit,
        description_visuelle: prodDescription
      });
    } catch (err) {
      console.error(`[VisionService] Failed to analyze product ${produit.nom || 'unknown'}:`, err.message);
    }
  }

  if (productsWithDescriptions.length === 0) {
    console.log('[VisionService] No products with images to compare');
    return null;
  }

  // Étape 4 : Trouver le produit le plus similaire avec DeepSeek
  const matchPrompt = `Tu es un expert en mode. Compare ces descriptions de produits et trouve le plus similaire.

Image envoyée par le client :
${JSON.stringify(clientDescription)}

Produits disponibles :
${productsWithDescriptions.map((p, i) => `
Produit ${i + 1}: ${p.nom}
Description visuelle: ${JSON.stringify(p.description_visuelle)}
Prix: ${p.prix} DZD
Tailles: ${p.tailles?.join(', ')}
Couleurs: ${p.couleurs?.join(', ')}
Stock: ${p.stock}
`).join('\n')}

Réponds en JSON:
{
  "produit_trouve": true/false,
  "index_produit": 0,
  "niveau_similarite": "exact/similaire/approche",
  "raison": "pourquoi ce produit correspond"
}`;

  console.log('[VisionService] Finding best match with DeepSeek...');
  try {
    const matchResp = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: matchPrompt }],
        max_tokens: 200,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const match = JSON.parse(
      matchResp.data.choices[0].message.content.replace(/```json|```/g, '').trim()
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[VisionService] Match result: ${match.produit_trouve ? 'FOUND' : 'NOT FOUND'} (${match.niveau_similarite}) in ${elapsed}s`);

    if (match.produit_trouve && productsWithDescriptions[match.index_produit]) {
      return productsWithDescriptions[match.index_produit];
    }

    return null;
  } catch (err) {
    console.error('[VisionService] DeepSeek matching failed:', err.message);
    return null;
  }
}
