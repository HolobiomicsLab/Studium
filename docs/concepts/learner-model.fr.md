[English](learner-model.md) · Français

# Modèle de l'apprenant

Pour chaque concept, Studium tient deux estimations distinctes : à quel point l'apprenant a *montré* qu'il le connaît (la maîtrise), et quelle est la probabilité qu'il s'en *souvienne encore* maintenant (la rétention). Cette page donne les équations telles que le code les applique, et les règles qui gardent ces deux estimations honnêtes. Elle n'est pas nécessaire pour utiliser Studium ; lisez-la pour savoir ce que signifie un chiffre de maîtrise.

## La maîtrise, une estimation bêta

Chaque concept part d'un a priori uniforme, α = 1 et β = 1. α accumule les preuves de connaissance, β les preuves de méconnaissance. La maîtrise est la moyenne a posteriori :

```text
p = α / (α + β)
```

Une réponse évaluée de difficulté w (entre 0 et 1, tirée du niveau de Bloom du concept, voir [Types de scènes](scene-types.fr.md#difficulté)), obtenue avec h indices, la met à jour :

```text
juste :   α ← α + (2 − w) / (1 + 2h)
fausse :  β ← β + (1 + w)
```

### Les indices réduisent le crédit

Chaque indice diminue le crédit d'une bonne réponse. Pour w = 0,5, une bonne réponse sans indice ajoute 1,5, avec un indice 0,5, avec deux indices 0,3. S'appuyer sur les indices ne permet pas de certifier un concept aussi facilement qu'en répondant seul.

### Correction du hasard

Sur une question à choix, on peut avoir raison par chance. Avec k bonnes options sur n, le taux de hasard vaut g = k / n. Une réponse fausse transfère alors aussi, de α vers β, le crédit qu'une réussite chanceuse aurait rapporté :

```text
τ = min(α − 1, (2 − w) · g / (1 − g))
fausse :  α ← α − τ,   β ← β + (1 + w) + τ
```

Pour un apprenant qui connaît une partie des questions et devine le reste, l'estimation attendue tend vers cette partie, et non vers cette partie augmentée des réussites chanceuses. Répondre à pile ou face sur des questions vrai/faux ne donne plus 0,5. α ne descend jamais sous son a priori de 1, et les bonnes réponses ne sont pas modifiées.

### Plafond des anciennes preuves

Quand α + β dépasse 20, les deux sont réduits du même facteur. La moyenne est conservée, et une nouvelle réponse pèse toujours au moins 5 % environ du total : un apprenant qui ne sait plus un concept n'est pas masqué par une longue série de réussites anciennes. Les nombres de tentatives ne sont pas réduits.

La mise à jour se trouve dans [`beta-updater.ts`](../../packages/adaptation-engine/src/beta-updater.ts).

## Quand un concept compte comme maîtrisé

| Usage | Condition |
|---|---|
| Débloquer un concept dépendant dans le graphe | chaque prérequis direct à p ≥ 0,8 (0,6 dans un univers `lenient`), avec au moins 3 tentatives évaluées |
| Certifier la maîtrise (une attestation de maîtrise est écrite) | p ≥ 0,8, au moins 3 tentatives évaluées, pas d'excès de confiance mesuré, pas d'excès de crédulité mesuré |
| Figurer parmi les révisions dues du plan d'étude | p ≥ 0,6 et révision échue |

Avec ce seuil de trois tentatives, deux réponses chanceuses peuvent laisser l'apprenant avancer, jamais certifier le concept.

## La rétention avec FSRS

Chaque réponse évaluée, et chaque auto-évaluation, compte comme une révision du concept dans un ordonnanceur dérivé de FSRS-4.5 (Free Spaced Repetition Scheduler), avec ses poids par défaut publiés. La mémoire d'un concept a une stabilité S, en jours, et une difficulté comprise entre 1 et 10. La récupérabilité, probabilité de rappel t jours après la dernière révision, vaut :

```text
R(t) = (1 + (19/81) · t / S) ^ (−0,5)
```

Un concept est dû quand R descend jusqu'à la rétention cible de 0,9 ; avec ces constantes, cela arrive au bout de S jours. Une révision réussie augmente S, d'autant plus qu'elle arrive tard (l'effet d'espacement) ; un oubli ramène S à une valeur plus basse, jamais plus haute.

| Événement | Note FSRS |
|---|---|
| Réponse évaluée, fausse | again |
| Réponse évaluée, juste avec indices | hard |
| Réponse évaluée, juste sans indice | good |
| Auto-évaluation | le choix de l'apprenant : again, hard, good ou easy |

L'ordonnanceur est dans [`fsrs.ts`](../../packages/adaptation-engine/src/fsrs.ts). La mémoire est conservée par leçon et dans le profil transversal de l'apprenant : un concept révisé dans une leçon est connu dans une autre.

## Maîtrise effective

Ce que l'apprenant peut mobiliser maintenant, c'est l'estimation a posteriori corrigée par le rappel :

```text
m_eff = p · R(t)     quand le concept a déjà été révisé
m_eff = p            quand il ne l'a jamais été
```

Le saut d'un concept déjà maîtrisé lit la maîtrise effective : un concept maîtrisé il y a des semaines et oublié depuis n'est pas sauté. La fonction est `effectiveMastery` dans [`learner-state`](../../packages/learner-state/src/index.ts).

## Auto-évaluation

Après une réponse rédigée qu'aucun juge n'a évaluée, l'apprenant la compare à la référence et note son rappel : again (à revoir), hard (difficile), good (bien) ou easy (facile). Cette note n'alimente que FSRS, pour chaque notion de la scène notée. Elle fixe la prochaine révision et ne modifie jamais α ni β. Une demande de note en attente est enregistrée avec l'état de l'apprenant : elle survit à un redémarrage du serveur.

## Calibration

### Confiance

Un `meta_checkpoint`, ou une confiance donnée avec une réponse de quiz, est comparé à la maîtrise mesurée :

```text
écart = c / 4 − p        c = confiance déclarée, de 0 à 4
```

Un écart positif traduit un excès de confiance, un écart négatif un manque de confiance. Un point de confiance remplace l'écart par sa dernière valeur ; les confiances données avec les réponses forment une moyenne glissante (poids 0,4 par réponse). Entre −0,4 et +0,4, l'apprenant est calibré. Seul un excès de confiance mesuré retient une certification de maîtrise ; un apprenant qui doute de lui mais a fait ses preuves n'est pas pénalisé.

### Confiance dans les productions de l'IA

Un `spot_the_flaw` ancré dans un résultat réellement exécuté mesure à quel point l'apprenant se fie à une lecture fautive de ce résultat par l'IA :

```text
crédulité = défauts manqués / défauts placés
méfiance  = affirmations correctes signalées à tort / affirmations correctes proposées
écart     = crédulité − méfiance      (moyenne glissante, poids 0,5)
```

Une crédulité mesurée au-delà de 0,4 retient une certification de maîtrise. Un résumé de détection du signal (discrimination A′ et biais c) est aussi conservé pour la lecture ; il ne bloque jamais rien.

## Non mesuré ne veut pas dire zéro

Le modèle ne transforme jamais une absence de preuve en valeur.

- Une réponse que personne n'a évaluée (texte libre sans juge) ne change ni α ni β, ne compte pas comme tentative, ne démarre ni n'interrompt une série d'erreurs. Elle est comptée à part, comme tentative non évaluée.
- Un concept jamais révisé n'a aucune preuve de rétention : sa maîtrise effective est son estimation a posteriori, pas zéro.
- Une calibration jamais mesurée n'est ni bonne ni mauvaise : aucun seuil ne s'y applique.
- La méfiance n'est pas mesurée quand une scène ne propose aucune affirmation correcte ; l'écart ne reflète alors que la crédulité.
- Un concept seulement auto-évalué apparaît dans le plan d'étude sous « À revoir », jamais sous « À reprendre ».
- Le rapport de classe ne donne une exactitude que là où une clé ou un juge a évalué.

Voir aussi [Honnêteté et provenance](honesty-and-provenance.fr.md) et le [glossaire](glossary.fr.md).
