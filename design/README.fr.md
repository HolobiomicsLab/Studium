# Système visuel de Studium

Du papier, de l'encre et un chemin entre les idées. Ouvrir
[preview.html](preview.html) depuis le disque : deux thèmes, des fichiers locaux
et des données d'exemple.

## Six principes

1. **Laisser place au raisonnement :** marges ouvertes, libellés courts, lecture confortable.
2. **Montrer les preuves :** nommer l'évaluation ; un retour par mots-clés reste **non certifié** (`Not certified`).
3. **Associer couleur et sens :** chaque statut a aussi un libellé, une forme ou un symbole.
4. **Respecter le lecteur :** suivre ses préférences web et le thème réel de VS Code.
5. **Rendre les commandes prévisibles :** contrôles natifs, libellés, clavier, cibles de 44 px et focus de 3 px.
6. **Limiter le mouvement :** transitions brèves ; messages écrits et statiques en mouvement réduit.

## Palette et contrastes

[`tokens.json`](tokens.json) porte les valeurs. Régénérer le CSS après modification :

```sh
node design/scripts/build-tokens.mjs
node design/scripts/build-tokens.mjs --check
node design/scripts/check-contrast.mjs
```

Les composants consomment les variables sémantiques `--st-`. Les valeurs
`--st-palette-*` servent aux replis des hôtes. Fond/surface clairs :
`#f5f2eb` / `#fffdf8` ; sombres : `#13252c` / `#1a3038`.

| Rôle et fond | Encre claire | Rapport | Encre sombre | Rapport |
| --- | --- | ---: | --- | ---: |
| Texte / fond | `#172d38` | 12,79 | `#f2f2e9` | 14,04 |
| Texte secondaire / fond | `#52646b` | 5,53 | `#b2c4c7` | 8,74 |
| Accent / fond | `#176b60` | 5,68 | `#8bd5c4` | 9,34 |
| Accent 2 / fond | `#85531c` | 5,78 | `#edc184` | 9,45 |
| Texte du bouton principal / accent | `#fffdf8` | 6,24 | `#13252c` | 9,34 |
| Réussite / success-soft | `#25654a` | 5,73 | `#a2d8b7` | 7,18 |
| Avertissement / warning-soft | `#85531c` | 5,25 | `#edc184` | 7,09 |
| Erreur / danger-soft | `#a33c31` | 5,21 | `#ffb4a6` | 7,18 |
| Information / info-soft | `#245e86` | 5,86 | `#a9d1ef` | 7,11 |
| Focus / surface | `#21688e` | 6,01 | `#b4dcfa` | 9,55 |
| Bordure essentielle / surface | `#748184` | 3,96 | `#829b9e` | 4,68 |

Rapports en *n*:1. Texte courant : au moins 4,5:1 ; interface essentielle et
grands caractères : 3:1. « Grand » signifie 24 px CSS en romain, ou environ
18,67 px en gras. Le script compare les valeurs non arrondies de toutes les
paires déclarées. Les champs utilisent `border-strong` ; `border` est
décoratif. L'ocre initial `#b87927` reste décoratif ; le texte utilise sa
variante sombre `accent-2`. Ne pas réduire l'opacité du texte sémantique.

| Classe de clé | Famille | Signification |
| --- | --- | --- |
| `ungraded` | Ardoise | Introduction, concept, point de confiance |
| `author_keyed` | Ocre | Quiz ou défaut à repérer ; livre ouvert en auto-apprentissage |
| `production` | Bleu | Raisonnement/communication ; préciser modèle ou mots-clés |
| `externally_grounded` | Vert | Reproduction avec résultat de référence exécuté |

Une classe n'est pas un verdict. Les **types de nœuds** sont concept (cercle) et
tâche (carré arrondi). Maîtrisé (coche) et à réviser (horloge) sont des **états**
qui conservent la forme du nœud.

## Typographie, espace et mouvement

- **Titres :** Georgia, Iowan Old Style, Palatino Linotype, Book Antiqua, serif.
  **Texte :** Avenir Next, Avenir, Segoe UI, system-ui, sans-serif.
  **Chasse fixe :** ui-monospace, SFMono-Regular, Consolas, Liberation Mono,
  monospace, pour identifiants et valeurs. Toutes les polices sont locales.
- **Échelle :** 12/14/16/18/22/28/36/48/72 px pour une racine de 16 px. Corps
  16 px, interface secondaire 14 px, libellés compacts 12 px. Interligne 1,6 ;
  titres 1,15–1,35.
- **Espacement :** base de 4 px ; 8/12 dans les contrôles, 16/24 dans les groupes,
  32/48/64 entre sections. Texte jusqu'à 65ch, panneau jusqu'à 46rem. Les groupes
  reviennent à la ligne sur petit écran.
- **Formes :** rayons de 4/8/16 px, capsules pour libellés courts, traits fins,
  fonds pâles. Réserver les ombres aux surfaces surélevées.
- **Mouvement :** 120/180/240 ms, `cubic-bezier(0.2, 0, 0, 1)`.
  `prefers-reduced-motion: reduce` retire transitions, animations et défilement
  fluide dans `.st-scope`. Le chargement reste nommé par écrit.

## Intégration par surface

| Surface | Utilisation |
| --- | --- |
| Panneaux VS Code | Charger `tokens.css`, `components.css`, puis `vscode-bridge.css`. Mettre `.st-scope` sur le corps et conserver la classe `vscode-*` de l'hôte. Aucun `data-theme` sur les descendants. Fonds, textes, champs, boutons et focus de l'éditeur priment ; la marque fournit les replis. |
| Tableau de bord / Observatory | Charger `tokens.css` et `components.css`, puis appliquer `.st-scope`. À la racine, `data-theme="light"` ou `"dark"` force le thème ; son absence suit le système. |
| Documentation | Employer `docs/assets/brand/`, `hero-*.svg` et `docs/assets/diagrams/`. Le suffixe indique le fond prévu. Utiliser `picture` avec source conditionnée au thème sombre et repli clair, lorsque possible, et un texte alternatif adapté. |

Le pont distingue le couple fond/texte des boutons de la couleur des liens.
Les thèmes à contraste élevé conservent bordures, focus, mots et formes de
l'hôte. Le rapport couvre les palettes livrées ; un thème personnalisé se
vérifie dans son hôte réel. Le texte des pastilles et des titres de verdict
utilise `--st-text` ; leur encre de statut ne peint que la bordure et le symbole,
car une couleur de statut de l'hôte peut rester sous 4,5:1 en texte (l'encre
d'avertissement de VS Code Light Modern donne 3,11:1 sur blanc). Le pont remet
aussi `--st-tracking-display` à `normal`, la police d'affichage devenant celle de
l'interface de l'éditeur. Le coordinateur reste responsable du raccordement
aux applications existantes.

## Icônes et composants

Le **S en chemin** relie trois nœuds. Utiliser le dessin couleur sur fond clair,
le bloc-marque adapté au thème, et la version mono `currentColor` dans la barre
d'activité ou en SVG intégré. Garder 4 unités libres autour du viewBox de 24
unités. Ne pas étirer, tourner ou ornementer. Le PNG de 256 px est prêt pour le
VSIX. Voir les [notes de marque](../docs/assets/brand/README.md) et les
[sources des diagrammes](../docs/assets/diagrams/README.md).

Reprendre les groupes radio libellés, textarea, confiance de 0 à 4,
`details`, `meter` et boutons du catalogue. La progression expose le numéro
d'étape. Annoncer le nouveau retour dans une seule région de statut polie ;
réserver les alertes aux nouvelles erreurs urgentes. Une notification se ferme
et rend le focus. L'application fournit progression, verdict, maîtrise, échéance
et `authoring.notice` ; le catalogue n'évalue ni n'enregistre de réponse.
Le retour par mots-clés porte une bordure en tirets, ≈ et **Not certified**.

| À faire | À éviter |
| --- | --- |
| Expliquer l'action suivante simplement | Exposer le corrigé ou les mécanismes internes du juge |
| Montrer l'origine de la leçon et de l'évaluation | Assimiler complétion ou mots-clés à la maîtrise |
| Une action principale et des statuts libellés | Colorer chaque conteneur ou compter uniquement sur la couleur |
| Conserver couleurs et focus de l'éditeur | Recouvrir le thème de l'utilisateur |
| Nommer les états vide/chargement/erreur | Un panneau silencieux ou du mouvement sans message |

[Preuves de vérification et limites](evidence/verification.md).
