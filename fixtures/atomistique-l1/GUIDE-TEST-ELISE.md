# Studium — Guide de test du cours d'atomistique L1

*Pour Élise Dumont — tester la démo « L1 SV — atomistique » dans VS Code, côté **étudiant** ET côté **enseignant**, depuis zéro.*

## En bref

**Studium** transforme votre cours (chapitre 1) en une **leçon interactive et adaptative** :
l'étudiant·e progresse concept par concept, débloque la suite en démontrant sa maîtrise, et
manipule des objets scientifiques générés automatiquement :

- des **orbitales atomiques 3D** que l'on fait tourner (2p, 3d — lobes + / −) ;
- le **spectre d'émission** de l'hydrogène (série de Balmer) ;
- les **tendances périodiques** (énergie d'ionisation, rayon — période 2) ;
- des **molécules 3D** (CH₄ tétraédrique, H₂O coudée) ;
- un **graphe du parcours** qui s'allume en temps réel.

Deux « runtimes » à tester :
- **Runtime étudiant** (Partie 2) — l'expérience d'apprentissage.
- **Runtime enseignant** (Partie 3) — observer le modèle apprenant en direct **+** un *rapport de
  classe anonyme* (quels concepts re-travailler, où ça coince), sans jamais voir une note individuelle.

Votre matériel (`cours-L1SV-atomistique.pdf`) ne sert qu'à *structurer* la leçon ; le texte brut
extrait reste **en local** (voir « Confidentialité »).

---

# Partie 0 — Pré-requis et dépendances

## Ce qu'il faut sur la machine
- **macOS**, **VS Code**, **Node 20+**, **pnpm**, **Python 3**.
- Le dépôt **`prototype-build`** (un seul dépôt suffit — voir « Dépendances »). Récupérez-le (une
  fois l'accès collaborateur accordé) dans le Terminal :

  ```bash
  git clone https://github.com/HolobiomicsLab/studium.git prototype-build
  ```

  *(le mot `prototype-build` à la fin nomme le dossier, pour que les chemins de ce guide collent.)*
- Remplacez partout `CHEMIN` par l'endroit où vous l'avez cloné. *(Sur Mac, `~` = votre dossier
  personnel : `~/git/prototype-build` = `/Users/VotreNom/git/prototype-build`.)*

## Dépendances : la démo est autonome
**Pour tester le cours d'atomistique, il suffit de `prototype-build`** — rien d'autre à cloner. Le
serveur de leçon tourne **en local**, lancé automatiquement par l'extension ; **aucun service
externe**. En particulier, **Perspicacité** et **indicium** ne sont **pas nécessaires** :
- *indicium* (claims typés) est **embarqué** dans le code (schéma vendorisé) — rien à installer ;
- *Perspicacité* (ancrage bibliographique) est une brique d'**auteur** (créer un cours), pas de
  **lecture** — la leçon est déjà rédigée et autonome.

> Pour *créer un nouveau cours* avec ancrage + LLM, il faudrait lancer Perspicacité (service Python,
> API `:8000`) + une clé LLM. **Hors périmètre de ce test.**

## Préparer (une fois) — dans le Terminal
Ouvrez l'app **Terminal** (`Cmd+Espace`, tapez « Terminal », `Entrée`).

**1) Vérifiez les outils** — tapez ces 3 lignes (une à la fois, `Entrée` après chacune) :

```bash
node --version       # doit afficher v20 ou plus
pnpm --version       # doit afficher 9 ou plus
python3 --version    # doit afficher 3.x
```

Si l'une répond « command not found » : `pnpm` → `npm install -g pnpm` ; `node` → installez Node 20+
depuis nodejs.org ; `python3` → depuis python.org (ou `brew install python3`).

**2) Installez et compilez** — tapez ces lignes une par une ; après chaque `Entrée`, **attendez que
la commande finisse** (le `$` réapparaît) avant la suivante :

```bash
cd CHEMIN/prototype-build
pnpm install
pnpm --filter studium-vscode vendor
pnpm --filter studium-vscode build
```

*(`--filter studium-vscode` = « ne traite que ce sous-projet » ; copiez la commande telle quelle.)*

---

# Partie 1 — Ouvrir VS Code et lancer l'extension (pas à pas)

> Pas besoin de la commande `code` : on passe par l'**application** VS Code.

1. **Ouvrir VS Code** : `Cmd+Espace`, « Visual Studio Code », `Entrée`.
   *(Pas installé ? code.visualstudio.com → glissez-le dans Applications.)*
2. **Ouvrir le dossier** : menu **File ▸ Open Folder…**. Dans la fenêtre qui s'ouvre, faites
   **`Cmd+Shift+G`** pour **taper un chemin**, collez `CHEMIN/prototype-build/apps/studium-vscode`,
   `Entrée`, puis bouton **Open**. *(Le bon dossier contient un fichier `package.json` et un dossier
   `.vscode`.)*
3. **(1ʳᵉ fois)** S'il demande la confiance dans le dossier → **« Yes, I trust the authors »**.
4. **Lancer l'extension** — au choix :
   - **Clavier** : touche **F5**. *(Sur Mac, si F5 règle le son/la luminosité, faites **fn + F5**.)*
   - **Souris** (sans surprise) : dans la **barre d'icônes verticale à gauche**, cliquez l'icône
     **Run and Debug** (un **▷** avec un petit insecte) ; un panneau s'ouvre, choisissez en haut
     **« Run Studium Extension »** dans la liste, puis cliquez le **▷ vert**.
5. Une **2ᵉ fenêtre** s'ouvre, titre **`[Extension Development Host]`** : **c'est là qu'on teste**.
   ⚠️ **Ne fermez pas la 1ʳᵉ fenêtre** (c'est le « moteur » ; gardez les deux ouvertes).
6. **Lancer la leçon** : dans la **2ᵉ fenêtre**, ouvrez la *palette de commandes* (un champ où
   chercher les commandes) — **`Cmd+Shift+P`** (ou **View ▸ Command Palette…**) — tapez
   **`Studium: Open Lesson`**, `Entrée`. Les deux panneaux s'ouvrent.
7. **Arrêter** : dans la **1ʳᵉ fenêtre**, menu **Run ▸ Stop Debugging** (ou `Shift+F5`). **Relancer** :
   F5. **Recharger après un changement de réglage** : dans la **2ᵉ fenêtre**, `Cmd+R` (ou palette de
   commandes → **« Developer: Reload Window »**).

> **Aucun réglage requis pour démarrer** : la démo pointe par défaut sur le cours d'atomistique.

## Où sont les réglages (pour la Partie 3) ?
Dans la fenêtre `[Extension Development Host]`, appuyez sur **`Cmd+,`** (ou menu **Code ▸ Settings**).
La page « Settings » s'ouvre ; dans la **barre de recherche en haut**, tapez **`studium`**. Les
réglages apparaissent (cases, listes, champs), nommés « **Studium: …** ». Pour les éditer en texte :
icône **`{}`** en haut à droite (« Open Settings (JSON) »).

---

# Partie 2 — Runtime ÉTUDIANT

`Cmd+Shift+P` → **« Studium: Open Lesson »** → *Entrée*.

Deux panneaux s'ouvrent côte à côte :

```
┌───────────────────────────────┬──────────────────────────┐
│  Studium — Lesson             │  Studium — Graph         │
│  (la scène + ses artefacts    │  (le parcours ; un       │
│   + boutons : Continuer,      │   concept passe « acquis »│
│   choix de quiz, indice)      │   après ~3 bonnes rép.)  │
└───────────────────────────────┴──────────────────────────┘
```

### Parcours (votre chapitre 1)

| # | Scène | Ce que l'étudiant·e voit | À vérifier (votre œil) |
|---|-------|--------------------------|------------------------|
| 1 | Particules de l'atome | Z, A, isotopes ; A = Z + N | exactitude, niveau |
| 2 | **Quiz** : fer ⁵⁶Fe (Z=26) | neutrons = A − Z = 30 | énoncé + feedback |
| 3 | Nombres quantiques | n, ℓ, mℓ, ms et valeurs permises | formulation |
| 4 | **Quiz** : sous-couche 4f | 2ℓ+1 = 7 orbitales (→ 14 e⁻) | bon réflexe ? |
| 5 | **Forme des orbitales** ⭐ | **2p_z et 3d_z² en 3D — à faire tourner** | forme, plan nodal |
| 6 | **Quiz** : nœuds de la 2p | nœuds radiaux = n − ℓ − 1 = 0 | rigueur |
| 7 | **Explique** 🆕 *(teach-back)* | « Pourquoi la 2p a-t-elle deux lobes ? » → l'étudiant·e rédige | pertinence des attendus |
| 8 | Quantification & spectres | E = hν + **spectre de Balmer interactif** | raies, λ |
| 9 | **Quiz** : raie Hα | transition n=3 → n=2 (~656 nm) | exactitude |
| 10 | Règles de remplissage | Klechkowski (n+ℓ), Pauli, Hund | ordre 4s/3d |
| 11 | **Quiz** : carbone (Z=6) | 1s² 2s² 2p² | feedback |
| 12 | **Repère l'erreur** 🆕 *(cours biaisé)* | un cours **volontairement faux** sur l'azote à corriger | erreurs plantées + correction |
| 13 | Périodicité | **courbes ionisation + rayon (période 2)** | tendances, B/O |
| 14 | **Quiz** : sens des tendances | ionisation ↑, rayon ↓ | — |
| 15 | Géométrie (VSEPR) | **CH₄ et H₂O en 3D** (109,5° / 104,5°) | géométries |
| 16 | Auto-évaluation | confiance avant/après | — |
| 17 | Reproduction | placer Na, S, Ca dans le tableau | énoncés |

> **Nouveau — deux scènes « apprentissage actif »** (🆕 lignes 7 et 12), inspirées du board de
> co-conception : **« Explique »** (l'étudiant·e *devient prof* et reformule une notion ; on évalue la
> transmission, pas la restitution) et **« Repère l'erreur »** (un *cours biaisé* à débusquer, puis la
> version corrigée — « relever les biais et proposer un cours amélioré »). On y **écrit du texte** (zone
> de saisie + bouton, ou la cellule en mode notebook). La correction/le corrigé n'apparaissent **jamais
> avant** la réponse, et la note est calculée **hors-ligne** (couverture des points-clés / erreurs
> trouvées), donc **aucune clé API n'est requise**.

> **Le « palier de maîtrise »** : il faut répondre **correctement ~3 fois** au quiz d'un concept
> avant que le suivant ne se débloque (mécanisme anti-triche, voulu). Regardez le **graphe de droite**
> se mettre à jour : le concept courant est mis en avant, les prérequis passent « en cours » puis
> « acquis », la suite reste « verrouillée » tant que le prérequis n'est pas atteint.

**Le moment clé** : scène **« Forme des orbitales atomiques »** → **glissez la souris** sur
l'orbitale pour la faire tourner (bleu = +, rouge = −, les deux signes de la fonction d'onde —
orbitales hydrogénoïdes analytiques, pas des images figées).

> La **maîtrise chiffrée n'est volontairement pas montrée à l'étudiant·e** : sinon, en essayant les
> options et en regardant le chiffre monter, on devine la bonne réponse. Voir Partie 3 pour la
> rendre visible côté enseignant.

### Variante « notebook »
`Cmd+Shift+P` → **« Studium: Open Lesson as Notebook »**. Exécutez la cellule (▶) ; pour avancer,
tapez dans la cellule puis ré-exécutez (`a`/`b`… pour un quiz, vide pour continuer, `0`–`4` pour la
confiance, **du texte libre pour « Explique » / « Repère l'erreur »**). Les graphiques s'affichent dans
la sortie ; le panneau *Lesson* reste la surface complète (orbitales 3D, équations).

---

# Partie 3 — Runtime ENSEIGNANT

Deux niveaux : **(3A)** observer le modèle en direct dans VS Code ; **(3B)** un rapport de classe
agrégé et anonyme.

## 3A — Observer le modèle apprenant en direct

Dans la fenêtre `[Extension Development Host]`, ouvrez les réglages (`Cmd+,`, tapez `studium`) et
mettez :

| Réglage | Valeur | Effet |
|---|---|---|
| `studium.graphView` | `teacher` | le graphe montre **tout** le cours (8 concepts + prérequis), pas seulement l'entourage de l'étudiant |
| `studium.showMastery` | ✅ (coché) | affiche la **maîtrise chiffrée** par concept dans le panneau leçon |

Relancez **« Studium: Open Lesson »**. En jouant l'étudiant·e, vous voyez :
- la **structure complète** du cours et les **prérequis** (ce que le runtime « propose ») ;
- la **maîtrise** monter/descendre à chaque réponse (modèle Beta : crédit *escompté* par les
  erreurs et les indices — tâtonner ne donne pas une vraie maîtrise) ;
- quels concepts se débloquent, et quand.

> C'est la réponse à « voir le graphe en direct pour comprendre ce qui est proposé », côté prof.
> Repassez `showMastery` à off et `graphView` à `student` pour retrouver la vue élève.

## 3B — Rapport de classe (agrégé, anonyme — RGPD)

Studium peut produire un **rapport de classe** : quels concepts re-travailler, où l'on s'appuie trop
sur les indices, la calibration (sur/sous-confiance), l'autonomie, la complétion — **sans jamais
nommer un·e étudiant·e** (la maîtrise individuelle reste sur l'appareil de l'élève ; un **seuil de
k-anonymat** refuse tout chiffre qui ré-identifierait quelqu'un).

**Le plus rapide (5 « élèves » simulés)** — pour voir le rapport sans tout refaire à la main :

```bash
cd CHEMIN/prototype-build
node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/teacher_check.mjs
python3 tools/class_report.py fixtures/data --min-learners 1 --bundle fixtures/atomistique-l1/lesson.json
```

Vous obtenez un tableau par concept (précision, recours aux indices, écart de calibration, temps
moyen), les priorités de re-travail, la complétion, l'autonomie, et les adaptations déclenchées.

**En vrai depuis VS Code** :
1. Réglage `studium.telemetryConsent` → ✅ (la télémétrie *pseudonymisée* est écrite sous
   `CHEMIN/prototype-build/fixtures/data/`).
2. Faites la leçon **jusqu'au bout** (la télémétrie est envoyée en fin de leçon). Pour simuler
   plusieurs élèves, changez `studium.learnerId` entre deux parcours.
3. Agrégez :
   ```bash
   python3 tools/class_report.py CHEMIN/prototype-build/fixtures/data --min-learners 1 \
     --bundle CHEMIN/prototype-build/fixtures/atomistique-l1/lesson.json
   ```
   `--min-learners 1` pour un test solo ; en classe réelle, gardez le défaut **5** (plancher
   d'anonymat). Ajoutez `--out CHEMIN/rapport` pour écrire `class_report.md` + `.json`.

> Il existe aussi un **tableau de bord enseignant** plus riche (`apps/teacher-dashboard`, appli web ;
> `pnpm --filter @studium/teacher-dashboard dev`) — optionnel, plus lourd à lancer.

---

# Partie 4 — Ce sur quoi votre retour est précieux

**Côté étudiant (contenu)** — exactitude chimique (énoncés, bonnes réponses, feedbacks, valeurs) ;
pédagogie (ordre des concepts, prérequis, pertinence des quiz, niveau L1) ; justesse et utilité des
artefacts (orbitales / spectre / tendances / molécules) ; ce qui manque pour vos étudiant·e·s.

**Côté enseignant** — le graphe « teacher » reflète-t-il votre logique de prérequis ? Le rapport de
classe pointe-t-il les bons concepts à re-travailler ? Les signaux (indices, calibration) vous
seraient-ils utiles ?

---

# Vérifications rapides (sans interface)

```bash
cd CHEMIN/prototype-build
# parcours étudiant (jusqu'à l'orbitale) + état du graphe
node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/drive_check.mjs
# chaîne enseignant : sessions simulées -> télémétrie -> rapport de classe
node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/teacher_check.mjs
python3 tools/class_report.py fixtures/data --min-learners 1 --bundle fixtures/atomistique-l1/lesson.json
```

---

# Dépannage

| Symptôme | Solution |
|----------|----------|
| `code` : command not found | ouvrez le dossier via VS Code (*File ▸ Open Folder*), ou installez la commande : `Cmd+Shift+P` → « Shell Command: Install 'code' command in PATH » |
| « could not start lesson » / rien | *Help ▸ Toggle Developer Tools* dans la fenêtre de test pour voir l'erreur |
| L'orbitale s'affiche en texte | `studium.assets` = `"vendor"` (ou `"cdn"` avec internet) ; relancez `pnpm --filter studium-vscode vendor` |
| Pas de panneau graphe | `studium.showGraph` = `true` |
| Le concept suivant ne se débloque pas | normal : ~3 bonnes réponses au quiz du prérequis |
| Le rapport dit « suppressed / k-anonymity » | trop peu d'« élèves » : `--min-learners 1` en test, ou simulez-en plusieurs (`teacher_check.mjs` ou plusieurs `learnerId`) |

---

# Confidentialité

Le PDF du cours et le **texte brut extrait** restent **en local** (ignorés par git :
`_extract/*.text.txt`). Le **rapport de classe est agrégé** : jamais de ligne par élève, jamais de
pseudonyme, pas de texte libre (les indices/journaux/discussions ne quittent pas l'appareil), et un
**plancher de k-anonymat** bloque les nombres ré-identifiables. La maîtrise individuelle ne quitte
pas l'appareil de l'élève.

---

# Contenu actuel de la démo

**8 concepts** : particules de l'atome · nombres quantiques · forme des orbitales · quantification &
spectres · règles de remplissage · configuration électronique · périodicité · géométrie (VSEPR).
**18 scènes** (intro, concepts, quiz, **« Explique » (teach-back)**, **« Repère l'erreur » (cours
biaisé)**, auto-évaluation, reproduction). Les items « fer Z=26 » et « 4f » reprennent vos TD1/TD2.

*Cette démo couvre le chapitre 1. La suite naturelle : liaison, Lewis, mésomérie, hybridation…*
