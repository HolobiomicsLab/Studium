[English](models.md) · Français

# Choisir son modèle

Studium ne contient aucun modèle et n'en choisit aucun. Cette page dit où un modèle intervient, ce qu'il
doit savoir faire, et comment travailler avec un abonnement Copilot, avec un modèle qui tourne sur votre
machine, ou sans aucun modèle supplémentaire.

## Avant de commencer

- Reliez d'abord un assistant : [Connecter votre assistant](harnesses.fr.md). MCP est le protocole par
  lequel un assistant appelle les outils de Studium.
- Un *juge* est un modèle qui évalue une réponse rédigée ; voir
  [Honnêteté et provenance](../concepts/honesty-and-provenance.fr.md#le-juge).

## Où un modèle intervient

| Modèle | Ce qu'il fait | Où vous le choisissez | Nécessaire |
|---|---|---|---|
| Le modèle de votre assistant | construit une leçon à partir de vos sources, affiche chaque étape, transmet vos réponses | dans l'assistant (Copilot, Claude Code, Codex, OpenCode, Cursor) | oui |
| Un modèle juge | évalue certaines réponses rédigées et mène les étapes de discussion | sur le serveur Studium, avec `LITELLM_BASE_URL` | non |

Les deux sont indépendants. Un abonnement Copilot donne ses modèles à votre assistant ; il ne donne pas de
point d'accès à Studium et ne peut donc pas servir de juge.

## Le modèle de votre assistant

Studium ne lui demande qu'une chose : savoir appeler des outils, car chaque étape d'une leçon est un appel
d'outil.

### Avec un abonnement Copilot

1. Ajoutez le serveur à Copilot dans VS Code :

   ```bash
   code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'
   ```

2. Ouvrez Copilot Chat en mode agent et choisissez un modèle dans le sélecteur. Les modèles proposés
   dépendent de votre abonnement (Pro, ou Copilot pour les étudiants et les enseignants par GitHub
   Education) : voir [Connecter Copilot](copilot.fr.md).
3. Demandez : « je veux apprendre … avec Studium », en indiquant vos sources.

### Avec un modèle qui tourne sur votre machine

| Assistant | Comment |
|---|---|
| Chat de VS Code | lancez **Chat: Manage Language Models**, puis **Add Models** : l'extension Ollama pour un modèle servi par Ollama, ou **Custom Endpoint** pour tout serveur compatible. VS Code ne propose un modèle en mode agent que s'il sait appeler des outils. Référence : [AI language models in VS Code](https://code.visualstudio.com/docs/agent-customization/language-models) |
| OpenCode | configurez un fournisseur local, puis ajoutez le serveur Studium : [Connecter OpenCode](opencode.fr.md) |

Construire une leçon est la partie exigeante : chaque citation doit reproduire son passage source au
caractère près, et Studium refuse un brouillon qui ne le fait pas. Jouer une leçon demande moins :
l'assistant affiche le texte que Studium renvoie et transmet vos mots. Les leçons et la progression sont
dans `~/.studium`, quel que soit l'assistant : une leçon construite avec un assistant peut être jouée avec
un autre sur la même machine.

## Le modèle juge

Sans juge, rien n'est perdu : sur une réponse rédigée, Studium montre la référence, vous comparez et vous
évaluez votre rappel, et le verdict dit que personne ne l'a évaluée. Avec un juge, certaines réponses
rédigées sont évaluées par le modèle, et le verdict le dit.

Réglez le juge dans la configuration du serveur Studium de votre assistant, à la place de
`LITELLM_BASE_URL=` :

| Variable | Valeur |
|---|---|
| `LITELLM_BASE_URL` | l'adresse d'un serveur compatible OpenAI, sans `/v1` : Studium envoie ses requêtes à `<adresse>/v1/chat/completions` |
| `LITELLM_API_KEY` | la clé, quand le serveur en demande une |
| `LITELLM_MODEL` | le nom de modèle envoyé pour l'évaluation des critiques ; `studium/audit-judge` par défaut |

Le serveur doit aussi répondre au nom de modèle `studium/runtime-tutor`, que Studium envoie pour les
étapes de discussion et qui ne se change pas. Les autres réglages sont dans
[Configuration](../reference/configuration.fr.md#modèle-juge-facultatif).

Un `LITELLM_BASE_URL` non vide peut être une route payante : vérifiez ce que facture le point d'accès
avant de le renseigner.

### Un juge sur votre machine

Un proxy [LiteLLM](https://docs.litellm.ai/) peut donner ces deux noms à un modèle local. Un exemple à adapter, pour un
modèle servi par Ollama :

```yaml
model_list:
  - model_name: studium/audit-judge
    litellm_params:
      model: ollama/<model>
      api_base: http://localhost:11434
  - model_name: studium/runtime-tutor
    litellm_params:
      model: ollama/<model>
      api_base: http://localhost:11434
```

Lancez le proxy avec ce fichier, puis donnez son adresse à Studium, par exemple
`LITELLM_BASE_URL=http://localhost:4000`.

## Ce que vous obtenez

- `get_server_info` indique `model_backend` : `none`, ou `configured` quand `LITELLM_BASE_URL` est
  renseigné. Demandez à votre assistant de l'appeler.
- Chaque verdict dit qui a évalué la réponse (`assessed_by`) : la clé de l'auteur (`key`), un juge
  (`judge`) ou personne (`none`). L'avis du premier écran d'une leçon écrite par un assistant dit si un
  juge évalue les réponses rédigées.
- Si le juge ne répond pas, ou répond par une erreur, la leçon continue et la réponse est enregistrée
  comme non évaluée.

## Limites

- Aucun modèle tournant sur une machine n'a été essayé avec Studium, ni comme modèle de l'assistant ni
  comme juge. Ce qui a été vérifié, c'est ce que Studium envoie : une requête à
  `<adresse>/v1/chat/completions` avec le nom de modèle, la clé et un format de réponse JSON, et ce qu'il
  fait quand cette requête échoue.
- Le fichier LiteLLM ci-dessus n'a pas été exécuté avec Studium.
- Avec `STUDIUM_EPHEMERAL=1` et un juge, renseignez aussi `STUDIUM_PSEUDO_SECRET` : le serveur refuse
  d'ouvrir une session sans lui. Avec le stockage durable par défaut, rien de plus n'est nécessaire.
- Une réponse HTTP 200 d'un point d'accès ne prouve pas qu'un modèle a répondu.
- Les abonnements, les modèles et les limites d'un assistant sont fixés par son fournisseur et changent
  avec le temps.
