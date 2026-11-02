# 송장 PDF 점검 (읽기만 함). 결과는 같은 폴더 PDF점검_컴퓨터이름.txt 로 드롭박스에 남음
$out = New-Object System.Collections.ArrayList
function Say($t) { [void]$out.Add([string]$t) }
$today = Get-Date -Format 'yyyy-MM-dd'
$root = 'C:\ez_PrintAgent'
Say "컴퓨터 $env:COMPUTERNAME / 사용자 $env:USERNAME / $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

Say ''; Say '[이지에이전트]'
Get-Process ez_printAgent -ErrorAction SilentlyContinue | ForEach-Object { Say "실행 중 pid $($_.Id) 세션 $($_.SessionId) 시작 $($_.StartTime) $($_.Path)" }
Say "설치 폴더: $(Test-Path $root)"
if (Test-Path $root) {
  Say "설정: $((Get-Content "$root\ez_config.txt" -Raw -ErrorAction SilentlyContinue) -replace '\s+', ' ')"
  Say "버전: $((Get-Content "$root\ez_PrintAgent.txt" -Raw -ErrorAction SilentlyContinue) -replace '\s+', ' ')"
  foreach ($d in 'Chrome', 'ChromeHeadlessShell') { Say "$d 폴더: $(Test-Path "$root\$d") 파일 $(@(Get-ChildItem "$root\$d" -Recurse -File -ErrorAction SilentlyContinue).Count)개" }
}

Say ''; Say '[PdfFile 폴더]'
Say "PdfFile 있음: $(Test-Path "$root\PdfFile")"
Get-ChildItem "$root\PdfFile" -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 6 | ForEach-Object {
  $f = @(Get-ChildItem $_.FullName -Filter *.pdf -ErrorAction SilentlyContinue)
  Say "$($_.Name): PDF $($f.Count)개, 최근 $(($f | Sort-Object LastWriteTime | Select-Object -Last 1).LastWriteTime)"
}
try { $acl = (Get-Acl "$root\PdfFile").Access | Where-Object { $_.IdentityReference -match 'Users|Everyone|' + [regex]::Escape($env:USERNAME) } | ForEach-Object { "$($_.IdentityReference)=$($_.FileSystemRights)" }; Say "권한: $($acl -join ', ')" } catch { Say "권한 못 읽음" }

Say ''; Say '[프린터]'
Get-Printer -ErrorAction SilentlyContinue | ForEach-Object { Say "$($_.Name) | $($_.DriverName) | $($_.PortName) | 상태 $($_.PrinterStatus)" }
Say "기본 프린터: $((Get-CimInstance Win32_Printer -Filter 'Default=True' -ErrorAction SilentlyContinue).Name)"
Get-PrintJob -PrinterName 'BIXOLON SLP-D420' -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { Say "대기열: $($_.DocumentName) $($_.JobStatus)" }
Get-PrintJob -PrinterName 'BIXOLON SLP-D 420' -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { Say "대기열: $($_.DocumentName) $($_.JobStatus)" }

Say ''; Say '[ezPDF 저장 위치]'
Get-ChildItem 'HKCU:\Software\UNIDOCS\ezPDF Builder' -ErrorAction SilentlyContinue | ForEach-Object {
  $k = $_; $k.Property | Where-Object { $_ -match 'path|folder|dir|save|auto|show|prompt|open|view' } | ForEach-Object { Say "$($k.PSChildName) | $_ = $($k.GetValue($_))" }
}

Say ''; Say '[최근 3일 PDF 찾기, 이름에 _20017_ 또는 오늘 만든 것]'
$since = (Get-Date).AddDays(-3)
$places = @("$root\PdfFile", (Join-Path $env:USERPROFILE 'Documents'), (Join-Path $env:USERPROFILE 'Desktop'), (Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'OneDrive'), $env:TEMP) | Where-Object { $_ -and (Test-Path $_) }
$hits = foreach ($p in $places) { Get-ChildItem $p -Recurse -Filter *.pdf -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $since } }
$hits = @($hits | Sort-Object LastWriteTime -Descending)
Say "찾은 PDF $($hits.Count)개"
$hits | Group-Object DirectoryName | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { Say "$($_.Count)개 $($_.Name)" }
$hits | Select-Object -First 5 | ForEach-Object { Say "  $($_.LastWriteTime.ToString('MM-dd HH:mm')) $($_.Name)" }

Say ''; Say "[에이전트 로그 $today 출력 흐름]"
$log = "$root\Log\ezAgent_$today.log"
Say "로그 있음: $(Test-Path $log)"
if (Test-Path $log) {
  $lines = @(Get-Content $log -Encoding UTF8 -ErrorAction SilentlyContinue)
  Say "전체 $($lines.Count)줄 / print_start $(@($lines | Where-Object { $_ -match 'print_start' }).Count) / generate $(@($lines | Where-Object { $_ -match 'generate pdf' }).Count) / pdf print start $(@($lines | Where-Object { $_ -match 'pdf print start' }).Count) / print_result $(@($lines | Where-Object { $_ -match 'print_result' }).Count)"
  Say '--- 오류 줄'
  $lines | Where-Object { $_ -match 'error|exception|fail|실패|오류|denied|not found' } | Select-Object -Last 15 | ForEach-Object { Say $_.Substring(0, [Math]::Min(220, $_.Length)) }
  Say '--- 출력 관련 마지막 40줄'
  $lines | Where-Object { $_ -match 'print|pdf|file' -and $_ -notmatch 'printer_list|"name"|req_printer' } | Select-Object -Last 40 | ForEach-Object { Say $_.Substring(0, [Math]::Min(220, $_.Length)) }
}

$file = Join-Path $PSScriptRoot "PDF점검_$env:COMPUTERNAME.txt"
[IO.File]::WriteAllLines($file, [string[]]$out, (New-Object System.Text.UTF8Encoding($true)))
Write-Host ''
Write-Host "끝났습니다. 결과 파일: $file"
Write-Host '이 창은 닫아도 됩니다.'
