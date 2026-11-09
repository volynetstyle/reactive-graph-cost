# Builds only WindowsBase from the pinned WPF commit, with the SDK that commit pins.
# Everything stays inside the clone: SDK, NuGet packages and dotnet's home directory.
#
# RunNetFrameworkApiCompat and RunRefApiCompat turn off two checks that compare the public
# surface with reference assemblies. They do not change the compiled code.
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$R = (Resolve-Path "$here\..\..\.cache\wpf-49ae5cd-repo").Path
$env:DOTNET_ROOT = "$R\.dotnet"
$env:DOTNET_MULTILEVEL_LOOKUP = "0"
$env:DOTNET_CLI_HOME = "$R\.dotnet-home"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_NOLOGO = "1"
$env:NUGET_PACKAGES = "$R\.packages"
$env:PATH = "$R\.dotnet;$env:PATH"
Set-Location $R
$ErrorActionPreference = "Continue"
& "$R\.dotnet\dotnet.exe" build "src\Microsoft.DotNet.Wpf\src\WindowsBase\WindowsBase.csproj" -c Release -p:Platform=x64 -p:RunNetFrameworkApiCompat=false -p:RunRefApiCompat=false -v:minimal -nologo *> "$R\windowsbase-build.log"
"EXIT=$LASTEXITCODE"
Get-Content "$R\windowsbase-build.log" -Tail 25
