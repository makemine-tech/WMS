# 상시 컴퓨터 이지에이전트를 옛 D:\ez_PrintAgent(1.0.16, PDF 안 만듦)에서 C:\ez_PrintAgent(1.1.9)로 교체 (2026-11-02)
# 대표님이 y 를 눌러야 바뀜. -Restore 는 되돌리기. 결과는 같은 폴더 에이전트교체_컴퓨터이름.txt
param([switch]$Restore)
. "$PSScriptRoot\agent_socket.ps1"
. "$PSScriptRoot\common.ps1"
$NewDir = 'C:\ez_PrintAgent'
$OldDir = 'D:\ez_PrintAgent'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$TestUrl = 'https://makewon.com/agent_test.html'
$Backup = Join-Path $PSScriptRoot "에이전트교체_되돌리기값_$env:COMPUTERNAME.txt"
$out = New-Object System.Collections.ArrayList
function Say($t) { [void]$out.Add([string]$t); Write-Host $t }
function Save-Result { [IO.File]::WriteAllLines((Join-Path $PSScriptRoot "에이전트교체_$env:COMPUTERNAME.txt"), [string[]]$out, (New-Object System.Text.UTF8Encoding($true))) }
function Finish($t) { Say $t; Save-Result; Write-Host ''; Write-Host '이 창은 닫아도 됩니다.'; exit }
function Agent-Now { Get-Process ez_printAgent -ErrorAction SilentlyContinue | Select-Object -First 1 }
function Start-Agent($dir) {
  Start-Process (Join-Path $dir 'ez_printAgent.exe') -WorkingDirectory $dir
  foreach ($i in 1..15) {
    Start-Sleep 2
    $s = Open-AgentSocket
    if ($s) { return $s }
  }
  return $null
}
function Stop-Agent {
  Get-Process ez_printAgent -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 3
}

Say "컴퓨터 $env:COMPUTERNAME / $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') / $(if ($Restore) { '되돌리기' } else { '교체' })"
if ($env:COMPUTERNAME -eq $script:DevPc) { Finish "개발 노트북($($script:DevPc))에서는 실행하지 않습니다. 아무것도 바꾸지 않았습니다." }

$cur = Agent-Now
Say "지금 도는 에이전트: $(if ($cur) { $cur.Path } else { '없음' })"

# 출력 중이면 바꾸지 않음: 오늘 로그의 마지막 출력 동작이 print_start 이고 5분 안이면 진행 중으로 봄
if ($cur) {
  $log = Join-Path (Split-Path $cur.Path) "Log\ezAgent_$(Get-Date -Format 'yyyy-MM-dd').log"
  if (Test-Path $log) {
    $last = @(Get-Content $log -Encoding UTF8 | Where-Object { $_ -match '"action":"print_(start|end)"' }) | Select-Object -Last 1
    if ($last -match 'print_start' -and (Get-Item $log).LastWriteTime -gt (Get-Date).AddMinutes(-5)) {
      Finish '송장출력이 진행 중인 것 같습니다. 끝난 뒤 다시 실행해 주세요. 아무것도 바꾸지 않았습니다.'
    }
  }
}

if ($Restore) {
  if (-not (Test-Path $Backup)) { Finish '되돌릴 기록이 없습니다. 아무것도 바꾸지 않았습니다.' }
  if ((Read-Host '옛 이지에이전트(D:)로 되돌립니다. 진행하려면 y') -ne 'y') { Finish '취소했습니다. 아무것도 바꾸지 않았습니다.' }
  Stop-Agent
  Get-Content $Backup -Encoding UTF8 | ForEach-Object { $p = $_ -split '\|', 2; if ($p.Count -eq 2) { Set-ItemProperty $RunKey -Name $p[0] -Value $p[1]; Say "시작 등록 되돌림: $($p[0]) = $($p[1])" } }
  $s = Start-Agent $OldDir
  if ($s) { $s.ws.Dispose() }
  $n = Agent-Now
  Finish "지금 도는 에이전트: $(if ($n) { $n.Path } else { '없음' })"
}

$exe = Join-Path $NewDir 'ez_printAgent.exe'
if (-not (Test-Path $exe)) { Finish "$exe 가 없습니다. 아무것도 바꾸지 않았습니다." }
$ver = (Get-Content (Join-Path $NewDir 'ez_PrintAgent.txt') -ErrorAction SilentlyContinue | Select-Object -Last 1)
Say "새 에이전트: $exe ($ver)"
if (-not (Test-Path (Join-Path $NewDir 'ChromeHeadlessShell'))) { Finish '새 에이전트에 내장 크롬이 없습니다. 아무것도 바꾸지 않았습니다.' }

# 시작 등록 찾기
$run = Get-ItemProperty $RunKey
$hits = @($run.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' -and "$($_.Value)" -match 'ez_printAgent' })
$hits | ForEach-Object { Say "시작 등록(사용자): $($_.Name) = $($_.Value)" }
$lm = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
if ($lm) { $lm.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' -and "$($_.Value)" -match 'ez_printAgent' } | ForEach-Object { Say "주의, 시작 등록(전체 사용자, 안 바꿈): $($_.Name) = $($_.Value)" } }
Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -match 'ez_printAgent' } | ForEach-Object { Say "주의, 서비스(안 바꿈): $($_.Name) $($_.State) $($_.PathName)" }
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { ($_.Actions | ForEach-Object { $_.Execute }) -match 'ez_printAgent' } | ForEach-Object { Say "주의, 예약 작업(안 바꿈): $($_.TaskName)" }
foreach ($dir in [Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup')) { Get-ChildItem $dir -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'ez|agent' } | ForEach-Object { Say "주의, 시작프로그램 폴더(안 바꿈): $($_.FullName)" } }

Write-Host ''
Write-Host '이지에이전트를 끄고 C 의 1.1.9 로 바꿉니다. 그동안 송장출력을 하지 마세요.'
if ((Read-Host '진행하려면 y') -ne 'y') { Finish '취소했습니다. 아무것도 바꾸지 않았습니다.' }

if (-not (Test-Path $Backup)) { [IO.File]::WriteAllLines($Backup, [string[]]($hits | ForEach-Object { "$($_.Name)|$($_.Value)" }), (New-Object System.Text.UTF8Encoding($true))) }
Stop-Agent
if (Agent-Now) { Finish "주의: 끈 뒤에도 $((Agent-Now).Path) 가 다시 떴습니다. 다른 곳에서 켜 주는 것 같습니다. 시작 등록은 안 바꿨습니다." }
$hits | ForEach-Object { Set-ItemProperty $RunKey -Name $_.Name -Value $exe; Say "시작 등록 변경: $($_.Name) = $exe" }
if (-not $hits.Count) { Set-ItemProperty $RunKey -Name 'ez_PrintAgent_service' -Value $exe; Say "시작 등록 추가: ez_PrintAgent_service = $exe" }

$s = Start-Agent $NewDir
$n = Agent-Now
Say "지금 도는 에이전트: $(if ($n) { $n.Path } else { '없음' })"
if (-not $s) { Finish '실패: 새 에이전트가 연결을 받지 않습니다. 이지에이전트_되돌리기.cmd 로 되돌릴 수 있습니다.' }

Send-Agent $s.ws '{"action":"req_printer_list"}'
$m = Read-Agent $s.ws 10 { param($x) $x -match 'printer_list' }
if (-not $m) { $s.ws.Dispose(); Finish '실패: 프린터 목록을 받지 못했습니다.' }
$list = $m | ConvertFrom-Json
Say "에이전트 버전: $($list.ez_Agent_version)"
$virtual = @(Get-Printer | Where-Object { $_.Name -match 'BIXOLON' -and $_.DriverName -match 'ezPDF' })
if ($virtual.Count -ne 1 -or (@($list.printer_list | ForEach-Object { $_.name }) -notcontains $virtual[0].Name)) {
  $s.ws.Dispose(); Finish '교체는 됐지만 가상 프린터를 하나로 특정하지 못해 시험 출력은 하지 않았습니다.'
}
$pname = $virtual[0].Name

# 시험 출력: 가짜 페이지를 가상 프린터로. 실제 프린터로는 보내지 않고, 만든 시험 PDF 는 지움 (자동수집에 섞이지 않게)
$today = Join-Path $NewDir "PdfFile\$(Get-Date -Format 'yyyy-MM-dd')"
Say "시험 출력: $TestUrl → $pname"
Send-Agent $s.ws '{"action":"initPrint"}'
[void](Read-Agent $s.ws 5 { param($x) $x -match 'print_start' })
Send-Agent $s.ws ('{"action":"print_start","file":"' + $TestUrl + '","printer":"' + $pname + '","template_seq":"5"}')
$r = Read-Agent $s.ws 90 { param($x) $x -match 'print_result|error' }
Say "에이전트 응답: $(if ($r) { $r.Substring(0, [Math]::Min(160, $r.Length)) } else { '90초 안에 없음' })"
Send-Agent $s.ws '{"action":"print_end"}'
Start-Sleep 2
$s.ws.Dispose()
$made = @(Get-ChildItem $today -Filter '*agent_test*.pdf' -ErrorAction SilentlyContinue)
if ($made.Count) {
  Say "성공: PDF 가 생겼습니다 $($made[0].FullName) ($($made[0].Length) 바이트)"
  $made | Remove-Item -Force -ErrorAction SilentlyContinue
  Say '시험 PDF 는 지웠습니다.'
} else {
  Say "시험 PDF 를 $today 에서 찾지 못했습니다. 폴더 안 PDF $(@(Get-ChildItem $today -Filter *.pdf -ErrorAction SilentlyContinue).Count)개"
  Say '에이전트가 외부 주소를 거절했을 수 있으니 다음 실제 출력 때 PDF점검.cmd 로 확인합니다.'
}
Write-Host ''
Finish '끝났습니다. 이지어드민 송장출력 화면은 새로고침해야 새 에이전트에 연결됩니다.'
