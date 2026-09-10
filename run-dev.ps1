# Run this script from the repository root to install dependencies and start the Next.js dev server.
# If npm is not installed or not available in PATH, the script will stop and print an error.

$projectRoot = Split-Path -Path $MyInvocation.MyCommand.Path -Parent
Push-Location $projectRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm is not installed or not available in PATH. Please install Node.js and npm before running this script."
    Pop-Location
    exit 1
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install failed. Please fix the reported errors and try again."
    Pop-Location
    exit $LASTEXITCODE
}

Write-Host "Starting the Next.js development server..." -ForegroundColor Cyan
npm run dev
