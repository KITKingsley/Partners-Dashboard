$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remoteUrl = "https://github.com/KITKingsley/Partners-Dashboard.git"

$git = @(
  (Get-Command git -ErrorAction SilentlyContinue).Source,
  "C:\Program Files\Git\cmd\git.exe",
  "C:\Program Files\Git\bin\git.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $git) {
  $gitDesktop = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($gitDesktop) {
    $git = $gitDesktop.FullName
  }
}

if (-not $git) {
  Write-Host "Git is not installed." -ForegroundColor Red
  Write-Host "Install from https://git-scm.com/download/win then run this script again."
  exit 1
}

Set-Location $repoRoot

if (-not (Test-Path ".git")) {
  & $git init
  & $git branch -M main
}

$existingRemote = (& $git remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0) {
  & $git remote add origin $remoteUrl
} elseif ($existingRemote -ne $remoteUrl) {
  & $git remote set-url origin $remoteUrl
}

& $git add -A
$status = & $git status --porcelain
if (-not $status) {
  Write-Host "No changes to commit."
} else {
  & $git commit -m "Update Partners Dashboard"
}

Write-Host "Pushing to $remoteUrl ..."
& $git push -u origin main

if ($LASTEXITCODE -eq 0) {
  Write-Host "Done. Repository: $remoteUrl" -ForegroundColor Green
} else {
  Write-Host "Push failed. If this is the first push, make sure the GitHub repo exists and you are signed in."
  Write-Host "You may be prompted for GitHub username and a Personal Access Token (not your password)."
}
