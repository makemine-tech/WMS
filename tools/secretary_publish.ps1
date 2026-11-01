# 전담비서 설치 파일을 드롭박스로 복사 (개발 노트북에서 실행). 결과_컴퓨터이름.txt 는 건드리지 않음
$ErrorActionPreference = 'Stop'
$dst = Join-Path $env:USERPROFILE 'Dropbox\MAKEWON\전담비서설치'
$bom = New-Object System.Text.UTF8Encoding($true)
New-Item -ItemType Directory -Force $dst | Out-Null
# 윈도우 PowerShell 5.1 이 한글 스크립트를 읽으려면 BOM 이 필요
Get-ChildItem (Join-Path $PSScriptRoot 'secretary_setup') -File | ForEach-Object {
  if ($_.Extension -in '.ps1', '.txt') {
    $t = [IO.File]::ReadAllText($_.FullName).TrimStart([char]0xFEFF) -replace "`r?`n", "`r`n"
    [IO.File]::WriteAllText($_.FullName, $t, $bom)
  }
  Copy-Item $_.FullName $dst -Force
}
$ext = Join-Path $dst 'extension'
New-Item -ItemType Directory -Force $ext | Out-Null
# manifest 를 마지막에 복사: 동기화 중 새 판 번호만 먼저 가는 일을 줄임
Copy-Item (Join-Path $PSScriptRoot 'secretary_ext\*') $ext -Force -Exclude 'manifest.json'
Copy-Item (Join-Path $PSScriptRoot 'secretary_ext\manifest.json') $ext -Force
Write-Host "복사 완료: $dst"
