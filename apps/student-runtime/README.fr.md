[English](README.md) · Français

# Application apprenant Studium (Tauri)

La première surface de l'apprenant : une application de bureau (Tauri 2 et React) qui joue un bundle de
leçon depuis une bibliothèque locale. Elle reste compilable mais n'évolue plus. Les nouveautés pour
l'apprenant vont dans le [panneau VS Code](../studium-vscode/README.fr.md) et dans le harnais
conversationnel ([`apps/lesson-mcp`](../lesson-mcp/README.fr.md)). Elle sera retirée dès que l'un des
deux couvrira l'apprenant sans IDE.

| | |
|---|---|
| Statut | **gelée** (décision D6) |
| Lancer | `pnpm --filter @studium/student-runtime tauri:dev` (demande une chaîne Rust) |
| Port | 1420 (serveur Vite dans la fenêtre de l'application) |
| Dépend de | [`@studium/lesson-session`](../../packages/lesson-session) et des paquets partagés du moteur |
| Appelle | rien sur le réseau |
| Tests | `pnpm --filter @studium/student-runtime test` |

## Ce qu'elle fait encore

- Joue un bundle de leçon (`.zip`) depuis une bibliothèque locale, avec le moteur partagé
  (`@studium/lesson-session`).
- Exécute les sept types de scène qu'elle implémente. Les six types d'apprentissage actif
  (`spot_the_flaw`, `explain_back`, `comparison`, `summary_audit`, `prompt_practice`,
  `communication_sim`) affichent une carte qui nomme la scène et laisse continuer ; ils ne se jouent que
  dans le panneau VS Code (`UNSUPPORTED_ON_WEB` dans
  [`src/components/scenes/SceneRouter.tsx`](src/components/scenes/SceneRouter.tsx)).

## Ce qu'elle ne fait pas

- Elle n'affiche pas l'avis d'autorat des leçons d'auto-apprentissage (`metadata.authoring`) : un bundle
  d'auto-apprentissage joué ici perd son avis d'honnêteté. Utilisez le panneau VS Code ou le harnais.
- Pas de gestion de la langue : les textes de l'interface sont fixés dans le code.
- Les bundles en dossier ne sont pas lus, seulement les `.zip`.

## Configuration

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `STUDIUM_BUNDLES_DIR` | `<cwd>/bundles` | dossier de la bibliothèque de bundles `.zip` |
| `TAURI_DEV_HOST` | non défini | hôte du serveur Vite pour développer depuis un autre appareil |
| `STUDIUM_RUNTIME_BIN` | `src-tauri/target/release/student-runtime` | binaire utilisé par les tests WebdriverIO |

## Développer et construire

```bash
pnpm --filter @studium/student-runtime test       # tests unitaires
pnpm --filter @studium/student-runtime tauri:dev  # demande une chaîne Rust
```

La CI ne construit plus cette application à chaque push. Les jobs `tauri-build` et `demo-m6` ne se
lancent qu'à la main (*Actions > CI > Run workflow*) ; ne comptez pas sur leur état.
