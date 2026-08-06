#!/bin/zsh
set -euo pipefail

BIN="apps/kimi-code/dist-native/bin/darwin-arm64/brewmaster"
ZIP_DIR="apps/kimi-code/dist-native/artifacts"

# 1. Build web
pnpm --filter @moonshot-ai/kimi-web run build

# 2. Build nativa con firma Developer ID (una sola volta: il binario
#    non deve essere piu' ricostruito dopo la notarizzazione)
APPLE_SIGNING_IDENTITY="Developer ID Application: Luca Saggese (DBJ5W7AQZK)" \
pnpm --filter @moonshot-ai/kimi-code run build:native:release

# 3. Verifica firma (hardened runtime + catena Developer ID)
codesign --verify --strict --verbose=2 "$BIN"
codesign -dvvv "$BIN" 2>&1 | grep -E 'Authority|flags'

# 4. Zip temporaneo SOLO per la sottomissione al notary service
mkdir -p "$ZIP_DIR"
rm -f "$ZIP_DIR/brewmaster-notarize.zip"
/usr/bin/zip -j "$ZIP_DIR/brewmaster-notarize.zip" "$BIN"

# 5. Notarizza
xcrun notarytool submit "$ZIP_DIR/brewmaster-notarize.zip" \
  --keychain-profile "AC_PASSWORD" \
  --wait

# 6. Staple: NON supportato su Mach-O nudi (errore 73 previsto).
#    Per un binario CLI il ticket vive sui server Apple e Gatekeeper lo
#    recupera online al primo avvio sul Mac di destinazione. Saltiamo.
echo "Skipping stapler (not supported on bare executables); ticket is on Apple's servers."

# 7. Zip finale creato DOPO lo stapling, contiene il binario con ticket
rm -f "$ZIP_DIR/brewmaster-darwin-arm64.zip"
/usr/bin/zip -j "$ZIP_DIR/brewmaster-darwin-arm64.zip" "$BIN"
rm -f "$ZIP_DIR/brewmaster-notarize.zip"

# 8. Verifica finale
shasum -a 256 "$ZIP_DIR/brewmaster-darwin-arm64.zip" | tee "$ZIP_DIR/brewmaster-darwin-arm64.zip.sha256"

echo "Done! ZIP: $ZIP_DIR/brewmaster-darwin-arm64.zip"

