[English](SECURITY.md) · Français

# Politique de sécurité

Cette page explique comment signaler une vulnérabilité en privé, ce à quoi Studium fait confiance et ce à quoi il ne fait pas confiance, et comment il protège les données des apprenants et les clés.

## Signaler une vulnérabilité

Signalez en privé, jamais dans une issue, une pull request ou une discussion publique.

1. Sur ce dépôt, ouvrez l'onglet **Security** et choisissez **Report a vulnerability** (signalement privé de vulnérabilité de GitHub).
2. Décrivez la surface concernée (extension VS Code, serveur MCP, API HTTP, lesson-server, tableau de bord enseignant, Observatory, outils Python), la révision, les étapes pour reproduire et l'impact constaté.
3. N'incluez ni données réelles d'apprenants ni clé d'API active. La pièce jointe la plus utile est un bundle de leçon minimal qui reproduit le problème.

Si le signalement privé ne vous est pas accessible, ouvrez une issue qui demande à un mainteneur un contact privé, sans aucun détail sur le problème. Les mainteneurs accusent réception, vous tiennent informé pendant la correction et peuvent vous citer dans le journal des modifications si vous le souhaitez.

## Versions prises en charge

Studium est un prototype de recherche en version 0.1.0, sans version publiée à ce jour. Les corrections arrivent sur la branche `dev`, puis sur `main`. Les révisions antérieures ne sont pas corrigées.

## Ce à quoi Studium fait confiance, ou non

| Entrée | Confiance ? | Traitement |
|---|---|---|
| Un bundle de leçon (`lesson.json`) | Des données, pas du code | Lu uniquement dans sa racine configurée ; un chemin qui en sort est refusé. Les clés de correction ne sont jamais envoyées à l'apprenant avant sa réponse, sur aucun hôte (MCP, canal fichier, HTTP) |
| La commande de reproduction d'un bundle | Pas de confiance tant que l'apprenant n'a pas accepté | L'extension VS Code affiche la commande, ses paquets et son dossier, et demande avant de l'exécuter. L'accord est lié à une empreinte SHA-256 du fichier du bundle et de ces champs : tout changement redemande l'accord |
| Markdown, SVG et figures d'une leçon | Pas de confiance | Le panneau rend le Markdown avec le HTML brut échappé, puis le passe par un assainisseur à liste blanche ; le SVG perd scripts, styles, objets embarqués et images ; les images relatives sont remplacées par un emplacement réservé |
| Un motif fourni par l'apprenant dans une reproduction | Pas de confiance | Évalué avec une limite de temps |
| Les sources passées à `prepare_sources` | Des données | Au plus 20 sources et 200 000 caractères ; chaque citation doit correspondre à un passage au caractère près |
| Le harnais IA et ses outils | Hors de Studium | Studium ne contrôle pas ce que l'assistant fait avec ses propres outils ; les permissions et validations du harnais s'appliquent |

## Le panneau VS Code

Le panneau de leçon fonctionne sous une politique de sécurité du contenu (CSP) stricte : `default-src 'none'`, des scripts autorisés seulement avec un nonce généré à chaque rendu, des styles et polices venant de l'extension (et du CDN en mode CDN), des images venant de l'extension ou d'URI `data:` (plus `https:` en mode CDN). Les bibliothèques de visualisation (KaTeX, marked, Vega, 3Dmol et d'autres) sont copiées localement par `pnpm --filter studium-vscode vendor` ; en mode CDN, chacune est chargée depuis jsDelivr avec une empreinte d'intégrité (SRI) égale à celle du fichier copié localement.

## L'API HTTP

`pnpm --filter @studium/lesson-mcp api` n'écoute que sur `127.0.0.1`. Elle refuse les connexions non locales, les origines de navigateur et les en-têtes `Host` non locaux, et exige un jeton porteur d'au moins 32 caractères dans `STUDIUM_API_TOKEN`. Le `lesson-server` historique retire les clés de correction de toutes les vues destinées à l'apprenant.

## Décisions sur les contributions des apprenants

`POST /learner-items/{id}/decide` sur scene-synth publie l'item d'un apprenant pour la classe : c'est un acte d'enseignant. La route exige un jeton porteur d'au moins 32 caractères dans `STUDIUM_REVIEW_TOKEN`, distinct de tout identifiant de cours et comparé en temps constant ; absent ou plus court, toute décision est refusée (`503`). Elle refuse toute requête portant une `Origin` de navigateur (`403`) et n'accorde aucun accès CORS. Le tableau de bord enseignant garde le jeton sur son serveur et appelle scene-synth depuis celui-ci ; le navigateur n'envoie que la décision au tableau de bord. Le jeton n'est jamais journalisé, répété dans une erreur ni écrit dans le journal des décisions. Un item approuvé porte un enregistrement `approval.json` lié au sha256 de son `lesson.json`.

Deux secrets gardent ce chemin, un par tronçon. `STUDIUM_REVIEW_TOKEN` se tient entre le serveur du tableau de bord et scene-synth. `STUDIUM_DASHBOARD_ACCESS_CODE`, 16 caractères au moins, se tient entre le navigateur de l'enseignant et le tableau de bord : quand il est défini, chaque page et chaque route d'API du tableau de bord demandent une session obtenue sur `/login`, un cookie signé (`HttpOnly`, `SameSite=Strict`, `Secure` en https) valable 12 heures dont la clé dérive du code, si bien que changer le code ferme toutes les sessions. Le code est comparé en temps constant et n'est jamais journalisé ni répété. La connexion n'accepte que les requêtes de même origine et répond `429` après 10 codes faux en 5 minutes. La route de décision vérifie elle-même la session : sans code d'accès, elle refuse toute décision (`503`) ; sans session valide, elle répond `401`. Sans code, le tableau de bord reste lisible par toute personne qui atteint son port, pages de relecture des leçons et agrégats de classe compris ; gardez-le sur `localhost`.

Les limites sont simples. Il y a un code partagé par tableau de bord, pas un compte par enseignant. Le nom du relecteur sur une approbation est déclaré par l'enseignant qui le saisit, pas authentifié. Le frein à la connexion est compté par processus serveur et repart de zéro quand le processus redémarre. En http simple sur un réseau, le code et le cookie circulent en clair : utilisez https, ou restez sur `localhost`.

## Données des apprenants

- **Local d'abord.** La progression reste sur la machine de l'apprenant : `~/.studium/data` pour le serveur MCP (`STUDIUM_HOME`, `STUDIUM_DATA_DIR`), le stockage propre de l'extension dans VS Code. `STUDIUM_EPHEMERAL=1` garde tout en mémoire.
- **Pseudonymes.** Les dossiers d'apprenants sur disque portent un pseudonyme HMAC, jamais l'identifiant brut. Le secret est `STUDIUM_PSEUDO_SECRET` ou un fichier propre à l'installation, `<dossier de données>/.studium-secret`, créé avec les droits 0600.
- **Effacement.** L'outil `forget_session` et la commande **Studium : Oublier mes données** suppriment la progression de l'apprenant. `end_session` ferme une séance et conserve la progression.
- **Télémétrie.** L'envoi de télémétrie exige le consentement de l'apprenant. Les rapports de classe sont agrégés et supprimés en dessous de cinq apprenants ; ce seuil ne peut pas être abaissé depuis l'outil.

[Confidentialité et limites](docs/concepts/privacy-and-limits.fr.md) explique contre quoi ces mesures protègent et contre quoi elles ne protègent pas ; à lire avant un pilote en classe.

## Clés et secrets

- L'accès à un modèle se configure par des variables d'environnement (`LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`). Studium fonctionne sans elles ; les réponses ouvertes sont alors comparées à la référence au lieu d'être jugées.
- Ne versionnez jamais une clé, un jeton, un secret de pseudonymisation ni des données d'apprenants. Gardez-les dans votre environnement ou dans un fichier ignoré par git.
- Si une clé a été exposée, révoquez-la d'abord auprès de son fournisseur, puis signalez l'exposition.
