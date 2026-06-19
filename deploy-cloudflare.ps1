$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host "Building static site..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
  throw "Build failed."
}

$wrangler = @(
  (Get-Command npx -ErrorAction SilentlyContinue).Source,
  (Get-Command wrangler -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ } | Select-Object -First 1

if (-not $wrangler) {
  Write-Host "Install Wrangler with: npm install -g wrangler" -ForegroundColor Red
  exit 1
}

Write-Host "Deploying dist/ to Cloudflare..." -ForegroundColor Cyan
npx wrangler deploy
if ($LASTEXITCODE -ne 0) {
  throw "Cloudflare deploy failed."
}

Write-Host "Done. Live app: https://partners-dashboard.gametize.workers.dev/" -ForegroundColor Green
