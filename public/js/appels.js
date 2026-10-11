// Appels audio et vidéo de Palabre, côté navigateur (WebRTC).
// Chargé seulement quand on en a besoin : par la messagerie (boutons d'appel) ou quand un appel arrive sur une autre page.
//
// Le serveur ne transporte ni le son ni l'image : il met les navigateurs en relation (src/routes/appels.js).
// Ici, chaque participant ouvre une liaison directe (RTCPeerConnection) vers chacun des autres : deux personnes,
// une liaison ; quatre personnes dans un groupe, trois liaisons chacun (« maillage »).
// Pendant un appel, et seulement pendant un appel, la page interroge le serveur chaque seconde pour savoir qui est
// là et recevoir les petits messages techniques (offre, réponse, candidats).
(function () {
  const { t, api, el, avatar, icone, toast, utilisateurConnecte } = window.Palabre;
  const RECONNEXION_MS = 15000; // réseau perdu : on essaie 15 secondes de rétablir la liaison avant de raccrocher
  const SON = { audio: 24000, video: 350000 }; // débits maximum (bits par seconde) : la voix passe en 3G

  let moi = null;
  let serveurs = null;   // { iceServers } : STUN, et TURN avec des identifiants valables une heure
  let appel = null;      // l'appel en cours : { id, type, groupe, flux, pairs, ecran… }
  let sonnerie = null;   // l'écran « on t'appelle » : { id, ecran, minuteur, son }

  // La feuille de style de l'écran d'appel n'est chargée qu'avec ce script.
  if (!document.querySelector('link[data-appels]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: '/css/appels.css', 'data-appels': '' }));
  }
  const calme = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reseauFaible = () => {
    const c = navigator.connection;
    return Boolean(c && (c.saveData || ['slow-2g', '2g', '3g'].includes(c.effectiveType)));
  };
  const minutes = (secondes) => `${Math.floor(secondes / 60)}:${String(Math.floor(secondes % 60)).padStart(2, '0')}`;
  const adresseDe = (a) => (a.groupe ? `/messages/groupe/${a.conversationId}` : `/messages/${a.conversationId}`);

  // ---------- Sons, fabriqués ici (Web Audio) : deux notes douces, rien d'enregistré ni de copié ----------
  let contexteAudio = null;
  function note(frequence, debut, duree, volume = 0.12) {
    const oscillateur = contexteAudio.createOscillator();
    const gain = contexteAudio.createGain();
    oscillateur.type = 'sine';
    oscillateur.frequency.value = frequence;
    gain.gain.setValueAtTime(0, debut);
    gain.gain.linearRampToValueAtTime(volume, debut + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, debut + duree);
    oscillateur.connect(gain).connect(contexteAudio.destination);
    oscillateur.start(debut);
    oscillateur.stop(debut + duree + 0.05);
  }
  // Rend une fonction qui arrête la sonnerie. Si le navigateur refuse le son (aucun geste encore), on se tait.
  function sonner(notes, toutesLes) {
    try {
      contexteAudio = contexteAudio || new (window.AudioContext || window.webkitAudioContext)();
      const jouer = () => { if (contexteAudio.state === 'running') notes.forEach(([f, quand, duree]) => note(f, contexteAudio.currentTime + quand, duree)); };
      contexteAudio.resume().then(jouer).catch(() => {});
      const repetition = setInterval(jouer, toutesLes);
      return () => clearInterval(repetition);
    } catch {
      return () => {};
    }
  }
  const sonEntrant = () => sonner([[659, 0, 0.5], [784, 0.28, 0.7]], 2400);  // mi puis sol
  const sonSortant = () => sonner([[523, 0, 0.9]], 3000);                   // un do, lent

  // ---------- L'écran d'appel ----------
  // Un <dialog> ouvert avec showModal() : au-dessus de tout, plein écran sur téléphone, fenêtre sur ordinateur.
  // Autour de l'avatar, des anneaux de petites feuilles qui tournent lentement (transform seulement).
  function anneaux(nombre = 3) {
    return el('div', { classe: 'appel-anneaux', 'aria-hidden': 'true' }, Array.from({ length: nombre }, (_, rang) => {
      const feuilles = 8 + rang * 4; // 8, 12 puis 16 feuilles : les anneaux extérieurs en portent plus
      return el('span', { classe: `appel-anneau anneau-${rang + 1}` }, Array.from({ length: feuilles }, (__, i) => {
        const feuille = el('i');
        feuille.style.transform = `rotate(${(360 / feuilles) * i}deg) translateY(calc(var(--rayon-anneau) * -1)) rotate(45deg)`;
        return feuille;
      }));
    }));
  }
  function bouton(nom, etiquette, classe, action) {
    const b = el('button', { classe: `appel-bouton ${classe}`, type: 'button', 'aria-label': etiquette, title: etiquette }, [icone(nom)]);
    b.addEventListener('click', action);
    return b;
  }
  function creerEcran(classe) {
    const ecran = el('dialog', { classe: `ecran-appel ${classe}`, 'aria-label': t('appels.appel-palabre') });
    // Échap ne ferme pas un appel par accident : on raccroche avec le bouton.
    ecran.addEventListener('cancel', (evenement) => evenement.preventDefault());
    document.body.append(ecran);
    ecran.showModal();
    return ecran;
  }
  function carteFin(texte) {
    const carte = el('div', { classe: 'appel-fin', role: 'status' }, [el('span', { classe: 'appel-feuille-icone' }, [icone('telephone')]), texte]);
    document.body.append(carte);
    setTimeout(() => carte.classList.add('part'), 2600);
    setTimeout(() => carte.remove(), 3400);
  }

  // ---------- Le micro et la caméra : demandés au moment d'appeler ou de décrocher, jamais avant ----------
  async function ouvrirMedias(type) {
    const video = type === 'video' ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20 }, facingMode: 'user' } : false;
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video });
    } catch (refus) {
      const bloque = refus.name === 'NotAllowedError' || refus.name === 'SecurityError';
      throw new Error(bloque
        ? t(type === 'video' ? 'appels.bloque-video' : 'vocal.micro-bloque')
        : t(type === 'video' ? 'appels.pas-de-camera' : 'vocal.pas-de-micro'));
    }
  }
  async function configuration() {
    serveurs = serveurs || await api('/messages/appels/config');
    return { iceServers: serveurs.iceServers };
  }
  const signaler = (pour, type, contenu) => api(`/messages/appels/${appel.id}/signal`, { methode: 'POST', donnees: { pour, type, contenu } }).catch(() => {});

  // ---------- Une liaison vers un autre participant ----------
  async function relier(participant) {
    if (appel.pairs.has(participant.identifiant)) return;
    const liaison = new RTCPeerConnection(await configuration());
    // Pour ne pas s'envoyer deux offres en même temps : celui dont l'identifiant vient en premier propose toujours.
    const pair = { liaison, participant, propose: moi.identifiant < participant.identifiant, enAttente: [], minuteur: 0, media: null };
    appel.pairs.set(participant.identifiant, pair);
    appel.flux.getTracks().forEach((piste) => liaison.addTrack(piste, appel.flux));

    liaison.addEventListener('icecandidate', (evenement) => { if (evenement.candidate) signaler(participant.identifiant, 'candidat', evenement.candidate.toJSON()); });
    liaison.addEventListener('track', (evenement) => {
      const [flux] = evenement.streams;
      if (pair.media && pair.media.srcObject === flux) return;
      pair.media = appel.type === 'video' ? appel.videoAutre : el('audio', { autoplay: true });
      pair.media.srcObject = flux;
      if (appel.type !== 'video') appel.ecran.append(pair.media);
      pair.media.play().catch(() => {});
      if (!appel.analyseur) ecouterNiveau(flux);
    });
    // Liaison perdue (changement de réseau, tunnel…) : « Reconnexion… », nouvelle tentative, puis on raccroche.
    liaison.addEventListener('iceconnectionstatechange', () => {
      const etatLiaison = liaison.iceConnectionState;
      if (etatLiaison === 'connected' || etatLiaison === 'completed') {
        clearTimeout(pair.minuteur);
        pair.minuteur = 0;
        appel.reconnexion.hidden = ![...appel.pairs.values()].some((p) => p.minuteur);
        limiterDebit(liaison);
      } else if ((etatLiaison === 'disconnected' || etatLiaison === 'failed') && !pair.minuteur) {
        appel.reconnexion.hidden = false;
        relancer(pair);
        pair.minuteur = setTimeout(() => {
          if (appel && appel.groupe) quitterPair(participant.identifiant);
          else raccrocher(t('appels.liaison-perdue'));
        }, RECONNEXION_MS);
      }
    });
    if (pair.propose) await proposer(pair);
  }
  async function proposer(pair, relance = false) {
    try {
      const offre = await pair.liaison.createOffer(relance ? { iceRestart: true } : {});
      await pair.liaison.setLocalDescription(offre);
      await signaler(pair.participant.identifiant, 'offre', pair.liaison.localDescription.toJSON());
    } catch { /* la liaison a été fermée entre-temps */ }
  }
  // Rétablir la liaison (« ICE restart ») : celui qui propose refait une offre ; l'autre le lui demande.
  function relancer(pair) {
    if (pair.propose) proposer(pair, true);
    else signaler(pair.participant.identifiant, 'relance', null);
  }
  function quitterPair(identifiant) {
    const pair = appel && appel.pairs.get(identifiant);
    if (!pair) return;
    clearTimeout(pair.minuteur);
    pair.liaison.close();
    if (pair.media && pair.media.tagName === 'AUDIO') pair.media.remove();
    appel.pairs.delete(identifiant);
  }
  // Voix à 24 kb/s environ, vidéo à 350 kb/s au plus : un appel audio tient dans une connexion 3G.
  function limiterDebit(liaison) {
    liaison.getSenders().forEach((emetteur) => {
      if (!emetteur.track) return;
      const reglages = emetteur.getParameters();
      if (!reglages.encodings || !reglages.encodings.length) reglages.encodings = [{}];
      reglages.encodings[0].maxBitrate = SON[emetteur.track.kind];
      emetteur.setParameters(reglages).catch(() => {});
    });
  }
  async function recevoir(signal) {
    const pair = appel.pairs.get(signal.de);
    if (!pair) return;
    const { liaison } = pair;
    try {
      if (signal.type === 'offre') {
        await liaison.setRemoteDescription(signal.contenu);
        await liaison.setLocalDescription(await liaison.createAnswer());
        await signaler(signal.de, 'reponse', liaison.localDescription.toJSON());
      } else if (signal.type === 'reponse') {
        await liaison.setRemoteDescription(signal.contenu);
      } else if (signal.type === 'candidat') {
        // Un candidat arrivé avant l'offre attend qu'elle soit posée.
        if (liaison.remoteDescription) await liaison.addIceCandidate(signal.contenu);
        else pair.enAttente.push(signal.contenu);
        return;
      } else if (signal.type === 'relance' && pair.propose) {
        await proposer(pair, true);
        return;
      }
      while (pair.enAttente.length) await liaison.addIceCandidate(pair.enAttente.shift());
    } catch { /* un message technique arrivé trop tard pour cette liaison : sans gravité */ }
  }

  // ---------- L'onde de feuilles : elle suit la voix de l'autre (AnalyserNode) ----------
  function ecouterNiveau(flux) {
    if (calme) return;
    try {
      contexteAudio = contexteAudio || new (window.AudioContext || window.webkitAudioContext)();
      const analyseur = contexteAudio.createAnalyser();
      analyseur.fftSize = 256;
      contexteAudio.createMediaStreamSource(flux).connect(analyseur);
      const valeurs = new Uint8Array(analyseur.frequencyBinCount);
      appel.analyseur = analyseur;
      const suivre = () => {
        if (!appel || appel.analyseur !== analyseur) return;
        analyseur.getByteFrequencyData(valeurs);
        const niveau = Math.min(1, valeurs.reduce((total, x) => total + x, 0) / valeurs.length / 90);
        // Uniquement une transformation : les anneaux grossissent un peu quand la voix porte.
        appel.onde.style.transform = `scale(${(1 + niveau * 0.22).toFixed(3)})`;
        requestAnimationFrame(suivre);
      };
      suivre();
    } catch { /* pas d'onde : l'appel marche quand même */ }
  }

  // ---------- Pendant l'appel ----------
  function dessinerAppel(etatAppel, autres) {
    const principal = autres[0] || etatAppel.participants.find((p) => !p.estMoi);
    const titre = etatAppel.groupe ? (appel.titre || t('appels.equipe-eclair')) : principal.nom;
    appel.etatTexte = el('p', { classe: 'appel-etat', role: 'status', texte: t('appels.en-cours') });
    appel.duree = el('span', { classe: 'appel-duree', texte: '0:00' });
    appel.qualite = el('span', { classe: 'appel-qualite', texte: t('appels.reseau-bon') });
    appel.reconnexion = el('p', { classe: 'appel-reconnexion', hidden: true, role: 'status' }, [el('span', { classe: 'feuille-tourne', 'aria-hidden': 'true' }), t('appels.reconnexion')]);
    appel.onde = anneaux(3);
    appel.liste = el('ul', { classe: 'appel-participants' });
    const centre = el('div', { classe: 'appel-centre' }, [
      el('div', { classe: 'appel-avatar' }, [appel.onde, avatar(principal, 'profil')]),
      el('h2', { classe: 'appel-nom', texte: titre }),
      appel.etatTexte,
      el('p', { classe: 'appel-infos' }, [appel.duree, appel.qualite]),
      etatAppel.groupe ? appel.liste : null,
      appel.reconnexion,
    ]);
    const commandes = [];
    const basculer = (b, coupe, etiquettes) => {
      b.classList.toggle('coupe', coupe);
      b.setAttribute('aria-pressed', String(coupe));
      b.setAttribute('aria-label', etiquettes[coupe ? 1 : 0]);
    };
    const micro = bouton('micro', t('appels.couper-micro'), '', () => {
      const piste = appel.flux.getAudioTracks()[0];
      piste.enabled = !piste.enabled;
      basculer(micro, !piste.enabled, [t('appels.couper-micro'), t('appels.rallumer-micro')]);
    });
    commandes.push(micro);
    if (appel.type === 'video') {
      appel.videoAutre = el('video', { classe: 'appel-video-autre', autoplay: true, playsinline: true });
      appel.videoMoi = el('video', { classe: 'appel-video-moi', autoplay: true, playsinline: true });
      appel.videoMoi.muted = true;
      appel.videoMoi.srcObject = appel.flux;
      const camera = bouton('video', t('appels.couper-camera'), '', () => {
        const piste = appel.flux.getVideoTracks()[0];
        piste.enabled = !piste.enabled;
        basculer(camera, !piste.enabled, [t('appels.couper-camera'), t('appels.rallumer-camera')]);
        appel.videoMoi.hidden = !piste.enabled;
      });
      // En 3G ou en économie de données : la caméra démarre éteinte, on l'allume si on veut.
      if (reseauFaible()) camera.click();
      commandes.push(camera);
      // Retourner la caméra (avant / arrière), sur téléphone : la nouvelle piste remplace l'ancienne dans la liaison.
      if (window.matchMedia('(pointer: coarse)').matches) {
        let face = 'user';
        commandes.push(bouton('recharger', t('appels.retourner-camera'), '', async () => {
          face = face === 'user' ? 'environment' : 'user';
          try {
            const nouveau = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: face } });
            const [piste] = nouveau.getVideoTracks();
            const ancienne = appel.flux.getVideoTracks()[0];
            appel.pairs.forEach((pair) => pair.liaison.getSenders().filter((e) => e.track && e.track.kind === 'video').forEach((e) => e.replaceTrack(piste)));
            appel.flux.removeTrack(ancienne);
            ancienne.stop();
            appel.flux.addTrack(piste);
          } catch { toast(t('appels.camera-indisponible'), 'erreur'); }
        }));
      }
      appel.ecran.append(appel.videoAutre, appel.videoMoi);
    }
    commandes.push(bouton('telephone', t('appels.raccrocher'), 'appel-raccrocher', () => raccrocher()));
    appel.ecran.append(centre, el('div', { classe: 'appel-commandes', role: 'group', 'aria-label': t('appels.commandes') }, commandes));
    commandes[commandes.length - 1].focus();
  }

  // La boucle de l'appel : une lecture par seconde, tant qu'il sonne ou qu'il est en cours.
  async function tour() {
    if (!appel) return;
    const { id } = appel;
    let reponse;
    try {
      reponse = await api(`/messages/appels/${id}?apres=${appel.dernierSignal}`);
    } catch (erreur) {
      if (erreur.statut === 404) fin(t('appels.termine'));
      return; // réseau coupé un instant : on réessaie au tour suivant
    }
    if (!appel || appel.id !== id) return;
    const { appel: etatAppel, signaux } = reponse;
    if (etatAppel.statut === 'termine' || etatAppel.statut === 'manque') {
      fin(etatAppel.statut === 'manque' ? t('appels.pas-de-reponse') : null);
      return;
    }
    const presents = etatAppel.participants.filter((p) => !p.estMoi && p.etat === 'present');
    // Quelqu'un vient de décrocher : la sonnerie s'arrête, le compteur démarre.
    if (etatAppel.statut === 'en_cours' && !appel.debut) {
      appel.debut = Date.now();
      appel.arreterSon();
      appel.etatTexte.textContent = appel.type === 'video' ? t('appels.video-palabre') : t('appels.audio-palabre');
      appel.ecran.classList.add('en-cours');
    }
    for (const participant of presents) await relier(participant);
    [...appel.pairs.keys()].filter((identifiant) => !presents.some((p) => p.identifiant === identifiant)).forEach(quitterPair);
    for (const signal of signaux) {
      appel.dernierSignal = Math.max(appel.dernierSignal, signal.id);
      await recevoir(signal);
    }
    if (appel.debut) appel.duree.textContent = minutes((Date.now() - appel.debut) / 1000);
    if (etatAppel.groupe) appel.liste.replaceChildren(...etatAppel.participants.filter((p) => !p.estMoi).map((p) => el('li', { classe: p.etat === 'present' ? 'present' : '' }, [avatar(p, 'mini'), el('span', { texte: `${p.prenom}${p.etat === 'present' ? '' : p.etat === 'invite' ? t('appels.ca-sonne-parenthese') : t('appels.absent')}` })])));
    appel.tours += 1;
    if (appel.tours % 4 === 0) mesurerReseau();
  }
  // Qualité du réseau, d'après les statistiques de la liaison : temps d'aller-retour et paquets perdus.
  async function mesurerReseau() {
    const pair = appel && [...appel.pairs.values()][0];
    if (!pair) return;
    try {
      let faible = false;
      (await pair.liaison.getStats()).forEach((rapport) => {
        if (rapport.type === 'candidate-pair' && rapport.nominated && rapport.currentRoundTripTime > 0.4) faible = true;
        if (rapport.type === 'inbound-rtp' && rapport.packetsReceived > 50 && rapport.packetsLost / (rapport.packetsLost + rapport.packetsReceived) > 0.08) faible = true;
      });
      if (!appel) return;
      appel.qualite.textContent = faible ? t('appels.reseau-faible') : t('appels.reseau-bon');
      appel.qualite.classList.toggle('faible', faible);
    } catch { /* statistiques indisponibles */ }
  }

  function demarrer(etatAppel, flux, sortant, titre) {
    appel = { id: etatAppel.id, type: etatAppel.type, groupe: etatAppel.groupe, conversationId: etatAppel.conversationId, titre, flux, pairs: new Map(), dernierSignal: 0, tours: 0, debut: 0, analyseur: null };
    appel.ecran = creerEcran(`appel-${etatAppel.type}`);
    appel.arreterSon = sortant ? sonSortant() : () => {};
    dessinerAppel(etatAppel, etatAppel.participants.filter((p) => !p.estMoi && p.etat === 'present'));
    if (sortant) appel.etatTexte.textContent = t('appels.ca-sonne');
    appel.minuteur = setInterval(tour, 1000);
    tour();
  }
  function fin(texte) {
    if (!appel) return;
    const termine = appel;
    appel = null;
    clearInterval(termine.minuteur);
    termine.arreterSon();
    termine.pairs.forEach((pair) => { clearTimeout(pair.minuteur); pair.liaison.close(); });
    termine.flux.getTracks().forEach((piste) => piste.stop()); // le voyant du micro et de la caméra s'éteint
    termine.ecran.close();
    termine.ecran.remove();
    carteFin(texte || (termine.debut ? t('appels.termine-duree', { duree: minutes((Date.now() - termine.debut) / 1000) }) : t('appels.termine')));
    document.dispatchEvent(new CustomEvent('palabre:appel-termine', { detail: { conversationId: termine.conversationId } }));
  }
  async function raccrocher(texte) {
    if (!appel) return;
    const { id } = appel;
    fin(texte);
    await api(`/messages/appels/${id}/raccrocher`, { methode: 'POST', donnees: {} }).catch(() => {});
  }
  // Page fermée en plein appel : on prévient le serveur au passage (sinon il le comprendra seul au bout de 20 s).
  window.addEventListener('pagehide', () => {
    if (appel) navigator.sendBeacon(`/api/messages/appels/${appel.id}/raccrocher`, new Blob(['{}'], { type: 'application/json' }));
  });
  // Le réseau revient (Wi-Fi vers 4G, sortie d'un tunnel) : on relance toutes les liaisons sans attendre.
  window.addEventListener('online', () => { if (appel) appel.pairs.forEach(relancer); });

  // ---------- Appeler ----------
  // conversation : { id, groupe, titre? } ; type : 'audio' ou 'video'.
  async function lancer(conversation, type) {
    if (appel) return toast(t('appels.deja-en-appel'), 'erreur');
    if (!window.RTCPeerConnection || !navigator.mediaDevices) return toast(t('appels.navigateur-incapable'), 'erreur');
    moi = moi || await utilisateurConnecte();
    let flux;
    try {
      flux = await ouvrirMedias(type);
    } catch (erreur) {
      return toast(erreur.message, 'erreur');
    }
    try {
      const reponse = await api('/messages/appels', { methode: 'POST', donnees: { conversationId: conversation.id, type } });
      if (reponse.occupe) {
        flux.getTracks().forEach((piste) => piste.stop());
        return toast(t('appels.occupe'));
      }
      // Un appel existe déjà dans cette conversation (l'autre m'appelait au même instant, ou le groupe est en appel) : on le rejoint.
      if (reponse.existant) {
        const rejoint = await api(`/messages/appels/${reponse.appel.id}/accepter`, { methode: 'POST', donnees: {} });
        arreterSonnerie();
        return demarrer(rejoint.appel, flux, false, conversation.titre);
      }
      return demarrer(reponse.appel, flux, true, conversation.titre);
    } catch (erreur) {
      flux.getTracks().forEach((piste) => piste.stop());
      return toast(erreur.message, 'erreur');
    }
  }

  // ---------- Recevoir un appel ----------
  function arreterSonnerie() {
    if (!sonnerie) return;
    clearInterval(sonnerie.minuteur);
    sonnerie.arreterSon();
    sonnerie.ecran.close();
    sonnerie.ecran.remove();
    sonnerie = null;
  }
  // entrant : { id, type, conversationId, groupe, titre, appelant } (envoyé par le serveur à toutes les pages).
  function recevoirAppel(entrant) {
    if (appel || (sonnerie && sonnerie.id === entrant.id)) return;
    if (sonnerie) arreterSonnerie();
    const ecran = creerEcran('appel-entrant');
    const decrocher = el('button', { classe: 'appel-decrocher', type: 'button' }, [el('span', { classe: 'appel-balance' }, [icone('telephone')]), t('appels.decrocher')]);
    const refuser = el('button', { classe: 'appel-refuser', type: 'button' }, [icone('telephone'), t('commun.refuser')]);
    ecran.append(
      el('div', { classe: 'appel-centre' }, [
        el('div', { classe: 'appel-avatar' }, [anneaux(3), avatar(entrant.appelant, 'profil')]),
        el('h2', { classe: 'appel-nom', texte: entrant.appelant.nom }),
        el('p', { classe: 'appel-etat', texte: `${entrant.type === 'video' ? t('appels.video-palabre') : t('appels.audio-palabre')}${entrant.groupe && entrant.titre ? `, ${entrant.titre}` : ''}` }),
      ]),
      el('div', { classe: 'appel-reponses' }, [refuser, decrocher]),
    );
    sonnerie = { id: entrant.id, ecran, arreterSon: sonEntrant(), minuteur: 0 };
    // Tant que ça sonne, on vérifie toutes les 2 secondes que l'appel existe encore (l'autre a pu raccrocher).
    sonnerie.minuteur = setInterval(async () => {
      try {
        const { appel: encore } = await api('/messages/appels/entrant');
        if (sonnerie && (!encore || encore.id !== entrant.id)) arreterSonnerie();
      } catch { /* on réessaie */ }
    }, 2000);
    refuser.addEventListener('click', async () => {
      arreterSonnerie();
      await api(`/messages/appels/${entrant.id}/refuser`, { methode: 'POST', donnees: {} }).catch(() => {});
      document.dispatchEvent(new CustomEvent('palabre:appel-termine', { detail: { conversationId: entrant.conversationId } }));
    });
    decrocher.addEventListener('click', async () => {
      decrocher.disabled = true;
      moi = moi || await utilisateurConnecte();
      let flux;
      try {
        flux = await ouvrirMedias(entrant.type);
      } catch (erreur) {
        decrocher.disabled = false;
        return toast(erreur.message, 'erreur');
      }
      try {
        const reponse = await api(`/messages/appels/${entrant.id}/accepter`, { methode: 'POST', donnees: {} });
        arreterSonnerie();
        return demarrer(reponse.appel, flux, false, entrant.titre);
      } catch (erreur) {
        flux.getTracks().forEach((piste) => piste.stop());
        arreterSonnerie();
        return toast(erreur.message, 'erreur');
      }
    });
    decrocher.focus();
  }

  window.Palabre.appels = { lancer, recevoir: recevoirAppel, enCours: () => Boolean(appel) };
  // Un appel reçu pendant que ce script se chargeait (voir app.js).
  if (window.Palabre.appelEnAttente) {
    recevoirAppel(window.Palabre.appelEnAttente);
    window.Palabre.appelEnAttente = null;
  }
})();
