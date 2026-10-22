# MAKEWON 매일 밤 백업
#   1) 파일   : WMS·MAKE-WMS 를 Dropbox\MAKEWON\파일\ 로 그대로 맞춤(node_modules·작업용 복사본·.git 제외)
#   2) git기록: 저장소 전체 기록 묶음(.bundle) — 날짜별, 최근 14개 보관
#   3) firebase: Realtime Database 전체 내보내기(.zip) — 날짜별, 최근 60개 보관
#   +  claude설정: Claude 기억(메모)·설정 파일
# 설치·등록: tools\backup\install_backup_task.ps1

$ErrorActionPreference = 'Continue'
$env:NODE_OPTIONS = '--no-deprecation'

$GitHub  = 'C:\Users\dmzoo\OneDrive\Documents\GitHub'
$Dest    = 'C:\Users\dmzoo\Dropbox\MAKEWON'
$Repos   = @('WMS', 'MAKE-WMS')
$Project = 'makechango-wms'
$KeepBundles = 14
$KeepDb      = 60

$today = Get-Date -Format 'yyyy-MM-dd'
$log   = Join-Path $Dest '백업기록.log'
$fail  = @()

function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  # 드롭박스가 동기화 중 기록 파일을 잠깐 잠그므로 몇 번 다시 시도
  for ($i = 0; $i -lt 10; $i++) {
    try { Add-Content -Path $log -Value $line -Encoding UTF8 -ErrorAction Stop; break }
    catch { Start-Sleep -Milliseconds 500 }
  }
  Write-Output $line
}

function Remove-Old($dir, $filter, $keep) {
  Get-ChildItem $dir -Filter $filter -File | Sort-Object Name -Descending |
    Select-Object -Skip $keep | Remove-Item -Force
}

foreach ($d in 'git기록', 'firebase', '파일') {
  New-Item -ItemType Directory -Force (Join-Path $Dest $d) | Out-Null
}
Write-Log '===== 백업 시작 ====='

# 1) 파일
foreach ($r in $Repos) {
  $src = Join-Path $GitHub $r
  if (-not (Test-Path $src)) { Write-Log "[파일] $r 없음 — 건너뜀"; $fail += "파일 $r"; continue }
  $dst = Join-Path $Dest "파일\$r"
  robocopy $src $dst /MIR /XD node_modules .git worktrees .firebase /R:2 /W:5 /NP /NFL /NDL /NJH /NJS | Out-Null
  # robocopy: 0~7 정상, 8 이상 실패
  if ($LASTEXITCODE -ge 8) { Write-Log "[파일] $r 실패 (코드 $LASTEXITCODE)"; $fail += "파일 $r" }
  else { Write-Log "[파일] $r 완료" }
}

# 1-2) Claude 기억·설정 (로그인 정보 파일은 넣지 않음)
$claude = Join-Path $env:USERPROFILE '.claude'
$cDest  = Join-Path $Dest 'claude설정'
New-Item -ItemType Directory -Force $cDest | Out-Null
foreach ($f in 'settings.json', 'CLAUDE.md', 'keybindings.json') {
  $p = Join-Path $claude $f
  if (Test-Path $p) { Copy-Item $p $cDest -Force }
}
Get-ChildItem (Join-Path $claude 'projects') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $mem = Join-Path $_.FullName 'memory'
  if (Test-Path $mem) {
    robocopy $mem (Join-Path $cDest "기억\$($_.Name)") /MIR /R:2 /W:5 /NP /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { $fail += "기억 $($_.Name)" }
  }
}
Write-Log '[claude] 기억·설정 복사 완료'

# 2) git 전체 기록 묶음
foreach ($r in $Repos) {
  $src = Join-Path $GitHub $r
  if (-not (Test-Path (Join-Path $src '.git'))) { continue }
  $out = Join-Path $Dest "git기록\${r}_$today.bundle"
  git -C $src bundle create $out --all 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) {
    git -C $src bundle verify $out 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Log "[git] $r 묶음 완료 ($([math]::Round((Get-Item $out).Length/1MB,1))MB)" }
    else { Write-Log "[git] $r 묶음 검증 실패"; $fail += "git $r" }
  } else { Write-Log "[git] $r 묶음 실패"; $fail += "git $r" }
  Remove-Old (Join-Path $Dest 'git기록') "${r}_*.bundle" $KeepBundles
}

# 3) Firebase Realtime Database
$fbDir = Join-Path $Dest 'firebase'
$json  = Join-Path $env:TEMP "makewon_db_$today.json"
$zip   = Join-Path $fbDir "db_$today.zip"
Push-Location (Join-Path $GitHub 'WMS')
firebase database:get / --project $Project --output $json 2>&1 | Out-Null
Pop-Location
if ((Test-Path $json) -and (Get-Item $json).Length -gt 1000) {
  Compress-Archive -Path $json -DestinationPath $zip -Force
  Remove-Item $json -Force
  Write-Log "[firebase] DB 내보내기 완료 ($([math]::Round((Get-Item $zip).Length/1MB,1))MB)"
  Remove-Old $fbDir 'db_*.zip' $KeepDb
} else {
  Write-Log '[firebase] DB 내보내기 실패 — firebase login 상태 확인 필요'
  $fail += 'firebase'
}

if ($fail.Count) { Write-Log "===== 끝: 실패 $($fail -join ', ') =====" }
else { Write-Log '===== 끝: 전부 성공 =====' }
