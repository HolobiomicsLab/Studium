# Comprendre Studium pendant l’activité

Les symboles **?** ouvrent une courte aide, au clic, au toucher ou avec Entrée/Espace
après Tab. Une seconde ouverture donne la méthode, les limites et la source du
projet. Les activités et l’Observatory permettent aussi de fermer avec Échap ou
un clic ailleurs. L’aide est facultative : les consignes nécessaires, alertes,
choix de confidentialité et limites scientifiques restent dans la page principale.

Pour un étudiant, l’aide répond à « pourquoi me demande-t-on cela ? » et propose
une démarche, sans fournir la réponse. Pour un enseignant, elle explicite
l’intention pédagogique, ce qu’il faut examiner et ce que l’indicateur ne démontre
pas. Les deux perspectives restent consultables ; aucune inférence de profil ou
d’aptitude n’est nécessaire.

## Les principes en langage courant

| Principe | À quoi sert-il dans Studium ? | Ce qu’il ne faut pas en déduire |
|---|---|---|
| Objectif explicite | Relier l’activité à une capacité à exercer | Finir ne prouve pas la maîtrise |
| Prédiction avant résultat | Rendre visible le raisonnement initial | Se tromper ne constitue pas un diagnostic |
| Confiance déclarée | Examiner sa propre incertitude | La certitude n’est pas l’exactitude |
| Comparaison contrôlée | Examiner l’effet d’un choix en gardant une référence | Une comparaison affichée n’est pas forcément une nouvelle exécution |
| Observation puis conclusion | Distinguer le résultat de son interprétation | Une explication fluide n’est pas une preuve |
| Étayage | Fournir un soutien temporaire, puis laisser agir | Une adaptation n’est pas un profil fixe d’étudiant |
| Examen critique | Justifier l’accord ou l’objection avec des preuves | Tout rejeter n’est pas mieux que tout accepter |
| Transfert | Appliquer une idée à un autre exemple | L’activité initiale ne mesure pas la rétention différée |
| Provenance | Retrouver sources, décisions et contrôles | Une empreinte ne certifie pas la vérité scientifique |
| Revue humaine | Examiner une révision précise avant usage pédagogique | Ouvrir MySTRA ne valide ni ne diffuse un cours |

Ces formulations décrivent des **intentions de conception**. Elles ne prétendent
pas établir l’efficacité pédagogique de Studium. Le catalogue renvoie aux guides
et contrats du projet qui expliquent l’implémentation ; « source du projet » ne
signifie pas « étude validant ce bénéfice ». Les références scientifiques et leurs
limites relèvent du manuscrit et de son audit bibliographique, pas d’une citation
ajoutée automatiquement par l’interface.

## Exemples de première utilisation

**Étudiant.** Ouvrir l’aide près de la prédiction, lire son objectif, écrire une
attente personnelle, puis comparer avec l’observation. Une réponse incertaine peut
servir de point de départ. L’agent peut expliquer une démarche sans rédiger la
réponse à soumettre.

**Enseignant.** Ouvrir l’aide d’un indicateur, examiner les données qui le composent,
la collecte manquante et les aides reçues. Utiliser MySTRA pour relier une affirmation
à sa source et à sa révision ; distinguer validation technique, revue scientifique,
approbation pédagogique et diffusion.

**Harnais.** Au début d’une séance, situer brièvement le rôle de l’apprenant, puis
expliquer les concepts nouveaux à leur première utilisation ou sur demande :

> Explique pourquoi cette étape est proposée, quelle contribution reste la mienne
> et quelles limites je dois garder en tête. Ne me donne pas le résultat attendu.

Ne pas imposer un tutoriel modal à chaque séance. Ne pas enregistrer la lecture
d’une aide comme une preuve d’apprentissage ou une demande d’assistance soumise.

## Couverture actuelle

- Les cinq templates d’activité : objectif, sources, traçage, prédiction,
  confiance, comparaison, conclusion, indices et médias quand présents.
- Le viewer scientifique lié : sources, prédiction, comparaison, représentations
  et conclusion.
- Observatory/MySTRA : entrée commune et aides sur analyses, variantes, traces,
  revue, intégrité, indicateurs, évaluation et harnais.
- Les nouveaux rapports portables : contexte, traces et provenance. Ils restent
  sans JavaScript ; les rapports historiques ne sont pas réécrits.
- Interfaces web : cadre étudiant et méthode de chaque type de scène ; auteur ;
  tableau de bord enseignant et ses pages de cours.
- Extension VS Code : méthode de chaque type de scène dans le panneau et aide du
  graphe. Le build embarque les aides ; reconstruire l’extension avant usage.

Les exports déjà créés et les viewers construits par un autre projet n’acquièrent
pas rétroactivement des aides. Les sorties de chat et de notebook doivent être
accompagnées par le harnais ; cette version n’injecte pas du HTML dans chaque
message ou chaque cellule. Les écrans métier restent responsables de leurs
explications spécifiques : un tooltip générique ne documente pas chaque formule.

## Langue et accessibilité

Le catalogue contient l’anglais et le français. Dans les activités, l’aide suit
le sélecteur de langue sans modifier les réponses ni les données. Pour une langue
non couverte, l’anglais reste affiché et marqué `lang="en"` ; le harnais peut
expliquer le texte dans la langue demandée. Les interfaces web françaises utilisent
les aides françaises ; l’Observatory et les rapports anglais utilisent l’anglais.
Cela ne constitue pas une traduction de toutes les interfaces historiques.

Les disclosures natifs fonctionnent sans JavaScript. Une aide fermée ne surcharge
pas l’impression ; une aide ouverte reste lisible. La couleur n’est pas le seul
signal, le contrôle porte un nom accessible lié au sujet, et le panneau se déploie
dans la page pour éviter de masquer un contrôle sur petit écran. Les tests
techniques ne remplacent pas un essai avec des enseignants et étudiants, notamment
avec lecteur d’écran.

## Réutilisation par les templates et les harnais

Source unique des textes et des correspondances de scènes :
[`ui/context-help.json`](../../ui/context-help.json), schéma
`studium/context-help/v1`. Chaque sujet a un identifiant stable, un titre,
une définition, un conseil étudiant, un conseil enseignant, un objectif, une
méthode, une limite et un chemin de source. La source est un **repère dans le dépôt**,
pas un fichier prétendument embarqué dans le rapport portable.

- Python : `help_tip("prediction", "student")` dans `tools/contextual_help.py`.
- HTML préparé : placer `<!-- HELP:prediction -->` dans une section, puis appeler
  `add_contextual_help(page)` ; le template standard le fait déjà.
- JavaScript : `renderHelp("prediction", catalogue, "student")` depuis
  `ui/context-help.mjs` et inclure `ui/context-help.css` localement.
- React : `ContextHelp` depuis `@studium/activity-presentation/react`, avec
  `topic`, `audience` et `language`. L’application inclut le CSS commun.
- Chat : reprendre les champs utiles du catalogue en texte, dans la langue
  demandée. Expliquer seulement ce qui aide la tâche en cours.

Placer l’aide à côté de la section concernée, **hors** des cellules numériques,
labels de formulaire, titres réécrits par JavaScript, contrôles de réponse et
résumés interactifs existants. Ne pas injecter des objets de scène, clés de
réponse, profils ou texte étudiant dans le catalogue. Les renderers échappent
les textes et refusent les sujets inconnus. Un nouveau sujet nécessite les deux
langues, un objectif concret, une limite et une source de projet existante.

Les contrats ASTRA/ARA et learner-actions sont inchangés. Les anciennes versions
exactes des rapports restent vérifiées ; des hashes recalculés ne rendent pas
acceptable une interprétation pédagogique altérée.
