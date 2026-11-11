# Studium

Studium turns sources you trust into adaptive lessons. This extension plays a lesson in a pane beside your
editor: one question at a time, with its figures, equations, plots and 3D molecules. Feedback comes after
your answer and says who wrote the answer key and whether anything assessed what you wrote. Reviews bring
each idea back on later days, before you forget it.

Studium is a research prototype from eDIAM (Institut de Chimie de Nice, Université Côte d'Azur, CNRS) and
HolobiomicsLab, under the Apache-2.0 licence. La version française est plus bas.

## Who does what

Knowing this saves the first ten minutes:

| Part | What it does | What it does not do |
|---|---|---|
| **An AI assistant** connected to the Studium server (Copilot in VS Code, Claude Code, Codex, Cursor) | builds a lesson from the sources you name, and can play it with you in the conversation | answer for you |
| **This extension** | shows a lesson in a pane, keeps your progress, tells you when reviews are due | build a lesson: right after installation its **Lessons** view says "No lesson found yet" |

So a new lesson starts in an assistant. If a teacher gave you a folder of lessons, go to step 3.

## Get your first lesson

### 1. Connect your assistant to Studium

You need Node 20 or later (`node --version`). Run the line for your assistant once, in a terminal, then
restart the assistant:

| Assistant | Command |
|---|---|
| Copilot in VS Code, agent mode | `code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'` |
| Claude Code | `claude mcp add --scope user studium -e LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Codex | `codex mcp add studium --env LITELLM_BASE_URL= -- npx -y studium-mcp` |

The server is the npm package `studium-mcp`; `npx` fetches it the first time. Studium needs no API key of
its own: the assistant works with the model you already have, a Copilot plan for example. The empty
`LITELLM_BASE_URL=` keeps Studium from calling any paid model. In Cursor, Claude Desktop or another
assistant, declare an MCP server named `studium` whose command is `npx` with the arguments `-y` and
`studium-mcp`.

### 2. Ask for a lesson

In a new conversation with your assistant (in Copilot Chat, choose the agent mode), in your own words:

> I want to learn how the water cycle works with Studium. Use these two pages: (two links you trust).

The assistant builds a lesson from your sources, shows you its outline and asks the first question. The
lesson is saved on your machine, in `~/.studium/library`.

### 3. Open it here

Select the **Studium** icon in the activity bar. The lesson is in the **Lessons** view; use the refresh
button of the view if VS Code was already open. Select the lesson to play it.

- For a folder of lessons a teacher gave you: run **Studium: Pick a course** from the Command Palette and
  choose the folder.
- For a guided tour in five steps: run **Studium: Getting started**.

## What a lesson looks like

- **One step at a time.** A step is something to read, a question with choices, a short written answer,
  a claim made by an AI to check, or a calculation to run.
- **Feedback that says what was checked.** A tick appears only on an answer marked right, a cross only on one marked
  wrong. An answer that nothing assessed is shown as recorded, with the reference to compare with; you then
  rate your own recall.
- **Reviews.** When no lesson is playing, the status bar says how many ideas are waiting ("Studium · 2 to
  review"), and the sidebar lists them, or gives the date of the next review.
- **Nothing runs without you.** Before a lesson's command runs, the extension shows the exact command and
  the folder, and waits for your choice. It asks again each time, unless you chose to trust that course.
- **Your editor's theme and language.** The interface follows VS Code, in English or French, and works
  with the keyboard and a screen reader.

## Commands

| Command | What it does |
|---|---|
| **Studium: Pick a course** | choose a lesson, or another folder of lessons |
| **Studium: Open lesson** | reopen the current lesson |
| **Studium: Open this lesson** | on a `lesson.json` file (right-click): open that lesson |
| **Studium: Getting started** | the guided tour |
| **Studium: Forget my data** | after confirmation, erase what this extension keeps |

In Copilot Chat, `@studium` plays the current lesson in the conversation.

## Your data

- Your progress and review dates stay on your machine, in the storage VS Code gives this extension. Your
  lessons are files in `~/.studium/library`.
- The extension calls no AI model. A judge model for written answers is optional and off, unless
  `LITELLM_BASE_URL` is set in the environment VS Code was started from.
- Class telemetry is off unless you turn on `studium.telemetryConsent`.
- The pane and an assistant keep separate progress: a lesson started in the conversation starts again
  from its first step in the pane.

## Requirements

VS Code 1.95 or later. The extension carries its own lesson server and viewer libraries and works offline.
Connecting an assistant (step 1) needs Node 20 or later.

## En français

Studium transforme des sources que vous jugez fiables en leçons adaptatives. Cette extension joue une leçon
dans un panneau à côté de votre éditeur : une question à la fois, avec ses figures, ses équations, ses
graphiques et ses molécules en 3D. Le retour vient après votre réponse et dit qui a écrit le corrigé et si
quelque chose a évalué ce que vous avez écrit. Les révisions ramènent chaque idée les jours suivants,
avant que vous l'oubliiez.

Studium est un prototype de recherche d'eDIAM (Institut de Chimie de Nice, Université Côte d'Azur, CNRS) et
du HolobiomicsLab, sous licence Apache-2.0.

### Qui fait quoi

Le savoir épargne les dix premières minutes :

| Partie | Ce qu'elle fait | Ce qu'elle ne fait pas |
|---|---|---|
| **Un assistant IA** relié au serveur Studium (Copilot dans VS Code, Claude Code, Codex, Cursor) | construit une leçon à partir des sources que vous nommez, et peut la jouer avec vous dans la conversation | répondre à votre place |
| **Cette extension** | affiche une leçon dans un panneau, garde votre progression, vous dit quand des révisions sont dues | construire une leçon : juste après l'installation, sa vue **Leçons** dit « Aucune leçon trouvée pour l'instant » |

Une nouvelle leçon commence donc dans un assistant. Si un enseignant vous a donné un dossier de leçons,
passez à l'étape 3.

### Obtenir votre première leçon

**1. Reliez votre assistant à Studium.** Il vous faut Node 20 ou plus récent (`node --version`). Lancez une
fois, dans un terminal, la ligne de votre assistant, puis redémarrez-le :

| Assistant | Commande |
|---|---|
| Copilot dans VS Code, mode agent | `code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'` |
| Claude Code | `claude mcp add --scope user studium -e LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Codex | `codex mcp add studium --env LITELLM_BASE_URL= -- npx -y studium-mcp` |

Le serveur est le paquet npm `studium-mcp` ; `npx` le télécharge la première fois. Studium n'a besoin
d'aucune clé d'API : l'assistant travaille avec le modèle que vous avez déjà, un abonnement Copilot par
exemple. Le `LITELLM_BASE_URL=` vide empêche Studium d'appeler un modèle payant. Dans Cursor, Claude
Desktop ou un autre assistant, déclarez un serveur MCP nommé `studium` dont la commande est `npx` avec les
arguments `-y` et `studium-mcp`.

**2. Demandez une leçon.** Dans une nouvelle conversation avec votre assistant (dans Copilot Chat,
choisissez le mode agent), avec vos mots :

> Je veux apprendre comment fonctionne le cycle de l'eau avec Studium. Utilise ces deux pages : (deux liens
> que vous jugez fiables).

L'assistant construit une leçon à partir de vos sources, vous montre son plan et pose la première question.
La leçon est enregistrée sur votre machine, dans `~/.studium/library`.

**3. Ouvrez-la ici.** Sélectionnez l'icône **Studium** dans la barre d'activité. La leçon est dans la vue
**Leçons** ; utilisez le bouton de rafraîchissement de la vue si VS Code était déjà ouvert. Sélectionnez la
leçon pour la jouer.

- Pour un dossier de leçons donné par un enseignant : lancez **Studium : Choisir un cours** depuis la
  palette de commandes et choisissez le dossier.
- Pour une visite guidée en cinq étapes : lancez **Studium : Prise en main**.

### À quoi ressemble une leçon

- **Une étape à la fois.** Une étape est un texte à lire, une question à choix, une courte réponse rédigée,
  une affirmation d'une IA à vérifier, ou un calcul à lancer.
- **Un retour qui dit ce qui a été vérifié.** Une coche n'apparaît que sur une réponse notée juste, une croix que
  sur une réponse notée fausse. Une réponse que rien n'a évaluée est affichée comme enregistrée, avec la
  référence à laquelle la comparer ; vous évaluez alors vous-même votre rappel.
- **Les révisions.** Quand aucune leçon n'est en cours, la barre d'état dit combien d'idées attendent
  (« Studium · 2 à réviser »), et la barre latérale les liste, ou donne la date de la prochaine révision.
- **Rien ne s'exécute sans vous.** Avant qu'une commande d'une leçon s'exécute, l'extension montre la
  commande exacte et le dossier, et attend votre choix. Elle redemande à chaque fois, sauf si vous avez
  choisi de faire confiance à ce cours.
- **Le thème et la langue de votre éditeur.** L'interface suit VS Code, en français ou en anglais, et
  fonctionne au clavier et avec un lecteur d'écran.

### Commandes

| Commande | Ce qu'elle fait |
|---|---|
| **Studium : Choisir un cours** | choisir une leçon, ou un autre dossier de leçons |
| **Studium : Ouvrir une leçon** | rouvrir la leçon courante |
| **Studium : Ouvrir cette leçon** | sur un fichier `lesson.json` (clic droit) : ouvrir cette leçon |
| **Studium : Prise en main** | la visite guidée |
| **Studium : Oublier mes données** | après confirmation, effacer ce que cette extension garde |

Dans Copilot Chat, `@studium` joue la leçon courante dans la conversation.

### Vos données

- Votre progression et vos dates de révision restent sur votre machine, dans l'espace de stockage que
  VS Code donne à cette extension. Vos leçons sont des fichiers dans `~/.studium/library`.
- L'extension n'appelle aucun modèle d'IA. Un modèle juge pour les réponses rédigées est facultatif et
  désactivé, sauf si `LITELLM_BASE_URL` est défini dans l'environnement d'où VS Code a été lancé.
- La télémétrie de classe est désactivée tant que vous n'activez pas `studium.telemetryConsent`.
- Le panneau et un assistant gardent des progressions séparées : une leçon commencée dans la conversation
  reprend à sa première étape dans le panneau.

### Prérequis

VS Code 1.95 ou plus récent. L'extension embarque son propre serveur de leçons et ses bibliothèques
d'affichage, et fonctionne hors ligne. Relier un assistant (étape 1) demande Node 20 ou plus récent.
