#requires -Version 7.0
# Covenant Guard CI R1 — creates a NEW, public repository and pushes one
# prevalidated source-only commit. Never overwrites an existing repository.
[CmdletBinding()]
param(
    [string]$Repository = 'chizzydev/covenant-guard-fe'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Run([string]$Tool, [string[]]$Arguments) {
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "COMMAND_FAILED: $Tool $($Arguments -join ' ') EXIT=$LASTEXITCODE"
    }
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Write-Host '=== COVENANT GUARD P08 PUBLIC GITHUB CI PUBLICATION ==='
Write-Host 'PUBLIC_CHAIN=NO'
Write-Host 'REAL_FUNDS=NONE'
Write-Host 'REPO_VISIBILITY=PUBLIC'
Write-Host "TARGET_REPOSITORY=$Repository"

if ($Repository -ne 'chizzydev/covenant-guard-fe') {
    throw 'UNREVIEWED_REPOSITORY_OVERRIDE_DENIED'
}
foreach ($Tool in @('git','gh','node')) {
    if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) {
        throw "REQUIRED_TOOL_MISSING=$Tool (install GitHub CLI from https://cli.github.com if gh is missing)"
    }
}

& gh auth status
if ($LASTEXITCODE -ne 0) {
    throw 'GITHUB_LOGIN_REQUIRED: run gh auth login --web'
}
$Login = (& gh api user --jq '.login' 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $Login -ne 'chizzydev') {
    throw "WRONG_GITHUB_IDENTITY=$Login"
}
$UserID = (& gh api user --jq '.id' 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $UserID -notmatch '^\d+$') {
    throw 'GITHUB_ACCOUNT_ID_UNAVAILABLE'
}
Write-Host "GITHUB_OWNER_VERIFIED=$Login"

# Check before any mutation. All approved files must match the source manifest.
Run 'node' @('p08/ci-source-inventory.mjs')
Run 'node' @('scripts/p06_verify.mjs')
Run 'node' @('scripts/p06_r4_verify.mjs')
Run 'node' @('p07/verify-source.mjs')
Write-Host 'PREPUBLICATION_SOURCE_INTEGRITY=PASS'

if (Test-Path -LiteralPath (Join-Path $Root '.git')) {
    throw 'LOCAL_GIT_ALREADY_EXISTS: refuse to overwrite or republish'
}
# Error from `gh repo view` means the repo is absent *or* inaccessible. Auth
# was verified, but a masked/inaccessible target still requires caution.
$Exists = & gh repo view $Repository --json name --jq '.name' 2>$null
if ($LASTEXITCODE -eq 0 -and $Exists) {
    throw "REMOTE_REPOSITORY_ALREADY_EXISTS=${Repository}: will not overwrite"
}
Write-Host 'REMOTE_TARGET=NOT_VISIBLE; creating only a new repository'

Run 'git' @('init','-b','main')
Run 'git' @('add','--all')
# Verify staged inventory exactly; .gitignore may suppress local generated files.
$Staged = @(& git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'GIT_STAGED_INVENTORY_QUERY_FAILED' }
$Manifest = Get-Content (Join-Path $Root 'MANIFEST_SHA256.txt') |
    ForEach-Object { ($_ -split '  ',2)[1] }
$ExpectedFiles = @($Manifest) + @('MANIFEST_SHA256.txt')
$Missing = @($ExpectedFiles | Where-Object { $_ -notin $Staged })
$Unexpected = @($Staged | Where-Object { $_ -notin $ExpectedFiles })
if ($Missing.Count -ne 0 -or $Unexpected.Count -ne 0) {
    throw "STAGED_SOURCE_INVENTORY_MISMATCH MISSING=$($Missing -join ',') UNEXPECTED=$($Unexpected -join ',')"
}
Write-Host "STAGED_FILES=$($Staged.Count)"
Write-Host 'GIT_SOURCE_ONLY_STAGE=PASS'

# Temporary per-command identity; no changes to global Git configuration.
$Email = "$UserID+$Login@users.noreply.github.com"
Run 'git' @('-c',"user.name=$Login",'-c',"user.email=$Email",'commit','-m','CI: publish P08 proven Fe sources and gated GitHub Actions')
$Commit = (& git rev-parse HEAD | Out-String).Trim()
Write-Host "LOCAL_COMMIT=$Commit"

Run 'gh' @('repo','create',$Repository,'--public','--source',$Root,'--remote','origin','--push',
    '--description','Covenant Guard: Fe-native persistent transition protection with reproducible EVM security evidence')
Write-Host "PUBLIC_REPOSITORY=https://github.com/$Repository"
Write-Host "PUBLISHED_COMMIT=$Commit"
Write-Host 'P08_GITHUB_SOURCE_PUBLISHED=PASS'
Write-Host 'P08_PUBLIC_GITHUB_CI_GATE=AWAITING_GITHUB_ACTIONS_RUN'
Write-Host "GITHUB_ACTIONS_URL=https://github.com/$Repository/actions/workflows/covenant-guard-verify.yml"
Write-Host ''
Write-Host "Next: gh run list --repo $Repository --workflow covenant-guard-verify.yml --limit 5"
Write-Host "Then: gh run watch <RUN_ID> --repo $Repository --exit-status"
