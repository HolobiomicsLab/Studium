# Studium — Guide de test du cours d'atomistique L1

*Pour Élise Dumont — tester la démo du cours « L1 SV — atomistique » dans VS Code.*

## En bref

**Studium** transforme votre cours (chapitre 1) en une **leçon interactive et adaptative** :
l'étudiant·e progresse concept par concept, débloque la suite en démontrant sa maîtrise, et
manipule des objets scientifiques générés automatiquement :

- des **orbitales atomiques 3D** que l'on fait tourner (2p, 3d — lobes + / −) ;
- le **spectre d'émission** de l'hydrogène (série de Balmer) ;
- les **tendances périodiques** (énergie d'ionisation, rayon — période 2) ;
- des **molécules 3D** (CH₄ tétraédrique, H₂O coudée) ;
- un **graphe du parcours** qui s'allume en temps réel (verrouillé → disponible → en cours → maîtrisé).

Votre matériel (`cours-L1SV-atomistique.pdf`) ne sert qu'à *structurer* la leçon ; le texte brut
extrait reste **en local** (voir « Confidentialité » plus bas).

---

## 1. Pré-requis (une fois)

- **VS Code**, **Node 20+** et **pnpm** installés.
- Le dépôt **`prototype-build`** présent sur la machine. Dans tout ce guide, remplacez
  `CHEMIN` par son emplacement réel (ex. `~/git/prototype-build`).

```bash
cd CHEMIN/prototype-build
pnpm install                              # dépendances
pnpm --filter studium-vscode vendor       # bibliothèques hors-ligne (orbitales 3D, graphe, équations)
pnpm --filter studium-vscode build        # compile l'extension
```

> Si `pnpm` n'est pas installé : `npm install -g pnpm`.

---

## 2. Lancer l'extension

```bash
code CHEMIN/prototype-build/apps/studium-vscode
```

Dans VS Code, appuyez sur **F5** (ou menu *Run ▸ « Run Studium Extension »*).
Une **deuxième fenêtre** s'ouvre : c'est l'environnement de test de l'extension.

---

## 3. Pointer vers le cours d'atomistique (2 réglages)

Dans la **nouvelle fenêtre** : `Cmd+,` (réglages) → en haut à droite, icône *« Open User Settings
(JSON) »* → ajoutez ces deux lignes (adaptez le chemin) :

```jsonc
"studium.bundlesRoot": "CHEMIN/prototype-build/fixtures",
"studium.bundleRef": "atomistique-l1/lesson.json"
// déjà par défaut : studium.assets = "vendor", studium.showGraph = true, studium.graphView = "student"
```

---

## 4. Tester la leçon

`Cmd+Shift+P` → tapez **« Studium: Open Lesson »** → *Entrée*.

Deux panneaux s'ouvrent côte à côte :

```
┌───────────────────────────────┬──────────────────────────┐
│  Studium — Lesson             │  Studium — Graph         │
│  (la scène + ses artefacts    │  (le graphe du parcours, │
│   + boutons : Continuer,      │   les concepts s'allument│
│   choix de quiz, indice)      │   à chaque réponse)      │
└───────────────────────────────┴──────────────────────────┘
```

### Parcours (votre chapitre 1)

| # | Scène | Ce que l'étudiant·e voit | À vérifier (votre regard) |
|---|-------|--------------------------|---------------------------|
| 1 | Particules de l'atome | Z, A, isotopes ; A = Z + N | exactitude, niveau |
| 2 | **Quiz** : fer ⁵⁶Fe (Z=26) | neutrons = A − Z = 30 | énoncé + feedback |
| 3 | Nombres quantiques | n, ℓ, mℓ, ms et valeurs permises | formulation |
| 4 | **Quiz** : sous-couche 4f | 2ℓ+1 = 7 orbitales (→ 14 e⁻) | bon réflexe ? |
| 5 | **Forme des orbitales** ⭐ | **2p_z et 3d_z² en 3D — à faire tourner** (lobes bleu/rouge) | forme, plan nodal |
| 6 | **Quiz** : nœuds de la 2p | nœuds radiaux = n − ℓ − 1 = 0 | rigueur |
| 7 | Quantification & spectres | E = hν + **spectre de Balmer interactif** | raies, λ |
| 8 | **Quiz** : raie Hα | transition n=3 → n=2 (~656 nm) | exactitude |
| 9 | Règles de remplissage | Klechkowski (n+ℓ), Pauli, Hund | ordre 4s/3d |
| 10 | **Quiz** : carbone (Z=6) | 1s² 2s² 2p² | feedback |
| 11 | Périodicité | **courbes ionisation + rayon (période 2)** | tendances, irrégularités B/O |
| 12 | **Quiz** : sens des tendances | ionisation ↑, rayon ↓ | — |
| 13 | Géométrie (VSEPR) | **CH₄ et H₂O en 3D** (109,5° / 104,5°) | géométries |
| 14 | Auto-évaluation | confiance avant/après | — |
| 15 | Reproduction | placer Na, S, Ca dans le tableau | énoncés |

> **Le « palier de maîtrise »** : il faut répondre **correctement ~3 fois** à chaque quiz d'un
> concept avant que le concept suivant ne se débloque (mécanisme anti-triche, voulu). Vous verrez
> le **graphe de droite se mettre à jour** : le concept courant clignote, les prérequis passent
> « en cours » puis « maîtrisé », la suite reste « verrouillée » tant que le prérequis n'est pas acquis.

**Le moment clé** : à la scène **« Forme des orbitales atomiques »**, faites **glisser la souris**
sur l'orbitale pour la faire tourner — les deux isosurfaces (bleue = +, rouge = −) sont les deux
signes de la fonction d'onde. (Les orbitales sont des fonctions hydrogénoïdes analytiques, pas des
images figées.)

---

## 5. Tester le « notebook »

`Cmd+Shift+P` → **« Studium: Open Lesson as Notebook »**.

Exécutez la cellule (▶) pour démarrer. Pour avancer, **tapez dans la cellule puis ré-exécutez** :
- vide ou `next` → continuer ; `a`, `b`… → choix de quiz ; `0`–`4` → point de confiance.

Les spectres/graphiques s'affichent dans la sortie de la cellule ; le panneau *Studium — Lesson*
reste la surface complète (orbitales 3D rotatives, équations rendues).

---

## 6. Ce sur quoi votre retour est précieux

1. **Exactitude chimique** — énoncés, bonnes réponses, feedbacks, valeurs.
2. **Pédagogie** — ordre des concepts, prérequis, pertinence des quiz, niveau L1.
3. **Artefacts interactifs** — les orbitales / spectre / tendances / molécules sont-ils justes et utiles ?
4. **Ce qui manque** pour vos étudiant·e·s (notions, exemples, exercices du TD…).

---

## 7. Vérification rapide (sans l'interface)

Pour confirmer que tout fonctionne, sans VS Code :

```bash
cd CHEMIN/prototype-build
node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/drive_check.mjs
```

Cela parcourt la leçon jusqu'à la scène des orbitales et affiche l'état du graphe.

---

## 8. Dépannage

| Symptôme | Solution |
|----------|----------|
| « could not start lesson » / rien ne s'affiche | vérifier les **deux réglages** (chemin absolu de `bundlesRoot`) ; *Help ▸ Toggle Developer Tools* pour voir la console |
| Pas de panneau graphe | `studium.showGraph` = `true` ; essayez `studium.graphView: "teacher"` (graphe complet) |
| L'orbitale s'affiche en texte au lieu de la 3D | `studium.assets` = `"vendor"` (ou `"cdn"` si vous avez internet) ; relancez `pnpm --filter studium-vscode vendor` |
| Le concept suivant ne se débloque pas | normal : répondez correctement ~3× au quiz du prérequis (palier de maîtrise) |

---

## 9. Confidentialité

Le PDF du cours et le **texte brut extrait** restent **en local** (le texte est ignoré par git :
`_extract/*.text.txt`). Seules la **structure distillée** (`_extract/*.skeleton.json`) et les
**ressources générées** (orbitales analytiques, spectre, tendances, molécules) sont partagées.

---

## 10. Contenu actuel de la démo

**8 concepts** : particules de l'atome · nombres quantiques · forme des orbitales · quantification
& spectres · règles de remplissage · configuration électronique · périodicité · géométrie (VSEPR).
**16 scènes** (intro, concepts, quiz, auto-évaluation, reproduction). Les items « fer Z=26 » et
« 4f » reprennent vos TD1/TD2.

*Cette démo couvre le chapitre 1. Les chapitres suivants (liaison, Lewis, mésomérie, hybridation…)
sont la suite naturelle.*
