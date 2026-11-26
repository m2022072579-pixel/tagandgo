@echo off
setlocal
chcp 65001 >nul
set "NODE_EXE=node"
where node >nul 2>&1
if errorlevel 1 (
  set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
"%NODE_EXE%" -e "require('node:sqlite')" >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.13 이상이 필요합니다. Node.js를 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
set "MOA_STORE_MODE=1"
set "TAGGO_PORT=8890"
set "TAGGO_HOST=0.0.0.0"
echo MOA 점주 서버 설정을 준비합니다.
echo PC 브라우저에서 http://localhost:8890/setup 을 열어 주세요.
echo 이 창을 닫으면 테스트 서버가 종료됩니다.
"%NODE_EXE%" "%~dp0server.mjs"
pause
