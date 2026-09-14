@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0.."
cd /d "%ROOT%\zhuyan-ai-desktop"
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

node scripts\check-packaging-environment.mjs
if errorlevel 1 goto :failed

echo Installing locked dependencies...
call npm ci --foreground-scripts
if errorlevel 1 goto :failed

call npm run build
if errorlevel 1 goto :failed
call npm run prepare:packaging
if errorlevel 1 goto :failed

echo.
echo ZHUYAN_WINDOWS_PACKAGING_SETUP_OK
exit /b 0

:failed
echo.
echo ZHUYAN_WINDOWS_PACKAGING_SETUP_FAILED
exit /b 1
