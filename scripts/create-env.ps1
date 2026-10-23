$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env'
if (Test-Path $target) { exit 0 }
function New-RandomText([int]$length) {
    $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
$content = Get-Content (Join-Path $root '.env.example') -Raw
$content = $content -replace '(?m)^CRIVO_DB_PASSWORD=.*$', ('CRIVO_DB_PASSWORD=' + (New-RandomText 32))
$content = $content -replace '(?m)^CRIVO_SECRET_KEY=.*$', ('CRIVO_SECRET_KEY=' + (New-RandomText 64))
[System.IO.File]::WriteAllText($target, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host 'Arquivo .env criado com senha e chave aleatorias.'
