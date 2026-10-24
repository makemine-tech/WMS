# 이미 설치된 매출 수집기를 「창 없이」 실행되게만 바꿈 — 키(keys.xml)·실행 간격은 그대로 둠 (2026-10-24)
# 「창숨김_적용.cmd」 를 더블클릭. 작업 스케줄러의 「MAKEWON 스토어 매출」 작업이 부르는 프로그램만
#   powershell.exe(창이 잠깐 뜸)  →  wscript.exe + run_hidden.vbs(창이 아예 안 뜸)  으로 바꿈.

$ErrorActionPreference = 'Stop'
$name   = 'MAKEWON 스토어 매출'
$hidden = Join-Path $PSScriptRoot 'run_hidden.vbs'
if (-not (Test-Path $hidden)) { Write-Host "run_hidden.vbs 가 이 폴더에 없습니다: $PSScriptRoot" -ForegroundColor Yellow; exit 1 }

$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if (-not $task) { Write-Host "작업 「$name」 이 없습니다 — 처음 설치라면 「설치.cmd」 를 실행하세요." -ForegroundColor Yellow; exit 1 }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$hidden`""
Set-ScheduledTask -TaskName $name -Action $action | Out-Null
$t = Get-ScheduledTask -TaskName $name
$rep = ($t.Triggers | Select-Object -First 1).Repetition.Interval
Write-Host "바꿈 완료 — 작업 「$name」 은 이제 창 없이 실행됩니다 (간격 $rep 그대로)." -ForegroundColor Green

Write-Host '지금 한 번 창 없이 돌려 봅니다…'
Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 20
$info = Get-ScheduledTaskInfo -TaskName $name
$log = Join-Path (Join-Path $env:LOCALAPPDATA 'MakewonStore') 'log.txt'
Write-Host "마지막 실행 $($info.LastRunTime) · 결과 코드 $($info.LastTaskResult) (0 이면 성공, 267009 는 아직 도는 중)"
if (Test-Path $log) { Write-Host '로그 마지막 줄:'; Get-Content $log -Tail 1 -Encoding UTF8 }
