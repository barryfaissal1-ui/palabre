# Les appels de Palabre et le serveur TURN

Ce guide est pour Barry. Il explique ce qu'est un serveur TURN, quand il en faut un, et comment en installer un (coturn) sur un serveur cloud Systalink.

**À retenir d'abord : sans TURN, les appels marchent déjà.** TURN ne sert qu'aux réseaux qui empêchent deux téléphones de se parler directement. Tu peux mettre Palabre en ligne sans lui, et l'ajouter ensuite.

## 1. Comment un appel trouve son chemin

Le son et l'image d'un appel **ne passent pas par le serveur de Palabre** : ils vont directement d'un téléphone à l'autre. Le serveur de Palabre ne fait que la mise en relation (`src/routes/appels.js`).

Pour se trouver, les deux navigateurs essaient trois chemins, du plus simple au plus sûr :

1. **Direct** : les deux appareils sont sur le même réseau (même Wi-Fi).
2. **Avec STUN** : chaque appareil demande à un serveur STUN « quelle est mon adresse vue d'Internet ? », puis ils se parlent directement. C'est gratuit, Palabre utilise des serveurs STUN publics. Cela suffit dans la plupart des cas.
3. **Avec TURN** : quand le réseau interdit la liaison directe, le son passe par un **relais**. C'est le cas sur certaines connexions mobiles (Orange, Moov, Telecel partagent une même adresse entre beaucoup d'abonnés) et sur les Wi-Fi d'université ou d'entreprise qui bloquent presque tous les ports.

Un relais transporte tout l'appel : il consomme de la bande passante. **Il nous faut donc le nôtre**, les relais publics gratuits n'existent pas vraiment.

## 2. Ce que Palabre attend

Deux variables d'environnement, à ajouter au service web (comme `JWT_SECRET`) :

| Variable | Exemple | À quoi elle sert |
| --- | --- | --- |
| `TURN_URL` | `turns:turn.palabre.dev:443?transport=tcp,turn:turn.palabre.dev:3478` | Les adresses du relais, séparées par des virgules. |
| `TURN_SECRET` | une longue chaîne au hasard | Le secret partagé entre Palabre et coturn. **Ne le mets jamais sur GitHub.** |

Palabre ne donne jamais ce secret aux navigateurs. Pour chaque membre, il calcule des **identifiants valables une heure** (un nom « date limite : numéro du membre » et sa signature). coturn refait le même calcul avec le même secret et accepte, ou non. Un identifiant volé ne sert donc plus au bout d'une heure. C'est la méthode « TURN REST API » de coturn ; elle est testée dans `tests/appels.test.js`.

## 3. Installer coturn sur un serveur cloud Systalink

coturn est un logiciel libre (licence BSD, permise par le concours). Il lui faut **un serveur à part, avec une adresse IP publique** : le plus petit serveur Linux (Ubuntu) suffit pour commencer. Il ne peut pas tourner dans le service web de Palabre.

Je n'ai pas vu l'écran de Systalink : les noms des menus peuvent différer.

### a. Un nom pour le serveur

Dans la zone DNS de ton domaine, ajoute un enregistrement **A** : `turn` → l'adresse IP publique du serveur. Le relais s'appellera `turn.ton-domaine`.

### b. Les ports à ouvrir (pare-feu du serveur et de Systalink)

| Port | Protocole | Pourquoi |
| --- | --- | --- |
| 3478 | UDP et TCP | L'entrée habituelle de TURN. |
| 443 | TCP | TURN chiffré (TLS). C'est le port du web sécurisé : même un Wi-Fi d'université le laisse passer. |
| 49152 à 65535 | UDP | Les ports où le son est relayé. |
| 22 | TCP | Pour t'y connecter (SSH), de préférence limité à ton adresse. |

### c. Installer

Connecte-toi au serveur, puis :

```
sudo apt update
sudo apt install coturn certbot
```

### d. Le certificat (pour le port 443)

Rien d'autre ne doit occuper le port 80 pendant cette commande :

```
sudo certbot certonly --standalone -d turn.ton-domaine
```

Les fichiers sont créés dans `/etc/letsencrypt/live/turn.ton-domaine/`. coturn doit pouvoir les lire :

```
sudo chgrp -R turnserver /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive
```

### e. Le secret

Fabrique-le sur ton ordinateur, et garde-le : il ira à deux endroits.

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### f. Le fichier de configuration

Remplace tout le contenu de `/etc/turnserver.conf` par ceci, avec tes valeurs :

```
# Ports d'écoute : 3478 (habituel) et 443 en TLS (passe les Wi-Fi qui bloquent tout le reste)
listening-port=3478
tls-listening-port=443

# L'adresse IP publique du serveur. Si Systalink lui donne aussi une adresse privée : external-ip=PUBLIQUE/PRIVEE
external-ip=ADRESSE_IP_PUBLIQUE

realm=turn.ton-domaine
server-name=turn.ton-domaine

# Identifiants temporaires calculés par Palabre : le même secret que TURN_SECRET
use-auth-secret
static-auth-secret=LE_SECRET_DE_L_ETAPE_E

cert=/etc/letsencrypt/live/turn.ton-domaine/fullchain.pem
pkey=/etc/letsencrypt/live/turn.ton-domaine/privkey.pem

# Les ports où le son est relayé
min-port=49152
max-port=65535

# Sécurité : empreinte dans les messages, pas d'anciens protocoles, pas de relais vers des machines internes
fingerprint
no-tlsv1
no-tlsv1_1
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255

# Limites : un membre ne peut pas monopoliser le relais
user-quota=12
total-quota=1200
no-cli
```

Le port 443 est « réservé » : il faut autoriser coturn à l'utiliser, puis le démarrer.

```
sudo setcap cap_net_bind_service=+ep /usr/bin/turnserver
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
sudo systemctl status coturn
```

### g. Brancher Palabre

Dans les variables d'environnement du service web de Palabre :

```
TURN_URL=turns:turn.ton-domaine:443?transport=tcp,turn:turn.ton-domaine:3478
TURN_SECRET=LE_SECRET_DE_L_ETAPE_E
```

Redémarre le service web. L'ordre compte peu : le navigateur essaie toutes les adresses et garde la meilleure.

### h. Renouveler le certificat

Le certificat dure 90 jours. certbot le renouvelle seul ; il faut seulement que coturn relise le nouveau :

```
echo 'systemctl restart coturn' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

## 4. Vérifier que le relais marche (outil « Trickle ICE »)

1. Sur Palabre, connecte-toi, puis ouvre `https://ton-site/api/messages/appels/config`. Tu vois les serveurs, avec un `username` et un `credential` valables une heure.
2. Ouvre l'outil **Trickle ICE** des exemples WebRTC : `https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`.
3. Retire le serveur proposé par défaut. Ajoute `turns:turn.ton-domaine:443?transport=tcp` avec le `username` et le `credential` copiés à l'étape 1.
4. Clique « Gather candidates ». **Une ligne de type `relay` doit apparaître** : le relais marche. S'il n'y a que des lignes `host` ou `srflx`, le relais ne répond pas.
5. Refais l'essai avec `turn:turn.ton-domaine:3478`.

Si rien ne vient :

| Ce que tu vois | Cause probable | Quoi faire |
| --- | --- | --- |
| Aucune ligne `relay` | Port fermé | Vérifie le pare-feu du serveur **et** celui de Systalink (3478, 443, 49152-65535). |
| Erreur 401 | Secret différent | `static-auth-secret` et `TURN_SECRET` doivent être identiques ; redémarre coturn et Palabre. |
| Marche en 3478, pas en 443 | Certificat illisible | Refais l'étape d ; regarde `sudo journalctl -u coturn -n 50`. |
| Marche chez toi, pas sur le Wi-Fi de l'université | Le Wi-Fi bloque tout sauf 443 | Garde bien `turns:…:443?transport=tcp` en premier dans `TURN_URL`. |

## 5. Ce que cela coûte

Un appel audio de Palabre consomme environ 24 kb/s dans chaque sens : une heure d'appel relayé pèse à peu près 20 Mo. Un appel vidéo, 350 kb/s : environ 300 Mo par heure. Surveille la consommation du serveur les premiers jours ; `total-quota` limite le nombre de relais ouverts en même temps.

## 6. Ce qui n'a pas pu être vérifié

Je n'ai pas eu de serveur TURN sous la main : cette procédure suit la documentation de coturn, mais **elle n'a pas été jouée de bout en bout**. Ce qui est vérifié de notre côté : le calcul des identifiants temporaires (test automatique), et un vrai appel audio puis vidéo entre deux navigateurs sur le même ordinateur, sans relais. Le premier essai sur un vrai réseau mobile, avec et sans TURN, reste à faire par l'équipe.
