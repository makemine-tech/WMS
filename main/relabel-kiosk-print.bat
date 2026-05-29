@echo off
chcp 65001 >nul
REM ============================================================
REM  바코드 덧방 무인(바로) 인쇄용 실행기
REM  - 크롬/엣지를 --kiosk-printing 옵션으로 실행하면
REM    인쇄 미리보기 없이 기본 프린터로 바로 출력됩니다.
REM  - 라벨 프린터를 "기본 프린터"로 지정해 두세요.
REM ============================================================

REM ▼▼ 필요 시 주소만 본인 환경에 맞게 수정하세요 ▼▼
set "TARGET_URL=https://makewon.com/star_outorder.html"
REM ▲▲ ----------------------------------------------- ▲▲

echo.
echo  바코드 덧방 무인인쇄 모드로 페이지를 엽니다...
echo  주소: %TARGET_URL%
echo.

REM 1) 크롬 우선 시도
start "" chrome.exe --kiosk-printing --new-window "%TARGET_URL%" 2>nul
if %errorlevel%==0 goto done

REM 2) 크롬 없으면 엣지 시도
start "" msedge.exe --kiosk-printing --new-window "%TARGET_URL%" 2>nul
if %errorlevel%==0 goto done

echo  [오류] 크롬/엣지를 찾지 못했습니다.
echo  크롬 또는 엣지를 설치했는지 확인하세요.
pause

:done
exit /b 0
