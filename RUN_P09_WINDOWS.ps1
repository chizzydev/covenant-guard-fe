$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location -LiteralPath $Root
try {
  & node p09/full-gate.mjs
  if($LASTEXITCODE -ne 0){throw 'P09_WINDOWS_FULL_GATE_FAILED'}
} finally {Pop-Location}
