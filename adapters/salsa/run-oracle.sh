#!/usr/bin/env bash
# M4B.2: builds the oracle against the pinned Salsa, with the locked dependencies, writes the
# environment journal, and runs the directed and generated corpora twice.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/env.sh"
OUT="$ROOT/.cache/salsa-oracle"
mkdir -p "$OUT"
CARGO=("$RUSTUP" run "$RUSTUP_TOOLCHAIN" cargo)
cd "$HERE/oracle"
[ -f Cargo.lock ] || "${CARGO[@]}" generate-lockfile
"${CARGO[@]}" fetch --locked
"${CARGO[@]}" build --release --locked --offline 2>&1 | tail -3
BIN="$CARGO_TARGET_DIR/release/salsa-oracle.exe"
{
  echo "git HEAD: $(git -C "$SALSA_REPO" rev-parse HEAD)"
  "$RUSTUP" run "$RUSTUP_TOOLCHAIN" rustc -Vv
  "${CARGO[@]}" -V
  "$RUSTUP" show active-toolchain
  echo "Cargo.lock sha256: $(sha256sum Cargo.lock | cut -d' ' -f1)"
  echo "salsa rlib sha256: $(sha256sum "$CARGO_TARGET_DIR"/release/deps/libsalsa-*.rlib | cut -c1-64 | tr '\n' ' ')"
  echo "oracle sha256: $(sha256sum "$BIN" | cut -d' ' -f1)"
} | tee "$OUT/journal.txt"
cd "$ROOT"
node adapters/salsa/generate.mjs 3000 "$OUT/generated-programs.json" 1
node adapters/salsa/generate.mjs 3000 "$OUT/holdout-programs.json" 3001
for run in a b; do
  "$BIN" adapters/salsa/programs/directed.json "$OUT/directed-$run.json"
  "$BIN" "$OUT/generated-programs.json" "$OUT/generated-$run.json"
  "$BIN" "$OUT/holdout-programs.json" "$OUT/holdout-$run.json"
done
npx tsc --noEmit --allowImportingTsExtensions --erasableSyntaxOnly --strict --noUncheckedIndexedAccess --skipLibCheck --target ES2023 --module ESNext --moduleResolution bundler --types node adapters/salsa/compare.ts
echo "TSC=$?"
for v in b1 b4; do
  for c in directed generated holdout; do
    p="$OUT/$c-programs.json"; [ $c = directed ] && p=adapters/salsa/programs/directed.json
    SALSA_VARIANT=$v node adapters/salsa/compare.ts "$p" "$OUT/$c-a.json" "$OUT/$c-b.json" | cut -c1-900
  done
done
