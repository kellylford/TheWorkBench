# Rebuilds every ballpark guide and the landing page.
# Run from anywhere:  .\_build\rebuild.ps1
$ErrorActionPreference = 'Stop'
$build = $PSScriptRoot
$root  = Split-Path $build -Parent

$py = if (Get-Command python3 -ErrorAction SilentlyContinue) { 'python3' } else { 'python' }

Push-Location $build
& $py build_all.py
& $py mkindex.py
Pop-Location

Push-Location (Join-Path $root 'amfamfield\build')
& $py build.py
& $py build_layout.py
& $py build_page.py
Pop-Location

Write-Host ''
Write-Host 'Build complete. To audit:' -ForegroundColor Green
Write-Host '  npm install playwright axe-core'
Write-Host '  npx playwright install chromium'
Write-Host "  node `"$build\auditall.js`""
