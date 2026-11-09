#!/usr/bin/env bash
# M4A.2: prepares the frozen WPF tree and its toolchain inside .cache. Idempotent.
# Nothing is installed outside the clone.
#
# Deviations from the repository's own bootstrap, all forced by this machine:
#   - builds.dotnet.microsoft.com is unreachable, so archives come from ci.dot.net, the
#     feed eng/common/tools.ps1 itself names. No checksum is published there, so the
#     SHA-512 of each archive is printed instead.
#   - .tools/native is absent. Perl is needed only by GenTraceStrings.pl, which generates
#     trace message strings, so Git's Perl stands in for the pinned Strawberry Perl.
set -eu
SHA=49ae5cd6e0ba39eb9d54b93e35af6a0bfe0b7d51
SDK=12.0.100-alpha.1.26480.102          # global.json, tools.dotnet
RUNTIME=12.0.0-alpha.1.26551.101        # eng/Version.Details.props, MicrosoftNETCoreAppRefVersion
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
R="$ROOT/.cache/wpf-49ae5cd-repo"
DL="$ROOT/.cache/wpf-sdk-download"
mkdir -p "$R" "$DL"

if [ ! -d "$R/.git" ]; then
  git -C "$R" init -q
  git -C "$R" config core.longpaths true
  git -C "$R" config core.autocrlf false
  git -C "$R" remote add origin https://github.com/dotnet/wpf.git
  git -C "$R" fetch -q --depth 1 origin "$SHA"
  git -C "$R" checkout -q FETCH_HEAD
fi
[ "$(git -C "$R" rev-parse HEAD)" = "$SHA" ] || { echo "wrong commit"; exit 1; }

fetch() { # url
  local file="$DL/${1##*/}"
  [ -s "$file" ] || curl -sSfL --retry 3 -o "$file" "$1"
  echo "$(sha512sum "$file" | cut -d' ' -f1)  ${1##*/}"
  /c/Windows/System32/tar.exe -xf "$file" -C "$R/.dotnet"
}

mkdir -p "$R/.dotnet"
[ -d "$R/.dotnet/sdk/$SDK" ] || fetch "https://ci.dot.net/public/Sdk/$SDK/dotnet-sdk-$SDK-win-x64.zip"
[ -d "$R/.dotnet/shared/Microsoft.NETCore.App/$RUNTIME" ] || fetch "https://ci.dot.net/public/Runtime/$RUNTIME/dotnet-runtime-$RUNTIME-win-x64.zip"

PERL_SHIM="$R/.tools/native/bin/strawberry-perl/5.38.0.1/portableshell.bat"
mkdir -p "$(dirname "$PERL_SHIM")"
printf '@"%s" %%*\r\n' "$(cygpath -w /usr/bin/perl.exe)" > "$PERL_SHIM"

ls "$R/.dotnet/shared/Microsoft.NETCore.App"
echo "clone status:"; git -C "$R" status --short
