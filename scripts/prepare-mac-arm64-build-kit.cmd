@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0.."
set "DESKTOP=%ROOT%\zhuyan-ai-desktop"

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
node scripts\prepare-mac-arm64-build-kit.mjs "%ROOT%\mac-arm64-build-kit"
if errorlevel 1 goto :failed

echo.
echo ZHUYAN_MAC_ARM64_PREPARATION_OK
echo Copy this private directory to an Apple Silicon Mac:
echo %ROOT%\mac-arm64-build-kit
exit /b 0

:failed
echo.
echo ZHUYAN_MAC_ARM64_PREPARATION_FAILED
exit /b 1
