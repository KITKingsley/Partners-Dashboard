# Run after: npx supabase login
# Usage: .\scripts\supabase-link-and-deploy.ps1

$ErrorActionPreference = "Stop"
$projectRef = "xfxkljltzyqvgbombtqy"
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Set-Location $repoRoot

Write-Host "Linking project $projectRef..." -ForegroundColor Cyan
npx supabase link --project-ref $projectRef

$functions = @(
  "get-cp-contacts",
  "get-xero-invoices",
  "upload-credit-logs",
  "upload-stripe-invoices"
)

foreach ($name in $functions) {
  Write-Host "Deploying $name..." -ForegroundColor Cyan
  npx supabase functions deploy $name
}

Write-Host "Done. Set CP_CONTACTS_APPS_SCRIPT_URL in dashboard if not already:" -ForegroundColor Green
Write-Host "https://supabase.com/dashboard/project/$projectRef/settings/functions"
