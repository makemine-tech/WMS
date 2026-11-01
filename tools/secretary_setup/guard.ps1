# 크롬 지킴이 — 작업 스케줄러가 5분마다 실행. 비서 전용 프로필 크롬이 없으면 켠다
# 대표님이 쓰는 다른 크롬은 프로필 경로가 달라 건드리지 않는다.

param([string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'))

$ErrorActionPreference = 'Stop'
$log = Join-Path (Split-Path $ConfigPath) 'guard.log'

function Write-GuardLog([string]$Text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Text"
  $old = @()
  if (Test-Path $log) { $old = @(Get-Content -LiteralPath $log -Encoding UTF8 | Select-Object -Last 199) }
  try { Set-Content -LiteralPath $log -Value ($old + $line) -Encoding UTF8 -ErrorAction Stop } catch { }   # 기록 실패가 크롬 켜기를 막지 않게
}

# 드롭박스에 새 판이 오면 이 컴퓨터로 복사. 실패해도 크롬 켜기는 계속한다. manifest 를 마지막에 옮겨 확장이 복사 도중 다시 불러오지 않게 함
try {
  $u = Get-Content -Raw -Encoding UTF8 -LiteralPath $ConfigPath | ConvertFrom-Json
  $srcManifest = if ($u.source) { Join-Path $u.source 'manifest.json' } else { '' }
  if ($srcManifest -and (Test-Path $srcManifest)) {
    $curManifest = Join-Path $u.extension 'manifest.json'
    $new = (Get-Content -Raw -Encoding UTF8 -LiteralPath $srcManifest | ConvertFrom-Json).version
    $cur = if (Test-Path $curManifest) { (Get-Content -Raw -Encoding UTF8 -LiteralPath $curManifest | ConvertFrom-Json).version } else { '' }
    if ($new -ne $cur) {
      New-Item -ItemType Directory -Force $u.extension | Out-Null
      Copy-Item (Join-Path $u.source '*') $u.extension -Recurse -Force -Exclude 'manifest.json'
      Copy-Item $srcManifest $curManifest -Force
      Write-GuardLog "확장 프로그램 새 판 복사: $cur -> $new"
    }
  }
} catch {
  Write-GuardLog "확장 프로그램 복사 실패: $($_.Exception.Message)"
}

try {
  $c = Get-Content -Raw -Encoding UTF8 -LiteralPath $ConfigPath | ConvertFrom-Json
  $needle = $c.profile.ToLowerInvariant()
  $running = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) } |
    Select-Object -First 1
  if ($running) { exit 0 }

  $args2 = ('--user-data-dir="{0}" --no-first-run --no-default-browser-check {1}' -f $c.profile, (@($c.urls) -join ' ')).Trim()
  Start-Process -FilePath $c.chrome -ArgumentList $args2
  Write-GuardLog '크롬이 꺼져 있어 다시 켬'
} catch {
  Write-GuardLog "실패: $($_.Exception.Message)"
  exit 1
}
