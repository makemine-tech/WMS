# 스마트스토어 매출 수집기 설치 — 커머스API센터에 IP 를 등록한 컴퓨터에서 「설치.cmd」 를 더블클릭
#  1) Node.js 확인  2) 애플리케이션 ID·시크릿 입력(이 컴퓨터·이 사용자만 풀 수 있게 암호화해 저장)
#  3) 10분마다 도는 작업 등록  4) 바로 한 번 돌려 결과 보여 줌
# 다시 실행하면 키를 새로 넣고 작업을 덮어씀.

$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host '=== 광고 관제 · 스마트스토어 매출 수집기 설치 ===' -ForegroundColor Cyan

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node -and (Test-Path 'C:\Program Files\nodejs\node.exe')) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not $node) {
  Write-Host 'Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요.' -ForegroundColor Yellow
  exit 1
}
$ver = (& $node -v).TrimStart('v'); if ([int]($ver.Split('.')[0]) -lt 18) { Write-Host "Node.js $ver 는 너무 오래됐습니다. LTS 로 새로 설치하세요." -ForegroundColor Yellow; exit 1 }
Write-Host "Node.js $ver 확인"

if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules\bcryptjs'))) {
  Write-Host '필요한 부품을 받는 중…'
  Push-Location $PSScriptRoot; & npm install --omit=dev --no-audit --no-fund | Out-Null; Pop-Location
}

$home2 = Join-Path $env:LOCALAPPDATA 'MakewonStore'
New-Item -ItemType Directory -Force $home2 | Out-Null
Write-Host ''
# 이 창에서는 Ctrl+V 가 붙여넣기 대신 제어 글자를 넣으므로, 복사해 둔 값(클립보드)을 직접 읽는다
function Read-Clip { ((Get-Clipboard -Raw) -as [string]) -replace '[^\x21-\x7E]', '' }
Write-Host '커머스API센터 → 애플리케이션 상세 화면을 열어 두세요. 여기에는 붙여넣지 않습니다.'
Write-Host ''
Read-Host '1) 애플리케이션 ID 를 복사(복사 버튼 또는 Ctrl+C)한 뒤, 이 창으로 와서 엔터' | Out-Null
$id = Read-Clip
if (-not $id) { Write-Host '복사된 값이 없습니다. 다시 실행해서 ID 를 복사한 뒤 엔터를 누르세요.' -ForegroundColor Yellow; exit 1 }
Write-Host "   ID 읽음: $id"
Read-Host '2) 애플리케이션 시크릿을 복사(복사 버튼 또는 Ctrl+C)한 뒤, 이 창으로 와서 엔터' | Out-Null
$plain = Read-Clip
if (-not $plain) { Write-Host '복사된 값이 없습니다. 다시 실행해서 시크릿을 복사한 뒤 엔터를 누르세요.' -ForegroundColor Yellow; exit 1 }
cmd /c 'echo off | clip'   # 클립보드에서 시크릿 지움
Write-Host "   시크릿 읽음 ($($plain.Length)자, 화면에는 안 보여 줌)"
# 네이버 시크릿은 $2a$04$ 로 시작하는 29자 — 아니면 ID 를 넣었거나 다른 값을 넣은 것
if ($plain -notmatch '^\$2[aby]?\$\d\d\$') {
  Write-Host "시크릿 모양이 아닙니다 (넣은 길이 $($plain.Length)자). 시크릿은 `$2a`$ 로 시작합니다." -ForegroundColor Yellow
  Write-Host '커머스API센터에서 시크릿의 「복사」 버튼으로 다시 복사한 뒤, 이 파일을 다시 실행하세요.' -ForegroundColor Yellow
  exit 1
}
if ($plain -eq $id) { Write-Host 'ID 와 시크릿이 같습니다. 시크릿 칸에는 시크릿을 넣어야 합니다.' -ForegroundColor Yellow; exit 1 }
$secret = ConvertTo-SecureString $plain -AsPlainText -Force
$plain = $null
New-Object System.Management.Automation.PSCredential($id, $secret) | Export-Clixml (Join-Path $home2 'keys.xml')
Write-Host '키 저장 완료 (이 컴퓨터의 이 사용자만 풀 수 있게 암호화)'

$run = Join-Path $PSScriptRoot 'run.ps1'
$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$run`""
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'MAKEWON 스토어 매출' -Action $action -Trigger $trigger -Settings $settings -Description '스마트스토어 매출을 광고 관제로 보냄 (10분마다)' -Force | Out-Null
Write-Host '10분마다 도는 작업 등록 완료 (작업 스케줄러: MAKEWON 스토어 매출)'

Write-Host ''
Write-Host '지금 한 번 돌려 봅니다…'
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $run
if ($LASTEXITCODE -eq 0) { Write-Host "성공: $out" -ForegroundColor Green }
else { Write-Host "실패: $out" -ForegroundColor Red; Write-Host '이 화면을 캡처해서 Claude 에게 보내 주세요.' }
Write-Host ''
Write-Host '이 컴퓨터는 로그인한 상태로 두세요(화면 잠금은 괜찮음). 로그아웃하면 작업이 멈춥니다.'
