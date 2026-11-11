[English](report-and-contribute.md) · Français

# Signaler un problème ou contribuer

Studium est un prototype de recherche, et il s'améliore grâce à ce que ses utilisateurs rencontrent.
Cette page vous dit où envoyer un défaut, une étape déroutante ou une fonction manquante, quoi mettre
dans un signalement, et comment proposer vous-même une modification.

## Où l'envoyer

| Ce qui ne va pas | Où l'envoyer |
|---|---|
| Studium lui-même : le serveur et ses outils, l'extension VS Code, le panneau de leçon, le tableau de bord enseignant, les outils en ligne de commande, la documentation, les skills | une issue sur le [dépôt](https://github.com/HolobiomicsLab/studium/issues), ou une modification proposée par une pull request |
| Une leçon de démonstration livrée avec Studium (dans `fixtures/`) | le dépôt également |
| Le contenu de la leçon de votre enseignant : un corrigé qui semble faux, un énoncé peu clair, une source douteuse | votre enseignant. Studium n'a pas d'outil qui lui transmette une remarque : indiquez-lui la leçon, le titre de la scène et la phrase. Pas le dépôt : la leçon n'est pas publique |
| Une leçon d'auto-apprentissage que votre assistant a rédigée à partir de vos sources | votre assistant : demandez-lui de corriger le brouillon et de recréer la leçon |
| Un moyen de lire les données de quelqu'un, de voir un corrigé avant de répondre, ou de contourner l'approbation d'un enseignant | le signalement privé de la [politique de sécurité](../../SECURITY.fr.md), jamais une issue publique |

## Ce que fait votre assistant

Quand Studium lui-même échoue, contredit sa documentation ou ne sait pas faire ce que vous demandez, un
assistant connecté a pour consigne de le dire franchement et de vous aider d'abord à avancer. Il vous
propose ensuite, une seule fois et à une pause, de préparer un signalement avec vous : il rédige le
texte, vous le relisez et vous le publiez. Il n'interrompt pas une question à laquelle vous répondez, ne
demande pas deux fois, et ne publie rien de lui-même.

Vous pouvez aussi le demander à tout moment :

```text
Aide-moi à signaler à Studium ce qui vient de se passer. Rédige le texte ; je le publierai moi-même.
```

Les adresses viennent du serveur (`feedback` dans `get_server_info`) : l'assistant n'a pas à les
deviner. La procédure complète est le skill `studium-contribute` ([Skills](skills.fr.md)).

## Rédiger un signalement utile

1. Ce que vous faisiez, en une ou deux phrases, et votre rôle : apprenant, enseignant, développeur.
2. Ce que vous attendiez et ce qui s'est passé, avec le message exact, raccourci s'il est long.
3. Le plus court moyen de le revoir : la demande faite à l'assistant, l'appel d'outil, la commande, ou
   la page et l'étape.
4. La version de Studium (`get_server_info` donne `version` et `build` ; l'extension affiche sa version
   dans VS Code), votre assistant et votre plateforme.
5. Pour une fonction manquante : le besoin avec vos mots, à qui elle servirait, et ce que vous faites
   aujourd'hui à la place.

## À laisser de côté

- Les réponses, les textes, le journal ou les résultats d'un apprenant.
- Les noms, les adresses électroniques, un établissement ou une classe, un identifiant d'apprenant qui
  désigne quelqu'un.
- Le corrigé, les indices ou les réponses modèles de la leçon d'un enseignant, et la leçon elle-même.
- Les jetons, les codes d'accès, les clés d'API, un fichier `.env`.
- Un dossier de données, un fichier de télémétrie, une conversation entière.
- Un texte copié d'une source dont la licence ne le permet pas.

Une leçon de démonstration de `fixtures/` montre en général le même défaut sans rien de tout cela.

## Ouvrir l'issue

1. Cherchez dans les [issues ouvertes](https://github.com/HolobiomicsLab/studium/issues) : un
   commentaire sur une issue existante est aussi utile qu'une nouvelle.
2. Ouvrez une [nouvelle issue](https://github.com/HolobiomicsLab/studium/issues/new/choose) et
   choisissez un formulaire : « Problem or difficulty », « Feature request », ou « Tester feedback »
   après le parcours de [TESTING.fr.md](../../TESTING.fr.md).
3. Écrivez en français ou en anglais.

Une issue est publique et part de votre propre compte GitHub. Sans compte, remettez le texte à votre
enseignant, ou utilisez le contact indiqué sur la page des formulaires. Un signalement est lu par un
mainteneur, qui peut vous poser une question ; il n'engage pas le projet sur une date.

## Proposer vous-même une modification

Une coquille, un lien mort, une phrase fausse dans un guide ou un skill, une traduction manquante : sur
GitHub, le crayon d'un fichier ouvre une modification qui devient une pull request, sans copie locale.
Pour le code, suivez [CONTRIBUTING](../../CONTRIBUTING.fr.md) : partez de `dev`, écrivez d'abord un test
qui échoue, modifiez les deux langues d'une page ensemble, et pour tout ce qui dépasse une petite
correction, ouvrez d'abord une issue. Deux limites valent pour toute contribution : aucune leçon
n'atteint des étudiants sans l'approbation d'un enseignant, et aucune donnée d'apprenant n'entre dans le
dépôt.

Pages liées : [Dépannage](troubleshooting.fr.md), [Skills](skills.fr.md),
[Confidentialité et limites](../concepts/privacy-and-limits.fr.md).
