-- Palabre — schéma de la base de données (PostgreSQL 16+)
-- Le script est idempotent : il peut être relancé sans casser les données.

-- Pas d extension requise : emails et identifiants sont stockés en minuscules.

-- ============ Comptes ============
CREATE TABLE IF NOT EXISTS utilisateurs (
  id                SERIAL PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('dev', 'client')),
  est_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  nom               TEXT NOT NULL CHECK (char_length(nom) BETWEEN 2 AND 80),
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
  cible_type  TEXT NOT NULL CHECK (cible_type IN ('publication', 'commentaire', 'profil', 'demande', 'projet')),
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

-- ============ Index ============
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

-- ============ Données de base ============
INSERT INTO competences (nom) VALUES
  ('HTML/CSS'), ('JavaScript'), ('TypeScript'), ('React'), ('Vue.js'), ('Angular'),
  ('Node.js'), ('PHP'), ('Laravel'), ('Python'), ('Django'), ('Java'), ('Kotlin'),
  ('Flutter'), ('React Native'), ('Swift'), ('C#'), ('WordPress'), ('PostgreSQL'),
  ('MySQL'), ('MongoDB'), ('Firebase'), ('UI/UX Design'), ('Figma'), ('DevOps'),
  ('Intégration Mobile Money'), ('USSD/SMS'), ('Data/IA'), ('Cybersécurité')
ON CONFLICT (nom) DO NOTHING;
