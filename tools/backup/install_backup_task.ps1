# 백업 스크립트를 Dropbox\MAKEWON\_스크립트 로 복사하고, 매일 밤 3시 작업 스케줄러에 등록
# 컴퓨터가 꺼져 있었으면 켜진 뒤 바로 한 번 돌림

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = 'C:\Users\dmzoo\Dropbox\MAKEWON\_스크립트'
New-Item -ItemType Directory -Force $target | Out-Null

# Windows PowerShell 5.1 이 한글을 읽도록 UTF-8(BOM) 으로 저장
$text = [IO.File]::ReadAllText((Join-Path $here 'backup_makewon.ps1'), [Text.Encoding]::UTF8)
$script = Join-Path $target 'backup_makewon.ps1'
[IO.File]::WriteAllText($script, $text, (New-Object Text.UTF8Encoding $true))

$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger  = New-ScheduledTaskTrigger -Daily -At 3am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'MAKEWON 매일 백업' -Action $action -Trigger $trigger -Settings $settings -Description 'WMS·MAKE-WMS 파일, git 기록 묶음, Firebase DB 를 Dropbox\MAKEWON 으로 백업' -Force | Out-Null
Write-Output "등록 완료: $script (매일 03:00)"
