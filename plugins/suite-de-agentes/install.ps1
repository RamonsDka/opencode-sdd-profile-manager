<#
.SYNOPSIS
Installs Suite de Agentes plugin for OpenCode.
.DESCRIPTION
Copies plugin files to ~/.config/opencode/plugins/suite-de-agentes, installs production dependencies, and registers the server and TUI plugins in OpenCode configuration.
#>
param(
    [switch]$DryRun,
    [switch]$Uninstall,
    [switch]$ReplaceAgentConfig,
    [string]$TargetDir = "",
    [string]$ConfigDir = "",
    [string]$AgentPermissions = "",
    [switch]$Help
)

if ($Help) {
    Write-Host "Suite de Agentes Installer (v1.1.0)"
    Write-Host "Usage: .\install.ps1 [-DryRun] [-Uninstall] [-ReplaceAgentConfig] [-TargetDir <path>] [-ConfigDir <path>] [-AgentPermissions recommended|prompt|none]"
    exit 0
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeScript = Join-Path $ScriptDir "scripts\installer.mjs"

# Check Node.js prerequisite
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error "Node.js (>= 22) is required to install Suite de Agentes, but was not found in PATH."
    exit 1
}

$argsList = @($NodeScript)
if ($DryRun) { $argsList += "--dry-run" }
if ($Uninstall) { $argsList += "--uninstall" }
if ($ReplaceAgentConfig) { $argsList += "--replace-agent-config" }
if ($TargetDir) { $argsList += "--target-dir"; $argsList += $TargetDir }
if ($ConfigDir) { $argsList += "--config-dir"; $argsList += $ConfigDir }
if ($AgentPermissions) { $argsList += "--agent-permissions"; $argsList += $AgentPermissions }
$argsList += "--source-dir"
$argsList += $ScriptDir

& node @argsList
exit $LASTEXITCODE
