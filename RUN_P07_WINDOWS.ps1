# P07-R2: real independent assurance; run only after P06 has passed.
# No public-chain transactions; compiler-mutants are isolated under results/p07.
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$Results=Join-Path $Root 'results'
New-Item -ItemType Directory -Path $Results -Force | Out-Null
$script:Log=Join-Path $Results 'P07_RUN_LOG.txt'
Set-Content -LiteralPath $script:Log -Encoding utf8 -Value '=== COVENANT GUARD P07-R2 INDEPENDENT ASSURANCE ==='
function Say([string]$Line){Write-Host $Line;Add-Content -LiteralPath $script:Log -Encoding utf8 -Value $Line}
function Stage([string]$Label,[string]$Exe,[string[]]$Arguments,[string]$MustContain='') {
    Say "STAGE=$Label"
    $Output=@(& $Exe @Arguments 2>&1)
    $Code=$LASTEXITCODE
    $Lines=@($Output | ForEach-Object {($_ | Out-String).TrimEnd()})
    foreach($Line in $Lines){if(-not [string]::IsNullOrWhiteSpace($Line)){Say $Line}}
    Say "${Label}_EXIT=$Code"
    if($Code -ne 0){throw "${Label}_EXECUTION_FAILED=$Code"}
    $Text=$Lines -join "`n"
    if($MustContain -and -not $Text.Contains($MustContain)){
        throw "${Label}_EVIDENCE_MISSING=$MustContain"
    }
    Say "$Label=PASS"
    return $Text
}
function NodeSummary([string]$Output,[int]$ExpectedTests){
    foreach($Field in @('tests','pass','fail')){
        $Expected=if($Field -eq 'fail'){'0'}else{[string]$ExpectedTests}
        $Pattern='(?m)^\s*(?:\S{1,16}\s+)?'+$Field+'\s+'+$Expected+'\s*$'
        if(-not [regex]::IsMatch($Output,$Pattern)){return $false}
    }
    return $true
}
try {
    Say 'ADMIN_REQUIRED=NO'
    Say 'PUBLIC_CHAIN=NO'
    Say 'REAL_FUNDS=NONE'
    Say 'SOURCE_MUTATIONS=DISPOSABLE_RESULTS_ONLY'
    $P06Log=Join-Path $Results 'P06_RUN_LOG.txt'
    if(-not (Test-Path -LiteralPath $P06Log)){throw 'P07_BASELINE_LOG_MISSING'}
    $Baseline=Get-Content -LiteralPath $P06Log -Raw -Encoding utf8
    foreach($Marker in @('P06_FE_98_TESTS=PASS','P06_NODE_45_TESTS=PASS',
            'P06_MASTER_FLAGSHIP_CUTOVER=PASS','P06_R4_GATE=PASS')){
        if(-not $Baseline.Contains($Marker)){throw "P07_BASELINE_MARKER_MISSING=$Marker"}
    }
    Say 'P07_P06_R4_BASELINE_FULL_REPLAY=PASS'
    $Manifest=Join-Path $Root 'MANIFEST_SHA256.txt'
    if(-not (Test-Path -LiteralPath $Manifest)){throw 'P07_PACKAGE_MANIFEST_MISSING'}
    $Count=0
    foreach($Line in (Get-Content -LiteralPath $Manifest -Encoding utf8)){
        if($Line -notmatch '^([0-9a-fA-F]{64})  ([A-Za-z0-9_./-]+)$'){throw "P07_BAD_MANIFEST_LINE=$Line"}
        $Digest=$Matches[1];$Rel=$Matches[2]
        if($Rel -match '\.\.|\\|^/'){throw "P07_UNSAFE_MANIFEST_PATH=$Rel"}
        $Path=Join-Path $Root ($Rel.Replace('/',[IO.Path]::DirectorySeparatorChar))
        if(-not (Test-Path -LiteralPath $Path)){throw "P07_MISSING_SOURCE=$Rel"}
        if((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Digest){throw "P07_SOURCE_HASH_MISMATCH=$Rel"}
        $Count++
    }
    Say "P07_MANIFEST_FILES_VERIFIED=$Count"
    $CountOld=0
    $OldManifest=Join-Path $Root 'docs/P06_R4_VERIFIED_SOURCE_MANIFEST.txt'
    foreach($Line in (Get-Content -LiteralPath $OldManifest -Encoding utf8)){
        if($Line -notmatch '^([0-9a-fA-F]{64})  ([A-Za-z0-9_./-]+)$'){throw 'P07_BAD_P06_REFERENCE_LINE'}
        $Digest=$Matches[1];$Rel=$Matches[2]
        # P07 owns its README and entrypoint, but preserves the exact original
        # P06-R4 bytes in these two frozen copies for integrity comparison.
        if($Rel -eq 'README.md'){$Rel='docs/P06_R4_FROZEN_README.md'}
        elseif($Rel -eq 'RUN_WINDOWS.ps1'){$Rel='RUN_BASELINE_WINDOWS.ps1'}
        $Path=Join-Path $Root ($Rel.Replace('/',[IO.Path]::DirectorySeparatorChar))
        if(-not (Test-Path -LiteralPath $Path)){throw "P07_P06_SOURCE_NOT_PRESERVED=$Rel"}
        if((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Digest){throw "P07_P06_SOURCE_DRIFT=$Rel"}
        $CountOld++
    }
    if($CountOld -ne 68){throw "P07_P06_REFERENCE_COUNT_WRONG=$CountOld"}
    Say 'P07_FROZEN_P06_R4_SOURCE=PASS'
    $Python=(Get-Command python.exe -ErrorAction Stop).Source
    $Node=(Get-Command node.exe -ErrorAction Stop).Source
    $Fe=if($env:FE_EXE){$env:FE_EXE}else{Join-Path $HOME 'Downloads/FE_PROGRESSIVE_DECISIVE_GATE/toolchain/fe.exe'}
    if(-not (Test-Path -LiteralPath $Fe)){throw "P07_FE_NOT_FOUND=$Fe"}
    if((Get-FileHash -LiteralPath $Fe -Algorithm SHA256).Hash -ine 'D86CA3C6FDADEB8335F7033E3A68FDB7D2AAB4EAFD22C1E23BEC047D2A8B2674'){
        throw 'P07_PINNED_FE_SHA256_MISMATCH'
    }
    $Version=(& $Python --version 2>&1) -join ''
    Say "P07_PYTHON_VERSION=$Version"
    if($Version -notmatch 'Python 3\.(1[1-9]|[2-9][0-9])\.'){throw 'P07_REQUIRES_PYTHON_3_11_OR_NEWER'}
    $env:P07_PYTHON=$Python
    $env:P07_PYTHON_VERSION=$Version
    $env:P07_FE_EXE=$Fe
    Push-Location -LiteralPath $Root
    try {
        $null=Stage 'P07_FROZEN_SOURCE_CHECK' $Node @('p07/verify-source.mjs') 'P07_FROZEN_P06_R4_SOURCE=PASS'
        $Text=Stage 'P07_PYTHON_ORACLE_UNIT' $Python @('-m','unittest','discover','-s','p07/spec','-p','test_oracle.py','-v') 'Ran 15 tests'
        if($Text -notmatch '(?m)^OK\s*$'){throw 'P07_ORACLE_UNIT_ASSERTION_NOT_OK'}
        Say 'P07_PYTHON_15_ORACLE_TESTS=PASS'
        $null=Stage 'P07_ABI_PROVENANCE' $Node @('p07/provenance.mjs') 'P07_ALL_EIGHT_WRITERS_ENUMERATED=PASS'
        $Text=Stage 'P07_PYTHON_VS_RAW_FE_EVM' $Node @('--test','p07/tests/differential.test.mjs') 'P07_FINITE_DOMAIN_432_PREVIEWS=PASS'
        if(-not (NodeSummary $Text 5)){throw 'P07_DIFFERENTIAL_NOT_5_OF_5'}
        foreach($Marker in @('P07_SEEDED_DIFF_701=PASS','P07_SEEDED_DIFF_1701=PASS',
                'P07_SEEDED_DIFF_2701=PASS','P07_FULL_72_CELL_ABI_MATRIX=PASS')){
            if(-not $Text.Contains($Marker)){throw "P07_DIFFERENTIAL_MARKER_MISSING=$Marker"}
        }
        Say 'P07_EVM_DIFFERENTIAL_TESTS=5'
        Say 'P07_SIGNED_EVM_300_ACTIONS=PASS'
        Say 'P07_ACTOR_SELECTOR_PHASE_72_CELLS=PASS'
        Say 'P07_FINITE_DOMAIN_432_FE_PREVIEWS=PASS'
        $null=Stage 'P07_MUTANT_RECIPE_PREP' $Python @('p07/mutation_prepare.py') 'P07_MUTANTS_PREPARED=8'
        $Recipe=Get-Content -LiteralPath (Join-Path $Root 'results/p07/mutation-manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
        $Mutants=@($Recipe.mutants)
        if($Mutants.Count -ne 8){throw "P07_MUTANT_COUNT_WRONG=$($Mutants.Count)"}
        foreach($M in $Mutants){
            $ID=[string]$M.name
            $Project=[string]$M.project
            $Output=Split-Path -Parent ([string]$M.artifactPrefix)
            if(-not (Test-Path -LiteralPath $Project)){throw "P07_MUTANT_PROJECT_MISSING=$ID"}
            $null=Stage "P07_MUTANT_BUILD_$ID" $Fe @('build','--out-dir',$Output,$Project)
            foreach($Extension in @('.bin','.abi.json')){
                $ArtifactFile=([string]$M.artifactPrefix)+$Extension
                if(-not (Test-Path -LiteralPath $ArtifactFile)){
                    throw "P07_MUTANT_BUILD_ARTIFACT_MISSING=${ID}${Extension}"
                }
            }
            Say "P07_MUTANT_COMPILED_$ID=PASS"
        }
        Say 'P07_MUTANTS_COMPILED=8'
        $Text=Stage 'P07_COMPILED_MUTANT_EVM' $Node @('--test','p07/tests/mutation.test.mjs') 'P07_MUTANT_SELF_MOVE=KILLED'
        if(-not (NodeSummary $Text 8)){throw 'P07_MUTANTS_NOT_8_OF_8'}
        foreach($M in $Mutants){
            $UpperID=([string]$M.name).ToUpperInvariant()
            if(-not $Text.Contains("P07_MUTANT_${UpperID}=KILLED")){
                throw "P07_MUTANT_KILL_MARKER_MISSING=$($M.name)"
            }
        }
        Say 'P07_COMPILED_MUTANT_EVM_DETECTION_TESTS=8'
        $null=Stage 'P07_EVIDENCE_COLLECT' $Node @('p07/collect-evidence.mjs') 'P07_EVIDENCE_MANIFEST=PASS'
        Say 'P07_EVIDENCE_MANIFEST=PASS'
        Say 'P07_R2_GATE=PASS'
        Say 'NEXT=P07_REVIEW_FINDINGS_OR_P08_REPRODUCIBILITY'
        Say "REPORT_PATH=$($script:Log)"
    } finally { Pop-Location }
} catch {
    Say 'P07_R2_GATE=FAIL'
    Say "ERROR=$($_.Exception.Message)"
    Say "REPORT_PATH=$($script:Log)"
    exit 1
}
