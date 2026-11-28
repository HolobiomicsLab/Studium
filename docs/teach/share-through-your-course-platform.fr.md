[English](share-through-your-course-platform.md) · Français

# Partager une leçon par votre plateforme de cours

Vous pouvez donner à vos étudiants une leçon approuvée depuis la page de votre cours, dans Moodle ou dans toute plateforme qui porte un fichier et un texte. La plateforme garde un fichier et la consigne ; la leçon se joue sur l'ordinateur de l'étudiant, et rien n'est installé dans la plateforme.

## Avant de commencer

- Une leçon que vous avez approuvée, avec `approval.json` à côté de `lesson.json` : voir [Relire et approuver](review-and-approve.fr.md#approuver-le-fichier-exact).
- L'environnement Python du dépôt, où tourne `tools/experience_packet.py` (voir [Installation](../start/installation.fr.md)).
- Ce dont chaque étudiant a besoin : VS Code et l'extension Studium. Pas de compte d'IA et pas de terminal : le panneau joue la leçon sans modèle ([VS Code](../start/vscode.fr.md)). Un étudiant sans VS Code a besoin de Node.js 20 ou plus récent et de deux commandes dans un terminal : voir [Sans VS Code](#sans-vs-code).

## 1. Empaqueter la leçon

```bash
.venv/bin/python tools/experience_packet.py pack --bundle work/library/my-course/lesson.json --out .
```

`pack` écrit `<bundle_id>.studium.zip` : `lesson.json`, `approval.json`, puis les fichiers de `assets/`, et rien d'autre (ni `reviews/`, ni `community/`, ni fichier caché comme `.DS_Store`). Il refuse une leçon dont `approval.json` manque, est incomplet ou ne correspond pas au `lesson.json` exact : approuvez de nouveau après toute modification. Il refuse aussi, sous `assets/`, un fichier que l'ordinateur d'un étudiant ne pourrait pas enregistrer (un nom avec `: * ? " < > |`, un nom de périphérique Windows comme `NUL`, deux noms qui ne diffèrent que par la casse ou les accents), un lien symbolique, plus de 2000 fichiers, un fichier de plus de 50 Mio ou plus de 200 Mio en tout ; chaque refus nomme le fichier. Les fichiers système comme `Thumbs.db` sont écartés comme les fichiers cachés. Il refuse un fichier de sortie existant sauf avec `--force`. `--language en|fr` fixe la langue de la consigne, par défaut celle de la leçon ; `--json` affiche le rapport en JSON.

Il affiche le fichier, le titre, qui a approuvé et quand, les 12 premiers caractères de l'empreinte de la leçon, puis le texte à coller :

```text
Leçon : Capsule-grounded judgment (decay fit)
Validée par Votre Nom le 2026-11-27. Empreinte de la leçon : 4cc0d00ed822.

1. Installez VS Code, puis l'extension Studium (https://marketplace.visualstudio.com/items?itemName=holobiomicslab.studium-vscode).
2. Téléchargez capsule-judgment-demo.studium.zip depuis cette page de cours.
3. Dans VS Code, ouvrez la vue Studium, choisissez « Importer un fichier de leçon » et sélectionnez le fichier téléchargé.

Dans le volet Studium, la leçon se joue sur votre ordinateur et vos réponses y restent. Si vous y associez un assistant d'IA, le fournisseur de cet assistant reçoit ce que l'assistant lit.
```

## 2. Mettre le fichier et la consigne dans le cours

1. Ajoutez le fichier `.studium.zip` à la page du cours. Dans Moodle, ajoutez une ressource **Fichier** ; toute plateforme qui porte un fichier convient. Gardez le nom du fichier.
2. Collez la consigne, telle qu'imprimée, à côté.

Facultatif : ajoutez un lien qui ouvre VS Code sur la boîte d'import, en lien HTML dans une Étiquette ou une Page :

```html
<a href="vscode://holobiomicslab.studium-vscode/import">Importer la leçon dans VS Code</a>
```

Le lien ouvre la boîte de la commande **Studium : Importer une leçon…**. Il ne peut jamais nommer ni aller chercher un fichier : l'étudiant télécharge toujours le fichier depuis la page du cours et le sélectionne.

## 3. Ce que fait et voit l'étudiant

L'étudiant télécharge le fichier, puis lance **Studium : Importer une leçon…** (aussi proposée dans la vue **Leçons** vide, dans le sélecteur de cours, et par un clic droit sur un fichier `.studium.zip`). Studium vérifie le fichier, puis demande une confirmation qui montre :

- le titre de la leçon et son nombre d'étapes ;
- l'approbation que le fichier enregistre, en rappelant que c'est un enregistrement, pas une signature ;
- les 12 premiers caractères de l'empreinte de la leçon.

À la confirmation, la leçon est copiée dans la bibliothèque de l'étudiant et s'ouvre. Le fichier est lu sur l'ordinateur ; Studium ne fait aucun appel réseau pour cela.

## Sans VS Code

Un étudiant qui n'utilise pas VS Code a besoin de [Node.js](https://nodejs.org) 20 ou plus récent et d'un terminal. Une fois le fichier téléchargé depuis la page du cours, deux commandes :

```bash
npx -y studium-mcp import ~/Downloads/my-course.studium.zip
npx -y studium-mcp play
```

`import` vérifie le fichier, n'écrit encore rien, et montre les mêmes informations que la boîte de dialogue de VS Code : le titre de la leçon et son nombre d'étapes, l'approbation que le fichier enregistre (un enregistrement, pas une signature, ou qu'aucune n'est enregistrée, ou que la leçon a changé depuis son approbation), les 12 premiers caractères de l'empreinte de la leçon, le nombre de fichiers de l'archive qu'il ne copiera pas, et le dossier de la bibliothèque où il écrira. Il demande ensuite oui ou non. Sans terminal, il n'écrit rien à moins que vous n'ajoutiez `--yes`, et le dit. Une leçon différente sous le même identifiant n'est remplacée qu'avec `--replace` et une seconde confirmation, qui dit ce que remplacer fait. `play` ouvre la leçon dans le navigateur ([Jouer une leçon dans votre navigateur](../start/browser.fr.md#jouer-une-leçon-venue-dune-page-de-cours)). Les options sont dans [Outils en ligne de commande](../reference/cli.fr.md#studium-mcp-import).

## Si le téléchargement ne s'importe pas

- **Le navigateur a renommé le fichier** (`mon-cours.studium (1).zip`, après un second téléchargement) : il s'importe de la même façon. Studium propose l'import sur tout fichier `.zip` dont le nom contient `.studium`, et `studium-mcp import` prend le nom que vous lui donnez.
- **Il n'y a pas de fichier, seulement un dossier** : le navigateur a décompressé le zip. Safari le fait avec son réglage par défaut **Ouvrir automatiquement les fichiers fiables** (réglages Général). Décochez-le et téléchargez de nouveau, ou utilisez un autre navigateur. Studium importe un fichier, pas un dossier.

## Mettre à jour une leçon

Approuvez de nouveau, empaquetez de nouveau, et remplacez le fichier dans le cours. Quand un étudiant importe le nouveau fichier :

- la même leçon déjà présente dans la bibliothèque est ouverte ; si le fichier porte une approbation qui correspond à la leçon, son enregistrement d'approbation et ses figures sont mis à jour s'ils diffèrent, et sinon rien n'est écrit ;
- une leçon différente sous le même identifiant (`bundle_id`) n'est remplacée qu'après une seconde confirmation (dans un terminal, avec `--replace`). La progression est conservée, car elle est enregistrée sous l'identifiant de la leçon, de même que les contributions de la classe du dossier `community/` de la leçon.

## En salle

Là où une équipe informatique prépare les ordinateurs, mettez les leçons dans un dossier partagé et sautez l'import : voir [Postes de salle de TP](../start/classroom-workstations.fr.md). Pour ce qu'on demande à l'établissement, voir [Studium pour l'informatique et la protection des données](../start/for-it-and-data-protection.fr.md).

## Ce que vous ne verrez pas

Aucune vue de classe ne revient par cette voie. Un rapport de classe demande une télémétrie consentie, réunie en un même lieu : voir [Suivre une classe](follow-a-class.fr.md).

## Ce que contient le fichier

Le `lesson.json` entier, clés de réponse comprises. N'importe quel étudiant peut ouvrir le fichier et les lire : cette voie ne convient pas à un test noté.

## Ce qu'est et n'est pas `approval.json`

C'est un enregistrement de votre approbation, lié aux octets exacts de `lesson.json`. Ce n'est pas une signature : n'importe qui peut écrire un fichier qui prétend à une approbation. Ce qui dit aux étudiants d'où vient le fichier, c'est la page de votre cours. Il ne couvre que `lesson.json` : les figures de `assets/` ne font pas partie de l'empreinte.

## Ce que la plateforme enregistre

Moodle journalise qu'un étudiant a consulté la ressource. Studium ne lui envoie rien.

## Limites

- Essayé : des tests automatiques de l'empaqueteur, de l'importeur et de `studium-mcp import` ; `studium-mcp import` lancé dans un terminal sous macOS, avec un `STUDIUM_HOME` temporaire, sur un fichier fait par `pack`, jusqu'à ce que `studium-mcp play` liste la leçon ; un aller-retour scripté de `pack` à l'installation, avec une empreinte identique ; sur un Moodle 5.3.1 local jetable aux réglages par défaut, avec un zip fait à la main (pas produit par `pack`) : dépôt comme ressource Fichier par un enseignant éditeur, téléchargement par un étudiant avec des octets identiques, refus sans session, un lien `vscode://` conservé dans une Étiquette et une Page.
- Non essayé : une vraie fenêtre VS Code (la commande a été exercée par des pilotes avec un faux VS Code), un clic sur un lien `vscode://` dans un vrai navigateur, le Moodle d'une université ou une autre version de Moodle ou un site qui restreint les types de fichiers, un ENT ou Teams, `studium-mcp import` sous Windows ou Linux et sur un fichier téléchargé depuis un Moodle, Windows, une classe.
