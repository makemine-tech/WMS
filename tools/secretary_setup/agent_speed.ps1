# 이지에이전트 프린터 단계 속도 시험 (2026-11-02). 송장이 아닌 시험 페이지만 씀
# 지금 쓰는 가상 프린터와, 종이도 파일도 안 나가는 임시 프린터(NUL 포트)를 비교하고 임시 프린터는 지움. 결과는 같은 폴더 속도시험_컴퓨터이름.txt
. "$PSScriptRoot\agent_socket.ps1"
. "$PSScriptRoot\common.ps1"
$TestUrl = 'https://makewon.com/agent_test.html'
$TempPrinter = 'MKW_NUL_TEST'
$Rounds = 3
$out = New-Object System.Collections.ArrayList
function Say($t) { [void]$out.Add([string]$t); Write-Host $t }
function Finish($t) {
  Say $t
  [IO.File]::WriteAllLines((Join-Path $PSScriptRoot "속도시험_$env:COMPUTERNAME.txt"), [string[]]$out, (New-Object System.Text.UTF8Encoding($true)))
  Write-Host ''
  [void](Read-Host '끝났습니다. Enter 를 누르면 창이 닫힙니다')
  exit
}
if ($env:COMPUTERNAME -eq $script:DevPc) { Say "개발 노트북($($script:DevPc))에서는 실행하지 않습니다."; [void](Read-Host 'Enter'); exit }

# 임시 프린터를 만들고 지우려면 관리자 권한이 필요. 창이 한 번 더 뜸
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  exit
}

Say "컴퓨터 $env:COMPUTERNAME / $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$agent = Get-Process ez_printAgent -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $agent) { Finish '이지에이전트가 돌고 있지 않습니다. 아무것도 하지 않았습니다.' }
$root = Split-Path $agent.Path
Say "에이전트: $($agent.Path)"

$log = Join-Path $root "Log\ezAgent_$(Get-Date -Format 'yyyy-MM-dd').log"
if (Test-Path $log) {
  $last = @(Get-Content $log -Encoding UTF8 | Where-Object { $_ -match '"action":"print_(start|end)"' }) | Select-Object -Last 1
  if ($last -match 'print_start' -and (Get-Item $log).LastWriteTime -gt (Get-Date).AddMinutes(-5)) { Finish '송장출력이 진행 중인 것 같습니다. 끝난 뒤 다시 실행해 주세요. 아무것도 하지 않았습니다.' }
}

$virtual = @(Get-Printer | Where-Object { $_.Name -match 'BIXOLON' -and $_.DriverName -match 'ezPDF' })
if ($virtual.Count -ne 1) { Finish '가상 프린터를 하나로 특정하지 못했습니다. 아무것도 하지 않았습니다.' }

function Run-Test($s, [string]$printer) {
  Send-Agent $s.ws '{"action":"initPrint"}'
  [void](Read-Agent $s.ws 5 { param($x) $x -match 'print_start' })
  $t0 = Get-Date
  Send-Agent $s.ws ('{"action":"print_start","file":"' + $TestUrl + '","printer":"' + $printer + '","template_seq":"5"}')
  $r = Read-Agent $s.ws 120 { param($x) $x -match 'print_result|error' }
  $total = [Math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  Send-Agent $s.ws '{"action":"print_end"}'
  [void](Read-Agent $s.ws 3 { param($x) $x -match 'print_end' })
  if (-not $r -or $r -notmatch '"print_result":"2"') { return "실패 ($($total)초) $(if ($r) { $r.Substring(0, [Math]::Min(120, $r.Length)) })" }
  $j = $r | ConvertFrom-Json
  $p = [Math]::Round(([datetime]$j.end - [datetime]$j.start).TotalSeconds, 0)
  $pdf = @(Get-ChildItem (Join-Path $root "PdfFile\$(Get-Date -Format 'yyyy-MM-dd')") -Filter 'agent_test*.pdf' -ErrorAction SilentlyContinue).Count
  return "전체 $($total)초 · 프린터 단계 $($p)초 · PDF ${pdf}개"
}
function Run-Rounds([string]$printer) {
  $s = Open-AgentSocket
  if (-not $s) { Say '에이전트에 연결하지 못했습니다.'; return }
  Send-Agent $s.ws '{"action":"req_printer_list"}'
  $m = Read-Agent $s.ws 10 { param($x) $x -match 'printer_list' }
  if (-not $m -or (@(($m | ConvertFrom-Json).printer_list | ForEach-Object { $_.name }) -notcontains $printer)) { Say "$printer 가 에이전트 목록에 없어 시험하지 않았습니다."; $s.ws.Dispose(); return }
  Say ''; Say "[$printer]"
  foreach ($i in 1..$Rounds) { Say "$i 회: $(Run-Test $s $printer)" }
  $s.ws.Dispose()
}
function Clean-Test {
  Get-ChildItem (Join-Path $root "PdfFile\$(Get-Date -Format 'yyyy-MM-dd')") -Filter 'agent_test*.pdf' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem (Join-Path ([Environment]::GetFolderPath('Desktop')) '11') -Filter '*agent_test*.pdf' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

Run-Rounds $virtual[0].Name
Clean-Test

try {
  $driver = 'Generic / Text Only'
  if (-not (Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue)) { Add-PrinterDriver -Name $driver -ErrorAction Stop }
  if (-not (Get-PrinterPort -Name 'NUL:' -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name 'NUL:' -ErrorAction Stop }
  Add-Printer -Name $TempPrinter -DriverName $driver -PortName 'NUL:' -ErrorAction Stop
  $made = Get-Printer -Name $TempPrinter -ErrorAction Stop
  if ($made.PortName -ne 'NUL:') { throw "임시 프린터 포트가 NUL 이 아닙니다: $($made.PortName)" }
  Say ''; Say "임시 프린터 만듦: $TempPrinter (포트 NUL:, 종이 안 나감)"
  Run-Rounds $TempPrinter
} catch {
  Say ''; Say "임시 프린터 시험 못 함: $($_.Exception.Message)"
} finally {
  Clean-Test
  Remove-Printer -Name $TempPrinter -ErrorAction SilentlyContinue
  Say "임시 프린터 남음: $([bool](Get-Printer -Name $TempPrinter -ErrorAction SilentlyContinue))"
}
Say "기본 프린터: $((Get-CimInstance Win32_Printer -Filter 'Default=True' -ErrorAction SilentlyContinue).Name)"
Finish '시험 끝'
