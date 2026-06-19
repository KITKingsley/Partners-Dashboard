# Opens the Supabase SQL editor for this project and prints setup steps.
# Run from repo root: .\scripts\setup-supabase.ps1

$ErrorActionPreference = "Stop"
$projectRef = "xfxkljltzyqvgbombtqy"
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$setupSql = Join-Path $repoRoot "supabase\setup-all.sql"
$sqlEditorUrl = "https://supabase.com/dashboard/project/$projectRef/sql/new"
$secretsUrl = "https://supabase.com/dashboard/project/$projectRef/settings/functions"
$functionsUrl = "https://supabase.com/dashboard/project/$projectRef/functions"

Write-Host ""
Write-Host "CP Revenue Dashboard - Supabase setup" -ForegroundColor Cyan
Write-Host "Project: $projectRef"
Write-Host ""

if (-not (Test-Path $setupSql)) {
  Write-Error "Missing $setupSql"
}

Write-Host "1) SQL schema" -ForegroundColor Yellow
Write-Host "   Open: $sqlEditorUrl"
Write-Host "   Paste the contents of: supabase\setup-all.sql"
Write-Host "   Click Run"
Write-Host ""

Write-Host "2) Edge function secrets" -ForegroundColor Yellow
Write-Host "   Open: $secretsUrl"
Write-Host "   Add: CP_CONTACTS_APPS_SCRIPT_URL = your Google Apps Script web app URL"
Write-Host ""

Write-Host "3) Deploy edge functions (requires Supabase CLI + login)" -ForegroundColor Yellow
Write-Host "   supabase link --project-ref $projectRef"
Write-Host "   supabase functions deploy get-cp-contacts"
Write-Host "   supabase functions deploy get-xero-invoices"
Write-Host "   supabase functions deploy upload-credit-logs"
Write-Host "   supabase functions deploy upload-stripe-invoices"
Write-Host "   Functions dashboard: $functionsUrl"
Write-Host ""

Write-Host "4) Cursor MCP (optional - lets the AI run SQL from chat)" -ForegroundColor Yellow
Write-Host "   Cursor Settings -> MCP -> enable Supabase for this project"
Write-Host "   Or use .cursor/mcp.json already added in this repo"
Write-Host ""

try {
  Set-Clipboard -Value (Get-Content -Raw -Path $setupSql)
  Write-Host "Copied setup-all.sql to clipboard." -ForegroundColor Green
} catch {
  Write-Host "Could not copy to clipboard. Open the file manually." -ForegroundColor DarkYellow
}

Start-Process $sqlEditorUrl
