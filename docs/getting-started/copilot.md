# Copilot pour les étudiants et les enseignants

Le parcours recommandé pour un étudiant est **VS Code + Copilot Student + MCP
Studium**, avec les outils locaux du cours. Le compte du harnais et le serveur
pédagogique sont deux éléments distincts : aucun abonnement API backend Studium
n'est requis pour la première séance.

## Activer son accès

1. Utiliser son compte GitHub personnel et demander la vérification étudiante
   dans GitHub Education. GitHub demande notamment une inscription en cours dans
   un cursus admissible, un âge d'au moins 13 ans et les justificatifs appropriés.
   Envoyer ces justificatifs à GitHub, jamais dans le dépôt de cours.
   Voir les [conditions et étapes officielles](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student).
2. Après vérification, activer **Copilot Student** dans les paramètres Copilot.
   L'éligibilité Education et l'activation Copilot sont deux étapes. L'avantage
   peut mettre plusieurs jours à apparaître ; si seul un paiement est proposé,
   vérifier l'état de la demande et la procédure officielle avant de souscrire.
   Voir [Configurer Copilot pour les étudiants](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students).
3. Dans VS Code, se connecter au même compte GitHub et vérifier que Copilot Chat
   est actif. Respecter aussi les restrictions éventuelles de l'établissement.

Les enseignants vérifiés ont un parcours distinct, actuellement **Copilot Pro**
gratuit sous conditions : [activation enseignant](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-teachers-and-os-maintainers).
Ces avantages ne signifient pas usage illimité. Modèles disponibles, limites et
conditions évoluent : les pages GitHub et l'écran du compte font référence.
Pages d'activation étudiant/enseignant reconsultées le 12 septembre 2026.

## Connecter Studium dans VS Code

Terminer l'[installation](installation.md) et ouvrir **la racine du dépôt** dans
VS Code. Fusionner l'[exemple MCP](../examples/mcp.vscode.json) dans
`.vscode/mcp.json`, sans remplacer d'autres serveurs déjà configurés :

```json
{
  "servers": {
    "studium": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/apps/studium-vscode/dist/lesson-mcp.cjs"],
      "env": {
        "BUNDLES_ROOT": "${workspaceFolder}/fixtures",
        "LITELLM_BASE_URL": ""
      }
    }
  }
}
```

Dans la palette, utiliser **MCP: List Servers**, sélectionner Studium et démarrer
le serveur. Lire les permissions demandées et ses logs en cas d'erreur. Dans une
session de chat agent, vérifier que ses outils sont disponibles. La syntaxe
`servers` est celle du fichier MCP **VS Code** ; les autres clients peuvent lire
une structure différente. Référence : [configuration MCP VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

Prompt de connexion :

> Lis `skills/studium-harness/SKILL.md` dans ce dépôt. Vérifie les outils MCP
> Studium réellement accessibles. Démarre `atomistique-l1/lesson.json` avec un
> identifiant de démonstration sans nom réel. Lis le contexte opérateur public,
> présente l'activité, puis attends ma réponse. N'ouvre pas les corrigés du bundle
> et ne réponds pas à ma place. N'active aucun fournisseur API supplémentaire.

L'appel `start_lesson_session` doit fournir un `session_id`, puis
`get_operator_context` la scène et le contrat de réponse. C'est un contrôle de
connexion, pas une simple affirmation du modèle. Continuer avec la
[première séance](../tutorials/first-lesson.md).

## Choisir un seul pilote de séance

Le panneau Studium et le client MCP natif de Copilot démarrent chacun leur
serveur. Ils ne synchronisent pas automatiquement leur scène ni leur identifiant.
Pour apprendre dans le panneau, utiliser sa boucle et éventuellement le compagnon
`@studium`. Pour une expérience pilotée par l'agent, utiliser la boucle MCP du
chat. Ne pas soumettre une réponse d'une séance à l'autre.

## Skills, web et bibliothèques

Le fichier `skills/studium-harness/SKILL.md` est la procédure livrée avec le cours.
Le demander explicitement dans le premier prompt évite de dépendre d'une
découverte automatique. VS Code reconnaît aussi des dossiers de skills comme
`.github/skills` et `.agents/skills` ; garder une source unique si l'équipe gère
déjà ses skills. Voir [Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).

Le harnais peut disposer de recherche, lecture de pages, terminal et MCP de
littérature. Il faut vérifier ces capacités dans la séance ; Studium ne les
installe ni ne les authentifie. Avant une installation scientifique, lire le
skill de domaine adapté, la documentation officielle et la capsule, puis
consigner les versions. Le [tutoriel d'expérimentation](../tutorials/agentic-experiment.md)
montre comment garder cette liberté liée à l'objectif pédagogique.

Cette documentation vérifie la configuration et le serveur avec un client MCP
standard. Elle ne constitue pas une validation en compte Copilot Student réel.
