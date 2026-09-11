# Guide étudiant

Dans Studium, tu peux demander à l'IA d'expliquer un outil, de préparer un calcul
ou de construire un graphique. **Ta prédiction, ton raisonnement et ta conclusion
restent les tiens.** Le parcours utilise tes réponses pour choisir la suite et
te rendre cette adaptation compréhensible.

## Préparer sa première séance

Demande à l'enseignant le bundle du cours, ses assets, la version de Studium et
le périmètre des expériences autorisées. Un PDF seul n'est pas un bundle jouable.
Pour essayer immédiatement, utilise `atomistique-l1`, livré dans le dépôt.

1. Suis l'[installation commune](../getting-started/installation.md).
2. Choisis le panneau sans compte LLM, ou [Copilot Student](../getting-started/copilot.md)
   pour travailler avec un agent. [D'autres harnais](../getting-started/harnesses-and-api.md) sont possibles.
3. Fais le [tutoriel première séance](../tutorials/first-lesson.md).

Laisse d'abord la télémétrie désactivée et utilise un identifiant de test sans
nom réel. Le professeur précise les règles du pilote avant une collecte de classe.
La [confidentialité](../privacy-and-limits.md) distingue les données Studium de
ce qui est envoyé au fournisseur du chat.

## Que faire dans une scène ?

| Activité | Ta contribution |
|---|---|
| Introduction ou concept | Lire, manipuler les assets puis continuer |
| Quiz | Choisir après avoir raisonné ; demander un indice si nécessaire |
| Confiance | Déclarer ton propre niveau de confiance, de 0 à 4 |
| Reproduction | Lire le protocole, prédire et examiner les résultats réellement exécutés |
| Critique / erreur à repérer | Relier chaque objection à un fait ou une preuve |
| Expliquer / comparer / auditer | Produire ta formulation et ses limites |
| Discussion | Construire le raisonnement sur plusieurs échanges |
| Prompt / communication | Rédiger puis améliorer ta propre proposition |

Les [13 types de scènes](../features.md) n'apparaissent pas dans chaque cours.
Le panneau propose les contrôles appropriés ; dans le chat, l'agent lit le contrat
avant de soumettre. Un exemple JSON du serveur est un format, pas une réponse.

## Utiliser l'agent sans lui céder l'activité

Prompts utiles :

> Donne-moi un indice sur la démarche, puis attends mon essai.

> Affiche ces données avec leurs unités. Demande-moi d'abord ce que je prédis
> quand on change le seuil. Garde la référence visible à côté de la variante.

> Voici mon explication : […]. Pose une question qui teste sa limite, sans
> remplacer mon texte par ta réponse avant soumission.

> Explique la dernière adaptation avec l'outil Studium disponible.
> Distingue ce qu'il rapporte de ton interprétation.

Un indice peut réduire le crédit de maîtrise : il reste utile pour apprendre.
Une remédiation propose un travail sur un prérequis. Les indicateurs du prototype
ne sont pas une note institutionnelle ni un diagnostic.

## Expérimenter avec un article ou une capsule

Suis le [tutoriel agentique](../tutorials/agentic-experiment.md). Choisis une question,
prédis un effet, exécute une référence, modifie un facteur et juge la différence.
Le harnais peut rechercher une documentation ou lire un skill, mais doit dire
ce qu'il a vraiment consulté et exécuté. Vérifie unités, données, cas limites et
provenance : un graphique produit par l'IA peut être erroné.

Garde les sorties dans ton espace d'expérience. Une capsule `type-checked` n'est
pas un run réussi. Si une dépendance manque ou qu'un calcul échoue, conserve cet
échec ; ne demande pas à l'agent de fabriquer un résultat.

## Terminer ou reprendre

Note le cours, la révision et ce que tu veux reprendre. Le panneau et un chat MCP
indépendant ont des sessions distinctes. Fermer une fenêtre ne prouve pas que
des données persistantes ont été effacées. L'oubli concerne l'état géré par Studium ;
les dossiers d'expérience et l'historique du harnais ont leur propre conservation.
Voir [confidentialité](../privacy-and-limits.md).

En cas de difficulté, utilise le [dépannage](../troubleshooting.md) et transmets
uniquement un exemple minimal anonymisé à l'enseignant.
