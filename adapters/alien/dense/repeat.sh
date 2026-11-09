#!/usr/bin/env bash
# M6 campaign: one fresh, pinned process per variant, workload and run.
#   bash adapters/alien/dense/repeat.sh [runs] [mask]
set -u
RUNS="${1:-10}"
MASK="${2:-F}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
node adapters/alien/dense/build.mjs || exit 1
OUT="$ROOT/.cache/m6/runs"
mkdir -p "$OUT"
OUTW="$(cygpath -w "$OUT")"
NODE="$(cygpath -w "$(command -v node)")"
pinned() { MSYS_NO_PATHCONV=1 cmd.exe /c start "" /b /wait /affinity "$MASK" "$@"; }
touch "$OUT/.started"
fresh() { [ "$1" -nt "$OUT/.started" ] || { echo "no fresh result: $1"; exit 1; }; }
one() { # variant workload run
  pinned "$NODE" --expose-gc adapters/alien/dense/bench.mjs "$1" "$2" "$OUTW\\$1-$2-$3.json" > /dev/null 2>&1
  fresh "$OUT/$1-$2-$3.json"
}
for i in $(seq 1 "$RUNS"); do
  for w in system propagate dynamic create app; do
    if [ $((i % 2)) -eq 0 ]; then one frozen "$w" "$i"; one dense "$w" "$i"; else one dense "$w" "$i"; one frozen "$w" "$i"; fi
  done
  echo "run $i done"
done
for w in system propagate dynamic create app; do one dense-counted "$w" 1; done
for i in $(seq 1 "$RUNS"); do
  for v in frozen dense; do
    pinned "$NODE" --expose-gc adapters/alien/dense/probes.mjs "$v" "$OUTW\\probe-$v-$i.json" > /dev/null 2>&1
    fresh "$OUT/probe-$v-$i.json"
  done
done
echo finished
