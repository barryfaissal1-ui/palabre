-- Palabre — schéma de la base de données (PostgreSQL 16+)
-- Le script est idempotent : il peut être relancé sans casser les données.

-- Pas d extension requise : emails et identifiants sont stockés en minuscules.

-- ============ Comptes ============
CREATE TABLE IF NOT EXISTS utilisateurs (
  id                SERIAL PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('dev', 'client')),
  est_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  nom               TEXT NOT NULL CHECK (char_length(nom) BETWEEN 2 AND 101), -- le nom affiché : « Prénom Nom »
  identifiant       TEXT NOT NULL UNIQUE CHECK (identifiant ~ '^[a-z0-9-]{3,30}$'),
  email             TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  mot_de_passe_hash TEXT NOT NULL,
  pays              TEXT NOT NULL,
  ville             TEXT NOT NULL,
  whatsapp          TEXT,
  bio               TEXT CHECK (char_length(bio) <= 500),
  avatar            TEXT,
  disponible        BOOLEAN NOT NULL DEFAULT TRUE,
  bloque            BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reinitialisations_mdp (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  jeton_hash     TEXT NOT NULL UNIQUE,
  expire_le      TIMESTAMPTZ NOT NULL,
  utilise_le     TIMESTAMPTZ
);

-- ============ Compétences ============
CREATE TABLE IF NOT EXISTS competences (
  id  SERIAL PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS utilisateur_competences (
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  competence_id  INTEGER NOT NULL REFERENCES competences(id) ON DELETE CASCADE,
  PRIMARY KEY (utilisateur_id, competence_id)
);

-- ============ Profil prouvé ============
CREATE TABLE IF NOT EXISTS projets (
  id              SERIAL PRIMARY KEY,
  dev_id          INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  titre           TEXT NOT NULL CHECK (char_length(titre) BETWEEN 3 AND 100),
  description     TEXT CHECK (char_length(description) <= 1000),
  secteur         TEXT NOT NULL DEFAULT 'autre',
  lien            TEXT,
  image           TEXT,
  lien_verifie_le TIMESTAMPTZ,
  publier_facebook BOOLEAN NOT NULL DEFAULT FALSE,
  statut_facebook TEXT NOT NULL DEFAULT 'non' CHECK (statut_facebook IN ('non', 'en_attente', 'valide', 'publie', 'refuse')),
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un administrateur peut masquer un projet signalé (colonne ajoutée après la création de la table).
ALTER TABLE projets ADD COLUMN IF NOT EXISTS masque BOOLEAN NOT NULL DEFAULT FALSE;
-- Date où un administrateur a marqué le projet « publié » sur la page Facebook (statut_facebook = 'publie').
-- Sert aussi à compter les publications du jour : 5 au plus.
ALTER TABLE projets ADD COLUMN IF NOT EXISTS publie_facebook_le TIMESTAMPTZ;
-- Prénom et nom de famille, saisis séparément. La colonne « nom » reste : c'est le nom affiché (« Prénom Nom »),
-- recalculé à chaque inscription ou modification du profil. Tout le reste du code continue de lire « nom ».
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS prenom TEXT;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS nom_famille TEXT;
-- Comptes créés avant cette séparation : le premier mot du nom devient le prénom, le reste le nom de famille.
-- « WHERE prenom IS NULL » : ce remplissage ne se fait qu'une fois par compte, même si le fichier est rejoué.
UPDATE utilisateurs
   SET prenom = split_part(btrim(nom), ' ', 1),
       nom_famille = btrim(substr(btrim(nom), length(split_part(btrim(nom), ' ', 1)) + 1))
 WHERE prenom IS NULL;
-- Deux champs de 50 caractères et une espace : le nom affiché peut maintenant atteindre 101 caractères.
ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_nom_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_nom_check CHECK (char_length(nom) BETWEEN 2 AND 101);
-- Photo de couverture du profil (numéro du fichier, comme avatar).
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS couverture TEXT;

-- ============ Inscription en deux étapes ============
-- Confirmation de l'email. La colonne est créée dans un bloc DO pour que les comptes qui existaient AVANT
-- soient marqués « confirmés » une seule fois : au premier passage seulement, quand la colonne n'existe pas encore.
-- (Un simple « UPDATE … WHERE email_confirme_le IS NULL » confirmerait tous les nouveaux comptes à chaque démarrage.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'utilisateurs' AND column_name = 'email_confirme_le') THEN
    ALTER TABLE utilisateurs ADD COLUMN email_confirme_le TIMESTAMPTZ;
    UPDATE utilisateurs SET email_confirme_le = cree_le;
  END IF;
END $$;

-- Codes à 6 chiffres envoyés par email. Le code n'est jamais gardé en clair : seulement son empreinte.
-- Une ligne par envoi (elles servent aussi à limiter « Renvoyer le code ») ; seule la plus récente est valable.
CREATE TABLE IF NOT EXISTS confirmations_email (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  code_hash      TEXT NOT NULL,
  expire_le      TIMESTAMPTZ NOT NULL,
  essais         INTEGER NOT NULL DEFAULT 0,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_confirmations_email_membre ON confirmations_email (utilisateur_id, id DESC);

-- Page 2 des développeurs (« Ton profil de dev »). La date de naissance ne sort jamais par l'API publique.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS date_naissance DATE;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS specialite TEXT;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS experience TEXT;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS lien_github TEXT;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS lien_github_verifie_le TIMESTAMPTZ;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS lien_gitlab TEXT;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS lien_gitlab_verifie_le TIMESTAMPTZ;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS lien_portfolio TEXT;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS lien_portfolio_verifie_le TIMESTAMPTZ;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS lien_linkedin TEXT;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS lien_linkedin_verifie_le TIMESTAMPTZ;
-- Vide tant que le dev n'a pas rempli la page 2 : il peut regarder le site, mais pas répondre aux demandes.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS profil_complete_le TIMESTAMPTZ;

-- ============ Réseau social ============
CREATE TABLE IF NOT EXISTS publications (
  id        SERIAL PRIMARY KEY,
  auteur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type      TEXT NOT NULL CHECK (type IN ('idee', 'question', 'projet')),
  texte     TEXT NOT NULL CHECK (char_length(texte) BETWEEN 1 AND 3000),
  image     TEXT,
  masque    BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Taille de l'image jointe : le navigateur réserve sa place avant qu'elle soit chargée (la page ne saute pas).
ALTER TABLE publications ADD COLUMN IF NOT EXISTS image_largeur INTEGER;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS image_hauteur INTEGER;
-- Vidéo jointe : seulement la plateforme et l'identifiant de la vidéo (src/utils/videos.js), jamais une adresse libre.
-- Les deux contraintes sont une seconde barrière : même une écriture directe en base ne peut pas y mettre autre chose.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS video_plateforme TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS video_id TEXT;
ALTER TABLE publications DROP CONSTRAINT IF EXISTS publications_video_check;
ALTER TABLE publications ADD CONSTRAINT publications_video_check CHECK (
  (video_plateforme IS NULL AND video_id IS NULL)
  OR (video_plateforme IN ('youtube', 'tiktok', 'facebook') AND video_id ~ '^[A-Za-z0-9_-]{4,25}$'));

CREATE TABLE IF NOT EXISTS commentaires (
  id             SERIAL PRIMARY KEY,
  publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  auteur_id      INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  texte          TEXT NOT NULL CHECK (char_length(texte) BETWEEN 1 AND 1000),
  masque         BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jaime (
  publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  PRIMARY KEY (publication_id, utilisateur_id)
);

CREATE TABLE IF NOT EXISTS amities (
  demandeur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  receveur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  statut       TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'acceptee', 'refusee')),
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (demandeur_id, receveur_id),
  CHECK (demandeur_id <> receveur_id)
);

-- ============ Demandes des clients ============
CREATE TABLE IF NOT EXISTS demandes (
  id          SERIAL PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  titre       TEXT NOT NULL CHECK (char_length(titre) BETWEEN 5 AND 120),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 20 AND 3000),
  budget_fcfa INTEGER CHECK (budget_fcfa >= 0),
  delai       TEXT,
  categorie   TEXT NOT NULL DEFAULT 'autre',
  statut      TEXT NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'attribuee', 'terminee', 'annulee')),
  masque      BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Équipes éclair ============
CREATE TABLE IF NOT EXISTS equipes (
  id         SERIAL PRIMARY KEY,
  demande_id INTEGER NOT NULL REFERENCES demandes(id) ON DELETE CASCADE,
  chef_id    INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (demande_id, chef_id)
);

CREATE TABLE IF NOT EXISTS equipe_membres (
  equipe_id INTEGER NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
  dev_id    INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,
  statut    TEXT NOT NULL DEFAULT 'invite' CHECK (statut IN ('invite', 'accepte', 'refuse')),
  PRIMARY KEY (equipe_id, dev_id)
);

-- Une proposition vient soit d'un dev seul, soit d'une équipe (jamais les deux).
CREATE TABLE IF NOT EXISTS propositions (
  id           SERIAL PRIMARY KEY,
  demande_id   INTEGER NOT NULL REFERENCES demandes(id) ON DELETE CASCADE,
  dev_id       INTEGER REFERENCES utilisateurs(id) ON DELETE CASCADE,
  equipe_id    INTEGER REFERENCES equipes(id) ON DELETE CASCADE,
  message      TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  montant_fcfa INTEGER CHECK (montant_fcfa >= 0),
  statut       TEXT NOT NULL DEFAULT 'envoyee' CHECK (statut IN ('brouillon', 'envoyee', 'acceptee', 'refusee')),
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((dev_id IS NULL) <> (equipe_id IS NULL))
);

-- Avis : contrôlé côté serveur (demande terminée, client auteur, dev dans la proposition retenue).
CREATE TABLE IF NOT EXISTS avis (
  id          SERIAL PRIMARY KEY,
  demande_id  INTEGER NOT NULL REFERENCES demandes(id) ON DELETE CASCADE,
  client_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  dev_id      INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  note        SMALLINT NOT NULL CHECK (note BETWEEN 1 AND 5),
  commentaire TEXT CHECK (char_length(commentaire) <= 1000),
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (demande_id, dev_id)
);

-- ============ Défi de la semaine ============
CREATE TABLE IF NOT EXISTS defis (
  id          SERIAL PRIMARY KEY,
  auteur_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  titre       TEXT NOT NULL,
  probleme    TEXT NOT NULL,
  debut_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin_vote_le TIMESTAMPTZ,
  statut      TEXT NOT NULL DEFAULT 'propose' CHECK (statut IN ('propose', 'ouvert', 'vote', 'termine', 'refuse')),
  gagnant_id  INTEGER,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defi_reponses (
  id      SERIAL PRIMARY KEY,
  defi_id INTEGER NOT NULL REFERENCES defis(id) ON DELETE CASCADE,
  dev_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  texte   TEXT NOT NULL,
  lien    TEXT,
  image   TEXT,
  cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (defi_id, dev_id)
);

CREATE TABLE IF NOT EXISTS defi_votes (
  defi_id        INTEGER NOT NULL REFERENCES defis(id) ON DELETE CASCADE,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  reponse_id     INTEGER NOT NULL REFERENCES defi_reponses(id) ON DELETE CASCADE,
  PRIMARY KEY (defi_id, utilisateur_id)
);

-- ============ Notifications et signalements ============
CREATE TABLE IF NOT EXISTS notifications (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  texte          TEXT NOT NULL,
  lien           TEXT,
  lue            BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signalements (
  id          SERIAL PRIMARY KEY,
  auteur_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cible_type  TEXT NOT NULL CHECK (cible_type IN ('publication', 'commentaire', 'profil', 'demande', 'projet', 'message')),
  cible_id    INTEGER NOT NULL,
  motif       TEXT NOT NULL CHECK (char_length(motif) BETWEEN 3 AND 500),
  statut      TEXT NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'traite', 'rejete')),
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (auteur_id, cible_type, cible_id)
);

-- ============ Fichiers (photos de profil, images de projets) ============
-- Les images, déjà compressées par le navigateur (quelques dizaines de Ko), sont gardées dans la base :
-- elles survivent ainsi aux redéploiements du serveur, sans service de stockage supplémentaire.
CREATE TABLE IF NOT EXISTS fichiers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proprietaire_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type_mime      TEXT NOT NULL CHECK (type_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  taille         INTEGER NOT NULL CHECK (taille > 0 AND taille <= 512000),
  donnees        BYTEA NOT NULL,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Messagerie privée (Palabre Messages) ============
-- Une conversation relie exactement deux membres. membre_a < membre_b : une seule ligne par paire, quel que soit
-- celui qui a écrit le premier. statut 'demande' : premier message d'un inconnu, en attente d'être accepté.
CREATE TABLE IF NOT EXISTS conversations (
  id                 SERIAL PRIMARY KEY,
  membre_a           INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  membre_b           INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  demande_id         INTEGER REFERENCES demandes(id) ON DELETE SET NULL, -- la demande dont on parle (client et dev)
  statut             TEXT NOT NULL DEFAULT 'acceptee' CHECK (statut IN ('demande', 'acceptee')),
  cree_par           INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le            TIMESTAMPTZ NOT NULL DEFAULT now(),
  dernier_message_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (membre_a < membre_b),
  UNIQUE (membre_a, membre_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  auteur_id       INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  texte           TEXT NOT NULL CHECK (char_length(texte) BETWEEN 1 AND 2000),
  fichier_id      UUID REFERENCES fichiers(id) ON DELETE SET NULL, -- photo facultative
  masque          BOOLEAN NOT NULL DEFAULT FALSE,                  -- masqué par un administrateur après un signalement
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jusqu'où chaque membre a lu : sert au compteur de non lus et à la mention « Vu ».
CREATE TABLE IF NOT EXISTS conversation_lectures (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  membre_id       INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  dernier_lu_id   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, membre_id)
);

-- Un membre en bloque un autre : celui-ci ne peut plus lui écrire ni voir leurs conversations.
CREATE TABLE IF NOT EXISTS blocages (
  bloqueur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  bloque_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bloqueur_id, bloque_id),
  CHECK (bloqueur_id <> bloque_id)
);

-- Conversation cachée d'un seul côté : demande de message refusée, ou « Supprimer la conversation ».
CREATE TABLE IF NOT EXISTS conversation_masquees (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  membre_id       INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, membre_id)
);

-- On peut maintenant signaler un message. La table signalements existait déjà : sa règle est remplacée
-- (retirer puis remettre la contrainte peut être rejoué sans risque à chaque démarrage).
ALTER TABLE signalements DROP CONSTRAINT IF EXISTS signalements_cible_type_check;
ALTER TABLE signalements ADD CONSTRAINT signalements_cible_type_check
  CHECK (cible_type IN ('publication', 'commentaire', 'profil', 'demande', 'projet', 'message'));

-- ============ Index ============
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_conversations_membre_b ON conversations (membre_b);
CREATE INDEX IF NOT EXISTS idx_publications_date ON publications (cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_commentaires_pub ON commentaires (publication_id);
CREATE INDEX IF NOT EXISTS idx_demandes_statut ON demandes (statut, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_projets_secteur ON projets (secteur, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (utilisateur_id, lue, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_utilisateurs_ville ON utilisateurs (pays, ville);
CREATE INDEX IF NOT EXISTS idx_publications_auteur ON publications (auteur_id);
CREATE INDEX IF NOT EXISTS idx_amities_receveur ON amities (receveur_id, statut);
-- Une seule ligne par paire de membres : A→B interdit B→A (pas de demandes en double dans les deux sens).
CREATE UNIQUE INDEX IF NOT EXISTS idx_amities_paire
  ON amities (LEAST(demandeur_id, receveur_id), GREATEST(demandeur_id, receveur_id));
-- Un dev n'envoie qu'une proposition en solo par demande ; une équipe n'a qu'une proposition.
CREATE UNIQUE INDEX IF NOT EXISTS idx_propositions_solo ON propositions (demande_id, dev_id) WHERE dev_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_propositions_equipe ON propositions (equipe_id) WHERE equipe_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_propositions_demande ON propositions (demande_id);
CREATE INDEX IF NOT EXISTS idx_equipe_membres_dev ON equipe_membres (dev_id, statut);
CREATE INDEX IF NOT EXISTS idx_projets_dev ON projets (dev_id);
CREATE INDEX IF NOT EXISTS idx_avis_dev ON avis (dev_id);

-- ============ Données de base ============
INSERT INTO competences (nom) VALUES
  ('HTML/CSS'), ('JavaScript'), ('TypeScript'), ('React'), ('Vue.js'), ('Angular'),
  ('Node.js'), ('PHP'), ('Laravel'), ('Python'), ('Django'), ('Java'), ('Kotlin'),
  ('Flutter'), ('React Native'), ('Swift'), ('C#'), ('WordPress'), ('PostgreSQL'),
  ('MySQL'), ('MongoDB'), ('Firebase'), ('UI/UX Design'), ('Figma'), ('DevOps'),
  ('Intégration Mobile Money'), ('USSD/SMS'), ('Data/IA'), ('Cybersécurité')
ON CONFLICT (nom) DO NOTHING;
