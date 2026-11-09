# Source this: every trace of the M4B toolchain stays inside .cache.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export SALSA_REPO="$ROOT/.cache/salsa-6d59529"
export RUSTUP_HOME="$ROOT/.cache/salsa-toolchain/rustup"
export CARGO_HOME="$ROOT/.cache/salsa-toolchain/cargo"
export CARGO_TARGET_DIR="$ROOT/.cache/salsa-oracle/target"
export RUSTUP_TOOLCHAIN=1.99-x86_64-pc-windows-gnullvm
export RUSTUP="/c/Users/User/.cargo/bin/rustup"
# Windows SDK is absent here, so the GNU target; its self-contained tools are not on PATH by default.
export PATH="$RUSTUP_HOME/toolchains/$RUSTUP_TOOLCHAIN/lib/rustlib/x86_64-pc-windows-gnullvm/bin/self-contained:$PATH"
export RUSTFLAGS="-Clinker=rust-lld -Clinker-flavor=ld.lld -Clink-self-contained=yes -Clink-arg=-mi386pep -Ctarget-feature=+crt-static"
