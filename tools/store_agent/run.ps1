# 스마트스토어 매출 수집 한 번 — 작업 스케줄러가 10분마다 부름 (install.ps1 이 등록)
# 키는 이 컴퓨터·이 사용자만 풀 수 있게 암호화해 둔 %LOCALAPPDATA%\MakewonStore\keys.xml 에서 꺼냄

$home2 = Join-Path $env:LOCALAPPDATA 'MakewonStore'
$log   = Join-Path $home2 'log.txt'
function Write-Log($msg) {
  Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" -Encoding UTF8
  if ((Get-Item $log).Length -gt 512KB) { Get-Content $log -Tail 2000 -Encoding UTF8 | Set-Content $log -Encoding UTF8 }
}

$keys = Join-Path $home2 'keys.xml'
if (-not (Test-Path $keys)) { Write-Log '키가 없음 — 설치.cmd 를 다시 실행하세요'; exit 1 }
$cred = Import-Clixml $keys
$env:NAVER_COMMERCE_CLIENT_ID = $cred.UserName
$env:NAVER_COMMERCE_CLIENT_SECRET = $cred.GetNetworkCredential().Password

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
# node 는 UTF-8 로 말하므로 한글이 안 깨지게 맞추고, 오류 줄도 글자 그대로 받음
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
$out = (& $node (Join-Path $PSScriptRoot 'agent.js') 2>&1 | ForEach-Object { "$_" }) -join ' / '
$code = $LASTEXITCODE
Write-Log $out
Write-Output $out
exit $code
