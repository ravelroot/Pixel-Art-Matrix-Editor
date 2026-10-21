$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$destino = Join-Path $raiz '.env'
if (Test-Path $destino) { exit 0 }
function Aleatorio([int]$tamanho) {
    $letras = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $bytes = New-Object byte[] $tamanho
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $letras[$_ % $letras.Length] })
}
$conteudo = Get-Content (Join-Path $raiz '.env.example') -Raw
$conteudo = $conteudo -replace '(?m)^CRIVO_DB_PASSWORD=.*$', ('CRIVO_DB_PASSWORD=' + (Aleatorio 32))
$conteudo = $conteudo -replace '(?m)^CRIVO_SECRET_KEY=.*$', ('CRIVO_SECRET_KEY=' + (Aleatorio 64))
[System.IO.File]::WriteAllText($destino, $conteudo, (New-Object System.Text.UTF8Encoding $false))
Write-Host 'Arquivo .env criado com senha e chave aleatorias.'
