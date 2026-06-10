param(
  [string]$PythonExe = "",
  [switch]$Recreate
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ProjectDir ".venv"

if (-not $PythonExe) {
  $Candidates = @(
    (Join-Path $env:USERPROFILE ".pyenv\pyenv-win\versions\3.9.13\python.exe"),
    (Join-Path $env:USERPROFILE ".pyenv\pyenv-win\versions\3.9.18\python.exe"),
    (Join-Path $env:USERPROFILE ".pyenv\pyenv-win\versions\3.9.19\python.exe")
  )
  $PythonExe = $Candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $PythonExe -or -not (Test-Path -LiteralPath $PythonExe)) {
  throw "Python 3.9 was not found. Install it first or pass -PythonExe C:\path\to\python.exe."
}

if ($Recreate -and (Test-Path -LiteralPath $VenvDir)) {
  $ResolvedProject = (Resolve-Path -LiteralPath $ProjectDir).Path
  $ResolvedVenv = (Resolve-Path -LiteralPath $VenvDir).Path
  if (-not $ResolvedVenv.StartsWith($ResolvedProject, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a virtual environment outside the project directory."
  }
  Remove-Item -LiteralPath $ResolvedVenv -Recurse -Force
}

if (-not (Test-Path -LiteralPath $VenvDir)) {
  & $PythonExe -m venv $VenvDir
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip setuptools wheel
& $VenvPython -m pip install -r (Join-Path $ProjectDir "requirements.txt")

& $VenvPython -c "import fastapi, uvicorn, multipart, PIL, numpy, mindspore; print('OPA environment ready'); print('MindSpore:', mindspore.__version__)"

Write-Host ""
Write-Host "Environment created at: $VenvDir"
Write-Host "Start the backend with: .\start_opa_backend.ps1"
