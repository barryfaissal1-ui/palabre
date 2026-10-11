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
-- Les sessions ouvertes avant cette date ne valent plus rien (remplie quand le mot de passe est réinitialisé).
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS sessions_depuis TIMESTAMPTZ;

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

-- Le défi tel qu'il fonctionne : créé par un administrateur (statut 'ouvert'), avec la fin des réponses puis la fin
-- du vote. À la fin, statut 'termine' et la réponse gagnante est notée (colonnes ajoutées après la création des tables).
ALTER TABLE defis ADD COLUMN IF NOT EXISTS fin_reponses_le TIMESTAMPTZ;
ALTER TABLE defis ADD COLUMN IF NOT EXISTS gagnant_reponse_id INTEGER;
ALTER TABLE defi_reponses ADD COLUMN IF NOT EXISTS lien_verifie_le TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_defi_votes_reponse ON defi_votes (reponse_id);

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

-- Notifications enrichies : qui a fait l'action (pour afficher son avatar), de quoi elle parle, et le regroupement
-- (« Awa et 3 autres ont aimé ta publication » : une seule ligne tant qu'elle n'est pas lue).
-- acteurs : les numéros des personnes regroupées, la plus récente en premier ; nombre : combien (ou combien de messages).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS acteur_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS cible_type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS cible_id INTEGER;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS acteurs INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS nombre INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_notifications_groupe ON notifications (utilisateur_id, type, cible_type, cible_id) WHERE lue = FALSE;
-- Notifications écrites AVANT la colonne acteur_id : on retrouve la personne quand c'est sûr, pour afficher son avatar.
-- « acteur_id IS NULL » : chaque ligne n'est complétée qu'une fois, le fichier peut être rejoué sans rien changer.
-- 1) « Awa a accepté ta demande d'ami » : le lien de la notification est le profil de cette personne.
UPDATE notifications n SET acteur_id = u.id, acteurs = ARRAY[u.id]
  FROM utilisateurs u
 WHERE n.acteur_id IS NULL AND n.type = 'ami_accepte' AND n.lien = '/' || u.identifiant;
-- 2) Les autres commencent par le nom de la personne (« Awa Ouédraogo veut t'ajouter en ami. »). On ne complète que
--    si UN SEUL membre porte ce nom : avec deux homonymes on ne devine pas, la ligne garde son icône neutre.
UPDATE notifications n SET acteur_id = trouve.membre, acteurs = ARRAY[trouve.membre]
  FROM (SELECT n2.id, min(u.id) AS membre
          FROM notifications n2
          JOIN utilisateurs u ON u.id <> n2.utilisateur_id
           AND (left(n2.texte, length(u.nom) + 1) = u.nom || ' '
                OR left(n2.texte, length(u.nom) + 18) = 'Bonne nouvelle : ' || u.nom || ' ')
         WHERE n2.acteur_id IS NULL
           AND n2.type IN ('demande_ami', 'demande_message', 'nouvelle_proposition', 'invitation_equipe', 'avis_recu', 'proposition_acceptee')
         GROUP BY n2.id
        HAVING count(*) = 1) trouve
 WHERE n.id = trouve.id;

-- Notifications push : un abonnement par appareil (téléphone, ordinateur) du membre.
-- endpoint : l'adresse donnée par le service de push du navigateur ; p256dh et auth : les clés de l'appareil,
-- avec lesquelles le serveur chiffre chaque message (src/utils/push.js).
CREATE TABLE IF NOT EXISTS abonnements_push (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  endpoint       TEXT NOT NULL UNIQUE,
  p256dh         TEXT NOT NULL,
  auth           TEXT NOT NULL,
  appareil       TEXT,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abonnements_push_membre ON abonnements_push (utilisateur_id);
-- Réglages des notifications du membre, en JSON : { "push": { "messages": false, … } }.
-- Une famille absente vaut « oui » : un nouveau type de notification est donc reçu sans rien migrer.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS preferences_notifications JSONB NOT NULL DEFAULT '{}';

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
-- ============ Conversations de groupe (équipes éclair) ============
-- Une conversation est « privee » (deux membres : membre_a et membre_b, comme depuis le début) ou « groupe ».
-- Un groupe n'a ni membre_a ni membre_b : ses membres sont dans conversation_membres. Les requêtes des
-- conversations privées filtrent sur membre_a / membre_b : elles ne voient donc jamais un groupe, et rien n'y change.
-- Un avis survit à la suppression du compte du client : il reste sur le profil du dev, sans client ni demande
-- (« Ancien client »). La route de suppression vide ces deux colonnes avant de supprimer le compte.
ALTER TABLE avis ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE avis ALTER COLUMN demande_id DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN membre_a DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN membre_b DROP NOT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'privee';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS titre TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS equipe_id INTEGER REFERENCES equipes(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ferme_le TIMESTAMPTZ; -- équipe dissoute : le groupe reste lisible, plus personne n'écrit
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_type_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_type_check CHECK (
  (type = 'privee' AND membre_a IS NOT NULL AND membre_b IS NOT NULL)
  OR (type = 'groupe' AND membre_a IS NULL AND membre_b IS NULL AND titre IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_equipe ON conversations (equipe_id) WHERE equipe_id IS NOT NULL;

-- Qui est dans quelle conversation. role : 'admin' (le chef de l'équipe) ou 'membre'.
-- quitte_le : la personne est partie ; elle ne lit plus rien. sourdine : plus de cloche ni de push pour ce groupe.
CREATE TABLE IF NOT EXISTS conversation_membres (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  membre_id       INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'membre' CHECK (role IN ('admin', 'membre')),
  rejoint_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
  quitte_le       TIMESTAMPTZ,
  sourdine        BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (conversation_id, membre_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_membres_membre ON conversation_membres (membre_id) WHERE quitte_le IS NULL;
-- Un message « système » (« Awa a rejoint l'équipe ») s'affiche au centre et ne compte pas comme non lu.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS systeme BOOLEAN NOT NULL DEFAULT FALSE;

-- ============ Réactions, réponses, suppression ============
-- Une réaction par personne et par message (clé primaire) : en choisir une autre remplace la précédente.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  membre_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  cree_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, membre_id)
);
-- « Supprimer pour moi » : le message reste chez les autres, il disparaît seulement pour ce membre.
CREATE TABLE IF NOT EXISTS messages_masques (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  membre_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, membre_id)
);
-- reponse_a : le message cité. supprime_le : supprimé pour tout le monde (texte et photo effacés).
-- modifie_le : touché à chaque réaction ou suppression, pour que les pages ouvertes redessinent ce message.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reponse_a INTEGER REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS supprime_le TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS modifie_le TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_messages_modifie ON messages (conversation_id, modifie_le);

-- ============ Présence : « en ligne », « écrit… » ============
-- vu_le : dernière activité du membre, notée au plus une fois par minute. masquer_presence : il cache son statut
-- (et ne voit alors pas celui des autres).
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS vu_le TIMESTAMPTZ;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS masquer_presence BOOLEAN NOT NULL DEFAULT FALSE;
-- Qui écrit dans quelle conversation, jusqu'à quand (6 secondes après le dernier signal). UNLOGGED : ces lignes
-- ne valent que quelques secondes, inutile de les protéger contre une panne du serveur de base de données.
CREATE UNLOGGED TABLE IF NOT EXISTS ecritures (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  membre_id       INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  jusqu_a         TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (conversation_id, membre_id)
);

-- ============ Messages vocaux ============
-- La table fichiers accepte aussi l'audio (WebM / Opus, Ogg, MP4 / AAC selon le téléphone).
ALTER TABLE fichiers DROP CONSTRAINT IF EXISTS fichiers_type_mime_check;
ALTER TABLE fichiers ADD CONSTRAINT fichiers_type_mime_check
  CHECK (type_mime IN ('image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4'));
-- Durée du message vocal, en secondes. Renseignée : le fichier joint est un son, pas une photo.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS vocal_duree INTEGER CHECK (vocal_duree BETWEEN 1 AND 60);

-- ============ Appels audio et vidéo ============
-- statut : sonne → en_cours → termine ; ou manque (personne n'a décroché en 30 secondes, refus, appelant parti).
CREATE TABLE IF NOT EXISTS appels (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  appelant_id     INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('audio', 'video')),
  statut          TEXT NOT NULL DEFAULT 'sonne' CHECK (statut IN ('sonne', 'en_cours', 'termine', 'manque')),
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  debut_le        TIMESTAMPTZ, -- quand quelqu'un a décroché
  fin_le          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_appels_actifs ON appels (conversation_id) WHERE statut IN ('sonne', 'en_cours');
-- etat : invite (ça sonne chez lui), present, refuse, parti. vu_le : son dernier signe de vie pendant l'appel.
CREATE TABLE IF NOT EXISTS appel_participants (
  appel_id  INTEGER NOT NULL REFERENCES appels(id) ON DELETE CASCADE,
  membre_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  etat      TEXT NOT NULL DEFAULT 'invite' CHECK (etat IN ('invite', 'present', 'refuse', 'parti')),
  vu_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (appel_id, membre_id)
);
CREATE INDEX IF NOT EXISTS idx_appel_participants_membre ON appel_participants (membre_id);
-- Les messages techniques que les navigateurs s'échangent pour se relier (offre, réponse, candidats ICE).
-- Ils ne servent que quelques secondes et sont effacés à la fin de l'appel : table UNLOGGED.
CREATE UNLOGGED TABLE IF NOT EXISTS appel_signaux (
  id       BIGSERIAL PRIMARY KEY,
  appel_id INTEGER NOT NULL REFERENCES appels(id) ON DELETE CASCADE,
  de_id    INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  pour_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type     TEXT NOT NULL,
  contenu  JSONB,
  cree_le  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appel_signaux_pour ON appel_signaux (appel_id, pour_id, id);
-- La ligne que l'appel laisse dans la conversation (« Appel audio, 4 min », « Appel manqué »).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS appel_id INTEGER REFERENCES appels(id) ON DELETE SET NULL;

-- Reprise de l'existant, rejouable sans rien doubler (ON CONFLICT DO NOTHING, NOT EXISTS) :
-- 1) les deux membres de chaque conversation privée ;
INSERT INTO conversation_membres (conversation_id, membre_id, rejoint_le)
SELECT c.id, m.membre, c.cree_le FROM conversations c CROSS JOIN LATERAL (VALUES (c.membre_a), (c.membre_b)) AS m(membre)
 WHERE c.type = 'privee'
ON CONFLICT DO NOTHING;
-- 2) un groupe pour chaque équipe éclair créée avant cette fonction, avec son chef, ses membres qui ont accepté,
--    et le client s'il a déjà choisi cette équipe.
INSERT INTO conversations (type, titre, equipe_id, cree_par, statut)
SELECT 'groupe', 'Équipe : ' || left(d.titre, 60), e.id, e.chef_id, 'acceptee'
  FROM equipes e JOIN demandes d ON d.id = e.demande_id
 WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.equipe_id = e.id);
INSERT INTO conversation_membres (conversation_id, membre_id, role)
SELECT c.id, em.dev_id, CASE WHEN em.dev_id = e.chef_id THEN 'admin' ELSE 'membre' END
  FROM conversations c JOIN equipes e ON e.id = c.equipe_id
  JOIN equipe_membres em ON em.equipe_id = e.id AND em.statut = 'accepte'
ON CONFLICT DO NOTHING;
INSERT INTO conversation_membres (conversation_id, membre_id, role)
SELECT c.id, d.client_id, 'membre'
  FROM conversations c JOIN equipes e ON e.id = c.equipe_id
  JOIN propositions p ON p.equipe_id = e.id AND p.statut = 'acceptee'
  JOIN demandes d ON d.id = e.demande_id
ON CONFLICT DO NOTHING;

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

-- ============ Paramètres et confidentialité ============
-- Réglages de confidentialité (src/utils/confidentialite.js). Une clé absente = la valeur par défaut, c'est-à-dire
-- le comportement d'avant : rien ne change pour un membre qui ne règle rien.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS confidentialite JSONB NOT NULL DEFAULT '{}';
-- Dernière connexion : la date et le type d'appareil (« Chrome sur Android »). Jamais l'adresse IP.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS derniere_connexion_le TIMESTAMPTZ;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS derniere_connexion_appareil TEXT;
-- Compte supprimé : ce qui reste est un compte vide, « Membre parti », auquel sont rattachés les messages déjà
-- envoyés aux autres. Personne ne peut s'y connecter ni lui écrire.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS supprime_le TIMESTAMPTZ;

-- Changement d'email en attente : le code (haché) est envoyé à la NOUVELLE adresse. Une seule demande par membre.
CREATE TABLE IF NOT EXISTS changements_email (
  utilisateur_id INTEGER PRIMARY KEY REFERENCES utilisateurs(id) ON DELETE CASCADE,
  email          TEXT NOT NULL CHECK (email = lower(email)),
  code_hash      TEXT NOT NULL,
  expire_le      TIMESTAMPTZ NOT NULL,
  essais         INTEGER NOT NULL DEFAULT 0,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- « Télécharger mes données » : 3 par jour au plus.
CREATE TABLE IF NOT EXISTS exports_donnees (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exports_donnees_membre ON exports_donnees (utilisateur_id, cree_le DESC);

-- Langue du membre : 'fr' ou 'en'. Vide tant qu'il n'a pas choisi (le site suit alors son navigateur).
-- Sert au serveur pour écrire dans la bonne langue ce qu'il lui envoie : notifications, push, emails.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS langue TEXT;
ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_langue_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_langue_check CHECK (langue IN ('fr', 'en'));

-- ============ Sécurité des comptes ============
-- Une session par appareil connecté. Le jeton du cookie porte l'identifiant de la session ; chaque requête vérifie
-- qu'elle existe et n'est pas révoquée. L'adresse IP n'est gardée que pour les alertes : aucune route ne la renvoie.
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  appareil       TEXT NOT NULL,
  ip             TEXT,
  pays           TEXT,
  ville          TEXT,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now(),
  vu_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoquee_le    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_membre ON sessions (utilisateur_id, vu_le DESC);

-- Appareils connus d'un membre : l'empreinte du numéro porté par le cookie d'appareil (src/utils/appareils.js).
-- confiance : « Faire confiance à cet appareil », qui dispense du code de la validation en deux étapes.
CREATE TABLE IF NOT EXISTS appareils_connus (
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  appareil_hash  TEXT NOT NULL,
  confiance      BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now(),
  vu_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (utilisateur_id, appareil_hash)
);

-- Validation en deux étapes (coupée par défaut) et verrou posé par « Ce n'était pas moi » : tant que verrouille_le
-- est rempli, la connexion est refusée ; choisir un nouveau mot de passe (lien reçu par email) rouvre le compte.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS deux_etapes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS verrouille_le TIMESTAMPTZ;

-- Les codes à 6 chiffres servent à deux choses : confirmer l'email à l'inscription, et valider une connexion.
ALTER TABLE confirmations_email ADD COLUMN IF NOT EXISTS motif TEXT NOT NULL DEFAULT 'inscription';
ALTER TABLE confirmations_email DROP CONSTRAINT IF EXISTS confirmations_email_motif_check;
ALTER TABLE confirmations_email ADD CONSTRAINT confirmations_email_motif_check CHECK (motif IN ('inscription', 'connexion'));

-- Codes de secours de la validation en deux étapes : 8 par membre, à usage unique, gardés hachés.
CREATE TABLE IF NOT EXISTS codes_secours (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  code_hash      TEXT NOT NULL,
  utilise_le     TIMESTAMPTZ,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_codes_secours_membre ON codes_secours (utilisateur_id);

-- Lien « Ce n'était pas moi » de l'email d'alerte : à usage unique, 24 heures, gardé haché.
CREATE TABLE IF NOT EXISTS alertes_connexion (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  jeton_hash     TEXT NOT NULL UNIQUE,
  session_id     TEXT,
  expire_le      TIMESTAMPTZ NOT NULL,
  utilise_le     TIMESTAMPTZ,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Essais de mot de passe, comptés par compte (en plus de la limite par adresse IP) : après 10 mots de passe faux en
-- 15 minutes, la connexion à ce compte est refusée pendant 15 minutes, même avec le bon mot de passe.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS echecs_connexion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS echecs_depuis TIMESTAMPTZ;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS connexion_bloquee_jusqu_a TIMESTAMPTZ;

-- Journal de sécurité : ce qui s'est passé d'important sur un compte, lu par son propriétaire dans /parametres.
-- Gardé 90 jours (src/utils/journal.js). Ni adresse IP ni texte libre : un type, un appareil, une date.
CREATE TABLE IF NOT EXISTS journal_securite (
  id             BIGSERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('connexion', 'connexion_refusee', 'nouvel_appareil', 'mot_de_passe_change', 'email_change',
                   'deux_etapes_active', 'deux_etapes_coupee', 'session_revoquee', 'compte_desactive', 'compte_reactive')),
  appareil       TEXT,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_securite_membre ON journal_securite (utilisateur_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_journal_securite_date ON journal_securite (cree_le);

-- Compte désactivé (par son propriétaire) : profil, publications, projets et propositions invisibles ; dans les
-- conversations, son nom devient « Membre indisponible ». Tout revient quand il se reconnecte.
-- suppression_prevue_le : il a demandé la suppression ; passé cette date (30 jours), le ménage supprime le compte.
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS desactive_le TIMESTAMPTZ;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS suppression_prevue_le TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_utilisateurs_suppression ON utilisateurs (suppression_prevue_le) WHERE suppression_prevue_le IS NOT NULL;

-- Lien « Annuler la suppression » de l'email : un par membre, à usage unique, gardé haché.
CREATE TABLE IF NOT EXISTS annulations_suppression (
  utilisateur_id INTEGER PRIMARY KEY REFERENCES utilisateurs(id) ON DELETE CASCADE,
  jeton_hash     TEXT NOT NULL UNIQUE,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Modifier, corbeille ============
-- Une publication ou un commentaire peut être modifié par son auteur pendant 48 heures (le texte seulement).
-- La page montre une mention discrète « modifiée » ; l'ancien texte est gardé dans historique_textes, que seul un
-- administrateur lit (pour juger un signalement : on ne peut pas publier une insulte puis la maquiller).
ALTER TABLE publications ADD COLUMN IF NOT EXISTS modifiee_le TIMESTAMPTZ;
ALTER TABLE commentaires ADD COLUMN IF NOT EXISTS modifie_le TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS historique_textes (
  id         SERIAL PRIMARY KEY,
  cible_type TEXT NOT NULL CHECK (cible_type IN ('publication', 'commentaire')),
  cible_id   INTEGER NOT NULL,
  auteur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  texte      TEXT NOT NULL,
  cree_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_historique_textes_cible ON historique_textes (cible_type, cible_id, id);

-- Corbeille : une publication supprimée par son auteur n'est plus visible de personne, mais reste 30 jours dans la
-- rubrique « Corbeille » de ses paramètres (restaurer, ou supprimer définitivement). Le ménage la vide ensuite.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS supprimee_le TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_publications_corbeille ON publications (supprimee_le) WHERE supprimee_le IS NOT NULL;

-- ============ Modération ============
-- Acceptation des règles de la communauté : la date et la version acceptée (src/utils/regles.js).
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS regles_acceptees_le TIMESTAMPTZ;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS regles_version INTEGER;

-- La file « À modérer » : un contenu que le filtre automatique a retenu (il ressemble à une arnaque). Il est caché
-- (colonne masque de sa table) jusqu'à la décision d'un administrateur : « approuve » le rend visible, « retire » non.
CREATE TABLE IF NOT EXISTS moderation_attente (
  id         SERIAL PRIMARY KEY,
  cible_type TEXT NOT NULL CHECK (cible_type IN ('publication', 'commentaire', 'demande', 'projet')),
  cible_id   INTEGER NOT NULL,
  auteur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  raison     TEXT NOT NULL,
  cree_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decide_le  TIMESTAMPTZ,
  decision   TEXT CHECK (decision IN ('approuve', 'retire')),
  decide_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_attente_ouverte ON moderation_attente (cible_type, cible_id) WHERE decide_le IS NULL;

-- Domaines que les administrateurs interdisent dans les liens, en plus des listes du filtre (/admin).
CREATE TABLE IF NOT EXISTS domaines_interdits (
  domaine    TEXT PRIMARY KEY CHECK (domaine = lower(domaine)),
  ajoute_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);
