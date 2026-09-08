#!/usr/bin/env bash
# Test pour tools/bundle_lint.mjs — chaque check doit VRAIMENT attraper son defaut.
# Casse deliberement un fixture sain (copie temporaire) et verifie que le lint sort en erreur
# avec le bon message, puis que les fixtures du repo passent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$ROOT/tools/bundle_lint.mjs"
BASE="$ROOT/fixtures/capsule-run-demo/lesson.json"   # sain : ni quiz, ni claims, ni asset

TSX="$ROOT/node_modules/.pnpm/node_modules/.bin/tsx"
[ -x "$TSX" ] || TSX="$(command -v tsx || true)"
[ -n "$TSX" ] || { echo "FAIL: tsx introuvable — lancer pnpm install"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

test -f "$LINT" || { echo "FAIL: $LINT absent"; exit 1; }

# scenes injectables par les mutations ci-dessous
PRELUDE="\
const quiz=(choices)=>({id:'s-q',type:'quiz',title:'Q',objective_refs:[],concept_refs:['c-kinetics'],\
estimated_seconds:10,adaptation_hooks:[],question:'?',feedback_correct:'ok',feedback_incorrect:'non',hints:[],choices});\
const flaw=(model_correction)=>({id:'s-f',type:'spot_the_flaw',title:'F',objective_refs:[],concept_refs:['c-kinetics'],\
estimated_seconds:10,adaptation_hooks:[],flawed_content:'x',rubric:{completeness:0.6,evidence_quality:0.3,tone:0.1},\
claims:[{id:'c1',text:'t',flaws_expected:['hund']}],model_correction});"

# $1 = nom du bundle casse, $2 = corps JS mutant `b`
mutate() {
  node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));$PRELUDE$2;fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$BASE" "$TMP/$1"
}

# $1 = nom du bundle casse, $2 = fragment attendu dans la sortie
expect_fail() {
  local out
  if out=$("$TSX" "$LINT" "$TMP/$1" 2>&1); then
    echo "FAIL: $1 aurait du etre rejete"; echo "$out"; exit 1
  fi
  echo "$out" | grep -qi -- "$2" || { echo "FAIL: $1 — message attendu: '$2'"; echo "$out"; exit 1; }
}

# 1. bundle sain temporaire : le lint doit l'accepter (sinon les cas negatifs ne prouvent rien)
cp "$BASE" "$TMP/ok.json"
"$TSX" "$LINT" "$TMP/ok.json" >/dev/null || { echo "FAIL: un bundle sain est rejete"; exit 1; }

# 2. deux ids de scene identiques
mutate dup.json "b.scenes.push(JSON.parse(JSON.stringify(b.scenes[0])))"
expect_fail dup.json "duplicate scene id"

# 3. quiz a deux bonnes reponses / a zero bonne reponse
mutate two-correct.json "b.scenes.push(quiz([{id:'a',text:'A',correct:true},{id:'b',text:'B',correct:true}]))"
expect_fail two-correct.json "2 correct"
mutate no-correct.json "b.scenes.push(quiz([{id:'a',text:'A',correct:false},{id:'b',text:'B',correct:false}]))"
expect_fail no-correct.json "0 correct"

# 4. render asset dont le fichier n'existe pas
mutate missing-asset.json "b.scenes[0].render_assets=[{kind:'image',path:'assets/absent.png'}]"
expect_fail missing-asset.json "unresolved render asset"

# 5. render asset sans payload NI path (schema : rendu vide)
mutate blank-asset.json "b.scenes[0].render_assets=[{kind:'svg',title:'vide'}]"
expect_fail blank-asset.json "schema"

# 6. mot-cle de flaws_expected absent du model_correction
mutate orphan-flaw.json "b.scenes.push(flaw('rien a voir ici'))"
expect_fail orphan-flaw.json "model_correction"

# 7. le meme mot-cle present dans le model_correction passe (pas de faux positif)
mutate sound-flaw.json "b.scenes.push(flaw('la regle de Hund impose des spins paralleles'))"
"$TSX" "$LINT" "$TMP/sound-flaw.json" >/dev/null || { echo "FAIL: faux positif sur un flaw couvert"; exit 1; }

# 8. les fixtures du repo passent (le gate CI)
"$TSX" "$LINT" || { echo "FAIL: fixtures/**/lesson.json ne passent pas le lint"; exit 1; }

echo "OK: bundle_lint.mjs — 8 tests passent"
