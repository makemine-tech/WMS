# 크롬 지킴이 — 작업 스케줄러가 5분마다 실행. 비서 전용 프로필 크롬이 없으면 켠다
# 대표님이 쓰는 다른 크롬은 프로필 경로가 달라 건드리지 않는다.

param([string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'))

$ErrorActionPreference = 'Stop'
$log = Join-Path (Split-Path $ConfigPath) 'guard.log'

function Write-GuardLog([string]$Text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Text"
  $old = @()
  if (Test-Path $log) { $old = @(Get-Content -LiteralPath $log -Encoding UTF8 | Select-Object -Last 199) }
  Set-Content -LiteralPath $log -Value ($old + $line) -Encoding UTF8
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
