#!/usr/bin/env bash
# Phase 2 AC 2.7 — verify both 1.1.1.1 and 8.8.8.8 return Cloudflare nameservers.
# Polls every 300 s for up to 48 h.
set -euo pipefail

DOMAIN="${1:-piercerkzn.ru}"
EXPECTED_RE='\.ns\.cloudflare\.com'
DEADLINE=$(( $(date +%s) + 48 * 3600 ))
INTERVAL=300

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  R1=$(dig +short NS "$DOMAIN" @1.1.1.1 | sort | head -n2 | tr '\n' ' ')
  R2=$(dig +short NS "$DOMAIN" @8.8.8.8 | sort | head -n2 | tr '\n' ' ')
  if echo "$R1" | grep -qE "$EXPECTED_RE" && echo "$R2" | grep -qE "$EXPECTED_RE"; then
    echo "[ok] $DOMAIN now on Cloudflare nameservers"
    echo "  1.1.1.1 → $R1"
    echo "  8.8.8.8 → $R2"
    exit 0
  fi
  echo "[wait] $(date -Is) — 1.1.1.1: $R1 / 8.8.8.8: $R2 — retrying in ${INTERVAL}s"
  sleep "$INTERVAL"
done

echo "[fail] dns propagation deadline exceeded for $DOMAIN" >&2
exit 1
