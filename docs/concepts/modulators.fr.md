[English](modulators.md) · Français

# Modulateurs

Un *modulateur* nomme l'intention pédagogique d'une règle d'adaptation : la raison d'être de la règle. Quand une règle se déclenche, son modulateur est recopié sur la décision, si bien que `explain_last_adaptation`, le panneau VS Code et la télémétrie peuvent dire non seulement ce qui a changé, mais pourquoi. Trois modulateurs sont en vigueur : M1, M3 et M6. Cette page les définit, liste les identifiants retirés et montre comment s'en servir dans une leçon.

## Une étiquette, pas un interrupteur

Le moteur d'adaptation sélectionne les règles sur leur condition `when` et applique leur `action`. Il ne se branche jamais sur la valeur du modulateur ; il se contente de la transmettre. Un modulateur documente donc une règle, il ne choisit pas un comportement. La liste de référence est le registre [`modulators.ts`](../../packages/lesson-bundle-schema/src/modulators.ts).

Attention à une homonymie : ailleurs dans le projet, `M<n>` désigne aussi des jalons (par exemple « démo M6 »). Ce ne sont pas des modulateurs.

## Le registre

| Id | Nom | Statut | Ce qu'il fait |
|---|---|---|---|
| **M1** | rythme et routage selon la maîtrise | actif | Oriente selon la compétence démontrée : rejoue après des erreurs répétées sur un même concept, passe ou accélère quand la maîtrise est élevée, et saute dans le graphe les concepts déjà maîtrisés. |
| **M2** | (non attribué) | retiré | Aucun comportement. Il figurait dans une ancienne énumération, mais aucune règle ne l'a jamais porté. |
| **M3** | calibration métacognitive | actif | Quand la confiance déclarée s'écarte de la maîtrise mesurée, affiche le panneau de calibration pour que l'apprenant confronte son excès ou son manque de confiance. |
| **M4** | (historique) | retiré | Déclaré seulement dans l'ancien paquet `lesson-schema` ; jamais implémenté, jamais utilisé comme étiquette de règle. |
| **M5** | anti-délégation | retiré comme étiquette | Le recours aux indices réduit le crédit de maîtrise. Ce comportement est actif pour toute réponse, comme invariant du moteur, mais n'est pas émis comme valeur de modulateur. |
| **M6** | remédiation conditionnée par les prérequis | actif | Retient un concept derrière ses prérequis non acquis ; après des remédiations répétées, fait passer l'apprenant, sans retour, à un univers plus guidé. |

M7 et M8 n'ont jamais été définis comme modulateurs. D'anciens documents parlaient de huit modulateurs ; seuls les trois actifs ci-dessus font partie du système en fonctionnement.

## Utiliser les modulateurs dans une leçon

Un bundle ne peut étiqueter une règle qu'avec un modulateur actif, `M1`, `M3` ou `M6` ; le schéma rejette toute autre valeur, si bien que le code et la documentation ne peuvent pas diverger en silence. Une règle sans modulateur est valide et renvoie `null`.

Règles que vous rencontrerez dans les leçons d'exemple et dans le routage par le graphe :

| Identifiant de règle | Origine | Modulateur | Effet |
|---|---|---|---|
| `rule_2err_replay_concept` | règle du bundle | M1 | deux erreurs sur le concept : rejouer la scène avec un appui |
| `rule_mastery_high_skip` | règle du bundle | M1 | maîtrise élevée : passer au concept suivant |
| `rule_calibration_mismatch_show` | règle du bundle | M3 | confiance éloignée de la maîtrise : afficher le panneau de calibration |
| `graph_skip_mastered` | routage par le graphe | M1 | sauter un concept déjà maîtrisé |
| `graph_prereq_gate` | routage par le graphe | M6 | détour par un prérequis non acquis |
| `graph_universe_escalated` | routage par le graphe | M6 | passer à l'univers plus guidé après des remédiations répétées |

Une scène peut être rejouée au plus trois fois avant que la leçon n'avance : une règle de reprise ne peut pas enfermer un apprenant.

`experience_packet.py bundle` ajoute par défaut la règle de reprise après deux erreurs ; `--no-default-rules` l'omet.

## Décisions ouvertes

Le code ne tranche pas ces choix de nom et de périmètre ; ils reviennent aux auteurs de la pédagogie.

1. **Le nom de M6.** Dans le code, M6 est la remédiation conditionnée par les prérequis. Un texte antérieur l'appelait « explicabilité », ce que le code contredit : l'explicabilité est une fonction de l'interface, pas une règle étiquetée M6.
2. **M5.** Garder l'anti-délégation comme invariant du moteur, comme aujourd'hui, ou en faire une étiquette de modulateur visible sur les décisions qu'elle influence.
3. **M2 et M4.** Les laisser retirés, ou leur attribuer de vraies interventions.

## En un paragraphe

Les adaptations de Studium sont annotées par un petit vocabulaire de modulateurs, chacun nommant le principe qu'incarne une règle. Trois sont en vigueur : M1 (rythme et routage selon la maîtrise), M3 (calibration métacognitive) et M6 (remédiation conditionnée par les prérequis). Un quatrième principe, l'anti-délégation (le recours aux indices réduit le crédit de maîtrise), s'applique partout plutôt que d'être étiqueté décision par décision. Voir [Modèle de l'apprenant](learner-model.fr.md) et [Principes d'apprentissage](learning-principles.fr.md).
