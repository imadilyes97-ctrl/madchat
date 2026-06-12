-- ============================================
-- Migration : Cache des descriptions visuelles
-- ============================================
-- But : Stocker l'analyse Groq de chaque photo produit
-- pour éviter d'appeler l'API à chaque message.
-- ============================================

-- 1. Ajouter la colonne description_visuelle à la table produits
ALTER TABLE produits
ADD COLUMN IF NOT EXISTS description_visuelle JSONB;

-- 2. Index pour recherche rapide des produits sans description
CREATE INDEX IF NOT EXISTS idx_produits_description_manquante
ON produits (id)
WHERE description_visuelle IS NULL;

-- 3. Fonction pour mettre à jour la description quand la photo change
CREATE OR REPLACE FUNCTION trigger_update_description_visuelle()
RETURNS TRIGGER AS $$
BEGIN
  -- Invalider le cache si la photo change
  IF TG_OP = 'UPDATE' AND OLD.photo_url IS DISTINCT FROM NEW.photo_url THEN
    NEW.description_visuelle := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Appliquer le trigger sur la table produits
DROP TRIGGER IF EXISTS trg_update_description_visuelle ON produits;
CREATE TRIGGER trg_update_description_visuelle
BEFORE INSERT OR UPDATE ON produits
FOR EACH ROW
EXECUTE FUNCTION trigger_update_description_visuelle();

-- 5. (Optionnel) Voir les produits sans description
-- SELECT id, nom, photo_url FROM produits WHERE description_visuelle IS NULL;
