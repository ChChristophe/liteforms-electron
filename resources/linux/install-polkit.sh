#!/bin/sh
# Install the Liteforms NetworkManager polkit rule on the appliance golden
# image (PLAN §6.11). Run once as root: sudo ./install-polkit.sh
# The AppImage cannot do this itself — the image carries it.
set -eu
RULE_SRC="$(dirname "$0")/10-liteforms-network.rules"
RULE_DST="/etc/polkit-1/rules.d/10-liteforms-network.rules"

install -D -m 0644 "$RULE_SRC" "$RULE_DST"
echo "polkit rule installed: $RULE_DST"

# Firewall: open provisioning (8080) + device API (43178) when ufw is active.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -qi "status: active"; then
    ufw allow 8080/tcp
    ufw allow 43178/tcp
    echo "ufw ports opened"
fi

echo "Done."
