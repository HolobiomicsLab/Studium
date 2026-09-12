# Installer Studium

Deux usages peuvent partager le même code : **suivre une leçon** nécessite Node
et éventuellement VS Code ; **préparer un cours et ses preuves** ajoute Python.
L'API et les harnais locaux permettent aussi de suivre une leçon sans éditeur.
La première séance utilise des exemples locaux sans clé API backend. Les
téléchargements d'outils et de dépendances nécessitent Internet au premier install.

## 1. Obtenir le code

Prérequis : Git, une version LTS maintenue de [Node.js](https://nodejs.org/en/download)
compatible avec le minimum du dépôt (20), et **pnpm 9.15.9**. Vérifier avec
`node --version` et `pnpm --version`. Suivre l'[installation pnpm](https://pnpm.io/installation)
si nécessaire ; ne pas présumer que Corepack est présent sur chaque installation Node.

Depuis un terminal, avec les droits d'accès au dépôt :

**Choisir la révision avant l'installation.** `dev` est la branche distante
habituelle. Certaines [avancées des 10–12 septembre](../updates/2026-09-12.md)
attendent encore leur intégration. Pour celles-ci, l'enseignant ou le mainteneur
doit fournir un checkout de la révision documentée ; ne pas chercher une branche
locale qui n'a pas encore été publiée. Conserver `git rev-parse HEAD` avec le
matériel du pilote. Si vous avez déjà ce checkout, commencer à `pnpm install`.

```sh
git clone --branch dev https://github.com/HolobiomicsLab/studium.git
cd studium
pnpm install --frozen-lockfile
pnpm build:libs
pnpm --filter studium-vscode vendor
pnpm --filter studium-vscode build
node apps/lesson-mcp/scripts/headless_smoke.mjs
```

Le dernier script vérifie la boucle MCP sans VS Code et affiche le nombre de
contrôles réussis. Il doit terminer sans échec. Le build crée
`apps/studium-vscode/dist/lesson-mcp.cjs`, utilisé dans les
configurations des [harnais](harnesses-and-api.md). Garder le terminal à la racine
du dépôt pour les commandes suivantes. Si une branche de travail vous est fournie
pour un pilote, utiliser cette branche avec sa documentation plutôt que mélanger
des révisions. Les dernières fonctions peuvent attendre leur publication distante.

Un environnement qui définit déjà `LITELLM_BASE_URL` peut activer un fournisseur
backend. Pour cette démonstration, retirer cette variable du terminal de test ou
la définir vide. Les exemples MCP fournis imposent une valeur vide.

## 2. Choisir la surface étudiant

### Panneau ou notebook VS Code

Installer une version actuelle de [VS Code](https://code.visualstudio.com/).
Ouvrir **le dossier `apps/studium-vscode`** dans VS Code, puis F5 et la configuration
« Run Studium Extension ». Dans la nouvelle fenêtre de développement, lancer
**Studium: Open Lesson** ou **Studium: Open Lesson as Notebook** depuis la palette.
L'exemple par défaut est `atomistique-l1/lesson.json` dans `fixtures/`.
Ce parcours de démonstration ne nécessite pas Copilot.

Pour un cours fourni par l'enseignant, définir dans les paramètres :

```json
{
  "studium.bundlesRoot": "/CHEMIN/ABSOLU/mes-cours",
  "studium.bundleRef": "mon-cours/lesson.json",
  "studium.telemetryConsent": false,
  "studium.assets": "vendor"
}
```

La racine contient le dossier `mon-cours`. Le professeur fournit le bundle et
ses assets ensemble. Les chemins d'exemple sont à remplacer ; sous Windows,
utiliser `C:/Users/.../mes-cours` dans le JSON.

### Agent dans le chat ou le terminal

Suivre [Copilot](copilot.md) ou [un autre harnais](harnesses-and-api.md), puis le
[tutoriel première séance](../tutorials/first-lesson.md). Le client démarre le serveur
stdio ; ne pas ouvrir un port HTTP pour MCP. Ce serveur ne produit pas de page web.

### API locale sans MCP

Suivre [API et harnais](../guides/api-and-harness.md) après l'installation des
dépendances. Ce parcours utilise `pnpm --filter @studium/lesson-mcp api` et le
client `api:call`, sans ouvrir VS Code. Il faut un token local partagé entre le
serveur et ses clients ; aucune clé de fournisseur LLM n'est nécessaire à la démo.
Le serveur doit rester actif pour reprendre la séance depuis un autre harnais.

### Navigateur seul

Un enseignant peut fournir une activité portable déjà préparée : ouvrir son
`index.html` dans un navigateur récent. L'activité ne nécessite pas le clone ni
un compte LLM pour ses interactions locales. Les supports préparés sont embarqués.
Elle n'est pas le moteur complet de séance : elle ne pilote pas automatiquement
la progression et ne contient pas d'agent. Voir [activité → rapport](../tutorials/activity-to-report.md).

### VSIX pour un groupe pilote

Un enseignant ou mainteneur peut construire un paquet après l'étape 1 :

```sh
pnpm --filter studium-vscode package
code --install-extension apps/studium-vscode/studium.vsix
```

Le packaging peut télécharger l'outil VSCE. Le VSIX contient le serveur MCP
compilé et les bibliothèques de rendu vendorizées. Pour **le panneau**, le
destinataire n'a pas besoin du clone ni de `tsx`, mais doit recevoir les bundles
séparément et définir `studium.bundlesRoot` / `studium.bundleRef`. Ne pas présenter
ce paquet local comme une extension publiée au Marketplace. La construction
VSIX n'est pas nécessaire pour le parcours F5.

## 3. Ajouter les outils enseignant en Python

Depuis la racine, avec Python **3.12 ou supérieur** (recette vérifiée avec 3.13) :

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -e packages/lesson-schema/python -e packages/telemetry-events -e services/planner -e services/scene-synth -e services/analytics-collector
.venv/bin/python tools/experience_packet.py --help
.venv/bin/python tools/experience_review.py --help
```

Puis suivre le [guide enseignant](../user/teacher-guide.md). Ne pas installer ces
paquets dans le Python système. Les bibliothèques scientifiques d'une capsule
s'installent dans **son environnement séparé**, selon ses propres versions.

Sous Windows, créer le venv avec `py -3.13 -m venv .venv`, puis remplacer
`.venv/bin/python` par `.venv\Scripts\python.exe`. Les JSON pointent vers les mêmes fichiers. Le script `vendor` emploie des
commandes Unix (`mkdir`, `cp`) : pour construire depuis les sources sous Windows,
utiliser un environnement compatible comme WSL et ses propres dépendances, ou
recevoir un VSIX déjà construit pour le panneau. Ne pas mélanger `node_modules`
Windows et WSL. Les commandes shell avec `VARIABLE=valeur` sont
POSIX : en PowerShell, définir `$env:VARIABLE="valeur"` avant la commande.
Les scripts Bash de développement nécessitent Bash/WSL. Le parcours Windows
n'a pas été exécuté dans la vérification de cette documentation.

## Mise à jour et reprise

Conserver ses cours et expériences hors des fichiers sources versionnés. Arrêter
la séance, noter sa révision (`git rev-parse HEAD`), puis appliquer la mise à jour
convenue avec l'enseignant et refaire installation/build. Reconnecter MCP après
un changement de serveur. Un identifiant de session appartient au processus qui
l'a créé : l'API permet de le réutiliser dans un autre harnais tant que ce même
serveur tourne, mais pas de le transférer vers un nouveau processus.

Un problème ? Commencer par le [dépannage](../troubleshooting.md), sans supprimer
les données d'apprentissage ni les sorties d'expérience pour « repartir propre ».
