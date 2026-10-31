# 메이크창고 전담비서 상시 컴퓨터 설치 — install.ps1·uninstall.ps1 공통 부품 (2026-10-31)

$script:TaskName     = 'MAKEWON 비서 크롬 지킴이'
$script:ShortcutName = '메이크창고 비서 크롬.lnk'
$script:StoreTask    = 'MAKEWON 스토어 매출'
$script:DevPc        = 'TOOZ-GRAM'   # 대표님 개발 노트북: 점검만, 설정 변경 금지
$script:SiteUrls     = @('https://makewon.com/', 'https://ga89.ezadmin.co.kr/', 'https://ebut3pl.co.kr/')

function Get-SetupPaths([string]$Sandbox) {
  if ($Sandbox) {
    $root = Join-Path $Sandbox 'MakewonSecretary'
    $desk = Join-Path $Sandbox 'Desktop'
  } else {
    $root = Join-Path $env:LOCALAPPDATA 'MakewonSecretary'
    $desk = [Environment]::GetFolderPath('Desktop')
  }
  [pscustomobject]@{
    Root     = $root
    Desktop  = $desk
    Profile  = Join-Path $root 'ChromeProfile'
    Config   = Join-Path $root 'config.json'
    State    = Join-Path $root 'state.json'
    Shortcut = Join-Path $desk $script:ShortcutName
  }
}

function Find-Chrome {
  $list = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($p in $list) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

# 비서 크롬을 여는 인수. 바로가기와 지킴이가 같은 값을 쓴다
function Get-ChromeArgs([string]$ProfileDir, [string[]]$Urls) {
  ('--user-data-dir="{0}" --no-first-run --no-default-browser-check {1}' -f $ProfileDir, ($Urls -join ' ')).Trim()
}

# powercfg 출력에서 전원 연결(AC) 값을 초 단위로 읽음. 값 줄 순서 = 최소·최대·증가·AC·DC (윈도우 언어와 무관)
function ConvertFrom-PowerQuery([string[]]$Lines) {
  $vals = @($Lines | ForEach-Object { if ($_ -match ':\s*0x([0-9a-fA-F]+)\s*$') { $Matches[1] } })
  if ($vals.Count -lt 4) { return $null }
  return [Convert]::ToInt64($vals[3], 16)
}

function Get-AcSeconds([string]$Alias) {
  # 최대 절전을 끈 컴퓨터는 이 설정이 없어 powercfg 가 실패함 → 값 없음으로 처리
  $ErrorActionPreference = 'Continue'
  $out = & powercfg /query SCHEME_CURRENT SUB_SLEEP $Alias 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ConvertFrom-PowerQuery $out
}

function Set-AcSeconds([string]$Alias, [long]$Seconds) {
  & powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP $Alias $Seconds | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "powercfg 변경 실패: $Alias" }
  & powercfg /setactive SCHEME_CURRENT | Out-Null
}

function Format-Seconds($Seconds) {
  if ($null -eq $Seconds) { return '확인 불가' }
  if ($Seconds -eq 0) { return '안 함' }
  return "$([math]::Round($Seconds / 60))분"
}

# 결과 목록: 상태 = 통과 / 주의 / 필요 / 안내
$script:Results = New-Object System.Collections.ArrayList

function Add-Result([string]$Status, [string]$Name, [string]$Detail) {
  [void]$script:Results.Add([pscustomobject]@{ Status = $Status; Name = $Name; Detail = $Detail })
  $color = switch ($Status) { '통과' { 'Green' } '주의' { 'Yellow' } '필요' { 'Red' } default { 'Gray' } }
  Write-Host ("  [{0}] {1}: {2}" -f $Status, $Name, $Detail) -ForegroundColor $color
}

function Save-Results([string]$Folder, [string]$Mode) {
  $path = Join-Path $Folder ("결과_{0}.txt" -f $env:COMPUTERNAME)
  $lines = @("컴퓨터: $env:COMPUTERNAME", "시각: $(Get-Date -Format 'yyyy-MM-dd HH:mm')", "방식: $Mode", '')
  $lines += $script:Results | ForEach-Object { "[{0}] {1}: {2}" -f $_.Status, $_.Name, $_.Detail }
  try {
    Set-Content -LiteralPath $path -Value $lines -Encoding UTF8 -ErrorAction Stop
    return $path
  } catch {
    return $null
  }
}
