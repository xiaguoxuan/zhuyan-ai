#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR/zhuyan-ai-desktop"
MANIFEST="$DESKTOP_DIR/private-audit-input/reference-library-sha256.json"

[[ "$(uname -s)" == "Darwin" ]] || { echo "MACOS_REQUIRED"; exit 2; }
[[ "$(uname -m)" == "arm64" ]] || { echo "APPLE_SILICON_REQUIRED"; exit 2; }
command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || { echo "NODEJS_REQUIRED"; exit 2; }
node -e 'const [M,m]=process.versions.node.split(".").map(Number);if(M<22||(M===22&&m<19)){process.exit(2)}'
[[ -f "$MANIFEST" ]] || { echo "REFERENCE_HASH_MANIFEST_MISSING"; exit 3; }

node "$DESKTOP_DIR/scripts/verify-mac-build-kit.mjs" "$SCRIPT_DIR"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
export ZHUYAN_FORBIDDEN_REFERENCE_HASH_MANIFESTS="$MANIFEST"
export CSC_IDENTITY_AUTO_DISCOVERY=false

cd "$DESKTOP_DIR"
npm ci --foreground-scripts
npm run dist:mac:arm64
node -e 'const fs=require("fs"),path=require("path");for(const name of ["mac-unpacked-app-audit.json","mac-dmg-app-audit.json","mac-dmg-audit.json"]){const value=JSON.parse(fs.readFileSync(path.join("release","audit",name),"utf8"));if(value.status!=="passed")throw new Error(`${name} did not pass`)}'

echo "ZHUYAN_MAC_ARM64_BUILD_AND_AUDIT_OK"
echo "DMG: $DESKTOP_DIR/release/Zhuyan-AI-0.10.4-mac-arm64.dmg"
