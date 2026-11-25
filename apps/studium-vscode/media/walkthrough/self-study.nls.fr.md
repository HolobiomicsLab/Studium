# Apprendre un sujet avec votre assistant

Vous n'avez pas à écrire la leçon vous-même.

1. Dans votre assistant (Copilot en mode agent, Codex ou Claude Code), serveur Studium connecté, dites **« je veux apprendre X avec Studium »**.
   Copilot dans VS Code 1.101 ou plus récent reçoit le serveur de cette extension, sans Node ni commande
   dans un terminal (lancez **MCP: List Servers** pour voir **Studium**). Codex et Claude Code
   demandent Node et une commande.
2. Dans Copilot, la première fois qu'il appelle un outil Studium, VS Code vous demande de l'autoriser.
   Ouvrez la flèche à côté de **Autoriser une fois** et choisissez
   **Autoriser les outils de Studium dans cette session**, ou **Toujours autoriser les outils de Studium**.
   Sinon VS Code redemande à chaque outil, et la leçon attend votre clic.
3. Votre assistant rassemble des sources sur X et en tire une leçon. Chaque question cite le passage dont
   elle provient, et la leçon est enregistrée dans votre bibliothèque personnelle, `~/.studium/library`.
   La construire prend quelques minutes ; c'est fait une fois, et vous pouvez ensuite jouer la leçon autant
   de fois que vous voulez. Pendant ce temps, la barre d'état indique **Studium · leçon en préparation…**, et
   vous pouvez essayer la leçon de démonstration.
4. Quand la leçon est prête, VS Code vous prévient, avec **Ouvrir**, et la leçon apparaît dans la vue Leçons.
   Si vous étiez dans une autre fenêtre, l'avis attend votre retour. Vous pouvez aussi suivre le lien
   `vscode://holobiomicslab.studium-vscode/open?bundle=<chemin de lesson.json>` que votre assistant vous
   donne, ou lancer **Studium : Choisir un cours**.

Si vous fermez VS Code en pleine leçon, le panneau revient à la réouverture de la fenêtre et reprend là
où vous vous étiez arrêté·e.

> La leçon a été rédigée par l'IA à partir de vos sources et n'a pas été vérifiée par un enseignant.
> Studium le dit en haut de la première scène. Si une clé de réponse vous semble fausse, dites-le : vous
> êtes là pour la contester.
