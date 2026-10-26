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

# EN: Installs micelio-server on Linux (systemd service).
#
#   sudo ./install.sh --host <IP pubblico> [--port 49737] [--extra-nodes 0] [--prefix /opt/micelio-server]
#                     [--no-systemd]
#
#     What it does, in order:
#       1. checks Node.js (>= 20) and npm;
#       2. copies the sources into --prefix, installs the dependencies, builds and removes the dev ones;
#       3. creates the "micelio" system user (no shell, no home): the service does not run as root;
#       4. writes the configuration to /etc/default/micelio-server;
#       5. installs and starts the "micelio-server" systemd service (unless --no-systemd).
#
#     Running it again UPDATES the installation (new code, same configuration if no options are
#     passed) and restarts the service. The firewall is NOT touched: at the end the script prints the
#     commands to open the UDP port.

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
# EN: --- 1. Prerequisites
command -v node >/dev/null || { echo "Node.js non trovato: installa Node.js 20 o successivo" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm non trovato" >&2; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node.js $(node -v) troppo vecchio: serve la 20 o successiva" >&2; exit 1; }

# --- 2. Codice: copia, dipendenze, compilazione ---------------------------------------------
# EN: --- 2. Code: copy, dependencies, build
SRC="$(cd "$(dirname "$0")" && pwd)"
echo "» Installo in $PREFIX"
mkdir -p "$PREFIX"
# Si copiano solo i sorgenti: node_modules e dist si rigenerano sul server.
# EN: Only the sources are copied: node_modules and dist are rebuilt on the server.
cp "$SRC/package.json" "$SRC/package-lock.json" "$SRC/tsconfig.json" "$PREFIX/"
rm -rf "$PREFIX/src" && cp -r "$SRC/src" "$PREFIX/src"
cp "$SRC/README.md" "$PREFIX/" 2>/dev/null || true
(cd "$PREFIX" && npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev --no-audit --no-fund)

# --- 3. Utente di servizio ------------------------------------------------------------------
# EN: --- 3. Service user
if ! id micelio >/dev/null 2>&1; then
  NOLOGIN=$(command -v nologin || echo /usr/sbin/nologin)
  useradd --system --no-create-home --shell "$NOLOGIN" micelio
  echo "» Creato l'utente di sistema micelio"
fi

# --- 4. Configurazione ----------------------------------------------------------------------
# EN: --- 4. Configuration
# Se il file esiste si aggiornano solo i valori passati; altrimenti si crea con i default.
# EN: If the file exists only the passed values are updated; otherwise it is created with the defaults.
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi
HOST="${HOST:-${MICELIO_SERVER_HOST:-}}"
PORT="${PORT:-${MICELIO_SERVER_PORT:-49737}}"
EXTRA="${EXTRA:-${MICELIO_SERVER_EXTRA_NODES:-0}}"
if [ -z "$HOST" ]; then
  # Primo indirizzo della macchina: è quello pubblico solo se non c'è NAT davanti.
  # EN: First address of the machine: it is the public one only if there is no NAT in front.
  HOST=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "ATTENZIONE: --host non indicato, uso $HOST. Se la macchina è dietro NAT rilancia con --host <IP pubblico>."
fi
# Chiave casuale del relay (0.6.2): generata alla prima installazione e CONSERVATA nelle successive,
# altrimenti i PC configurati con host:porta#chiave perderebbero il relay.
# EN: Random relay key (0.6.2): generated at the first installation and KEPT in the following ones,
#     otherwise the PCs configured with host:port#key would lose the relay.
SEED="${MICELIO_SERVER_RELAY_SEED:-}"
if [ -z "$SEED" ]; then
  SEED=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  echo "» Generata la chiave casuale del relay"
fi
LEGACY="${MICELIO_SERVER_RELAY_LEGACY:-1}"
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
# Seme SEGRETO della chiave del relay (non condividerlo: i PC ricevono solo la chiave pubblica)
MICELIO_SERVER_RELAY_SEED=$SEED
# 1 = il relay risponde anche sulla chiave vecchia, ricavata dall'indirizzo, per i PC non ancora
# aggiornati alla 0.6.2. Quando tutti i PC usano host:porta#chiave mettilo a 0.
MICELIO_SERVER_RELAY_LEGACY=$LEGACY
EOF
# Leggibile solo da root e dal servizio: contiene il seme del relay
# EN: Readable only by root and the service: it contains the relay seed
chown root:micelio "$CONF"
chmod 640 "$CONF"

# --- 5. Servizio systemd --------------------------------------------------------------------
# EN: --- 5. systemd service
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
# EN: --- End: instructions
LAST=$((PORT + EXTRA))
ADDR=$(cd "$PREFIX" && MICELIO_SERVER_HOST="$HOST" MICELIO_SERVER_PORT="$PORT" MICELIO_SERVER_RELAY_SEED="$SEED" node dist/main.js --print-address)
RANGE=$PORT; [ "$EXTRA" -gt 0 ] && RANGE="$PORT:$LAST"
cat <<EOF

✔ micelio-server installato.

1) Apri la porta UDP $RANGE verso internet:
     ufw:        sudo ufw allow $RANGE/udp
     firewalld:  sudo firewall-cmd --permanent --add-port=${RANGE/:/-}/udp && sudo firewall-cmd --reload
   Se la macchina è in un cloud o dietro un router, apri la stessa porta anche nel security group
   o con un port forwarding verso questa macchina.

2) Su OGNI PC del team (tutti devono usare lo stesso server):
     micelio network set $ADDR
   (oppure dall'app: Impostazioni > Rete). La parte dopo # è la chiave pubblica del relay.
     micelio network check

Log del servizio:  journalctl -u micelio-server -f
EOF
