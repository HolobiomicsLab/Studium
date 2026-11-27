[English](for-it-and-data-protection.md) · Français

# Studium pour l'informatique et la protection des données

Cette page s'adresse à la direction informatique et au délégué à la protection des données d'une université, qui doivent pouvoir dire ce que Studium demande à leur système d'information, sans connaître Studium. Elle décrit le logiciel ; ce n'est pas une déclaration de conformité (voir [Limites](#limites)).

## Ce qu'est Studium

Studium transforme des sources de confiance d'un enseignant en leçons que les étudiants jouent. Chaque réponse dit qui a rédigé la clé et si quelque chose l'a évaluée. Un enseignant approuve une leçon avant que les étudiants l'utilisent, et la leçon se joue sur l'ordinateur de l'étudiant, dans un panneau de VS Code.

## Ce qui est installé, et d'où

| Quoi | D'où cela vient | Nécessaire |
|---|---|---|
| L'extension VS Code `holobiomicslab.studium-vscode` | le Visual Studio Marketplace, Open VSX (VSCodium, Cursor, Gitpod), ou un fichier `studium-vX.Y.Z.vsix` d'une [version GitHub](https://github.com/HolobiomicsLab/studium/releases), à vérifier avec le `SHA256SUMS.txt` de la version | oui, avec VS Code 1.95 ou plus récent |
| Node.js 20 ou plus récent et le paquet `studium-mcp` (npm) | npm, ou le fichier `lesson-mcp.cjs` d'une version | seulement pour le [lecteur dans le navigateur](browser.fr.md) ou pour relier un assistant d'IA |

L'extension porte son serveur de leçons et ses visionneuses et les exécute avec l'environnement d'exécution de VS Code : les étudiants n'ont besoin ni de Node, ni de terminal, ni de Git, ni de Python, ni de compte d'IA pour jouer une leçon. Où l'installer et quels réglages écrire pour une salle d'enseignement : [Postes de salle de TP](classroom-workstations.fr.md). D'où vient une leçon sur l'ordinateur personnel d'un étudiant : [Partager une leçon par votre plateforme de cours](../teach/share-through-your-course-platform.fr.md).

## Ce qui est installé sur les serveurs de l'établissement

Rien. Studium n'a pas de serveur propre à héberger, pas de plugin pour la plateforme de cours, pas d'outil LTI, pas d'authentification unique et pas de lien avec un carnet de notes. La plateforme de cours ne porte qu'un fichier et un texte.

## Ce qui passe par le réseau par défaut

Rien du fait de Studium. L'extension n'appelle aucun modèle, la télémétrie de classe est désactivée (`studium.telemetryConsent` vaut `false` ; activée, les événements sont écrits dans un dossier local et rien n'est envoyé), et les bibliothèques de visualisation (équations, graphiques, 3D) sont chargées depuis l'extension elle-même. Le serveur de leçons et le lecteur dans le navigateur n'écoutent que sur 127.0.0.1. Le trafic propre à VS Code (mises à jour, Marketplace, sa télémétrie) dépend de la configuration de VS Code de l'établissement, hors de Studium.

Trois choix changent cela :

| Choix | Effet |
|---|---|
| Un assistant d'IA avec un modèle distant, choisi par l'utilisateur | le fournisseur de l'assistant reçoit ce que l'assistant lit ; Studium ne le contrôle pas |
| `studium.assets` réglé sur `cdn` | les bibliothèques de visualisation se chargent depuis jsdelivr au lieu d'être locales |
| Un point d'accès à un modèle juge (`LITELLM_BASE_URL`, vide par défaut) | les réponses rédigées sont envoyées à ce point d'accès pour être évaluées |

Voir [Confidentialité et limites](../concepts/privacy-and-limits.fr.md) et la [référence de configuration](../reference/configuration.fr.md).

## Où vivent les données des apprenants

Sur l'ordinateur de l'étudiant, jamais dans le dossier des leçons. Avec VS Code, la progression et les dates de révision sont dans le stockage de l'extension pour ce compte utilisateur (`globalStorage/holobiomicslab.studium-vscode` sous le dossier utilisateur de VS Code). Chaque apprenant a un dossier nommé par un pseudonyme, jamais par son identifiant : un HMAC de l'identifiant, avec un secret gardé dans un fichier du dossier de données (`.studium-secret`, droits 0600). Une leçon importée est copiée dans la bibliothèque personnelle, `~/.studium/library` (ou `<STUDIUM_HOME>/library`).

| Pour effacer | Faites |
|---|---|
| L'état d'une leçon | **M'oublier** dans le menu du panneau |
| Tout ce que l'extension garde | **Studium : Oublier mes données**, après confirmation |
| La même chose, par un administrateur | supprimer le dossier `globalStorage/holobiomicslab.studium-vscode` |

Des étudiants qui partagent un compte partagent un enregistrement. L'effacement n'atteint ni les leçons de la bibliothèque, ni les données que le serveur d'un assistant garde dans `~/.studium/data`, ni l'historique de l'assistant, ni les copies faites ailleurs.

## Ce que la plateforme de cours enregistre

C'est l'affaire de la plateforme. Sur le Moodle 5.3.1 jetable d'une vérification, Moodle a journalisé un événement de consultation par visite de la ressource fichier (utilisateur, cours, date, adresse IP) et aucun événement pour le téléchargement lui-même ; Studium n'envoie rien à la plateforme. Ce que votre plateforme enregistre dépend de sa configuration.

## Ce qu'un enseignant voit d'une classe

Rien par défaut. Un rapport de classe demande des dossiers de télémétrie consentie, réunis en un même lieu par l'enseignant ou le responsable du pilote ; aucune surface prise en charge ne les envoie par le réseau. Chaque chiffre de classe est calculé sur au moins cinq apprenants, et un chiffre sous ce seuil est retenu. Voir [Suivre une classe](../teach/follow-a-class.fr.md).

## Ce que Studium ne fait pas aujourd'hui

- Ce n'est pas un service hébergé : il n'y a pas de compte à créer ni d'instance institutionnelle.
- Il ne renvoie aucune note à la plateforme de cours.
- Il n'importe aucune liste d'étudiants.

## Ce qui demanderait une évaluation formelle

Un service hébergé et multi-utilisateur. Le document de conception du lecteur dans le navigateur le range sous « Not covered » : connexion, une identité par apprenant, isolation entre apprenants, TLS, protection des données (base légale, registre des traitements, conservation, effacement pour chaque apprenant, analyse d'impact pour l'analytique d'apprentissage) et une décision d'hébergement institutionnel. Voir [cette liste](../design-records/specs/2026-11-25-browser-player.md#not-covered).

## Limites

- Aucune salle d'enseignement n'a été préparée avec ces étapes.
- Cette page décrit le logiciel. Ce n'est pas une déclaration de conformité : réussir des tests ne rend pas un déploiement conforme à une réglementation, donc menez un pilote avec les personnes qui en sont responsables ([Confidentialité et limites](../concepts/privacy-and-limits.fr.md#publier)).
