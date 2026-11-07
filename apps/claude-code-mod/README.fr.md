# Panneau Studium pour Claude Code

Ce plugin Claude Code ajoute un panneau de leçon Studium natif, relié au serveur MCP `studium-lesson`. Il enregistre `/studium` au démarrage d'une session sans ouvrir d'interface tant que l'utilisateur ne le demande pas.

## Charger le plugin

Depuis la racine du dépôt, lancer Claude Code avec le répertoire du plugin :

```sh
claude --plugin-dir "$PWD/apps/claude-code-mod"
```

Le même répertoire peut être ajouté à une valeur `CLAUDE_CODE_PLUGIN_DIRS` existante :

```sh
export CLAUDE_CODE_PLUGIN_DIRS="$PWD/apps/claude-code-mod${CLAUDE_CODE_PLUGIN_DIRS:+:$CLAUDE_CODE_PLUGIN_DIRS}"
claude
```

La session doit disposer d'un serveur MCP nommé `studium-lesson`. Ouvrir une leçon avec `/studium <bundle_ref>`. Une fois la leçon active, `/studium` rouvre son panneau. Les scènes qui demandent du texte libre utilisent `/studium answer <texte>` ; les choix, indices, révisions, redémarrages, autoévaluations et effacements utilisent les boutons du panneau. L'effacement exige deux pressions.

## Surfaces et contenu

Le panneau utilise les éléments natifs de Claude Code dans le terminal, l'application de bureau, VS Code et l'application mobile. Il affiche le titre et la progression, la prose Markdown de la scène, les choix et actions disponibles, le retour et les indices, les sources, le bilan de fin, ainsi que les états d'information et d'erreur. Le contenu courant est atténué pendant une action MCP. Quand une action atteint une séance que le serveur ne connaît plus (son erreur commence par `session not found` : le serveur a redémarré ou la séance a été fermée), le panneau remplace la scène et ses contrôles par « Séance perdue (le serveur a redémarré ou la séance a été fermée). Rouvre la leçon : ta progression est conservée. », un bouton « Rouvrir la leçon » qui appelle `open_lesson_panel` pour le même `bundle_ref` et le même `learner_id` sur ce panneau, et la commande `/studium <bundle_ref>` qui fait de même depuis l'invite. Rien n'est relancé tout seul ; toute autre erreur garde sa ligne d'erreur. Les images PNG sont rendues dans le terminal, seule surface qui expose actuellement l'élément natif `Image` ; chaque surface affiche tout de même le titre et le type de chaque support.

Le panneau HTML du navigateur reste le moteur visuel le plus riche. Le panneau natif conserve le Markdown et les blocs de code, mais laisse les équations `$…$` sous forme de texte et ne rend ni KaTeX, ni graphiques Vega, ni graphes interactifs, ni contenu 3D, ni HTML arbitraire. Le texte libre et les échanges passent par `/studium answer`, car les surfaces mobile et VS Code ne partagent pas encore d'élément de saisie natif. Le plugin accepte les contrats versionnés `studium/panel-view/1` et `studium/panel-view/2` et refuse proprement les vues stockées ou MCP incompatibles.

Pour une vue version 2, le panneau affiche aussi, dans cet ordre : la ligne d'état sous le titre (étape, minutes restantes, révisions dues, ce qui est attendu) ; une ligne au-dessus de la scène qui dit qui signe la leçon et si un enseignant a relu cette version ; une ligne au-dessus d'un verdict qui dit qui a évalué la réponse (un modèle juge, ou une clé : « Évalué par la clé rédigée par l'IA — vérifie-la avec le passage cité » pour une leçon rédigée par l'IA, « Évalué par la clé que tu as rédigée » pour une leçon que l'apprenant a rédigée, « Évalué par la clé de l'auteur » pour celle d'un enseignant) ; l'échelle d'aide, un bouton par échelon (relire, indice, explication, référence), où un échelon fermé est grisé et porte sa raison et où un indice ouvert porte son coût ; et « Poser une question », qui envoie l'action `ask`. Le serveur répond à `ask` par une notice qui renvoie l'apprenant à la conversation ; la leçon reste à la même étape. Une explication ouverte envoie `ask` avec la demande « Explique-moi cet écran. ». Appuyer sur un échelon fermé, ou sur un échelon qui ne demande aucun appel au serveur, affiche sa note dans une notification. Après l'échelle viennent les réglages de l'apprenant, chacun seulement là où la vue propose son action : « Silencieux », « Normal », « Accompagné » (`setAttention` ; l'`attention` de la vue est le bouton principal), FR et EN (`setLanguage` ; la `locale` de la vue est le bouton principal), et un champ « Minutes disponibles » dont Entrée envoie `replan` avec un nombre entier de 1 à 600 (tout autre est refusé dans une notification et rien n'est envoyé). L'application mobile ne dessine aucun champ de texte : le volet y nomme `/studium replan <minutes>`, qui fait de même depuis l'invite. Une vue version 2 dont l'`attention` n'est pas l'un des trois niveaux est refusée en entier.

Quand la vue le propose, « Carte des notions » demande la carte des notions (`openMap`). Le volet affiche alors la carte en liste sous les commandes : chaque notion avec son état en mots, ce qu'elle demande d'abord, un contrôle en cours ou le résultat du dernier, ce que l'état établit et ce qu'il n'établit pas, et les réponses qui le fondent (jour, qui a évalué, résultat, indices). Sous la liste, un bouton de déclaration par notion que le serveur laisse contester envoie `contest`, avec une ligne qui dit combien de questions de contrôle suivront ; « Fermer la carte » envoie `closeMap`. Le volet ne dessine aucun graphe. Le `message` d'une vue de scène (ce qu'a montré le contrôle d'une contestation) s'affiche au-dessus des commandes. Ce que la séance propose (`prompts`) vient après les commandes : la raison de chaque proposition ou notice, puis un bouton par réponse que la vue propose, chacun envoyant `prompt` avec `accept` ou `dismiss`. Tant qu'une réponse ou une auto-évaluation est attendue, seules les notices sont affichées. Une proposition pour laquelle la vue ne donne aucune action est affichée en texte seul, et une vue dont les `prompts` sont mal formés est refusée en entier.

## Vérifications de développement

```sh
pnpm --filter @studium/claude-code-mod test
pnpm --filter @studium/claude-code-mod typecheck
claude plugin validate --strict apps/claude-code-mod
claude plugin test apps/claude-code-mod
```

La suite portable simule uniquement la frontière avec l'hôte Claude et fonctionne sans la CLI Claude. Le test natif du plugin reste une vérification SDK explicite.
