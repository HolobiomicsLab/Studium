[English](classroom-workstations.md) · Français

# Postes de salle de TP

Cette page s'adresse à l'équipe informatique qui prépare les ordinateurs d'une salle d'enseignement, pour que
les étudiants ouvrent une leçon Studium dans VS Code sans terminal, sans Node et sans compte d'assistant IA.
Elle dit quoi installer, où mettre les leçons, quels réglages écrire, où la progression de chaque étudiant est
gardée et ce qui sort de la machine. Aucune salle n'a encore été préparée avec ces étapes : voir
[Limites](#limites).

## Avant de commencer

| Sur chaque poste | Nécessaire | Pourquoi |
|---|---|---|
| VS Code 1.95 ou plus récent | oui | il héberge le panneau de leçon |
| L'extension Studium | oui | elle embarque le serveur de leçons et les afficheurs, et les lance avec le moteur de VS Code lui-même |
| Un dossier de leçons | oui | l'extension ne contient que « Découvrir Studium », une démonstration de Studium lui-même (ci-dessous) |
| Node, un terminal, Git, Python | non | seulement pour construire des leçons avec un assistant, préparer des cours ou contribuer |
| Un compte d'assistant IA ou une clé d'API de modèle | non | le panneau joue une leçon sans aucun modèle |

Demandez à l'enseignant les dossiers de cours, chacun avec son `lesson.json`, ses ressources et, une fois
qu'il l'a approuvé, son `approval.json` (voir [Relire et approuver](../teach/review-and-approve.fr.md)). La
liste des cours dans VS Code dit si un enseignant a approuvé chaque leçon, et signale une leçon modifiée
depuis son approbation.

## 1. Installer l'extension

VS Code installe les extensions pour chaque compte utilisateur. Lancez cette commande une fois pour chaque
compte qu'utilisent les étudiants, par exemple depuis la préparation de l'image des machines ou un script
d'ouverture de session :

```bash
code --install-extension holobiomicslab.studium-vscode
```

Sans accès au Marketplace, téléchargez `studium-vX.Y.Z.vsix` depuis une
[version publiée sur GitHub](https://github.com/HolobiomicsLab/studium/releases), vérifiez-le avec le
`SHA256SUMS.txt` de cette version, puis installez-le avec `code --install-extension studium-vX.Y.Z.vsix`.
Open VSX propose la même extension pour VSCodium.

## 2. Mettre les leçons dans un dossier partagé

Copiez les dossiers de cours dans un dossier que tous les comptes étudiants peuvent lire, sur le disque local
ou sur un partage réseau, un sous-dossier par cours, au plus deux niveaux sous ce dossier. Les étudiants ne
font que le lire : le serveur de leçons n'écrit rien dans le dossier de leçons, et la progression va dans
l'espace propre à chaque compte (voir [Où la progression est gardée](#où-la-progression-est-gardée)). Le
dossier peut donc être en lecture seule.

## 3. Indiquer le dossier à l'extension

Écrivez ces réglages dans les réglages utilisateur de VS Code de chaque compte étudiant (`settings.json`) :

```json
{
  "studium.bundlesRoot": "/chemin/vers/les/lecons",
  "studium.bundleRef": "dossier-du-cours/lesson.json"
}
```

| Réglage | Effet |
|---|---|
| `studium.bundlesRoot` | le dossier que la vue **Leçons** liste et d'où les leçons sont lues |
| `studium.bundleRef` | la leçon qu'ouvre **Studium : Ouvrir une leçon**, relative à ce dossier |

Le fichier des réglages utilisateur est `~/Library/Application Support/Code/User/settings.json` sous macOS,
`~/.config/Code/User/settings.json` sous Linux et `%APPDATA%\Code\User\settings.json` sous Windows. Un
dossier que les étudiants ouvrent par **Fichier, Ouvrir le dossier** peut porter les mêmes lignes dans son
`.vscode/settings.json`, qui l'emportent. L'extension ne déclare aucun réglage que les stratégies
d'entreprise de VS Code peuvent fixer : utilisez les fichiers de réglages. Gardez `studium.assets` sur
`vendor`, `studium.telemetryConsent` désactivé et `studium.showMastery` désactivé, qui sont les valeurs
par défaut.

## 4. Ce que fait un étudiant

1. Ouvrir VS Code.
2. Sélectionner l'icône **Studium** dans la barre d'activité.
3. Sélectionner un cours dans la vue **Leçons**. Il s'ouvre dans un panneau, à sa première étape.

Un étudiant qui choisit un autre dossier avec **Studium : Choisir un cours** ne change que ses propres
réglages utilisateur, ou ceux du dossier qu'il a ouvert.

L'extension contient aussi « Découvrir Studium », une leçon de démonstration d'une dizaine de minutes sur le
fonctionnement de Studium et de son panneau (**Studium : Essayer la leçon de démonstration**, proposée aussi dans
la liste des cours, dans la langue d'affichage de VS Code). Elle sert pour une première séance en salle, avant le
cours. Un agent d'IA l'a rédigée à partir de la documentation de Studium et aucun enseignant ne l'a relue, comme
le dit son premier écran : relisez-la comme toute leçon avant de l'utiliser avec une classe. Elle reste à part du
dossier de cours et n'écrit aucun réglage.

## Où la progression est gardée

L'extension lance son propre serveur de leçons et lui donne comme dossier de données l'espace que VS Code
garde pour l'extension dans ce compte utilisateur (`globalStorage/holobiomicslab.studium-vscode` sous le
dossier utilisateur de VS Code). La progression et les dates de révision y sont gardées, jamais dans le
dossier de leçons ; les dossiers d'apprenants y sont nommés par un pseudonyme. Les cours auxquels un étudiant
a choisi de faire confiance et la dernière leçon ouverte sont gardés dans l'état que VS Code tient pour
l'extension, dans le même compte.

- Chaque compte utilisateur a sa propre progression. Des étudiants qui partagent un compte partagent un même
  dossier : donnez un compte à chaque étudiant, ou effacez le dossier entre deux séances.
- **Studium : Oublier mes données** efface tout cela pour ce compte, après confirmation. Supprimer le dossier
  `globalStorage/holobiomicslab.studium-vscode` à la fermeture de session efface la progression et les
  dates de révision.
- Avec des profils itinérants, le dossier suit le profil comme toute donnée utilisateur de VS Code ; cela n'a
  pas été essayé.

## Ce qui sort de la machine

| Quoi | Par défaut | Remarque |
|---|---|---|
| Appels à un modèle | aucun | l'extension n'appelle aucun modèle ; un modèle juge n'est utilisé que si `LITELLM_BASE_URL` est défini dans l'environnement d'où VS Code démarre, laissez-le donc vide |
| Télémétrie de classe | désactivée | `studium.telemetryConsent` ; activée, elle écrit des événements pseudonymisés dans le dossier de données local, rien n'est envoyé |
| Bibliothèques d'affichage (équations, graphiques, 3D) | locales | `studium.assets` = `vendor` ; `cdn` les chargerait depuis jsdelivr |
| Le trafic de VS Code lui-même (mises à jour, Marketplace, télémétrie) | selon la configuration | fixé par la configuration de VS Code de l'établissement, hors de Studium |

Une étape de reproduction lance une commande sur le poste, seulement après que l'étudiant a confirmé la
commande exacte. Une telle étape demande les logiciels que déclare sa capsule, Python par exemple ; pour une
salle qui ne les a pas, choisissez des cours sans étape de reproduction.

## Avec un assistant

Construire de nouvelles leçons dans la salle, avec Copilot dans VS Code ou un autre assistant, ajoute ce que
cette page évite : Node sur le poste, une commande par compte (voir
[Ajouter le serveur à votre assistant](installation.fr.md#ajouter-le-serveur-à-votre-assistant)) et un compte
chez le fournisseur de l'assistant pour chaque étudiant. Le panneau et un assistant gardent des progressions
séparées. Cela n'a pas été essayé en salle.

## Limites

- Aucune salle d'enseignement n'a été préparée avec ces étapes. Ce sur quoi elles reposent est dans le code
  et ses tests automatiques ; le serveur a aussi été vérifié seul, hors de VS Code, en jouant un cours depuis
  un dossier en lecture seule.
- Windows n'a pas été essayé de bout en bout.
- Le panneau ne donne pas de vue de classe. Un rapport de classe demande une télémétrie consentie, réunie dans
  un même dossier de données : voir [Suivre une classe](../teach/follow-a-class.fr.md).
- Signalez ce que vous rencontrez, avec la version et les étapes suivies :
  [Signaler un problème ou contribuer](report-and-contribute.fr.md).
