Param()

$ErrorActionPreference = 'Stop'

# Locate version.json relative to script location
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$versionPath = Join-Path $repoRoot 'version.json'

if (-not (Test-Path $versionPath)) {
    Write-Error "version.json not found at $versionPath"
}

$raw = Get-Content -Path $versionPath -Raw
try {
    $data = $raw | ConvertFrom-Json -ErrorAction Stop
} catch {
    Write-Error "Failed to parse version.json: $_"
}

$ver = [string]$data.version
if (-not $ver) { $ver = '0.0.0' }

$m = [regex]::Match($ver, '^(\d+)\.(\d+)\.(\d+)$')
if ($m.Success) {
    $major = [int]$m.Groups[1].Value
    $minor = [int]$m.Groups[2].Value
    $patch = ([int]$m.Groups[3].Value) + 1
} else {
    $major = 0; $minor = 0; $patch = 1
}

$newVersion = "$major.$minor.$patch"
$today = Get-Date -Format 'yyyy-MM-dd'

$data.version = $newVersion
$data.date = $today

# Write back pretty JSON (2-space indent)
$json = $data | ConvertTo-Json -Depth 10
Set-Content -Path $versionPath -Value ($json + "`n") -NoNewline

Write-Host "Bumped version.json -> version=$newVersion, date=$today"
