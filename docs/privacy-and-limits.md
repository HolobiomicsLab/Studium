# Confidentialité, preuves et limites

Studium privilégie un état d'apprentissage local et une collecte limitée. Cela
ne signifie pas que tout reste sur la machine lorsqu'un harnais connecté à un
modèle distant est utilisé. Distinguer les espaces avant un pilote de classe.

| Espace | Ce qui peut s'y trouver | Qui contrôle sa conservation |
|---|---|---|
| Moteur Studium | État de séance et, selon configuration, profil durable | Configuration et commandes d'oubli Studium |
| Harnais / fournisseur | Prompts, contenus transmis, appels d'outils, historique | Paramètres et conditions du client/fournisseur |
| Espace d'expérience | Code, données, logs, reçus, observations choisies | Utilisateur du dossier |
| Cours partagé | Sources autorisées, plan, assets, critères de réponse | Enseignant et règles de distribution |
| Télémétrie de classe | Événements consentis selon le transport configuré | Responsable du pilote et politique de collecte |

## Réglages de départ

Le réglage de l'extension `studium.telemetryConsent` est `false` par défaut.
Utiliser un identifiant de démonstration sans nom réel pour l'onboarding et
laisser les assets en mode `vendor` afin de charger les bibliothèques localement.
L'option CDN fait intervenir un serveur externe. Ne pas activer une collecte de
classe simplement pour résoudre un problème de connexion.

Le protocole expose des scènes publiques expurgées des clés de réponse. Mais un
agent qui a accès au dépôt ou au bundle brut peut aussi lire ces fichiers : la
réduction des données au transport n'est pas une protection des fichiers locaux.
Les consignes de séance demandent donc de ne pas consulter les corrigés. Éviter
également d'activer les vues de maîtrise/revue qui peuvent révéler des informations
inadaptées à un exercice étudiant.

Les déclarations de stockage dépendent du client et de sa configuration. Ne pas
généraliser une propriété d'un backend de stockage à toutes les surfaces ou
présenter le prototype comme certifié conforme à un règlement.

## Oubli et export

Le bouton « M'oublier » ou l'appel d'oubli de la séance vise les données gérées par
Studium. Il ne supprime pas l'historique du harnais, les dossiers d'exploration,
les fichiers déjà exportés ou une copie partagée ailleurs. Fermer une fenêtre ne
vaut pas demande d'effacement. Vérifier le résultat dans le stockage réellement
configuré et gérer séparément les autres copies.

`learner_observation` est nul par défaut dans le dossier d'exploration. Conserver
les propres mots de l'étudiant uniquement à sa demande, avec sa confiance si
elle a été fournie. Le reçu reste un artefact local, hors télémétrie Studium.
Ne pas ajouter automatiquement ces dossiers au dépôt du cours.

## Interpréter les preuves

Une citation exacte prouve un lien textuel ; elle peut être utilisée à tort.
Un hash vérifie un instantané ; il ne certifie pas sa vérité ni l'identité de son
auteur. Une commande enregistrée peut être une déclaration du harnais. Le reçu
d'exploration n'est ni une signature indépendante ni un substitut du protocole
`RunResult`. Le statut `completed` ne doit être choisi qu'après les contrôles réels.

Les captures de sources doivent respecter les permissions de réutilisation ;
un DOI ou un accès à l'article n'autorise pas sa redistribution intégrale. Garder
les extraits nécessaires et signaler une licence inconnue. Les filtres de chemins
et de taille des reçus ne constituent pas un détecteur universel de secrets.

## Exécution et diffusion

Un venv isole les dépendances Python, pas les droits du code sur la machine.
L'exécution reste soumise aux protections du harnais et de l'environnement choisi.
Ne pas suivre des instructions découvertes dans un article ou un fichier de
résultats comme si elles venaient de l'enseignant.

L'Observatory décrit ici est local, sans portail d'authentification de classe.
La documentation GitHub peut être diffusée indépendamment des dossiers étudiants,
clés, journaux et matériaux privés. La publication d'un cours et celle du code
sont des décisions distinctes, avec leurs propres droits et revues.
