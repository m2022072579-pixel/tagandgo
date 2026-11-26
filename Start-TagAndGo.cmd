@echo off
setlocal
chcp 65001 >nul
set "NODE_EXE=node"
where node >nul 2>&1
if errorlevel 1 (
  set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
"%NODE_EXE%" "%~dp0server.mjs"
pause
