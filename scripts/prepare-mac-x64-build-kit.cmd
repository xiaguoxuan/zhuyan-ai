@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0.."
set "DESKTOP=%ROOT%\zhuyan-ai-desktop"
set "OUTPUT=%ROOT%\mac-x64-build-kit"

if not defined ZHUYAN_FORBIDDEN_REFERENCE_ROOT (
  echo ZHUYAN_FORBIDDEN_REFERENCE_ROOT_REQUIRED
  echo Set this variable to a rights-restricted read-only reference library outside Git.
  exit /b 2
)

cd /d "%DESKTOP%"
node scripts\check-packaging-environment.mjs
if errorlevel 1 goto :failed
node scripts\create-reference-hash-manifest.mjs
if errorlevel 1 goto :failed
node scripts\prepare-mac-arm64-build-kit.mjs "%OUTPUT%" x64
if errorlevel 1 goto :failed

node scripts\verify-mac-build-kit.mjs "%OUTPUT%" x64
if errorlevel 1 goto :failed

echo.
echo ZHUYAN_MAC_X64_PREPARATION_OK
echo Copy this private directory to an Intel Mac:
echo %OUTPUT%
exit /b 0

:failed
echo.
echo ZHUYAN_MAC_X64_PREPARATION_FAILED
exit /b 1
