# Skills prêts à utiliser

Les skills sont des procédures que le harnais lit au bon moment. Ils complètent
les tutoriels ; ils ne fournissent ni modèle, ni compte, ni serveur MCP à eux seuls.
Leurs sources sont versionnées dans `skills/` du dépôt Studium.

| Skill | Quand l'utiliser | Exemple de demande |
|---|---|---|
| `studium-teacher` | Installation enseignant, premier brouillon sourcé, revue MySTRA | « Aide-moi à préparer mon premier cours à partir de cet article. » |
| `studium-student` | Installation étudiante, choix du harnais et première activité | « J'ai Copilot Student ; aide-moi à démarrer le cours. » |
| `studium-harness` | Boucle MCP/fichier, réponses personnelles, runs et exploration | « Pilote cette séance et attends mes réponses. » |
| `studium-activity-templates` | Choisir et adapter une activité interactive liée à la scène | « Fais-moi explorer ce résultat avec un template. » |
| `studium-visual-support` | Figure sourcée, carte conceptuelle ou explication visuelle adaptée | « Explique cette figure en tenant compte de ce que je connais déjà. » |
| `studium-learner-report` | Export local et revue des actions choisies dans ASTRA/MySTRA | « Prépare mon rapport sans inclure mes textes privés. » |

## Les utiliser dans un clone du projet

Le dépôt contient des liens de découverte `.agents/skills/` et `.claude/skills/`
vers les mêmes sources. Les clients qui reconnaissent ces dossiers peuvent les
charger automatiquement. La découverte dépend du client, de sa version, de la
confiance accordée au projet et de la conservation des symlinks par Git/Windows.
Elle n'a pas été vérifiée dans chaque interface authentifiée.

Dans Codex, commencer par exemple par :

```text
Utilise $studium-teacher pour vérifier mon installation et préparer un premier
brouillon sourcé, sans ajouter de fournisseur API.
```

```text
Utilise $studium-student pour connecter mon harnais et commencer la leçon
fournie par mon enseignant. Attends mes propres réponses.
```

```text
Utilise $studium-harness pour reprendre la boucle pédagogique. Vérifie la
session réellement disponible avant toute réponse ou exécution.
```

Dans un client avec menu de skills, sélectionner le nom correspondant. Sinon,
la méthode portable est explicite :

> Lis `skills/studium-teacher/SKILL.md` dans ce dépôt et applique-le pour mon
> onboarding enseignant.

Remplacer le nom par `studium-student` ou `studium-harness` selon le besoin.
Cette lecture directe reste utilisable quand les liens de découverte ne sont
pas suivis. Le skill doit résoudre sa source réelle pour trouver les guides.

## Utilisation depuis un autre dossier

Sur une machine personnelle, on peut ajouter un lien vers le dossier source du
skill dans le répertoire de skills reconnu par son harnais, par exemple
`~/.agents/skills` pour Codex ou `~/.claude/skills` pour Claude Code. Vérifier
l'emplacement du client choisi et préserver toute entrée existante. Les liens
doivent pointer vers un clone durable, pas un worktree temporaire. Les guides
et le code doivent rester avec les skills ; copier seulement `SKILL.md` perdrait
les références au projet.

Ne pas recopier les procédures dans plusieurs installations. Mettre à jour la
source, puis ouvrir une nouvelle session si le client garde son catalogue en cache.
Sur Windows sans symlinks, utiliser le chemin source explicite dans le prompt.

## Ce qui permet de dire « prêt »

Le harnais a lu le skill choisi, trouvé la bonne installation et exécuté une
vérification pertinente : outils MCP et scène publique pour l'étudiant, ou
packet/check/revue pour l'enseignant. Une activation de skill ne prouve pas une
connexion MCP. Une démo automatisée ne prouve pas un apprentissage.

Les paramètres de compte et d'API restent dans les guides
[Copilot](copilot.md) et [autres harnais](harnesses-and-api.md). Une demande
d'onboarding n'autorise pas implicitement un achat, une diffusion étudiante ou
la publication de données. Les skills reprennent les autorisations déjà données
et ne redemandent pas confirmation pour les étapes locales déjà convenues.

## Templates et traces

Les [templates d’activité](../user/activity-templates.md) fournissent une structure
au harnais ; le viewer ne contient pas un agent. Le
[rapport étudiant](../user/learner-report.md) utilise les contrats ASTRA/ARA communs
et MySTRA, avec un fichier d’actions Studium versionné. Il couvre les événements
enregistrés explicitement, pas toute la conversation ni une preuve d’autonomie.
