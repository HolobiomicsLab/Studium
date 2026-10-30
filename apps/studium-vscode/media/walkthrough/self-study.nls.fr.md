# Apprendre un sujet avec votre assistant

Vous n'avez pas à écrire la leçon vous-même.

1. Dans Codex ou Claude Code, serveur MCP Studium connecté, dites **« je veux apprendre X avec Studium »**.
2. Votre assistant rassemble des sources sur X et en tire une leçon. Chaque question cite le passage dont
   elle provient, et la leçon est enregistrée dans votre bibliothèque personnelle, `~/.studium/library`.
3. Ouvrez-la ici :
   - clic droit sur son `lesson.json` dans l'explorateur, puis **Studium : Ouvrir cette leçon**, ou
   - suivez le lien `vscode://holobiomicslab.studium-vscode/open?bundle=<chemin de lesson.json>` que votre
     assistant vous donne (il peut lancer `code --open-url` pour vous), ou
   - lancez **Studium : Choisir un cours**.

Si vous fermez VS Code en pleine leçon, le panneau revient à la réouverture de la fenêtre et reprend là
où vous vous étiez arrêté·e.

> La leçon a été rédigée par l'IA à partir de vos sources et n'a pas été vérifiée par un enseignant.
> Studium le dit en haut de la première scène. Si une clé de réponse vous semble fausse, dites-le : vous
> êtes là pour la contester.
