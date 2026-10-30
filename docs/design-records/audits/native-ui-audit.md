# Audit de l’interface native

## État actuel : lancement isolé bloqué

Ne lancez pas encore le binaire Tauri pour un audit avec des données temporaires.
Le fichier SQLite et sa clé ne partagent pas la même portée :

1. `src/lib.rs` choisit le répertoire de données puis appelle
   `storage::open_or_init`.
2. `storage::open_or_init` place `studium.sqlite` dans ce répertoire.
3. Avant d’ouvrir ce fichier, la fonction charge ou crée une clé dans le
   trousseau avec l’identité globale
   `("test.studium.runtime", "sqlcipher-db-key")`.
4. Le répertoire de données ne participe pas à cette identité.

Un override `STUDIUM_DATA_DIR` isolerait donc le fichier SQLite, mais
consulterait encore l’entrée réelle du trousseau et pourrait la créer si elle
n’existe pas. Aucun secret n’a été lu pendant ce préflight.

La bibliothèque de bundles est déjà isolable séparément avec
`STUDIUM_BUNDLES_DIR`. Le répertoire préparé pour ce contrôle est :

- données : `/tmp/studium-native-audit-0Br3WY/data`
- bundles : `/tmp/studium-native-audit-0Br3WY/bundles`
- bundle : `demo-atomistique-bundle.zip`

La copie du bundle a le même SHA-256 que la fixture :
`a5e43386fbe652f3a22e38974519f8f86e9893a11f6484a0bc88001e6b26ded6`.

## Décision requise

Il faut définir la portée et le cycle de vie de la clé d’un audit avant
d’ajouter l’override de données : entrée de trousseau distincte par répertoire,
identité d’audit explicite, ou clé éphémère. Cette décision touche la politique
de clés et ne peut pas être déduite du seul chemin de données.

Après cette décision et son implémentation, la commande prévue avec le serveur
Vite déjà actif sera :

```bash
STUDIUM_DATA_DIR=/tmp/studium-native-audit-0Br3WY/data \
STUDIUM_BUNDLES_DIR=/tmp/studium-native-audit-0Br3WY/bundles \
pnpm --filter @studium/student-runtime exec tauri dev \
  --config '{"build":{"beforeDevCommand":null,"devUrl":"http://127.0.0.1:5186"}}'
```

Cette commande est un gabarit bloqué, pas une commande sûre avec le code
actuel. Le binaire de développement produit par Cargo se trouve à
`apps/student-runtime/src-tauri/target/debug/student-runtime`.
