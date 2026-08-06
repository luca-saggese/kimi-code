#!/bin/zsh
# Crea Brewmaster.app: wrapper double-clickable che apre Terminal e lancia
# il binario CLI. Da firmare + notarizzare insieme al binario.
set -euo pipefail

BIN="${1:?usage: make-app-wrapper.sh <path-to-binary> <out-app>}"
APP="${2:?usage: make-app-wrapper.sh <path-to-binary> <out-app>}"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Binario reale dentro il bundle
cp "$BIN" "$APP/Contents/MacOS/brewmaster-bin"

# Launcher: apre una finestra Terminal ed esegue la TUI li' dentro
cat > "$APP/Contents/MacOS/Brewmaster" <<'LAUNCHER'
#!/bin/zsh
DIR="$(cd "$(dirname "$0")" && pwd)"
osascript -e "tell application \"Terminal\" to do script \"'$DIR/brewmaster-bin'; exit\"" \
          -e "tell application \"Terminal\" to activate"
LAUNCHER
chmod +x "$APP/Contents/MacOS/Brewmaster"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>Brewmaster</string>
	<key>CFBundleIdentifier</key>
	<string>com.brewmaster.cli</string>
	<key>CFBundleName</key>
	<string>Brewmaster</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.27.0</string>
	<key>LSUIElement</key>
	<false/>
</dict>
</plist>
PLIST

echo "Created $APP"
