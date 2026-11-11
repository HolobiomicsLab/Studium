[English](skills.md) · Français

# Skills

Les skills sont des procédures écrites que votre assistant lit au bon moment : accueillir un enseignant,
piloter une leçon sans répondre à la place de l'apprenant, préparer une leçon d'auto-apprentissage. Elles
sont livrées avec le dépôt, dans `skills/`. Une skill n'apporte ni modèle, ni compte, ni serveur : connectez
d'abord le serveur Studium ([Harnais](harnesses.fr.md)).

Aucune skill n'est nécessaire pour apprendre un sujet dans une conversation. À la connexion, le serveur
donne ses instructions à l'assistant, et les prompts `learn` et `review` lancent les deux usages courants.

## Skills disponibles

| Skill | Pour | Exemple de demande |
|---|---|---|
| `studium-student` | installer ou connecter Studium, configurer Copilot Student ou un autre assistant, commencer une première leçon | « J'ai Copilot Student ; aide-moi à démarrer le cours. » |
| `studium-teacher` | installer, connecter un assistant, rédiger une leçon à partir de la littérature, la relire avant un pilote | « Aide-moi à préparer mon premier cours à partir de cet article. » |
| `studium-harness` | conduire la boucle de leçon par MCP, HTTP ou le canal fichiers : présenter les scènes, recueillir les réponses de l'apprenant, exécuter les capsules honnêtement | « Pilote cette séance et attends mes réponses. » |
| `studium-self-learner` | transformer des références que vous avez choisies (une page web, un PDF, un texte) en leçon d'auto-apprentissage avec les outils Python, puis la jouer | « Construis une leçon à partir de ce chapitre, puis fais-la-moi jouer. » |
| `studium-from-conversation` | transformer la conversation en cours, ou une séance passée, en courte leçon qui la cite, avec une carte des notions | « Fais une courte leçon à partir de cette conversation pour que je vérifie que j'ai compris pourquoi la porte m'a renvoyé en arrière. » |
| `studium-concept-map` | voir où vous en êtes sur chaque notion d'une leçon, et exporter la carte en page à explorer, avec ce sur quoi repose chaque notion | « Où en suis-je dans cette leçon ? Puis exporte la carte en page. » |
| `studium-suggest` | laisser l'assistant proposer la bonne fonction de Studium au bon moment, une fois, puis attendre votre accord | « Dis-moi quand une courte leçon ou une révision m'aiderait, et demande-moi d'abord. » |
| `studium-activity-templates` | choisir et adapter une activité interactive liée à une scène | « Fais-moi explorer ce résultat avec un template. » |
| `studium-visual-support` | examiner des photographies sources ou demander une image, une carte, un audio ou une vidéo adaptés, par votre assistant | « Prépare une aide visuelle avec un équivalent textuel. » |
| `studium-learner-report` | exporter une trace d'activité ou un journal d'expérience enregistrés en rapport local | « Prépare mon rapport sans mes textes privés. » |
| `studium-observatory` | lancer et lire l'Observatoire, la vue locale en lecture seule de ce que Studium a produit | « Montre-moi les décisions et les preuves derrière ce cours. » |
| `studium-contribute` | signaler une difficulté avec Studium lui-même ou demander une fonction manquante : l'assistant rédige le texte, vous le publiez | « Aide-moi à signaler ce qui vient de se passer ; je le publierai moi-même. » |

## Les utiliser dans un clone

Le dépôt relie les skills dans `.claude/skills/` (Claude Code) et `.agents/skills/` (Codex et les autres
clients qui lisent ce dossier). Les clients qui reconnaissent ces dossiers peuvent charger une skill
d'eux-mêmes ; la découverte dépend du client, de sa version, de la confiance accordée au projet et de la
conservation des liens symboliques dans votre clone. Si votre client ne liste pas une skill,
`studium-observatory` par exemple, nommez son fichier.

Dans Codex, appelez une skill par son nom :

```text
Utilise $studium-student pour connecter mon assistant et commencer la leçon fournie par mon enseignant. Attends mes propres réponses.
```

Dans n'importe quel client, la méthode portable est explicite :

```text
Lis skills/studium-teacher/SKILL.md dans ce dépôt et applique-le pour mon accueil d'enseignant.
```

Remplacez le nom par la skill voulue. La skill résout son vrai dossier pour trouver les guides et outils
auxquels elle renvoie.

## Les utiliser depuis un autre dossier

Pour utiliser les skills hors du clone, reliez chaque dossier de skill au dossier de skills que lit votre
client, par exemple `~/.claude/skills` pour Claude Code ou `~/.agents/skills` pour Codex :

```bash
ln -s /path/to/studium/skills/studium-student ~/.claude/skills/studium-student
```

Faites pointer les liens vers un clone durable, pas vers un worktree temporaire, et gardez les entrées déjà
présentes. Ne copiez pas `SKILL.md` seul : il renvoie à des guides et outils du dépôt. Après une mise à
jour, ouvrez une nouvelle session si votre client garde sa liste de skills en cache. Sous Windows sans
liens symboliques, nommez le fichier source dans votre demande.

## Ce qu'une skill ne prouve pas

Une skill chargée ne prouve pas que le serveur Studium est connecté : vérifiez avec `get_server_info`
([Harnais](harnesses.fr.md#vérifier-la-connexion)). Une démonstration automatisée ne prouve pas qu'une
personne a appris. Une demande d'accueil n'autorise ni achat, ni diffusion aux étudiants, ni publication de
données ; les skills demandent avant ces étapes et reprennent les autorisations déjà données pour les étapes
locales.

Pages liées : [Signaler un problème ou contribuer](report-and-contribute.fr.md), [Templates d'activité](../teach/activity-templates.fr.md),
[Médias et supports visuels](../teach/media-and-visual-support.fr.md),
[Rapport de l'apprenant](../learn/learner-report.fr.md), [Observatoire](../teach/observatory.fr.md).
