@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0.."
cd /d "%ROOT%\zhuyan-ai-desktop"
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

if not defined ZHUYAN_FORBIDDEN_REFERENCE_ROOTS if not defined ZHUYAN_FORBIDDEN_REFERENCE_HASH_MANIFESTS (
  echo PRIVATE_REFERENCE_AUDIT_INPUT_REQUIRED
  echo Set ZHUYAN_FORBIDDEN_REFERENCE_ROOTS or ZHUYAN_FORBIDDEN_REFERENCE_HASH_MANIFESTS outside Git.
  exit /b 2
)

node scripts\check-packaging-environment.mjs
if errorlevel 1 goto :failed
if not exist "node_modules\electron-builder\out\cli\cli.js" (
  echo DEPENDENCIES_MISSING: run scripts\setup-windows-packaging.cmd first
  exit /b 2
)

call npm run dist:win
if errorlevel 1 goto :failed

echo.
echo ZHUYAN_WINDOWS_INSTALLER_BUILD_AND_AUDIT_OK
echo Installer: %ROOT%\zhuyan-ai-desktop\release\Zhuyan-AI-Setup-0.10.4.exe
echo Audit reports: %ROOT%\zhuyan-ai-desktop\release\audit
exit /b 0

:failed
echo.
echo ZHUYAN_WINDOWS_INSTALLER_BUILD_OR_AUDIT_FAILED
exit /b 1
