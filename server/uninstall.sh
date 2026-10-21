#!/usr/bin/env bash
# =============================================================================================
# Disinstallazione di micelio-server.
# EN: Uninstalls micelio-server.
#
#   sudo ./uninstall.sh [--prefix /opt/micelio-server] [--purge]
#
# Ferma e rimuove il servizio systemd e il codice installato. Con --purge rimuove anche la
# configurazione (/etc/default/micelio-server) e l'utente di sistema "micelio".
# Il server non conserva dati: non c'è nient'altro da cancellare.
# Ricorda di chiudere la porta UDP nel firewall e di riportare i PC del team su un'altra DHT
# (`micelio network public` oppure un altro server).
# EN: Stops and removes the systemd service and the installed code. With --purge it also removes the
#     configuration (/etc/default/micelio-server) and the "micelio" system user.
#     The server keeps no data: there is nothing else to delete.
#     Remember to close the UDP port in the firewall and to move the team's PCs to another DHT
#     (`micelio network public` or another server).
# =============================================================================================
set -euo pipefail

PREFIX=/opt/micelio-server
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --purge) PURGE=1; shift ;;
    *) echo "opzione sconosciuta: $1" >&2; exit 1 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Serve root: sudo $0" >&2; exit 1; }

if [ -f /etc/systemd/system/micelio-server.service ]; then
  systemctl disable --now micelio-server >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/micelio-server.service
  systemctl daemon-reload
  echo "» Servizio rimosso"
fi
rm -rf "$PREFIX" && echo "» Rimosso $PREFIX"

if [ "$PURGE" -eq 1 ]; then
  rm -f /etc/default/micelio-server && echo "» Configurazione rimossa"
  if id micelio >/dev/null 2>&1; then userdel micelio && echo "» Utente micelio rimosso"; fi
fi
echo "✔ micelio-server disinstallato"
