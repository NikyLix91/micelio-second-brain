#!/usr/bin/env bash
# =============================================================================================
# Installazione di micelio-server su Linux (servizio systemd).
#
#   sudo ./install.sh --host <IP pubblico> [--port 49737] [--extra-nodes 0] [--prefix /opt/micelio-server]
#                     [--no-systemd]
#
# Cosa fa, nell'ordine:
#   1. controlla Node.js (>= 20) e npm;
#   2. copia i sorgenti in --prefix, installa le dipendenze, compila e toglie quelle di sviluppo;
#   3. crea l'utente di sistema "micelio" (senza shell né home): il servizio non gira come root;
#   4. scrive la configurazione in /etc/default/micelio-server;
#   5. installa e avvia il servizio systemd "micelio-server" (salvo --no-systemd).
#
# Rieseguirlo AGGIORNA l'installazione (nuovo codice, stessa configurazione se non si passano
# opzioni) e riavvia il servizio. Il firewall NON viene toccato: alla fine lo script stampa i
# comandi per aprire la porta UDP.
# =============================================================================================
set -euo pipefail

PREFIX=/opt/micelio-server
CONF=/etc/default/micelio-server
UNIT=/etc/systemd/system/micelio-server.service
HOST=""
PORT=""
EXTRA=""
SYSTEMD=1

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --extra-nodes) EXTRA="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --no-systemd) SYSTEMD=0; shift ;;
    -h|--help) usage 0 ;;
    *) echo "opzione sconosciuta: $1" >&2; usage 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Serve root: sudo $0 $*" >&2; exit 1; }

# --- 1. Prerequisiti ------------------------------------------------------------------------
command -v node >/dev/null || { echo "Node.js non trovato: installa Node.js 20 o successivo" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm non trovato" >&2; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node.js $(node -v) troppo vecchio: serve la 20 o successiva" >&2; exit 1; }

# --- 2. Codice: copia, dipendenze, compilazione ---------------------------------------------
SRC="$(cd "$(dirname "$0")" && pwd)"
echo "» Installo in $PREFIX"
mkdir -p "$PREFIX"
# Si copiano solo i sorgenti: node_modules e dist si rigenerano sul server.
cp "$SRC/package.json" "$SRC/package-lock.json" "$SRC/tsconfig.json" "$PREFIX/"
rm -rf "$PREFIX/src" && cp -r "$SRC/src" "$PREFIX/src"
cp "$SRC/README.md" "$PREFIX/" 2>/dev/null || true
(cd "$PREFIX" && npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev --no-audit --no-fund)

# --- 3. Utente di servizio ------------------------------------------------------------------
if ! id micelio >/dev/null 2>&1; then
  NOLOGIN=$(command -v nologin || echo /usr/sbin/nologin)
  useradd --system --no-create-home --shell "$NOLOGIN" micelio
  echo "» Creato l'utente di sistema micelio"
fi

# --- 4. Configurazione ----------------------------------------------------------------------
# Se il file esiste si aggiornano solo i valori passati; altrimenti si crea con i default.
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi
HOST="${HOST:-${MICELIO_SERVER_HOST:-}}"
PORT="${PORT:-${MICELIO_SERVER_PORT:-49737}}"
EXTRA="${EXTRA:-${MICELIO_SERVER_EXTRA_NODES:-0}}"
if [ -z "$HOST" ]; then
  # Primo indirizzo della macchina: è quello pubblico solo se non c'è NAT davanti.
  HOST=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "ATTENZIONE: --host non indicato, uso $HOST. Se la macchina è dietro NAT rilancia con --host <IP pubblico>."
fi
cat > "$CONF" <<EOF
# Configurazione di micelio-server (letta dal servizio systemd). Dopo una modifica:
#   sudo systemctl restart micelio-server
# Indirizzo IPv4 PUBBLICO con cui i PC del team raggiungono questa macchina
MICELIO_SERVER_HOST=$HOST
# Porta UDP del nodo di avvio
MICELIO_SERVER_PORT=$PORT
# Nodi DHT aggiuntivi sulle porte successive (richiedono altrettante porte UDP aperte)
MICELIO_SERVER_EXTRA_NODES=$EXTRA
# Interfaccia di ascolto
MICELIO_SERVER_BIND=0.0.0.0
EOF
chmod 644 "$CONF"

# --- 5. Servizio systemd --------------------------------------------------------------------
if [ "$SYSTEMD" -eq 1 ]; then
  cat > "$UNIT" <<EOF
[Unit]
Description=Micelio: nodo di avvio della DHT privata del team
Documentation=file://$PREFIX/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=micelio
Group=micelio
EnvironmentFile=$CONF
ExecStart=$(command -v node) $PREFIX/dist/main.js
Restart=on-failure
RestartSec=5
# Isolamento: il servizio non scrive su disco e non vede le home degli utenti
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable micelio-server >/dev/null
  systemctl restart micelio-server
  sleep 2
  systemctl --no-pager --lines=5 status micelio-server || true
fi

# --- Fine: istruzioni ---------------------------------------------------------------------------
LAST=$((PORT + EXTRA))
RANGE=$PORT; [ "$EXTRA" -gt 0 ] && RANGE="$PORT:$LAST"
cat <<EOF

✔ micelio-server installato.

1) Apri la porta UDP $RANGE verso internet:
     ufw:        sudo ufw allow $RANGE/udp
     firewalld:  sudo firewall-cmd --permanent --add-port=${RANGE/:/-}/udp && sudo firewall-cmd --reload
   Se la macchina è in un cloud o dietro un router, apri la stessa porta anche nel security group
   o con un port forwarding verso questa macchina.

2) Su OGNI PC del team (tutti devono usare lo stesso server):
     micelio network set $HOST:$PORT
     micelio stop && micelio start
     micelio network check

Log del servizio:  journalctl -u micelio-server -f
EOF
