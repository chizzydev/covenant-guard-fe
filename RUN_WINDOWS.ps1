# P07-R2 authoritative entrypoint. Never reports PASS after baseline-only execution.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Results = Join-Path $Root 'results'
New-Item -ItemType Directory -Path $Results -Force | Out-Null
$DispatchLog = Join-Path $Results 'P07_DISPATCH_LOG.txt'
Set-Content -LiteralPath $DispatchLog -Encoding utf8 -Value '=== COVENANT GUARD P07-R2 DISPATCH ==='
function Mark([string]$Line) {
    Write-Host $Line
    Add-Content -LiteralPath $DispatchLog -Encoding utf8 -Value $Line
}
try {
    Mark 'ADMIN_REQUIRED=NO'
    Mark 'PUBLIC_CHAIN=NO'
    Mark 'REAL_FUNDS=NONE'
    Mark 'PUBLIC_GITHUB_MUTATION=NONE'
    Mark 'P07_DISPATCH_BASELINE_FIRST=YES'
    $Baseline = Join-Path $Root 'RUN_BASELINE_P08_WINDOWS.ps1'
    $Assurance = Join-Path $Root 'RUN_P07_WINDOWS.ps1'
    if (-not (Test-Path -LiteralPath $Baseline) -or -not (Test-Path -LiteralPath $Assurance)) {
        throw 'P07_RUNNER_FILE_MISSING'
    }
    Mark 'STAGE=P07_P06_R4_BASELINE_FULL_REPLAY'
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $Baseline
    if ($LASTEXITCODE -ne 0) { throw "P07_BASELINE_REPLAY_FAILED=$LASTEXITCODE" }
    $P06Log = Join-Path $Results 'P06_RUN_LOG.txt'
    if (-not (Test-Path -LiteralPath $P06Log)) { throw 'P07_BASELINE_LOG_MISSING' }
    $P06Text = Get-Content -LiteralPath $P06Log -Raw -Encoding utf8
    foreach ($Marker in @('P06_FE_98_TESTS=PASS','P06_NODE_45_TESTS=PASS',
            'P06_MASTER_FLAGSHIP_CUTOVER=PASS','P06_R4_GATE=PASS')) {
        if (-not $P06Text.Contains($Marker)) { throw "P07_BASELINE_MARKER_MISSING=$Marker" }
    }
    Mark 'P07_P06_R4_BASELINE_FULL_REPLAY=PASS'
    Mark 'STAGE=P07_INDEPENDENT_ASSURANCE'
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $Assurance
    if ($LASTEXITCODE -ne 0) { throw "P07_ASSURANCE_EXECUTION_FAILED=$LASTEXITCODE" }
    $P07Log = Join-Path $Results 'P07_RUN_LOG.txt'
    $Manifest = Join-Path $Results 'p07/P07_RUN_MANIFEST.json'
    if (-not (Test-Path -LiteralPath $P07Log)) { throw 'P07_ASSURANCE_LOG_MISSING' }
    $P07Text = Get-Content -LiteralPath $P07Log -Raw -Encoding utf8
    foreach ($Marker in @('P07_PYTHON_15_ORACLE_TESTS=PASS',
        'P07_EVM_DIFFERENTIAL_TESTS=5','P07_MUTANTS_COMPILED=8',
        'P07_COMPILED_MUTANT_EVM_DETECTION_TESTS=8','P07_EVIDENCE_MANIFEST=PASS',
        'P07_R2_GATE=PASS')) {
        if (-not $P07Text.Contains($Marker)) { throw "P07_ASSURANCE_MARKER_MISSING=$Marker" }
    }
    if (-not (Test-Path -LiteralPath $Manifest)) { throw 'P07_FINAL_EVIDENCE_MANIFEST_MISSING' }
    $Evidence = Get-Content -LiteralPath $Manifest -Raw -Encoding utf8 | ConvertFrom-Json
    if ($Evidence.results.fe -ne 98 -or $Evidence.results.baselineNode -ne 45 -or
        $Evidence.results.pythonModelUnit -ne 15 -or
        $Evidence.results.seededTransactions -ne 300 -or
        $Evidence.results.actorSelectorPhaseCases -ne 72 -or
        $Evidence.results.finitePreviewCases -ne 432 -or
        $Evidence.results.compiledMutants -ne 8 -or
        $Evidence.results.killedMutants -ne 8) {
        throw 'P07_FINAL_EVIDENCE_MANIFEST_COUNTS_WRONG'
    }
    Mark 'P07_FINAL_EVIDENCE_COUNTS=PASS'
    Mark 'P07_R2_GATE=PASS'
    Mark 'COVENANT_P07_R2_EXECUTION=PASS'
    Mark "REPORT_PATH=$DispatchLog"
} catch {
    Mark 'P07_R2_GATE=FAIL'
    Mark "ERROR=$($_.Exception.Message)"
    Mark "REPORT_PATH=$DispatchLog"
    exit 1
}
