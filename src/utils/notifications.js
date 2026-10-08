// Notifications dans l'appli (la cloche du menu).

// Ajoute une notification pour un membre.
// executeur : « db » en temps normal, ou le client d'une transaction pour que la notification
// soit annulée avec le reste si l'action échoue.
// lien : toujours une adresse interne du site, construite par le serveur (jamais fournie par un membre).
async function notifier(executeur, utilisateurId, type, texte, lien) {
  await executeur.query(
    'INSERT INTO notifications (utilisateur_id, type, texte, lien) VALUES ($1, $2, $3, $4)',
    [utilisateurId, type, texte, lien],
  );
}

// Raccourcit un titre pour le citer dans une notification.
function court(texte, max = 60) {
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte;
}

// « de Bintou » mais « d'Awa » : l'élision devant une voyelle.
function deNom(nom) {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
}

module.exports = { notifier, court, deNom };
