#!/usr/bin/env bash
# Repeats the physical measurements in fresh processes, one at a time, so that a result is a
# distribution over runs and not one lucky process. Each process is held on the two performance
# cores of this 2P+8E machine (mask 0xF). Windows 10 has no Thread Director, and without the mask a
# long run lands on either core type. The order of representations rotates with the run.
#   bash adapters/m5/repeat.sh [runs] [mask]
set -u
RUNS="${1:-10}"
MASK="${2:-F}"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../salsa/env.sh"
export CARGO_TARGET_DIR="$ROOT/.cache/m5/target"
OUT="$ROOT/.cache/m5/runs"
mkdir -p "$OUT"
cd "$HERE/harness"
if ! BUILD="$("$RUSTUP" run "$RUSTUP_TOOLCHAIN" cargo build --release 2>&1)"; then
  # A failed build must stop here: the old binary would otherwise be measured as if it were new.
  echo "$BUILD" | grep -E '^error' -A8 | head -40
  exit 1
fi
cd "$ROOT"
BIN="$(cygpath -w "$CARGO_TARGET_DIR/release/m5-harness.exe")"
NODE="$(cygpath -w "$(command -v node)")"
OUTW="$(cygpath -w "$OUT")"
pinned() { MSYS_NO_PATHCONV=1 cmd.exe /c start "" /b /wait /affinity "$MASK" "$@"; }
# A run counts only if it wrote its own result after this campaign began.
touch "$OUT/.started"
fresh() { [ "$1" -nt "$OUT/.started" ] || { echo "no fresh result: $1"; exit 1; }; }
"$BIN" .cache/m5/tapes dump
for i in $(seq 1 "$RUNS"); do
  M5_ROTATE="$i" pinned "$BIN" .cache/m5/tapes "$OUTW\\rust-$i.json" > "$OUT/rust-$i.txt" 2>&1
  fresh "$OUT/rust-$i.json"
  echo "rust run $i done"
done
for i in $(seq 1 "$RUNS"); do
  M5_ROTATE="$i" pinned "$NODE" --expose-gc --max-old-space-size=12000 adapters/m5/js-dense.mjs .cache/m5/tapes "$OUTW\\js-$i.json" > "$OUT/js-$i.txt" 2>&1
  fresh "$OUT/js-$i.json"
  echo "js run $i done"
done
{
  echo "rustc: $("$RUSTUP" run "$RUSTUP_TOOLCHAIN" rustc -V)"
  echo "node: $(node -v)"
  echo "cpu: $(powershell.exe -NoProfile -Command '(Get-CimInstance Win32_Processor).Name' | tr -d '\r')"
  echo "memory_gb: $(powershell.exe -NoProfile -Command '[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)' | tr -d '\r')"
  echo "os: $(powershell.exe -NoProfile -Command '$o = Get-CimInstance Win32_OperatingSystem; $o.Caption + " " + $o.Version' | tr -d '\r')"
  echo "affinity_mask: 0x$MASK"
  echo "runs: $RUNS"
  echo "power_plan: balanced, AC"
} > "$OUT/environment.txt"
cat "$OUT/environment.txt"
