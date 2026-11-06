[English](README.md) · Français

# Skills

Les skills sont de courts fichiers d'instructions qui apprennent à un assistant d'IA (Claude Code,
Codex, Copilot, Cursor, OpenCode) à utiliser Studium pour une tâche précise : accompagner un étudiant,
préparer un cours, faire jouer une leçon, construire une leçon d'auto-apprentissage à partir de vos
propres sources. Chaque skill est un dossier contenant un `SKILL.md` ; son en-tête (`name`,
`description`) indique à l'assistant quand le charger.

| | |
|---|---|
| Statut | **pris en charge** (fait partie de la surface harnais, décision D6) |
| Lancer | rien à lancer : l'assistant charge un skill quand votre demande correspond à sa description |
| Appelle | le serveur MCP de Studium ([`apps/lesson-mcp`](../apps/lesson-mcp/README.fr.md)) et les outils du dépôt |
| Tests | aucun en propre ; les parcours qu'ils décrivent sont couverts par les tests du serveur et des outils |

## Les skills

| Skill | Pour qui | Pour quoi faire |
|---|---|---|
| [`studium-student`](studium-student/SKILL.md) | étudiants | installer ou connecter Studium, activer une offre Copilot Student éligible ou un autre assistant, et commencer une première leçon avec vos propres réponses |
| [`studium-self-learner`](studium-self-learner/SKILL.md) | apprenants sans enseignant | transformer une page web, un PDF ou un texte que vous avez choisi en leçon d'auto-apprentissage jouable, puis la jouer |
| [`studium-from-conversation`](studium-from-conversation/SKILL.md) | toute personne qui travaille avec un assistant | transformer la conversation en cours, ou une séance passée, en courte leçon pour vérifier et approfondir ce que vous en avez compris |
| [`studium-concept-map`](studium-concept-map/SKILL.md) | apprenants et enseignants | montrer où en est l'apprenant sur chaque notion, exporter la carte en page qui dit sur quoi repose chaque notion, et y poser les chiffres d'une classe |
| [`studium-suggest`](studium-suggest/SKILL.md) | tout assistant | repérer le moment où une fonction de Studium servirait la personne et la proposer une fois, au bon moment |
| [`studium-teacher`](studium-teacher/SKILL.md) | enseignants | installer Studium, connecter un assistant, préparer un brouillon de leçon appuyé sur la littérature ou une capsule et le relire dans MySTRA avant un pilote |
| [`studium-harness`](studium-harness/SKILL.md) | tout assistant qui fait jouer une leçon | présenter les scènes publiques, recueillir les réponses de l'apprenant lui-même, exécuter les capsules honnêtement, par MCP, HTTP ou le canal fichier |
| [`studium-activity-templates`](studium-activity-templates/SKILL.md) | enseignants et apprenants | choisir et adapter une activité interactive (représentations liées, comparaison de paramètres, diagnostic d'analyse, robustesse, preuve et affirmation) |
| [`studium-visual-support`](studium-visual-support/SKILL.md) | apprenants | examiner des photographies sources ou demander une image adaptée, une carte Mermaid, une explication audio ou une courte vidéo |
| [`studium-learner-report`](studium-learner-report/SKILL.md) | apprenants et enseignants | exporter ou examiner une trace d'activité choisie par l'apprenant ou un journal d'expérience sous forme de rapport ASTRA/MySTRA |
| [`studium-observatory`](studium-observatory/SKILL.md) | opérateurs et relecteurs | lancer et lire l'[Observatory](../services/observatory/README.fr.md) |

Les skills de rôle (`studium-student`, `studium-teacher`, `studium-self-learner`,
`studium-from-conversation`) renvoient à
`studium-harness` pour la boucle de leçon elle-même. `studium-suggest` choisit quoi proposer et à quel
moment, puis passe la main au skill qui sait faire.

## Comment les assistants les trouvent

Ce dossier est l'unique source. Les assistants découvrent les skills par des liens symboliques dans deux
dossiers conventionnels à la racine du dépôt :

| Dossier | Lu par |
|---|---|
| `.claude/skills/<nom>` | Claude Code |
| `.agents/skills/<nom>` | Codex et les autres assistants qui suivent la convention `.agents/skills` |

Chaque lien pointe vers ce dossier (`../../skills/<nom>`) : une modification de `skills/<nom>/SKILL.md`
atteint tous les assistants. Le fichier facultatif `agents/openai.yaml` d'un skill donne à Codex un nom
d'affichage, une courte description et un prompt par défaut.

Pour ajouter un skill, créez `skills/<nom>/SKILL.md` avec les champs `name` et `description` en en-tête,
puis liez-le depuis les deux dossiers :

```bash
ln -s ../../skills/<nom> .claude/skills/<nom>
ln -s ../../skills/<nom> .agents/skills/<nom>
```

Un skill sans ces liens n'est pas découvert. Vérifiez lesquels sont liés avec
`ls -l .claude/skills .agents/skills`.

## Voir aussi

- [Des skills pour votre assistant](../docs/start/skills.fr.md)
- [Connecter un assistant](../docs/start/harnesses.fr.md)
