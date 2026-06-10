param(
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = Join-Path $ProjectDir ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $PythonExe)) {
  throw "Virtual environment not found. Run .\setup_opa_env.ps1 first."
}

Push-Location $ProjectDir
try {
  & $PythonExe app.py `
    --host $HostAddress `
    --port $Port `
    --train-code train_opa_score_resnet_ms.py `
    --ckpt best.ckpt `
    --arch resnet18 `
    --device-target CPU
} finally {
  Pop-Location
}
