# Builds the oracle against WindowsBase from the pinned commit, and runs a program file.
#   powershell -File adapters/wpf/run-oracle.ps1 [programs.json] [output.json]
param(
  [string]$Programs = "$PSScriptRoot\programs\directed.json",
  [string]$Output = "$PSScriptRoot\..\..\.cache\wpf-oracle\directed.json"
)
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$R = "$root\.cache\wpf-49ae5cd-repo"
$env:DOTNET_ROOT = "$R\.dotnet"
$env:DOTNET_MULTILEVEL_LOOKUP = "0"
$env:DOTNET_CLI_HOME = "$R\.dotnet-home"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_NOLOGO = "1"
$env:NUGET_PACKAGES = "$R\.packages"
$artifacts = "$root\.cache\wpf-oracle"
New-Item -ItemType Directory -Force $artifacts | Out-Null
# This alpha SDK caps NETCoreAppMaximumVersion at 11.0 though it carries 12.0 packs.
# The WPF build lifts the cap the same way, through Arcade.
& "$R\.dotnet\dotnet.exe" build "$PSScriptRoot\oracle\Oracle.csproj" -c Release -v:quiet -nologo --artifacts-path $artifacts -p:NETCoreAppMaximumVersion=12.0 -p:LoadPrunePackageDataFromNearestFramework=true
if ($LASTEXITCODE -ne 0) { "ORACLE BUILD FAILED"; exit 1 }
& "$R\.dotnet\dotnet.exe" "$artifacts\bin\Oracle\release\Oracle.dll" $Programs $Output
"ORACLE EXIT=$LASTEXITCODE"
