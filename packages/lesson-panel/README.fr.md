[English](README.md) · Français

# Panneau de leçon partagé

`@studium/lesson-panel` compose la même vue apprenante pour VS Code et les autres harnais. Il n'importe ni VS Code, ni DOM, ni API de fichiers. Le backend injecté lit les images.

## Contrat

`PanelViewSchema` et `PanelActionSchema` sont des schémas Zod dont les types TypeScript sont inférés. Une vue porte `schema: "studium/panel-view/2"`, les identifiants de session, la scène publique, les supports ordonnés, la langue et le catalogue de chaînes, la progression, le retour acquis, les révisions, la calibration sans nombres et la complétion. La maîtrise est vide par défaut ; sur demande, les valeurs non mesurées restent null, conformément à l'hôte existant. Une explication peut conserver sa forme structurée ou être du texte.

La version 2 ajoute des champs et n'en retype aucun : `orientation` (l'étape sur le total, la notion à l'écran, les minutes restantes, les révisions dues, ce qui est attendu, la raison de la dernière adaptation), `status_line` (la même chose en 80 caractères au plus), `voices` (qui signe la leçon et si elle a été relue ; qui a évalué une réponse), `help` (relire, indice, explication, référence, chacun ouvert ou fermé avec son coût ou sa raison), `prompts`, `attention` et `surface`. Le backend calcule les quatre premiers par `getOrientation` (voir `packages/lesson-session-host/src/orientation.ts`) ; un backend sans cette méthode écrit `studium/panel-view/1`, comme l'avis d'une séance effacée. `PanelViewSchema` lit les deux versions et refuse une vue de version 2 à laquelle manque l'un de ces champs.

Le présentateur réutilise [publicScene](../lesson-session-host/src/public-scene.ts). Les champs answer, correct, expected, key ou solution restants dans la scène ou les supports avant réponse sont refusés récursivement. Le verdict acquis peut contenir correct après réponse. Cette validation ne constitue pas une seconde règle de suppression. Les indices et les retours de discussion restent présents lors d'une nouvelle lecture de la vue.

## Backends et actions

`presentPanel(backend, ctx)` lit la vue. `applyPanelAction(backend, ctx, action)` valide et applique respond, turn, hint, rateRecall, reviewNow, restartLesson, end ou pickCourse, et refuse en une ligne une action inconnue ou mal formée. L'hôte possède le `PanelContext` mutable : identité, titres des concepts, préférences, origines des révisions, transition acquise et dernière vue. Il sérialise les actions. Réviser ou recommencer peut remplacer l'identifiant de session ; reprendre celui de la vue renvoyée.

Quatre autres actions, proposées sur une scène en version 2, changent la façon de montrer la leçon et jamais une réponse :

| Action | Effet |
|---|---|
| `setLanguage {presentation_language}` | Affiche le texte propre au panneau (libellés, ligne d'état) en français ou en anglais ; une variante régionale garde sa langue de base, `null` revient à la langue de la leçon. Le contenu de la leçon reste dans sa langue : seule la conversation le traduit. La séance note la langue demandée, quelle qu'elle soit ; pour une autre langue que ces deux-là, la vue dit que le panneau n'a pas de texte pour elle. |
| `setAttention {level}` | Règle `attention` sur `quiet`, `normal` ou `coached` : ce que la séance peut proposer. |
| `replan {minutes}` | Répond à « j'ai N minutes » par une invite (`prompts`, genre `replan`) : les révisions dues d'abord, puis si la leçon se termine à temps. Rien n'est coupé ; l'invite part avec la scène. |
| `ask {text?}` | Passe la main à la conversation : une vue `notice`, la scène inchangée, rien de soumis. `text` est gardé dans le contexte (`question`). |

Une vue porte `strings`, le catalogue des libellés de l'interface dans la langue de la leçon (environ
24 ko), pour la surface qui la dessine. Le serveur MCP le laisse vide là où rien ne dessine la vue
(formulaires, conversation). Son lecteur est alors un modèle.

Une surface peut envoyer `client_ms` à côté d'une action (`ClientMsSchema`, un nombre entier de millisecondes de 0 à 600000) : le délai entre l'action précédente de l'apprenant et l'affichage de la vue qui y a répondu. Il ne fait jamais partie de l'action. `panel_action` le valide ; rien ne le lit encore, le journal d'interaction l'enregistrera sous consentement.

L'[adaptateur MCP](../../apps/lesson-mcp/src/panel-tools.ts) fournit `hostBackend(SessionHost, bundlesRoot)`, avec lecture des images confinée au dossier de la leçon. Il observe aussi les transitions des outils ordinaires, dont une reproduction native, afin de préserver la complétion. L'[adaptateur VS Code](../../apps/studium-vscode/src/extension.ts) fournit `mcpBackend(call, {bundlesRoot})` sur les opérations existantes. L'extension consomme normalement open_lesson_panel, get_panel_view et panel_action directement. Le backend lit aussi get_next_reinforcement pour compter les révisions dues en fin de leçon.

## Ajouter un hôte

1. Ouvrir une session avec open_lesson_panel et conserver le PanelView.
2. Afficher les champs publics et proposer les actions de actions.
3. Transmettre uniquement la réponse ou la note donnée par l'apprenant avec panel_action, puis afficher la nouvelle vue.
4. Traiter pickCourse localement (action laissée à l'hôte). Demander une confirmation native avant end avec confirmed:true, qui efface la progression. confirmed:false conserve la vue. Fermer l'interface est distinct de l'effacement.

P1 n'enregistre aucune métadonnée MCP UI. VS Code publie `{type:"view", view}` et un message de compatibilité temporaire ; le renderer partagé et la ressource MCP Apps relèvent de P2. Les anciens chemins des helpers réexportent le paquet pour les pilotes existants. Le helper de compatibilité de complétion reste dans VS Code, hors du périmètre d'écriture P1.

## Vérification

`pnpm --filter @studium/lesson-panel test` exécute les tests d'actions sur fixture. `pnpm --filter @studium/lesson-panel build` vérifie TypeScript. Les vérifications MCP et VS Code restent dans leurs paquets. Aucun appel à un modèle n'est nécessaire.
