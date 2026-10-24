# 스마트스토어 매출 수집기 제거 — 「제거.cmd」 를 더블클릭 (2026-10-24)
# 수집 컴퓨터를 다른 컴퓨터로 옮길 때 「이전 컴퓨터」에서 실행.
#   1) 작업 스케줄러의 「MAKEWON 스토어 매출」 작업 삭제
#   2) 이 컴퓨터에 암호화해 둔 키·로그(%LOCALAPPDATA%\MakewonStore) 삭제
# 수집기 폴더(드롭박스 스토어수집기)는 지우지 않음 — 새 컴퓨터가 같은 폴더를 씀.
# 이전 컴퓨터를 그대로 두면 IP 가 안 맞아 10분마다 실패를 보내서, 광고 관제 화면이 「실패」 와 「받음」 사이를 오락가락함.

$name  = 'MAKEWON 스토어 매출'
$home2 = Join-Path $env:LOCALAPPDATA 'MakewonStore'
Write-Host ''
Write-Host '=== 광고 관제 · 스마트스토어 매출 수집기 제거 ===' -ForegroundColor Cyan
Write-Host "컴퓨터: $env:COMPUTERNAME / 사용자: $env:USERNAME"
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Write-Host ('작업 스케줄러 「' + $name + '」: ' + $(if ($task) { '있음' } else { '없음' }))
Write-Host ('키·로그 폴더: ' + $(if (Test-Path $home2) { $home2 } else { '없음' }))
if (-not $task -and -not (Test-Path $home2)) { Write-Host '이 컴퓨터에는 설치된 것이 없습니다.' -ForegroundColor Green; exit 0 }
Write-Host ''
$ok = Read-Host '이 컴퓨터에서 수집기를 지울까요? (y 입력 후 엔터)'
if ($ok -ne 'y' -and $ok -ne 'Y') { Write-Host '그만뒀습니다.'; exit 0 }

if ($task) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Host '작업 삭제 완료' -ForegroundColor Green }
if (Test-Path $home2) { Remove-Item -Recurse -Force $home2; Write-Host '키·로그 삭제 완료' -ForegroundColor Green }
Write-Host ''
Write-Host '끝. 새 컴퓨터에서는 같은 폴더의 「설치.cmd」 를 실행하세요 (커머스API센터에 새 컴퓨터 IP 를 먼저 등록).'
