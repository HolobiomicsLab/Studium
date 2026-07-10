# Guide étudiant — Studium démo M6

> **Note — 2026-07-10.** Ce guide décrit les surfaces de l'époque M6. Le parcours
> testeur actuel est décrit dans [`TESTING.md`](../../TESTING.md) à la racine du
> dépôt (extension VS Code, sans clé API). Les fonctionnalités ajoutées depuis
> (boucle opération→jugement, calibration de confiance `trust_calibration`,
> protocole d'exécution côté apprenant `get_run_manifest` / `submit_run_result`,
> répétition espacée au niveau du cours) ne sont pas couvertes ici. Voir aussi
> [`apps/studium-vscode/README.md`](../../apps/studium-vscode/README.md).

> Studium est une application d'apprentissage avec évaluation continue.
> Cette version démo couvre la chimie atomistique L1 Sciences de la Vie.

## 1. Premier lancement — Consentement (RGPD)

Au premier démarrage, Studium te demande 3 consentements distincts :

- **A — Données pédagogiques anonymisées** : *obligatoire*. Ce que tu fais
  dans l'app (scènes jouées, réponses, temps) est stocké chiffré sur **ton
  appareil uniquement** pour l'adaptation.
- **B — Journal métacognitif** : *optionnel*. Stocke tes réflexions libres
  rédigées dans le journal.
- **C — Partage agrégat enseignant** : *optionnel*. Envoie au tableau de
  bord enseignant des **statistiques anonymisées** (jamais ton texte brut).

Tu peux modifier ces choix à tout moment dans **Settings**.

## 2. Library — choisir une leçon

> Les sections ci-dessous décrivent l'application de bureau `student-runtime`
> (Tauri), qui requiert une chaîne d'outils Rust et n'a pas de commande de
> lancement documentée — ce n'est pas le parcours testeur. Pour jouer la leçon
> sans clé ni Rust, utilise l'extension VS Code (voir [`TESTING.md`](../../TESTING.md)).

Une fois consenti, la Library s'ouvre. Elle liste les bundles disponibles
sur ton appareil. Pour la démo, charge `demo-atomistique-bundle.zip`.

Clique sur un bundle pour démarrer.

## 3. Les 13 types de scènes

Studium combine 13 types de scènes pédagogiques (schéma `lesson-bundle-schema`) :

| Type | Ce que tu y fais |
|---|---|
| `intro` | Lecture courte — contexte de la leçon. |
| `concept` | Exposé textuel d'un concept-clé. Possible : image, schéma. |
| `quiz` | Question à choix multiple, feedback immédiat. |
| `meta_checkpoint` | Pause métacognitive : tu estimes ta confiance (0–4). |
| `reproduction` | Reproduction guidée d'une tâche ; tu vois le résultat d'exécution de référence (et, si l'hôte le fournit, tu exécutes toi-même la capsule). |
| `ai_critique` | Évaluation critique d'une réponse IA — détecte l'erreur. |
| `discussion` | Dialogue socratique multi-tours — argumentation. |
| `spot_the_flaw` | Un mini-cours volontairement erroné : nomme les erreurs plantées. |
| `explain_back` | Ré-explique l'idée avec tes propres mots (Feynman). |
| `comparison` | Compare deux productions (A vs B) et nomme les différences. |
| `summary_audit` | Audite un résumé IA : repère omissions et distorsions. |
| `prompt_practice` | Rédige ou affine un prompt pour la tâche donnée. |
| `communication_sim` | Rédige un message professionnel adapté à une situation. |

## 4. Calibration et adaptation

Studium s'adapte à ton niveau **en continu**, sans examen terminal.

### Comment ça se manifeste ?

- 2 erreurs de suite sur un quiz → tu rejoues la scène concept précédente.
- Maîtrise haute observée → tu skips les concepts pré-requis aux leçons
  suivantes.
- Le panel **Calibration** te montre comment tu estimes ton niveau vs ton
  niveau réel. Plus l'écart est faible, mieux tu te connais (méta-conscience).

### Beta model

Chaque concept-clé a un score Beta(α, β) qui évolue à chaque réponse :
- Bonne réponse → α augmente.
- Mauvaise réponse → β augmente.

Au démarrage d'une nouvelle session, Studium recharge ton état Beta et adapte
en conséquence.

## 5. Bouton "?" — explicabilité

À tout moment tu peux cliquer le bouton **"?"** près d'une scène pour voir
quelle règle d'adaptation est active (par exemple `rule_2err_replay_concept`)
et **pourquoi** elle a été déclenchée.

C'est volontaire : Studium veut que tu comprennes ce qui se passe sous le
capot, pas une boîte noire.

## 6. Settings — RGPD et droit à l'oubli

- **Modifier mes consentements** : change A/B/C à tout moment.
- **Droit à l'oubli** : efface définitivement toutes tes données locales
  (Beta model, journal, télémétrie en attente). **Action irréversible**.
- **Pseudonyme** : Studium utilise un identifiant local pseudonyme pour
  les agrégats classe (jamais ton nom réel).

## 7. FAQ

**Q. Studium envoie-t-il mes données sur Internet ?**
A. Non, sauf si tu actives le consentement C. Et même alors, **seules les
statistiques anonymisées** sont envoyées au dashboard de ton enseignant —
jamais le contenu brut de tes réponses.

**Q. Puis-je revoir une scène ?**
A. Oui, via le menu de navigation latéral. Mais l'adaptation peut
re-déclencher des scènes que tu pensais finies.

**Q. L'IA dans `ai_critique` peut dire des choses fausses ?**
A. **Oui, c'est l'objectif.** La scène `ai_critique` te présente
volontairement des réponses IA partiellement ou totalement fausses. Ton
travail = identifier l'erreur. C'est de la **littératie IA** : apprendre à
ne pas croire l'IA sur parole.

**Q. Où sont stockées mes données ?**
A. Dans une base **SQLCipher chiffrée** sur ton appareil. La clé est dérivée
de ton pseudonyme. Si tu supprimes l'app, tout est perdu (pas de cloud).

## 8. Problèmes courants

| Symptôme | Solution |
|---|---|
| L'app ne démarre pas | Vérifie que ton OS est macOS ≥ 12 ou Linux récent |
| Une scène reste bloquée | Bouton "Suivant" grisé ? Réponds d'abord à la question/champ |
| Le journal ne sauvegarde pas | As-tu consenti B dans Settings ? |
| Calibration ne s'affiche pas | Joue ≥ 3 scènes pour avoir assez de signal |
