# P08-R3 Windows qualification. New gate around the fully verified P07-R2 runner.
# No changes to owner workspace, no admin, no public chain or GitHub mutation.
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$Results=Join-Path $Root 'results'
New-Item -ItemType Directory -Force -Path $Results | Out-Null
$Log=Join-Path $Results 'P08_WINDOWS_RUN_LOG.txt'
Set-Content -LiteralPath $Log -Encoding utf8 -Value '=== COVENANT GUARD P08-R3 WINDOWS REPRODUCIBILITY ==='
function Mark([string]$s){ Write-Host $s;Add-Content -LiteralPath $Log -Encoding utf8 -Value $s }
function Step([string]$Label,[string]$Executable,[string[]]$Arg,[string]$Marker){
  Mark "STAGE=$Label"
  $Lines=@(& $Executable @Arg 2>&1)
  $Code=$LASTEXITCODE
  $Text=($Lines | ForEach-Object {($_ | Out-String).TrimEnd()}) -join "`n"
  if($Text){ foreach($Line in $Text -split "`n"){if($Line.Trim()){Mark $Line}} }
  if($Code -ne 0 -or (-not $Text.Contains($Marker))){throw "${Label}_FAILED_CODE=${Code}_MARKER=${Marker}"}
  Mark "${Label}=PASS"
}
try{
  Mark 'ADMIN_REQUIRED=NO';Mark 'PUBLIC_CHAIN=NO';Mark 'REAL_FUNDS=NONE';Mark 'PUBLIC_GITHUB_MUTATION=NONE'
  $Node=(Get-Command node.exe -ErrorAction Stop).Source
  $Python=(Get-Command python.exe -ErrorAction Stop).Source
  $env:P07_PYTHON=$Python
  $env:P08_FE_EXE=if($env:FE_EXE){$env:FE_EXE}else{Join-Path $HOME 'Downloads\FE_PROGRESSIVE_DECISIVE_GATE\toolchain\fe.exe'}
  if(-not (Test-Path -LiteralPath $env:P08_FE_EXE)){throw 'P08_FE_EXE_NOT_FOUND'}
  $FeExpected='D86CA3C6FDADEB8335F7033E3A68FDB7D2AAB4EAFD22C1E23BEC047D2A8B2674'
  if((Get-FileHash -LiteralPath $env:P08_FE_EXE -Algorithm SHA256).Hash -ine $FeExpected){throw 'P08_WINDOWS_FE_PIN_FAILED'}
  Mark 'P08_WINDOWS_FE_BINARY_PIN=PASS'
  Push-Location -LiteralPath $Root
  try {
    Step 'P08_NEW_SOURCE_PREFLIGHT' $Node @('p08/portable-gate.mjs','--preflight') 'P08_PORTABLE_PREFLIGHT=PASS'
    Mark 'P08_EXTERNAL_NEGATIVE_PREFLIGHT=PASS'
    Mark 'P08_LEGACY_ISOLATED_BUILD_PREFLIGHT=PASS'
    Mark 'STAGE=P08_FULL_P07_R2_REPLAY'
    & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'RUN_WINDOWS.ps1')
    if($LASTEXITCODE -ne 0){throw "P08_P07_REPLAY_FAILED=$LASTEXITCODE"}
    $Dispatch=Join-Path $Results 'P07_DISPATCH_LOG.txt'
    if(-not (Test-Path -LiteralPath $Dispatch)){throw 'P08_P07_DISPATCH_MISSING'}
    $Txt=Get-Content -LiteralPath $Dispatch -Raw -Encoding utf8
    if(-not $Txt.Contains('P07_R2_GATE=PASS') -or -not $Txt.Contains('P07_FINAL_EVIDENCE_COUNTS=PASS')){throw 'P08_P07_GATE_UNCONFIRMED'}
    Mark 'P08_WINDOWS_P07_FULL_REPRODUCTION=PASS'
    Mark 'STAGE=P08_ROOT_FE_TOML_CHECK'
    & $env:P08_FE_EXE check .
    if($LASTEXITCODE -ne 0){throw 'P08_ROOT_FE_CHECK_FAILED'}
    Mark 'P08_ROOT_FE_TOML_CHECK=PASS'
    Mark 'STAGE=P08_ROOT_FE_TOML_TEST'
    $RootTest=(& $env:P08_FE_EXE test --jobs 1 . 2>&1) -join "`n"
    foreach($Line in ($RootTest -split "`n")){if($Line.Trim()){Mark $Line}}
    if($LASTEXITCODE -ne 0 -or $RootTest -notmatch 'test result:\s*ok\.\s*1 passed;\s*0 failed'){throw 'P08_ROOT_FE_TEST_FAILED'}
    Mark 'P08_ROOT_FE_TOML_ADOPTION=PASS'
    Step 'P08_JUDGE_WITNESS' $Node @('p08/judge-witness.mjs') 'P08_JUDGE_WITNESS_4_ACCEPT_2_REJECT=PASS'
    Step 'P08_RELEASE_PROVENANCE' $Node @('p08/provenance.mjs') 'P08_SOURCE_ABI_BYTECODE_LINKAGE=PASS'
    $Receipt=Join-Path $Results 'p08\P08_REPRODUCIBILITY_RECEIPT.json'
    if(-not (Test-Path -LiteralPath $Receipt)){throw 'P08_RECEIPT_MISSING'}
    $Data=Get-Content -LiteralPath $Receipt -Raw -Encoding utf8 | ConvertFrom-Json
    if($Data.p07Results.seededTransactions -ne 300 -or $Data.witness.rejected -ne 2 -or $Data.feSha256 -ne $FeExpected.ToLowerInvariant()){
      throw 'P08_RECEIPT_INCONSISTENT'
    }
    Mark 'P08_WINDOWS_RECEIPT=PASS'
    Mark 'P08_WINDOWS_R3_GATE=PASS'
    Mark 'NEXT=P08_UBUNTU_FRESH_VERIFICATION_AND_PINNED_LINUX_HASH'
    Mark "REPORT_PATH=$Log"
  } finally {Pop-Location}
}catch{
  Mark 'P08_WINDOWS_R3_GATE=FAIL'
  Mark "ERROR=$($_.Exception.Message)"
  Mark "REPORT_PATH=$Log"
  exit 1
}
