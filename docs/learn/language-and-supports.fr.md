[English](language-and-supports.md) · Français

# Langue et supports

Apprenez dans la langue de votre choix, demandez la représentation qui vous aide (une équation, un schéma, une
molécule, une explication en texte) et ouvrez une aide courte sur la raison d'être de chaque étape. Changer de
langue ne change que ce que vous voyez : les sources originales, vos réponses, les identifiants, les nombres,
les unités et la notation scientifique restent tels quels. Une traduction aide à comprendre ; ce n'est pas une
preuve nouvelle.

## Choisir votre langue

**Avec un assistant.** Dites-le au début ou à tout moment : « Continue en français ; garde les citations
originales à côté des traductions. » L'assistant traduit ses explications, consignes, retours et légendes avec
ses propres capacités de texte ; aucun modèle d'image n'est nécessaire et Studium n'appelle aucun service de
traduction en arrière-plan. Les textes de chat prêts à l'emploi de Studium existent en anglais et en français ;
pour toute autre langue, l'assistant les traduit. Vérifiez dans une traduction les termes spécialisés, les
négations et les consignes d'évaluation.

Concrètement, l'assistant transmet `presentation_language` (une étiquette BCP 47 comme `fr` ou `de`) à
`start_lesson_session`, ou appelle `set_session_language` avec `{session_id, presentation_language}` pour en
changer ; `null` revient à la langue de la leçon. Le choix vaut pour la séance en cours, pas pour un compte.

**Avec le canal fichier.** Lancez le lanceur avec `--language=fr`, ou écrivez `session-language.json` avec le
même identifiant de séance et la nouvelle langue, puis attendez le `task.md` rafraîchi.

**Dans VS Code.** L'interface du panneau suit la langue d'affichage de VS Code (anglais ou français) ; le texte
de la leçon reste dans sa langue de rédaction.

**Dans une activité portable.** Le sélecteur de langue passe d'une traduction fournie par l'enseignant à une
autre, sans effacer votre prédiction, vos choix, votre confiance ni votre trace. Un texte sans traduction reste
dans sa langue source, avec un avis visible ; le sélecteur ne prétend jamais traduire automatiquement une leçon.

Une leçon traduite proposée à d'autres étudiants passe toujours par la relecture de l'enseignant
([relire et approuver](../teach/review-and-approve.fr.md)).

## Demander une représentation

| Besoin | Rendu local |
|---|---|
| Une équation | KaTeX, avec MathML accessible |
| Un processus, une relation entre notions, une carte mentale | Un schéma Mermaid |
| La connectivité d'une molécule | Une structure 2D tirée d'un SMILES (SmilesDrawer), signalée comme représentation 2D |
| Une figure originale ou une explication générée | Une image fixe, avec sa source et un texte alternatif |
| Une narration ou un court extrait | Un lecteur natif, avec transcription ou sous-titres |

Ce sont les supports des activités portables. Le panneau VS Code affiche aussi les figures, équations,
graphiques, spectres et structures 3D des scènes, et le réglage `studium.modalityPreference` (`visual`,
`textual` ou `balanced`, par défaut) met d'abord les figures ou le texte ; rien n'est retiré, l'autre modalité
est repliée.

Préférez un ou deux supports utiles à une galerie. Les supports explicatifs sont proposés après votre
prédiction. Un support est un matériau d'apprentissage : il ne prouve ni qu'un calcul a tourné ni que vous avez
été évalué. Une équation mal formée ou une représentation non prise en charge affiche son texte source plutôt
qu'un graphique inventé.

### Une image générée par l'IA

Si votre assistant dispose d'un outil d'image, vous pouvez lui demander une explication graphique. Préférez
d'abord une figure existante, un schéma ou un graphique calculé. La génération d'image peut prendre du temps et
consommer un quota limité ou payant ; l'assistant doit utiliser la voie dont vous disposez et vous demander,
jamais changer de fournisseur en silence. Une image générée porte l'avis « AI-generated image; details may be
inaccurate. » et ne doit jamais remplacer un graphique mesuré, une structure moléculaire ou une figure source.
Vérifiez ses symboles, atomes, nombres et flèches. Rien ne génère d'image automatiquement. Les enseignants
joignent et documentent ces fichiers comme décrit dans [médias et supports visuels](../teach/media-and-visual-support.fr.md).

## Une aide à chaque étape

Les symboles **?** ouvrent une aide courte, au clic, au toucher, ou avec Entrée ou Espace après Tab ; Échap ou
un clic ailleurs la ferme dans les activités et l'Observatory. Un second niveau donne la méthode, ses limites et
sa source dans le projet. L'aide est facultative : consignes, alertes, choix de confidentialité et limites
scientifiques restent toujours sur la page elle-même. Elle explique pourquoi une étape est demandée et propose
une démarche, jamais la réponse.

| Principe | À quoi il sert | Ce qu'il ne faut pas en conclure |
|---|---|---|
| Objectif explicite | Relier l'activité à une capacité à exercer | Finir ne prouve pas la maîtrise |
| Prédiction avant résultat | Rendre visible votre raisonnement initial | Se tromper n'est pas un diagnostic |
| Confiance déclarée | Examiner votre propre incertitude | La certitude n'est pas l'exactitude |
| Comparaison contrôlée | Voir l'effet d'un choix face à une référence | Une comparaison affichée n'est pas forcément une nouvelle exécution |
| Observation, puis conclusion | Distinguer un résultat de son interprétation | Une explication fluide n'est pas une preuve |
| Étayage | Un soutien temporaire, puis vous agissez | Une adaptation n'est pas un profil figé de l'apprenant |
| Examen critique | Justifier l'accord ou l'objection par des preuves | Tout rejeter ne vaut pas mieux que tout accepter |
| Transfert | Appliquer une idée à un autre cas | La première activité ne mesure pas la rétention différée |
| Provenance | Retrouver sources, décisions et contrôles | Une empreinte ne certifie pas la vérité scientifique |
| Revue humaine | Examiner une révision précise avant d'enseigner avec | Ouvrir MySTRA ne valide ni ne publie un cours |

Ces formulations décrivent des intentions de conception ; elles ne prétendent pas établir l'efficacité
pédagogique de Studium. Pour le fond : [principes d'apprentissage](../concepts/learning-principles.fr.md).

L'aide existe en anglais et en français. Dans les activités, elle suit le sélecteur de langue ; pour une autre
langue, l'anglais s'affiche, marqué `lang="en"`, et l'assistant peut l'expliquer. Elle fonctionne sans
JavaScript, ne repose pas sur la seule couleur, porte un nom accessible lié à son sujet et se déploie dans la
page, sans masquer de contrôle sur petit écran. Lire une aide n'est jamais enregistré comme une preuve
d'apprentissage ni comme une demande d'assistance.

Vous la trouvez dans les modèles d'activité portable, le visualiseur de spectres lié, l'Observatory et MySTRA,
les nouveaux rapports portables, les interfaces web et le panneau VS Code. Les rapports et visualiseurs
construits auparavant ne l'acquièrent pas après coup ; dans un chat ou un notebook, l'assistant donne
l'explication en texte.

## Pour les enseignants : préparer une activité dans une autre langue

```bash
pnpm install --frozen-lockfile
pnpm --filter @studium/activity-presentation build
.venv/bin/python tools/experience_templates.py prepare \
  --template conclusion-robustness --context PUBLIC_CONTEXT.json --out ACTIVITY \
  --language fr \
  --translations examples/visual-support/robustness-fr.json \
  --supports examples/visual-support/robustness-support.json
```

- Un fichier de traductions associe une étiquette de langue au texte original exact et à sa traduction :
  `{"fr": {"Original sentence": "Phrase traduite"}}`. Laissez inchangés formules, nombres, unités,
  identifiants, code et notation chimique ; le texte est inséré comme texte, jamais comme HTML. Versionnez les
  traductions relues avec le matériel pédagogique.
- Le manifeste de supports est un objet avec `render_assets`, selon le
  [contrat RenderAsset](../../packages/lesson-bundle-schema/src/render-asset.ts). Chaque support précise sa
  portée et nomme sa source dans `provenance`. `meta.placement: "before_prediction"` rend une photographie
  source ou une introduction sans réponse disponible avant la prédiction ; `meta.origin: "generated"` signale
  une image générée.
- La préparation intègre les ressources au HTML et exécute les moteurs de rendu localement, sans CDN ni appel
  de modèle. Des supports riches ajoutent plusieurs mégaoctets ; une activité en texte seul reste légère. Les
  types non pris en charge sont refusés.
- `presentation.json` garde la langue initiale, les dictionnaires et les ressources préparées, avec sa propre
  empreinte dans la provenance de préparation. L'export des actions de l'apprenant n'enregistre ni les
  changements de langue ni les supports consultés.

Droits, audio et vidéo accessibles, et ajout d'un fichier généré par l'assistant d'un apprenant :
[médias et supports visuels](../teach/media-and-visual-support.fr.md).

## Pour les développeurs : réutiliser le catalogue d'aide

Une seule source porte les textes et la correspondance entre scènes et sujets :
[ui/context-help.json](../../ui/context-help.json) (schéma `studium/context-help/v1`). Chaque sujet a un
identifiant stable, un titre, une définition, un conseil pour l'étudiant et pour l'enseignant, un objectif, une
méthode, une limite et un chemin de source dans le dépôt.

| Contexte | Point d'entrée |
|---|---|
| Python | `help_tip("prediction", "student")` et `add_contextual_help(page)` dans [tools/contextual_help.py](../../tools/contextual_help.py) ; placez `<!-- HELP:prediction -->` dans une section |
| JavaScript | `renderHelp("prediction", catalogue, "student")` depuis [ui/context-help.mjs](../../ui/context-help.mjs), avec `ui/context-help.css` |
| React | `ContextHelp` depuis `@studium/activity-presentation/react`, avec `topic`, `audience` et `language` |
| Chat | Les champs utiles, en texte, dans la langue demandée |

Placez l'aide à côté de sa section, jamais dans des cellules numériques, des libellés de formulaire, des
contrôles de réponse ou des titres réécrits par script. N'y mettez jamais d'objets de scène, de clés de réponse,
de profils ni de texte d'apprenant. Les moteurs de rendu échappent le texte et refusent les sujets inconnus ; un
nouveau sujet demande les deux langues, un objectif concret, une limite et une source existante.
