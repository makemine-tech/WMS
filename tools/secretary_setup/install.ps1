# 메이크창고 전담비서 상시 컴퓨터 설치 — 드롭박스 폴더의 「설치.cmd」 를 더블클릭 (점검만 할 때는 「점검.cmd」)
#  1) 컴퓨터 점검  2) 전원 연결 때 절전 끄기  3) 파일 복사  4) 바탕화면 바로가기
#  5) 크롬 지킴이 등록(5분마다)  6) 사람이 할 일 안내  7) 결과 저장
# 다시 실행해도 안전함. 비밀번호는 어디에도 저장하지 않고, 스토어 수집기는 확인만 함.
# -Sandbox 폴더: 시험용. 그 폴더 안에만 파일을 만들고 전원·작업 스케줄러·크롬 실행은 건너뜀.

param(
  [switch]$CheckOnly,
  [string]$Sandbox
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-SetupPaths $Sandbox

function Test-Environment {
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  Add-Result '안내' '컴퓨터 이름' $env:COMPUTERNAME

  if ($os.Caption -match 'Windows 10') { Add-Result '주의' '윈도우' "$($os.Caption) (보안 지원 종료, 업그레이드 때 교체 권장)" }
  else { Add-Result '통과' '윈도우' $os.Caption }

  $ram = [math]::Round($cs.TotalPhysicalMemory / 1GB)
  if ($ram -lt 8) { Add-Result '주의' '메모리' "${ram}GB (8GB 이상 권장)" } else { Add-Result '통과' '메모리' "${ram}GB" }

  $free = [math]::Round((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace / 1GB)
  if ($free -lt 20) { Add-Result '주의' 'C 드라이브 여유' "${free}GB (20GB 이상 권장)" } else { Add-Result '통과' 'C 드라이브 여유' "${free}GB" }

  if ($cs.PCSystemType -eq 2) { Add-Result '주의' '컴퓨터 종류' '노트북: 전원을 연결하고 뚜껑을 닫아도 잠들지 않게 해야 함' }
  else { Add-Result '통과' '컴퓨터 종류' '데스크톱' }

  $chrome = Find-Chrome
  if ($chrome) { Add-Result '통과' '크롬' (Get-Item $chrome).VersionInfo.ProductVersion }
  else { Add-Result '필요' '크롬' '없음: 크롬을 설치한 뒤 다시 실행' }

  $agent = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'ez_PrintAgent' } | Select-Object -First 1
  if ($agent) {
    $running = [bool](Get-Process -Name 'ez_printAgent' -ErrorAction SilentlyContinue)
    Add-Result $(if ($running) { '통과' } else { '주의' }) '이지에이전트' "$($agent.DisplayVersion) 설치됨, $(if ($running) { '실행 중' } else { '실행 안 됨' })"
  } else { Add-Result '필요' '이지에이전트' '없음: 이지어드민에서 받아 설치' }

  $printer = Get-CimInstance Win32_Printer -Filter "Name='BIXOLON SLP-D 420'" -ErrorAction SilentlyContinue
  if (-not $printer) { Add-Result '필요' '가상 프린터' '「BIXOLON SLP-D 420」 없음: ezPDF Builder 와 함께 설치' }
  elseif ($printer.DriverName -match 'ezPDF') { Add-Result '통과' '가상 프린터' "BIXOLON SLP-D 420 ($($printer.DriverName))" }
  else { Add-Result '주의' '가상 프린터' "같은 이름이 실제 프린터일 수 있음 (드라이버 $($printer.DriverName))" }

  $sb = Get-AcSeconds 'STANDBYIDLE'
  $hb = Get-AcSeconds 'HIBERNATEIDLE'
  Add-Result $(if ($sb -eq 0) { '통과' } else { '주의' }) '절전 (전원 연결)' (Format-Seconds $sb)
  Add-Result $(if ($hb -eq 0 -or $null -eq $hb) { '통과' } else { '주의' }) '최대 절전 (전원 연결)' (Format-Seconds $hb)

  $store = Get-ScheduledTask -TaskName $script:StoreTask -ErrorAction SilentlyContinue
  Add-Result '안내' '스토어 수집기' $(if ($store) { '있음 (건드리지 않음)' } else { '없음' })

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  foreach ($url in $script:SiteUrls) {
    try {
      Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 15 | Out-Null
      Add-Result '통과' '접속' $url
    } catch {
      if ($_.Exception.Response) { Add-Result '통과' '접속' "$url (서버 응답 $([int]$_.Exception.Response.StatusCode))" }
      else { Add-Result '필요' '접속' "$url 연결 안 됨" }
    }
  }
}

function Install-Power {
  $state = $null
  if (Test-Path $paths.State) { $state = Get-Content -Raw -Encoding UTF8 $paths.State | ConvertFrom-Json }
  # 처음 설치 때의 값만 기억. 다시 실행해도 원래 값(0 아님)을 잃지 않게 덮어쓰지 않음
  if (-not $state) {
    $state = [pscustomobject]@{ standbyAc = (Get-AcSeconds 'STANDBYIDLE'); hibernateAc = (Get-AcSeconds 'HIBERNATEIDLE'); savedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm') }
    $state | ConvertTo-Json | Set-Content -LiteralPath $paths.State -Encoding UTF8
  }
  if ($Sandbox) { Add-Result '안내' '전원 설정' '시험이라 건너뜀'; return }
  Set-AcSeconds 'STANDBYIDLE' 0
  if ($null -ne (Get-AcSeconds 'HIBERNATEIDLE')) { Set-AcSeconds 'HIBERNATEIDLE' 0 }
  Add-Result '통과' '전원 설정' "절전 $(Format-Seconds (Get-AcSeconds 'STANDBYIDLE')), 최대 절전 $(Format-Seconds (Get-AcSeconds 'HIBERNATEIDLE')) (전원 연결 때)"
}

function Install-Files([string]$Chrome) {
  # 드롭박스 파일이 온라인 전용으로 바뀌어도 돌도록 이 컴퓨터로 복사해서 실행
  Copy-Item (Join-Path $PSScriptRoot 'guard.ps1'), (Join-Path $PSScriptRoot 'guard_hidden.vbs') $paths.Root -Force
  [pscustomobject]@{ chrome = $Chrome; profile = $paths.Profile; urls = $script:SiteUrls } |
    ConvertTo-Json | Set-Content -LiteralPath $paths.Config -Encoding UTF8
  Add-Result '통과' '파일 복사' $paths.Root
}

function Install-Shortcut([string]$Chrome) {
  New-Item -ItemType Directory -Force $paths.Desktop | Out-Null
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($paths.Shortcut)
  $lnk.TargetPath = $Chrome
  $lnk.Arguments = Get-ChromeArgs $paths.Profile $script:SiteUrls
  $lnk.WorkingDirectory = Split-Path $Chrome
  $lnk.Description = '메이크창고 전담비서 전용 크롬'
  $lnk.Save()
  Add-Result '통과' '바로가기' $paths.Shortcut
}

function Install-GuardTask {
  $hidden   = Join-Path $paths.Root 'guard_hidden.vbs'
  $action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$hidden`""
  $trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  if ($Sandbox) { Add-Result '안내' '크롬 지킴이' '시험이라 등록은 건너뜀 (작업 설정 만들기는 통과)'; return }
  Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $trigger -Settings $settings -Description '비서 전용 크롬이 꺼져 있으면 다시 켬 (5분마다)' -Force | Out-Null
  Add-Result '통과' '크롬 지킴이' "$($script:TaskName) 등록 (5분마다)"
}

function Invoke-Checklist([string]$Chrome) {
  $items = @(
    @('WMS 로그인', 'makewon.com 탭에서 구글 로그인'),
    @('이지어드민 로그인', '이지어드민 탭에서 로그인, 비밀번호 저장 물으면 「저장」. 캡차·추가 인증이 나오면 아래 답에 n'),
    @('이벗 로그인', '이벗 탭에서 로그인, 비밀번호 저장 물으면 「저장」. 캡차·추가 인증이 나오면 아래 답에 n'),
    @('팝업 허용', '크롬 설정 → 개인 정보 보호 및 보안 → 사이트 설정 → 팝업 → 허용에 makewon.com 추가'),
    @('메모리 절약 제외', '크롬 설정 → 성능 → 항상 활성 사이트에 makewon.com, ezadmin.co.kr, ebut3pl.co.kr 추가'),
    @('정전 후 자동 켜짐', 'BIOS 의 AC Power Recovery(이름은 기종마다 다름)를 Power On 으로. 지금 못 하면 n')
  )
  Write-Host ''
  Write-Host '비서 전용 크롬을 엽니다. 이 창과 번갈아 보며 하나씩 진행하세요.' -ForegroundColor Cyan
  Start-Process -FilePath $Chrome -ArgumentList (Get-ChromeArgs $paths.Profile $script:SiteUrls)
  foreach ($it in $items) {
    Write-Host ''
    Write-Host "▶ $($it[0])" -ForegroundColor Cyan
    Write-Host "  $($it[1])"
    $a = Read-Host '  마쳤으면 엔터, 못 했으면 n'
    if ($a -match '^[nNㅜ]') { Add-Result '필요' $it[0] '아직 안 함' } else { Add-Result '통과' $it[0] '대표님 확인' }
  }
}

Write-Host ''
Write-Host '=== 메이크창고 전담비서 · 상시 컴퓨터 설치 ===' -ForegroundColor Cyan
Write-Host ''
Write-Host '[1] 컴퓨터 점검' -ForegroundColor Cyan
Test-Environment

$mode = '설치'
if ($CheckOnly) { $mode = '점검만' }
elseif (-not $Sandbox -and $env:COMPUTERNAME -eq $script:DevPc) {
  $mode = '점검만 (개발 노트북)'
  Write-Host ''
  Write-Host "$($script:DevPc) 는 개발 노트북이라 점검만 하고 아무것도 바꾸지 않습니다." -ForegroundColor Yellow
}

if ($mode -eq '설치') {
  $chrome = Find-Chrome
  if (-not $chrome) {
    $mode = '설치 중단 (크롬 없음)'
    Write-Host ''
    Write-Host '크롬이 없어 여기서 멈춥니다. 크롬을 설치한 뒤 다시 실행하세요.' -ForegroundColor Yellow
  } else {
    $proceed = $true
    if (-not $Sandbox) {
      Write-Host ''
      Write-Host '이 컴퓨터를 상시 컴퓨터로 설정합니다: 전원 연결 때 절전을 끄고, 크롬 지킴이를 등록합니다.' -ForegroundColor Yellow
      $a = Read-Host '진행하려면 y, 멈추려면 엔터'
      $proceed = $a -match '^[yYㅛ]'
    }
    if (-not $proceed) { $mode = '점검만 (설치 취소)' }
    else {
      New-Item -ItemType Directory -Force $paths.Root, $paths.Profile | Out-Null
      Write-Host ''
      Write-Host '[2] 전원 설정' -ForegroundColor Cyan
      Install-Power
      Write-Host '[3] 파일 복사' -ForegroundColor Cyan
      Install-Files $chrome
      Write-Host '[4] 바탕화면 바로가기' -ForegroundColor Cyan
      Install-Shortcut $chrome
      Write-Host '[5] 크롬 지킴이' -ForegroundColor Cyan
      Install-GuardTask
      if (-not $Sandbox) {
        Write-Host '[6] 사람이 할 일' -ForegroundColor Cyan
        Invoke-Checklist $chrome
      }
    }
  }
}

$folder = if ($Sandbox) { $Sandbox } else { $PSScriptRoot }
$saved = Save-Results $folder $mode
$need = @($script:Results | Where-Object { $_.Status -eq '필요' })
Write-Host ''
Write-Host "=== 끝: $mode ===" -ForegroundColor Cyan
if ($need.Count) {
  Write-Host "남은 일 $($need.Count)개:" -ForegroundColor Yellow
  $need | ForEach-Object { Write-Host "  - $($_.Name): $($_.Detail)" -ForegroundColor Yellow }
} else {
  Write-Host '남은 필수 항목 없음' -ForegroundColor Green
}
if ($saved) { Write-Host "결과 파일: $saved" } else { Write-Host '결과 파일을 저장하지 못했습니다. 이 화면을 캡처해 주세요.' -ForegroundColor Yellow }
if ($mode -eq '설치') { Write-Host '이 컴퓨터는 윈도우에 로그인한 상태로 두세요(화면 잠금은 괜찮음). 로그아웃하면 지킴이가 멈춥니다.' }
