# Comptes de démonstration

Ces comptes sont créés par `npm run demo` (`scripts/demo.js`). Ils servent à tester le site et à le montrer au jury sans avoir à s'inscrire.

**Mot de passe, le même pour tous : `Palabre-Jury-2026`**

Pour se connecter : ouvrir `/connexion`, saisir l'email d'un compte ci-dessous et ce mot de passe.

## Développeurs

| Nom | Email | Ville | À voir avec ce compte |
| --- | --- | --- | --- |
| Awa Ouédraogo | `awa@demo.palabre.dev` | Koudougou, Burkina Faso | le fil, ses amis, les suggestions « Devs à découvrir » |
| Bintou Traoré | `bintou@demo.palabre.dev` | Koudougou, Burkina Faso | un avis 5 étoiles, une photo de couverture, 6 projets vérifiés |
| Cheick Diallo | `cheick@demo.palabre.dev` | Ouagadougou, Burkina Faso | une proposition refusée |
| Fatoumata Koné | `fatou@demo.palabre.dev` | Abidjan, Côte d'Ivoire | l'anneau de preuve plein (11 projets), cheffe d'une équipe éclair retenue |
| Idrissa Sawadogo | `idrissa@demo.palabre.dev` | Bobo-Dioulasso, Burkina Faso | un débutant : aucun projet, donc pas d'anneau |
| Mariam Sow | `mariam@demo.palabre.dev` | Dakar, Sénégal | |
| Kofi Mensah | `kofi@demo.palabre.dev` | Lomé, Togo | un avis 5 étoiles, 8 projets vérifiés |
| Oumar Bah | `oumar@demo.palabre.dev` | Bamako, Mali | un dev « occupé » (absent de « Disponibles maintenant ») |
| Aminata Diop | `aminata@demo.palabre.dev` | Thiès, Sénégal | |
| Yao Kouassi | `yao@demo.palabre.dev` | Bouaké, Côte d'Ivoire | membre de l'équipe éclair de Fatoumata |
| Nadège Mbarga | `nadege@demo.palabre.dev` | Douala, Cameroun | |
| Ibrahim Maïga | `ibrahim@demo.palabre.dev` | Niamey, Niger | une proposition en attente |

## Clients

| Nom | Email | Ville | À voir avec ce compte |
| --- | --- | --- | --- |
| Salimata Dao | `salimata@demo.palabre.dev` | Ouagadougou, Burkina Faso | une demande terminée avec avis, une demande ouverte avec 2 propositions à départager |
| Pascal Zongo | `pascal@demo.palabre.dev` | Koudougou, Burkina Faso | une demande terminée avec avis, une demande ouverte sans proposition |
| Esther Akakpo | `esther@demo.palabre.dev` | Cotonou, Bénin | une demande attribuée à une équipe éclair |

## Ce que contient la démonstration

- 15 membres, 17 amitiés ;
- 16 publications (idées, questions, projets) avec leurs j'aime et leurs commentaires, étalées sur une semaine ;
- des projets pour 10 développeurs, avec des anneaux de preuve de 1 à 11 segments ;
- 6 demandes de clients : 2 terminées avec avis, 1 attribuée à une équipe éclair, 3 ouvertes.

## À savoir

- **Les liens des projets sont inventés** (`https://demo.palabre.dev/…`) et marqués « vérifiés » directement en base, pour montrer l'anneau de preuve. Sur le vrai site, ce badge n'est donné que si le serveur a réellement visité le lien.
- **Les images sont dessinées par le script** (de fausses captures d'écran, des bandes de couleur) : aucune photo de personne.
- **Aucun de ces comptes n'est administrateur.** Pour montrer `/admin` : `npm run admin -- awa@demo.palabre.dev`.

## Commandes

```
npm run demo              # crée les comptes ; ne fait rien s'ils existent déjà
npm run demo -- retirer   # retire les comptes et tout leur contenu
npm run demo -- --forcer  # nécessaire si NODE_ENV=production (mise en ligne pour le jury)
```

Tous les comptes ont un email en `@demo.palabre.dev` : c'est ce qui permet de les retirer d'un coup, sans toucher aux vrais membres.
