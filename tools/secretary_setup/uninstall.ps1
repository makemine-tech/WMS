# 메이크창고 전담비서 상시 컴퓨터 설정 되돌리기 — 「제거.cmd」 를 더블클릭
# 크롬 지킴이·바로가기를 지우고 전원 설정을 설치 전 값으로 돌림. 스토어 수집기는 건드리지 않음.
# 전용 크롬 프로필(사이트 로그인)은 물어본 뒤에만 지움.
# -Sandbox 폴더: 시험용. 그 폴더 안의 파일만 지우고 전원·작업 스케줄러는 건너뜀.

param([string]$Sandbox)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-SetupPaths $Sandbox

Write-Host ''
Write-Host '=== 메이크창고 전담비서 · 상시 컴퓨터 설정 되돌리기 ===' -ForegroundColor Cyan

if (-not $Sandbox) {
  if (Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false
    Write-Host '크롬 지킴이 삭제'
  } else { Write-Host '크롬 지킴이: 등록돼 있지 않음' }
}

if (Test-Path $paths.State) {
  $state = Get-Content -Raw -Encoding UTF8 -LiteralPath $paths.State | ConvertFrom-Json
  if ($Sandbox) { Write-Host "전원 설정: 시험이라 건너뜀 (되돌릴 값 절전 $(Format-Seconds $state.standbyAc))" }
  else {
    if ($null -ne $state.standbyAc) { Set-AcSeconds 'STANDBYIDLE' $state.standbyAc }
    if ($null -ne $state.hibernateAc) { Set-AcSeconds 'HIBERNATEIDLE' $state.hibernateAc }
    Write-Host "전원 설정 복구: 절전 $(Format-Seconds $state.standbyAc), 최대 절전 $(Format-Seconds $state.hibernateAc)"
  }
} else { Write-Host '전원 설정: 설치 기록이 없어 그대로 둠' }

if (Test-Path $paths.Shortcut) { Remove-Item -LiteralPath $paths.Shortcut -Force; Write-Host '바로가기 삭제' }

foreach ($name in 'guard.ps1', 'guard_hidden.vbs', 'config.json', 'state.json', 'guard.log') {
  $f = Join-Path $paths.Root $name
  if (Test-Path $f) { Remove-Item -LiteralPath $f -Force }
}

if (Test-Path $paths.Profile) {
  $a = ''
  if (-not $Sandbox) {
    Write-Host ''
    Write-Host '전용 크롬 프로필을 지우면 그 안의 사이트 로그인과 저장한 비밀번호가 사라집니다.' -ForegroundColor Yellow
    $a = Read-Host '지우려면 y, 남기려면 엔터'
  }
  if ($a -match '^[yYㅛ]') {
    Remove-Item -LiteralPath $paths.Profile -Recurse -Force
    Write-Host '전용 크롬 프로필 삭제'
  } else { Write-Host "전용 크롬 프로필은 남겨 둠: $($paths.Profile)" }
}

Write-Host ''
Write-Host '되돌리기 끝' -ForegroundColor Green
