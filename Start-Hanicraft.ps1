$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Hanicraft ERP: http://localhost:3000'
& node local/server.mjs
