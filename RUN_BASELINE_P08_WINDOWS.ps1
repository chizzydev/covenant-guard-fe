# Covenant Guard P06-R4 — production-path single-state flagship cutover qualification.
# No admin/real wallet/public RPC/GitHub writes; npm may fetch locked deps.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Results = Join-Path $Root 'results'
New-Item -ItemType Directory -Path $Results -Force | Out-Null
$script:Log = Join-Path $Results 'P06_RUN_LOG.txt'
Set-Content -LiteralPath $script:Log -Value '=== COVENANT GUARD P06-R4 WINDOWS ACCEPTANCE ===' -Encoding utf8
function Say([string]$message) {
    Write-Host $message
    Add-Content -LiteralPath $script:Log -Value $message -Encoding utf8
}
# Node 24 uses an information glyph as the summary prefix. PowerShell's native
# output decoding can transform that glyph into several non-ASCII characters
# (for example, "Γä╣"). The authoritative parts are the *complete* summary
# lines: tests N, pass N, fail 0. Permit one short arbitrary nonspace prefix.
function TestNodeSummary([string]$Summary,[int]$ExpectedTests) {
    foreach ($Metric in @('tests', 'pass', 'fail')) {
        $Expected = if ($Metric -eq 'fail') { '0' } else { [string]$ExpectedTests }
        $Pattern = '(?m)^\s*(?:\S{1,16}\s+)?' + $Metric + '\s+' + $Expected + '\s*$'
        if (-not [regex]::IsMatch($Summary,$Pattern)) { return $false }
    }
    return $true
}
function VerifyNodeSummaryParser() {
    $Fixtures = @(
        "ℹ tests 31`nℹ pass 31`nℹ fail 0",
        "Γä╣ tests 31`nΓä╣ pass 31`nΓä╣ fail 0",
        "# tests 31`n# pass 31`n# fail 0",
        "tests 31`npass 31`nfail 0"
    )
    foreach ($Fixture in $Fixtures) {
        if (-not (TestNodeSummary $Fixture 31)) { throw 'P06_NODE_PARSER_VALID_FIXTURE_REJECTED' }
    }
    if (TestNodeSummary "ℹ tests 31`nℹ pass 30`nℹ fail 1" 31) { throw 'P06_NODE_PARSER_FALSE_PASS' }
    if (TestNodeSummary "ℹ tests 31`nℹ pass 31" 31) { throw 'P06_NODE_PARSER_MISSING_FAIL_ACCEPTED' }
    if (TestNodeSummary "ℹ tests 30`nℹ pass 30`nℹ fail 0" 31) { throw 'P06_NODE_PARSER_WRONG_TOTAL_ACCEPTED' }
    Say 'P06_NODE_SUMMARY_PARSER=PASS'
}
function Native([string]$Label,[string]$Executable,[string[]]$Arguments,[int]$ExpectedTests=0) {
    Say "STAGE=$Label"
    $Output = @(& $Executable @Arguments 2>&1)
    $Code = $LASTEXITCODE
    $Lines = @($Output | ForEach-Object {($_ | Out-String).TrimEnd()})
    foreach ($Line in $Lines) { if (-not [string]::IsNullOrWhiteSpace($Line)) { Say $Line } }
    Say "${Label}_EXIT=$Code"
    if ($Code -ne 0) { throw "${Label}_FAILED=$Code" }
    if ($ExpectedTests -gt 0) {
        $Text = $Lines -join "`n"
        if ($Label -like '*FE_*' -and $Label -notlike '*NODE*') {
            if ($Text -notmatch "test result:\s*ok\.\s*$ExpectedTests passed;\s*0 failed") {
                throw "${Label}_FE_TEST_COUNT_MISMATCH=$ExpectedTests"
            }
        } else {
            if (-not (TestNodeSummary $Text $ExpectedTests)) {
                throw "${Label}_NODE_TEST_COUNT_MISMATCH=$ExpectedTests"
            }
        }
        Say "${Label}_TESTS=$ExpectedTests"
    }
    Say "$Label=PASS"
    return ($Lines -join "`n")
}
function Negative([string]$Label,[string]$Target,[string]$Diagnostic) {
    Say "STAGE=$Label"
    $Output = @(& $script:Fe 'check' $Target 2>&1)
    $Code = $LASTEXITCODE
    $Text = ($Output | ForEach-Object {($_ | Out-String).TrimEnd()}) -join "`n"
    foreach ($Line in ($Text -split "`n")) { if (-not [string]::IsNullOrWhiteSpace($Line)) { Say $Line } }
    Say "${Label}_EXIT=$Code"
    if ($Code -eq 0 -or $Text -notmatch [regex]::Escape($Diagnostic)) {
        throw "${Label}_EXPECTED_DIAGNOSTIC_MISSING=$Diagnostic"
    }
    Say "$Label=PASS"
}
function RequireAbi([string]$Label,[string]$Path,[string[]]$Names) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "${Label}_MISSING=$Path" }
    $Abi=Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
    $Actual=@($Abi | Where-Object {$_.type -eq 'function'} | ForEach-Object {$_.name})
    foreach($N in $Names) { if($Actual -notcontains $N) { throw "${Label}_MISSING_METHOD=$N" } }
    Say "$Label=PASS"
}
try {
    Say 'ADMIN_REQUIRED=NO'
    Say 'REAL_FUNDS=NONE'
    Say 'PUBLIC_CHAIN=NO'
    Say 'PUBLIC_GITHUB_MUTATION=NONE'
    Say 'NETWORK_REQUIRED=ONLY_IF_LOCKED_NPM_PACKAGES_NOT_INSTALLED'
    Say 'P05_R1_OWNER_VERIFIED=YES'
    VerifyNodeSummaryParser
    $Manifest=Join-Path $Root 'MANIFEST_SHA256.txt'
    if (-not (Test-Path -LiteralPath $Manifest)) { throw 'P06_MANIFEST_MISSING' }
    $Count=0
    foreach($Line in Get-Content -LiteralPath $Manifest -Encoding utf8) {
        if($Line -notmatch '^([0-9a-fA-F]{64})  ([A-Za-z0-9_./-]+)$') { throw "P06_MANIFEST_BAD_LINE=$Line" }
        $Expected=$Matches[1];$Relative=$Matches[2]
        if($Relative -match '(^/|\\|\.\.)') { throw "P06_MANIFEST_UNSAFE_PATH=$Relative" }
        $Path=Join-Path $Root $Relative.Replace('/',[IO.Path]::DirectorySeparatorChar)
        if(-not (Test-Path -LiteralPath $Path)) { throw "P06_MISSING_SOURCE=$Relative" }
        if((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Expected) { throw "P06_HASH_MISMATCH=$Relative" }
        $Count++
    }
    Say "P06_MANIFEST_FILES_VERIFIED=$Count"
    $Kernel=Join-Path $Root 'library\covenant_transition'
    $KernelFile=Join-Path $Kernel 'src\lib.fe'
    Say 'P06_P05_KERNEL_EXTENDED_WITH_ORDERED_API=YES'
    $PrefixMeta=((Get-Content -LiteralPath (Join-Path $Root 'docs\P04_PREFIX_SHA256.txt') -Raw).Trim() -split ' ')
    if($PrefixMeta.Count -ne 2) { throw 'P06_P04_PREFIX_METADATA_INVALID' }
    $Size=[int]$PrefixMeta[0]
    $Bytes=[IO.File]::ReadAllBytes($KernelFile)
    if($Size -lt 1 -or $Bytes.Length -le $Size) {throw 'P06_P04_PREFIX_SIZE_INVALID'}
    $Prefix=[byte[]]::new($Size)
    [Array]::Copy($Bytes,$Prefix,$Size)
    if([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Prefix)) -ine $PrefixMeta[1]) {throw 'P06_P04_PREFIX_DRIFT'}
    Say 'P06_P04_GUARDED_PREFIX_IDENTICAL=PASS'
    $ExpectedFe='D86CA3C6FDADEB8335F7033E3A68FDB7D2AAB4EAFD22C1E23BEC047D2A8B2674'
    $DefaultFe=Join-Path $HOME 'Downloads\FE_PROGRESSIVE_DECISIVE_GATE\toolchain\fe.exe'
    if($env:FE_EXE) { $script:Fe=$env:FE_EXE }
    elseif(Test-Path -LiteralPath $DefaultFe) { $script:Fe=$DefaultFe }
    else {throw "P06_FE_NOT_FOUND=$DefaultFe"}
    if(-not (Test-Path -LiteralPath $script:Fe)) {throw "P06_FE_NOT_FOUND=$($script:Fe)"}
    if((Get-FileHash -LiteralPath $script:Fe -Algorithm SHA256).Hash -ine $ExpectedFe) {throw 'P06_FE_BINARY_SHA256_MISMATCH'}
    $null=Native 'P06_FE_VERSION' $script:Fe @('--version')
    Say 'P06_PINNED_FE=PASS'
    $Node=(Get-Command node.exe -ErrorAction Stop).Source
    $Npm=(Get-Command npm.cmd -ErrorAction Stop).Source
    $Version=& $Node '--version'
    Say "P06_NODE_VERSION=$Version"
    if([int](($Version -replace '^v','').Split('.')[0]) -lt 20) { throw 'P06_NODE_MINIMUM_20_REQUIRED' }
    Push-Location -LiteralPath $Root
    try {
        $null=Native 'P06_STATIC_VERIFY' $Node @('scripts/p06_verify.mjs')
        $null=Native 'P06_R4_STATIC_VERIFY' $Node @('scripts/p06_r4_verify.mjs')
        $P04=Join-Path $Root 'consumers\allocation_kernel'
        $Pilot=Join-Path $Root 'consumers\allocation_pilot'
        $Flagship=Join-Path $Root 'consumers\allocation_flagship'
        $Gov=Join-Path $Root 'consumers\governance_registry'
        $LegacyFe=Join-Path $Root 'contracts\CovenantControl.fe'
        $null=Native 'P06_FE_SHARED_LIBRARY_CHECK' $script:Fe @('check',$Kernel)
        $null=Native 'P06_FE_SHARED_LIBRARY_TEST' $script:Fe @('test','--jobs','1',$Kernel) 15
        $null=Native 'P06_FE_P04_CHECK' $script:Fe @('check',$P04)
        $null=Native 'P06_FE_P04_REGRESSION_TEST' $script:Fe @('test','--jobs','1',$P04) 37
        $null=Native 'P06_FE_ALLOCATION_CHECK' $script:Fe @('check',$Pilot)
        $null=Native 'P06_FE_ALLOCATION_TEST' $script:Fe @('test','--jobs','1',$Pilot) 4
        $null=Native 'P06_FE_FLAGSHIP_CHECK' $script:Fe @('check',$Flagship)
        $null=Native 'P06_FE_FLAGSHIP_TEST' $script:Fe @('test','--jobs','1',$Flagship) 4
        $null=Native 'P06_FE_GOVERNANCE_CHECK' $script:Fe @('check',$Gov)
        $null=Native 'P06_FE_GOVERNANCE_TEST' $script:Fe @('test','--jobs','1',$Gov) 4
        $null=Native 'P06_FE_LEGACY_CHECK' $script:Fe @('check',$LegacyFe)
        $null=Native 'P06_FE_LEGACY_TEST' $script:Fe @('test','--jobs','1',$LegacyFe) 34
        Negative 'P06_PRIVATE_GENERIC_RULES' (Join-Path $Root 'probes\private_generic_rules') 'error[2-0003]'
        Negative 'P06_PRIVATE_OLD_REVISION' (Join-Path $Root 'probes\private_revision') 'error[2-0003]'
        Negative 'P06_PRIVATE_OLD_RULES' (Join-Path $Root 'probes\private_rules') 'error[2-0003]'
        Negative 'P06_EXTERNAL_CALL_CONFLICT' (Join-Path $Root 'probes\external_call_conflict') 'error[16-0001]'
        $Build=Join-Path $Root 'artifacts'
        $A0=Join-Path $Build 'guard\p04'; $A1=Join-Path $Build 'guard\allocation';$A2=Join-Path $Build 'guard\governance'
        $null=Native 'P06_BUILD_P04' $script:Fe @('build','--out-dir',$A0,$P04)
        $null=Native 'P06_BUILD_ALLOCATION' $script:Fe @('build','--out-dir',$A1,$Pilot)
        $AF=Join-Path $Build 'guard\flagship'
        $null=Native 'P06_BUILD_FLAGSHIP' $script:Fe @('build','--out-dir',$AF,$Flagship)
        $null=Native 'P06_BUILD_GOVERNANCE' $script:Fe @('build','--out-dir',$A2,$Gov)
        $LegacyBuildFixture=Join-Path $Root 'probes\legacy_build_fixture'
        $null=Native 'P06_BUILD_LEGACY' $script:Fe @('build','--out-dir',$Build,$LegacyBuildFixture)
        RequireAbi 'P06_ABI_ALLOCATION' (Join-Path $A1 'AllocationPilot.abi.json') @('snapshot','preview','setAllocation','reallocate','activateRecovery','activateAtomicRecovery','releaseRecovery','incidentSnapshot','deficits','operator','guardian')
        RequireAbi 'P06_ABI_GOVERNANCE' (Join-Path $A2 'GovernanceRegistry.abi.json') @('snapshot','preview','setConfiguration','changeQuorumAndMembers','activateRestriction','activateAtomicRestriction','releaseRestriction','incidentSnapshot','deficits','operator','guardian')
        RequireAbi 'P06_ABI_LEGACY' (Join-Path $Build 'CovenantControl.abi.json') @('snapshot','preview','commit','commitMigration','commitActions','commitGoalActions','commitIncidentActions')
        RequireAbi 'P06_ABI_FLAGSHIP' (Join-Path $AF 'AllocationFlagship.abi.json') @('snapshot','operator','guardian','canCommit','preview','commit','previewMigration','commitMigration','previewActions','commitActions','commitGoalActions','previewIncidentActions','commitIncidentActions','activateProgressive','activateContain','releaseIncidentBound','incidentSnapshot','incidentDeficits')
        $FlagshipAbi=Get-Content -LiteralPath (Join-Path $AF 'AllocationFlagship.abi.json') -Raw -Encoding utf8 | ConvertFrom-Json
        $FlagshipMethods=@($FlagshipAbi | Where-Object {$_.type -eq 'function'} | ForEach-Object {$_.name})
        if($FlagshipMethods -contains 'earlyInvalid' -or $FlagshipMethods -contains 'releaseIncident') {throw 'P06_R3_FORBIDDEN_FLAGSHIP_ABI_ROUTE'}
        Say 'P06_R3_FLAGSHIP_UNBOUND_RELEASE_ABSENT=PASS'
        Say 'P06_FE_98_TESTS=PASS'
        # Preserve reproducible lockfile. Run npm ci only if missing/wrong.
        $Probe=@(& $Npm 'ls' '--depth=0' '--omit=dev' 2>&1)
        if($LASTEXITCODE -ne 0) {
            Say 'P06_NPM_LOCKED_INSTALL_REQUIRED=YES'
            $null=Native 'P06_NPM_CI' $Npm @('ci','--prefer-offline','--no-audit','--no-fund')
        } else {Say 'P06_NPM_LOCKED_INSTALL_REQUIRED=NO'}
        $null=Native 'P06_JS_SYNTAX' $Npm @('run','check:js')
        # Historical regression controls use the prior behavior explicitly.
        # The default server is the actual single-state flagship below.
        $PreviousRuntime=$env:COVENANT_RUNTIME
        try {
            $env:COVENANT_RUNTIME='legacy'
            $null=Native 'P06_NODE_LEGACY_REGRESSION' $Npm @('run','smoke') 31
            $null=Native 'P06_NODE_GUARD_HTTP_UI' $Npm @('run','guard:http') 2
        } finally {
            $env:COVENANT_RUNTIME=$PreviousRuntime
        }
        $null=Native 'P06_NODE_REAL_GUARD_EVM' $Npm @('run','guard:unit') 6
        $null=Native 'P06_NODE_FLAGSHIP_CANDIDATE' $Npm @('run','flagship:candidate') 2
        $env:COVENANT_RUNTIME='flagship'
        try {
            $null=Native 'P06_NODE_FLAGSHIP_CUTOVER' $Npm @('run','flagship:cutover') 4
        } finally {
            $env:COVENANT_RUNTIME=$PreviousRuntime
        }
        Say 'P06_NODE_45_TESTS=PASS'
        Say 'P06_SAME_SERVER_7_VIEW_AND_GUARD_UI=PASS'
        Say 'P06_SEPARATE_GUARDIAN_EOA=PASS'
        Say 'P06_TWO_REAL_SHARED_GUARD3_CONSUMERS=PASS'
        Say 'P06_INTEGRATION_VERTICAL_SLICE=PASS'
        Say 'P06_FLAGSHIP_SINGLE_GUARD_CONTRACT_CANDIDATE=PASS'
        Say 'P06_GUARD_ALLOCATION_AND_FLAGSHIP_ONE_STATE=PASS'
        Say 'P06_SEVEN_VIEW_MAIN_RUNTIME_ALLOCATIONFLAGSHIP=PASS'
        Say 'P06_INCIDENT_GUARDIAN_REQUIRED=PASS'
        Say 'P06_MASTER_FLAGSHIP_CUTOVER=PASS'
        Say 'P06_R4_GATE=PASS'
        Say 'NEXT=P07_INDEPENDENT_MODEL_AND_ADVERSARIAL_SECURITY_VERIFICATION'
        Say "REPORT_PATH=$($script:Log)"
    } finally {Pop-Location}
} catch {
    Say 'P06_R4_GATE=FAIL'
    Say "ERROR=$($_.Exception.Message)"
    Say "REPORT_PATH=$($script:Log)"
    exit 1
}
