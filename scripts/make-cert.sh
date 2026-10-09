#!/usr/bin/env bash
# Certificates for serving this tool over HTTPS on a local network.
#
# Two files matter:
#
#   certs/ca.pem    a small certificate authority, created once. Import this
#                   into each machine's browser and the warning stops — for
#                   good, including after the server's address changes.
#   certs/cert.pem  the server's own certificate, signed by that CA, listing
#                   every name and address this machine answers on.
#
# Re-run this whenever the machine's IP changes or you add a name. The CA is
# reused, so nobody has to import anything again.
#
#   npm run tls:selfsigned                   this machine's current addresses
#   npm run tls:selfsigned teamops.local     plus any extra names you use
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs
chmod 700 certs

CA_DAYS=3650
LEAF_DAYS=825

# --- the authority, created once and then left alone ------------------------
if [[ ! -f certs/ca.pem || ! -f certs/ca-key.pem ]]; then
  openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout certs/ca-key.pem -out certs/ca.pem \
    -days "$CA_DAYS" -subj "/CN=Team Ops local CA ($(hostname))" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  echo "✓ Created a local certificate authority (certs/ca.pem)"
  NEW_CA=1
else
  echo "✓ Reusing the existing authority — nobody needs to re-import anything"
  NEW_CA=0
fi

# --- every name and address this machine answers on -------------------------
HOST=$(hostname)
ALT="DNS:localhost,DNS:${HOST},DNS:${HOST}.local"
for ip in $(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' || true); do
  ALT="${ALT},IP:${ip}"
done
ALT="${ALT},IP:127.0.0.1"
for extra in "$@"; do
  if [[ "$extra" =~ ^[0-9.]+$ ]]; then ALT="${ALT},IP:${extra}"; else ALT="${ALT},DNS:${extra}"; fi
done

# --- the server certificate, signed by the authority ------------------------
openssl req -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/server.csr \
  -subj "/CN=${HOST}" 2>/dev/null

openssl x509 -req -in certs/server.csr \
  -CA certs/ca.pem -CAkey certs/ca-key.pem -CAcreateserial \
  -out certs/cert.pem -days "$LEAF_DAYS" \
  -extfile <(printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$ALT") 2>/dev/null

rm -f certs/server.csr
chmod 600 certs/*.pem

echo "✓ Issued a server certificate valid for:"
echo "    ${ALT//,/$'\n    '}"
echo ""
echo "  Restart the server for it to take effect:  pkill -f src/server.ts && npm start"
if [[ "$NEW_CA" == "1" ]]; then
  echo ""
  echo "  ── One-time, on each machine that uses this ──────────────────────"
  echo "  Copy certs/ca.pem to the machine, then in Chrome:"
  echo "    Settings → Privacy and security → Security → Manage certificates"
  echo "    → Authorities → Import → pick ca.pem"
  echo "    → tick \"Trust this certificate for identifying websites\""
  echo "  Firefox: Settings → Privacy & Security → View Certificates → Authorities."
  echo ""
  echo "  Prefer the name over the address — https://${HOST}.local:4000/ keeps"
  echo "  working when DHCP hands this machine a different IP."
fi
