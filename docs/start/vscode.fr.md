[English](vscode.md) · Français

# VS Code

L'extension Studium joue une leçon dans un panneau, en onglet de la zone d'édition : chaque étape affiche ses
figures, équations, graphiques et modèles 3D, pose une question à la fois, donne son retour dans une étape
à part et vous signale les révisions dues. Elle suit le thème et la langue de votre éditeur (français ou
anglais) et s'utilise au clavier comme avec un lecteur d'écran (objectif : WCAG 2.2 AA).

Installez-la d'abord, depuis le Visual Studio Marketplace ou Open VSX :

```bash
code --install-extension holobiomicslab.studium-vscode
```

Depuis un fichier de release : `code --install-extension studium-vX.Y.Z.vsix`. Pour la construire depuis
les sources, voir [Installation](installation.fr.md#construire-lextension-vs-code). Les registres qui
portent l'extension sont dans [Où sont les paquets](installation.fr.md#où-sont-les-paquets).

## Obtenir votre première leçon

L'extension affiche des leçons ; elle n'en construit pas. Juste après l'installation, la vue **Leçons**
indique « Pas encore de leçon à vous » et propose **Essayer la leçon de démonstration**. Prenez la
ligne qui correspond à ce que vous avez :

| Vous avez | Faites ceci |
|---|---|
| Rien encore, et vous voulez voir comment fonctionne Studium | **Essayer la leçon de démonstration** dans la vue **Leçons** vide, ou **Studium : Essayer la leçon de démonstration** : « Découvrir Studium », environ douze minutes, dans la langue d'affichage de VS Code (français ou anglais). Elle est livrée avec l'extension ; un agent d'IA l'a rédigée à partir de la documentation de Studium et le responsable du projet l'a approuvée, sous le nom beta-testeur, sans l'avoir lue. Elle n'est pas enregistrée comme votre cours et ne remplace jamais une de vos leçons |
| Copilot dans VS Code 1.101 ou plus récent | Rien à relier : l'extension propose son propre serveur Studium à Copilot (voir [Connecter Copilot](copilot.fr.md)). En mode agent de Copilot Chat, demandez « je veux apprendre … avec Studium » en indiquant vos sources. Construire la leçon prend quelques minutes : la barre d'état indique **Studium · leçon en préparation…**, puis VS Code vous prévient que la leçon est prête, avec **Ouvrir**, et elle apparaît dans la vue **Leçons**. Au premier outil Studium, autorisez les outils de Studium pour la session (voir [Connecter Copilot](copilot.fr.md)) |
| Un autre assistant IA (Claude Code, Codex, Mistral Vibe, Claude Desktop, Cursor, OpenCode) | Reliez-le avec **Studium : Relier un assistant…** (un lien dans la vue **Leçons** ; sans Node, voir [Démarrer sans terminal](easy-start.fr.md)) ou depuis un terminal par [une commande](installation.fr.md#ajouter-le-serveur-à-votre-assistant), puis demandez « je veux apprendre … avec Studium » en indiquant vos sources. La leçon est écrite dans votre bibliothèque personnelle, `~/.studium/library` ; VS Code vous prévient quand elle est prête, et elle apparaît dans la vue **Leçons** |
| Une leçon donnée par un enseignant | **Studium : Choisir un cours**, **Choisir un autre dossier de cours…**, puis choisissez son dossier ; ou clic droit sur son `lesson.json`, puis **Studium : Ouvrir cette leçon** |
| Les leçons de démonstration, sans clone | téléchargez l'[archive du dépôt](https://github.com/HolobiomicsLab/studium/archive/refs/heads/main.zip) et décompressez-la, puis **Studium : Choisir un cours**, **Choisir un autre dossier de cours…**, et choisissez son dossier `fixtures` |
| Un clone du dépôt | **Studium : Choisir un cours**, puis choisissez `fixtures` pour les leçons de démonstration |

Avec Copilot en mode agent, tout reste dans VS Code, sans terminal : voir [Connecter Copilot](copilot.fr.md),
qui dit aussi ce qui n'a pas été essayé. Ce que fait
l'assistant, étape par étape, est dans
[Apprendre avec votre assistant](../learn/learn-with-your-assistant.fr.md).

## Ouvrir une leçon

| Moyen | Quand l'utiliser |
|---|---|
| Icône **Studium** de la barre d'activité, puis la vue **Leçons** | parcourir les leçons de votre dossier de leçons |
| **Studium : Choisir un cours** | choisir un cours, ou un autre dossier de leçons ; le choix est enregistré dans les réglages du dossier ouvert, ou dans vos réglages utilisateur quand aucun dossier n'est ouvert. La liste propose aussi la leçon de démonstration livrée avec Studium, signalée comme telle |
| **Studium : Ouvrir une leçon** | rouvrir le cours courant (propose le sélecteur s'il n'y en a pas) |
| Clic droit sur un `lesson.json`, **Studium : Ouvrir cette leçon** | ouvrir directement ce fichier, depuis l'explorateur ou l'onglet de l'éditeur, sans changer les réglages |
| Un lien `vscode://` donné par votre assistant | ouvrir la leçon que votre assistant vient de préparer (ci-dessous) |
| **Studium : Prise en main** | un parcours en cinq étapes : ouvrir une leçon, apprendre avec votre assistant, juger une production d'IA, exécuter une reproduction, réviser |

Quand `studium.bundlesRoot` est vide, le dossier de leçons est le `fixtures/` du dépôt si l'extension
tourne depuis un clone de Studium, sinon votre bibliothèque personnelle, `~/.studium/library` (ou
`<STUDIUM_HOME>/library`), où sont écrites les leçons qu'un assistant prépare pour vous. L'extension crée
cette bibliothèque au démarrage si elle manque, et la surveille : une leçon qu'un assistant y écrit est listée
et s'ouvre d'elle-même dans le panneau Studium, en onglet de la zone d'édition, sans quitter la conversation ; une
notification le dit, et son bouton désactive `studium.openLessonWhenReady`. Ce réglage désactivé, la leçon est
annoncée à la place, avec **Ouvrir**, **Plus tard** et **Ne plus afficher**. Des leçons arrivées ensemble partagent
une seule notification, dont **Afficher** ouvre la vue Studium. Une leçon que vous y copiez vous-même est
listée mais pas annoncée. **Ne plus afficher** désactive le réglage `studium.notifyLessonReady` :
réactivez-le dans l'éditeur de réglages pour revoir les notifications. Si `studium.bundlesRoot` désigne
un autre dossier, les leçons de la bibliothèque sont listées à part, sous **Ta bibliothèque**.

### De la conversation au panneau

Après avoir préparé une leçon avec vous, un assistant peut vous la transmettre :

```bash
code --open-url "vscode://holobiomicslab.studium-vscode/open?bundle=<chemin absolu de lesson.json, encodé pour une URL>"
```

Le lien doit désigner un chemin absolu, sans `..`, vers un fichier `.json` existant de votre bibliothèque,
du dossier `studium.bundlesRoot` ou des leçons livrées avec Studium ; sinon il est refusé avec un message et
rien ne s'ouvre. Pour ouvrir un fichier de leçon rangé ailleurs, faites un clic droit dessus et choisissez
**Studium : Ouvrir cette leçon**. Si la fenêtre se recharge pendant une leçon, le panneau revient et
reprend à partir de votre progression enregistrée.

## Ce que vous voyez

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/vscode-pane-choices-dark.png">
  <img src="../assets/screenshots/vscode-pane-choices-light.png" width="420" alt="Le panneau de leçon sur une étape de quiz : un avis indiquant que la leçon a été rédigée par l'apprenant, des badges pour le type d'étape et les révisions dues, la progression à l'étape 3 sur 8, la formule de Rydberg, quatre choix lettrés, une échelle de confiance facultative de 0 à 4, un bouton Valider et un lien Indice.">
</picture>

- **Avis.** La première étape indique qui a écrit le corrigé (un enseignant, l'apprenant ou un agent) et si
  un modèle juge évalue les réponses ouvertes.
- **En-tête.** Le type de l'étape et sa classe de corrigé, le nombre de révisions dues, et un menu avec
  **À propos de cette leçon** et **M'oublier**.
- **Ligne d'état.** Une ligne au-dessus de la barre de progression, de 80 caractères au plus, dit où vous
  en êtes : la leçon, l'étape sur le total (ou quelle question de contrôle d'une contestation), un détour,
  les minutes restantes (la durée annoncée de la leçon multipliée par la part des étapes qui restent, la durée
  que la conversation donne quand la leçon est prête), les révisions dues et ce qui est attendu de vous (à lire, votre réponse, votre
  auto-évaluation, un calcul à lancer, terminé). La barre de progression garde ses segments sans répéter
  l'étape. Pendant une leçon, la barre d'état de VS Code affiche cette même ligne ; ce qui est dû en
  révision passe alors dans son info-bulle (voir [Révisions](#révisions)).
- **Voix.** Au-dessus de la scène, une ligne dit qui signe la leçon : le nom d'un enseignant quand elle a
  été validée, ou qu'elle n'a pas été relue, qu'elle a été rédigée par une IA ou par vous, ou qu'elle a
  changé depuis son approbation. Au-dessus d'un verdict, une ligne dit qui a évalué la réponse : la clé de
  l'auteur, un modèle juge, ou un texte que l'assistant a produit hors de la leçon ; un verdict de clé
  nomme une clé rédigée par l'IA ou une clé que vous avez écrite.
- **Progression.** « Étape 3 sur 8 », sans jamais reculer ; un détour vers un prérequis est signalé comme
  tel.
- **Étapes déjà faites.** Sous la barre de progression, chaque étape du parcours principal de la leçon que
  vous avez déjà faite est un bouton numéroté (un lecteur d'écran lit « Revoir l'étape 3 : <titre> »). Il
  remontre cette étape telle qu'elle était, en lecture seule, sous un bandeau « Étape 3 sur 12, déjà faite :
  en relecture » : son texte et ses figures, votre réponse et le retour reçu (pour les réponses données depuis
  le démarrage du serveur ; après un redémarrage, seulement si la réponse était juste, fausse ou non évaluée).
  On ne peut rien y répondre et rien ne change : ni votre progression, ni votre maîtrise, ni vos révisions, ni
  l'étape où vous êtes. **Reprendre où j'en étais** ramène à l'étape en cours telle que vous l'avez laissée,
  réponse commencée comprise. Les étapes pas encore atteintes et celles d'un détour ne sont pas proposées.
- **Réponse.** Quand le focus est dans la liste des choix, `A`–`D` ou `1`–`4` choisissent et `Entrée`
  valide ; la ligne sous les choix l'indique (« Dans la liste des choix : … »). La confiance (de 0 à 4) est
  facultative.
- **Échelle d'aide.** Sous les contrôles de réponse, quatre barreaux dans l'ordre où les essayer :
  **Relire**, **Indice**, **Explication** et **Référence**. Chacun affiche son coût ou la raison pour
  laquelle il est fermé : une explication attend que vous ayez tenté une réponse, et la référence
  n'apparaît qu'avec un verdict, après votre réponse. Un barreau fermé prend quand même le focus au clavier
  et dit pourquoi, mais n'envoie rien. **Poser une question** transmet votre question à l'assistant. Une
  bonne réponse après un indice compte moins pour la maîtrise et revient plus tôt en révision.
- **Réglages.** À la fin de la scène, là où la leçon les propose : le niveau d'**attention**
  (**Silencieux**, **Normal** ou **Accompagné**) règle ce que la séance peut proposer ; la **langue**
  bascule le texte propre au panneau (libellés, ligne d'état) entre français et anglais sans traduire le
  contenu de la leçon ; et les **minutes disponibles** avec **Replanifier** répondent par une proposition
  qui cite le temps dont vous disposez : si la leçon y tient, et si une révision due doit venir d'abord.
  Ces contrôles ne répondent à rien : ils restent utilisables tant qu'une réponse est attendue.
- **Carte des notions.** **Carte des notions** ouvre la liste des notions de la leçon avec leur état
  (acquise, à revoir, en cours, vue mais pas encore évaluée, à venir), les prérequis de chacune et, une fois
  dépliée, ses preuves et ce que son état établit ou n'établit pas. Vous pouvez contester une notion que
  vous avez atteinte — « Je la connais » ou « J'ai un doute » — et la leçon pose une ou deux questions de
  contrôle tirées de scènes notées sur la clé ; la déclaration seule ne change jamais la maîtrise et ne
  saute aucune scène. Voir [Carte des notions](../learn/concept-map.fr.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/vscode-pane-feedback-dark.png">
  <img src="../assets/screenshots/vscode-pane-feedback-light.png" width="420" alt="L'étape de retour après une réponse ouverte : un encadré À comparer toi-même marqué Non certifié, les points clés, une réponse modèle repliée, le passage de la source citée avec son lien, quatre boutons de rappel et un bouton Continuer.">
</picture>

- **Le retour** forme une étape à part. ✓ n'apparaît que sur une réponse jugée juste et ✗ que sur une
  réponse jugée fausse. Sans modèle juge, une réponse ouverte est marquée **À comparer toi-même** et
  **Non certifié** : vous voyez les points clés et pouvez déplier la réponse modèle, et la réponse ne change
  pas votre maîtrise. Aucun décompte de mots-clés n'est affiché.
- **Source citée.** Les passages cités par une étape notée n'apparaissent qu'une fois que vous avez répondu
  et quitté l'étape pour de bon : ils ne soufflent jamais la réponse. La licence de la source suit son titre
  quand la leçon en indique une. Quitter un quiz sur une mauvaise réponse affiche de la même façon
  **La bonne réponse**.
- **Évalue ton rappel** (Je ne savais pas, Difficile, Bien, Facile) fixe seulement la date de votre
  prochaine révision ; cela ne change jamais votre maîtrise. Voir
  [Réviser dans la durée](../learn/review-over-time.fr.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/vscode-pane-completion-dark.png">
  <img src="../assets/screenshots/vscode-pane-completion-light.png" width="420" alt="L'écran de fin : le nombre d'étapes parcourues, les notions consolidées, les notions à revoir, les détours faits en route, la date de la prochaine révision et trois boutons : Réviser maintenant, Revoir le parcours, Choisir un autre cours.">
</picture>

- **Fin de leçon.** Les notions sont nommées, sans score, en trois listes : **Notions consolidées** (au
  moins trois réponses notées et une maîtrise suffisante), **Notions travaillées** (avec leur nombre de
  réponses notées) et **Pas encore mesurées**. Viennent ensuite la date de la prochaine révision et trois
  actions : **Réviser maintenant**, **Revoir le parcours**, **Choisir un autre cours**.

## Révisions

Si vous avez déjà étudié et qu'aucune leçon n'est ouverte, la barre d'état affiche **Studium · 2 à
réviser**, ou **Studium · 3 à travailler** quand certaines notions en attente sont à reprendre ou pas encore
mesurées ; son info-bulle nomme chaque groupe. Pendant une leçon, la barre affiche la ligne d'état de
cette leçon ; les groupes de révision passent alors dans son info-bulle. Un clic ouvre la barre
latérale Studium, dont l'entrée **Révisions** liste les notions par groupe (à réviser, à reprendre, pas
encore mesurées), ou la date de la prochaine révision. Le décompte est rafraîchi au démarrage, à la
fermeture ou à la fin d'une leçon, et avec le bouton de rafraîchissement de la vue Leçons.

Quand rien n'est dû, la barre propose plutôt la leçon que vous suiviez, par exemple
**Studium · reprendre Découvrir Studium** ; un clic rouvre cette leçon à l'étape où vous en étiez. La vue
**Leçons** montre cette même leçon en premier, sous la forme **Reprendre : …**, avec l'étape
suivante et, quand la leçon donne sa durée, les minutes restantes ; chaque leçon de la liste montre sa
progression (**6/12**, ou **terminée**). C'est la progression que VS Code garde sous `studium.learnerId` :
dans le panneau, dans `@studium`, et dans Copilot quand il utilise le serveur Studium que propose cette
extension, qui joue le même apprenant dans le même stockage (une leçon jouée là apparaît ici au prochain
rafraîchissement). Les leçons jouées avec un autre assistant, le lecteur dans le navigateur ou un serveur
Studium ajouté à la main dans VS Code gardent leur progression ailleurs et n'apparaissent pas ici. Une leçon en
préparation et une révision due passent avant. Sans historique ni leçon en cours, rien n'est affiché.

## Chat et notebook

- **`@studium` dans le panneau de chat** (avec Copilot Chat ou un autre fournisseur de chat) joue la leçon
  tour par tour, avec `/start`, `/hint` et `/discuss`. Il affiche le texte du serveur et lui transmet ce que
  vous tapez comme votre réponse : une lettre, un nombre, vos propres mots, ou des numéros comme `1,3` sur un
  jeu d'affirmations. Quand le serveur ne peut pas lire une réponse, le chat le dit et rappelle comment
  répondre. Les contenus riches s'ouvrent toujours dans le panneau. Aucun corrigé n'atteint le chat.
- **Studium : Ouvrir la leçon en notebook** joue la leçon dans un notebook : exécutez la cellule de pilotage
  avec `next`, une lettre de choix, `0`–`4`, un texte libre, `hint` ou `forget`.

Le panneau et le mode agent de Copilot lancent chacun leur propre serveur, que Copilot utilise celui que
propose l'extension ou un serveur que vous avez configuré vous-même, et ne partagent pas l'étape courante.
Pilotez une leçon depuis l'un des deux à la fois. Avec le serveur que propose l'extension, Copilot joue
l'apprenant du panneau (`studium.learnerId`) : une leçon se poursuit dans le panneau là où elle s'est arrêtée
dans la conversation, et Copilot propose d'abord dans le panneau une leçon qu'il a construite
([Connecter Copilot](copilot.fr.md)).

## Exécuter une reproduction

Certaines étapes vous demandent d'exécuter une vraie capsule. Avant toute exécution, une fenêtre montre la
commande exacte, les paquets à installer et le dossier d'exécution. Rien ne démarre avant que vous
choisissiez **Exécuter**, ou **Exécuter et faire confiance à ce cours** (mémorisé pour cette version exacte
de la leçon). Un dossier de travail donné en chemin absolu ou contenant `..` est refusé, et le motif qui
contrôle la sortie s'exécute sous une limite de 50 ms : une leçon défectueuse ne peut pas figer l'éditeur.
**Studium : Exécuter la reproduction** lance la capsule de l'étape courante.

## Réglages

| Réglage | Par défaut | Rôle |
|---|---|---|
| `studium.bundlesRoot` | vide | dossier de leçons ; vide signifie le `fixtures/` du dépôt, sinon `~/.studium/library` |
| `studium.bundleRef` | `atomistique-l1/lesson.json` | le cours courant, relatif au dossier de leçons |
| `studium.repoRoot` | vide | un clone de Studium, pour lancer le serveur depuis ses sources (développement) |
| `studium.communityBundlesRoot` | vide (comme `bundlesRoot`) | où **Contributions de la classe** trouve les leçons d'apprenants approuvées |
| `studium.assets` | `vendor` | charger KaTeX et Vega hors ligne (`vendor`) ou depuis un CDN (`cdn`) |
| `studium.learnerId` | `vscode-learner` | votre identifiant d'apprenant ; il sale votre pseudonyme sur le disque |
| `studium.registerMcpServer` | `true` | proposer le serveur de l'extension au mode agent de Copilot (VS Code 1.101 ou plus récent) ; aucun n'est proposé si vous avez déjà ajouté vous-même un serveur Studium |
| `studium.notifyLessonReady` | `true` | vous prévenir quand une leçon construite par votre assistant est prête ; **Ne plus afficher** sur cette notification le désactive, et le réactiver fait revenir les notifications. Un réglage utilisateur, pour toutes les fenêtres |
| `studium.openLessonWhenReady` | `true` | ouvrir dans le panneau Studium une leçon construite par votre assistant dès qu'elle est prête, en onglet de la zone d'édition, sans quitter la conversation ; désactivé, une notification propose **Ouvrir** à la place. Un réglage utilisateur |
| `studium.offerVibeConnection` | `true` | quand Mistral Vibe est installé, proposer une fois de le relier à Studium ; **Studium : Relier Mistral Vibe** fonctionne quel que soit ce réglage. Un réglage utilisateur |
| `studium.telemetryConsent` | `false` | consentir à l'enregistrement d'une télémétrie de classe pseudonymisée dans le dossier de données de l'extension (rien n'est envoyé) |
| `studium.modalityPreference` | `balanced` | `visual` ou `textual` réordonne le contenu de chaque étape ; rien n'est retiré |
| `studium.showGraph` | `true` | ouvrir le graphe d'apprentissage en direct dans un onglet à côté de la leçon |
| `studium.graphView` | `student` | `student` montre votre voisinage, `teacher` le graphe entier |
| `studium.showMastery` | `false` | afficher la barre de maîtrise par notion ; pour les démonstrations enseignantes seulement, car elle peut révéler les réponses d'un quiz |

## Commandes

| Commande | Effet |
|---|---|
| Studium : Choisir un cours | choisir et ouvrir un cours |
| Studium : Essayer la leçon de démonstration | ouvrir « Découvrir Studium », la leçon de démonstration livrée avec l'extension |
| Studium : Ouvrir une leçon | ouvrir le cours courant dans le panneau |
| Studium : Ouvrir cette leçon | ouvrir le `lesson.json` sélectionné |
| Studium : Ouvrir la leçon en notebook | jouer le cours dans un notebook |
| Studium : Contributions de la classe | ouvrir une leçon d'apprenant approuvée |
| Studium : Exécuter la reproduction (capsule de la scène courante) | lancer la capsule de l'étape courante, après confirmation |
| Studium : Prise en main | ouvrir le parcours de prise en main |
| Studium : Oublier mes données | effacer ce que l'extension garde (ci-dessous) |
| Studium : Relier Mistral Vibe | permettre à Mistral Vibe (son extension VS Code, Vibe Desktop, sa ligne de commande) d'utiliser le serveur Studium de cette extension, sans Node ; voir [Connecter Mistral Vibe](vibe.fr.md) |
| Studium : Délier Mistral Vibe | retirer l'entrée écrite par cette commande |
| Studium : Relier un assistant… | permettre à Mistral Vibe, Codex, Claude Code, Claude Desktop, Cursor ou OpenCode d'utiliser le serveur Studium de cette extension, sans Node : cochez les assistants dans la liste ; voir [Connecter votre assistant](harnesses.fr.md#choisir-votre-client) |
| Studium : Délier un assistant… | retirer les entrées écrites par cette commande |

## Vos données

La progression et les révisions sont gardées dans le stockage d'extension de VS Code, propre à votre
compte utilisateur, jamais dans le dossier de leçons, que le consentement à la télémétrie soit activé ou
non ; ce réglage décide seulement de l'envoi de télémétrie de classe pseudonymisée. **M'oublier**, dans le
menu du panneau, efface votre état enregistré pour la leçon courante. **Studium : Oublier mes données**
efface, après confirmation, tout ce que garde l'extension (progression, révisions, cours auxquels vous avez
fait confiance, dernière leçon) ; elle ferme d'abord chaque séance de leçon, de chat ou de notebook ouverte
par l'extension, pour que rien ne réécrive son état. Elle ne touche pas aux données que le serveur Studium d'un assistant garde
dans `~/.studium/data` ; la confirmation nomme ce dossier. Elle n'arrête pas le serveur que VS Code a lancé pour
Copilot, qui garde sa progression dans le même stockage : arrêtez d'abord **Studium** dans **MCP: List Servers**. Voir
[Vie privée et limites](../concepts/privacy-and-limits.fr.md).
