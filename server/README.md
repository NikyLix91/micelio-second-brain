# micelio-server — DHT privata del team

Pacchetto **separato** dal resto di Micelio: si installa su una macchina Linux sempre accesa e
raggiungibile da internet, e fa da **punto d'incontro privato** dei nodi del team. Ha una sola
dipendenza (`hyperdht`) e non contiene dati.

## A cosa serve

I nodi Micelio si trovano su internet tramite una **DHT**, una tabella distribuita. Ogni nodo annuncia "per il team con impronta X rispondo io a questo indirizzo" e cerca gli altri con la stessa impronta. Per entrare nella DHT serve almeno un indirizzo noto: il **nodo di avvio** (bootstrap).

| | DHT pubblica (default) | DHT privata (questo server) |
|---|---|---|
| Nodi di avvio | di Holepunch (`node1..3.hyperdht.org`) | il vostro server |
| Chi vede l'impronta del team e gli IP dei membri | chiunque partecipi alla DHT pubblica | solo il vostro server |
| Dipendenza da terzi | sì, per entrare | no |
| Cosa chiedere all'IT | UDP in uscita verso internet | una porta UDP aperta su **una** macchina |

Il server **non vede i contenuti**:
- le connessioni fra i nodi sono cifrate (Noise);
- i dati del team sono cifrati con la chiave del team, che il server non ha;
- la connessione fra due PC, una volta stabilita, è **diretta**: il server fa solo da intermediario per l'*hole punching*.

Con l'hole punching i due PC, entrambi dietro un router, si contattano nello stesso istante, e così i router lasciano passare la connessione.

## Requisiti

- Linux con systemd, Node.js ≥ 20 e npm
- Un **IPv4 pubblico** con la porta **UDP 49737** raggiungibile da internet (direttamente o con un port forwarding)
- Risorse: minime (qualche decina di MB di RAM, traffico trascurabile)

## Installazione

Dalla cartella `server/` della repo (basta copiare questa cartella sulla macchina):

```bash
sudo ./install.sh --host <IP pubblico>
```

Lo script:
1. copia i sorgenti in `/opt/micelio-server`, compila e lascia solo le dipendenze di esecuzione;
2. crea l'utente di sistema `micelio`, senza shell e senza home;
3. scrive la configurazione in `/etc/default/micelio-server`;
4. installa e avvia il servizio systemd `micelio-server`, con isolamento: niente scrittura su disco e home degli utenti invisibili.

Alla fine stampa i comandi per il firewall e per i PC del team.

Opzioni:

| Opzione | Default | Significato |
|---|---|---|
| `--host` | primo IP della macchina | IPv4 **pubblico** con cui i PC raggiungono il server. Se la macchina è dietro NAT (molte VM cloud) va indicato |
| `--port` | 49737 | Porta UDP del nodo di avvio |
| `--extra-nodes` | 0 | Nodi DHT aggiuntivi sulle porte successive (vedi sotto) |
| `--prefix` | `/opt/micelio-server` | Cartella d'installazione |
| `--no-systemd` | | Non installa il servizio (container, prove) |

**Aggiornamento:** rieseguire `sudo ./install.sh` con il codice nuovo. La configurazione resta, e cambia solo se si passano opzioni.

### Firewall

```bash
sudo ufw allow 49737/udp                                    # ufw
sudo firewall-cmd --permanent --add-port=49737/udp && sudo firewall-cmd --reload   # firewalld
```

In un cloud (security group) o dietro un router (port forwarding) va aperta anche lì la stessa porta UDP verso la macchina.

### Nodi aggiuntivi (`--extra-nodes 2`)

Avviano altri 2 nodi DHT sulle porte 49738 e 49739. Servono a due cose:
- gli annunci dei team sono conservati da più di un nodo;
- `micelio network check` diventa in grado di dire se un PC ha un NAT "simmetrico" (il caso difficile per l'hole punching), perché per capirlo servono risposte da almeno due nodi.

Requisiti:
- le porte aggiuntive vanno aperte nel firewall;
- la macchina deve poter raggiungere **il proprio IP pubblico**. In alcune VM cloud non è possibile: in quel caso i nodi aggiuntivi non partono, e si torna a `0`.

## Sui PC del team

Tutti i membri devono usare **lo stesso** server, altrimenti stanno in DHT diverse e non si trovano:

```bash
micelio network set <IP pubblico>:49737   # vale subito se il daemon è acceso
micelio network check
```

Oppure dall'app: Impostazioni, poi **Rete**, poi *DHT privata del team*. Lì *Verifica* prova la scelta prima di applicarla.

Per tornare alla DHT pubblica: `micelio network public` (l'indirizzo del server resta salvato: `micelio network private` per riprenderlo).

`micelio network check` dice:
- se il PC entra nella DHT;
- con quale IP pubblico si presenta;
- se il router ha un NAT simmetrico (serve `--extra-nodes`).

Se due colleghi hanno **entrambi** un NAT simmetrico, oppure una rete che blocca l'UDP, la connessione diretta fra loro può non riuscire. Il sapere passa comunque attraverso un nodo sempre acceso, vedi sotto.

## Nodo del team sempre acceso (consigliato, sulla stessa macchina)

Il server qui sopra fa solo da punto d'incontro. Conviene affiancargli un **nodo Micelio vero**, membro del team, sempre acceso. Serve a tre cose:
- il sapere è disponibile anche quando tutti i PC sono spenti;
- i nuovi membri possono entrare anche se chi li ha invitati è offline;
- due colleghi che non riescono a collegarsi direttamente si sincronizzano entrambi con lui.

Questo nodo usa la versione **senza interfaccia** di Micelio, dalla radice della repo:

```bash
# come utente normale (non root), con la repo clonata
npm ci --workspaces=false --omit=optional && npx tsc -p tsconfig.build.json   # niente UI/Electron né modello di embedding
node dist/cli/main.js network set 127.0.0.1:49737        # stessa DHT, raggiunta in locale
node dist/cli/main.js start
node dist/cli/main.js join <codice d'invito> --name server # invito creato da un membro del team
node dist/cli/main.js autostart on                         # servizio systemd utente
sudo loginctl enable-linger $USER                          # parte anche senza login
```

Il nodo non ha Claude installato, quindi non distilla sessioni: replica e conserva il sapere. In alternativa c'è l'immagine Docker del nodo (`Dockerfile` nella radice della repo).

## Gestione

```bash
systemctl status micelio-server
journalctl -u micelio-server -f        # log: avvio e un battito ogni 15 minuti
sudo systemctl restart micelio-server  # dopo aver modificato /etc/default/micelio-server
sudo ./uninstall.sh [--purge]          # --purge rimuove anche configurazione e utente
```

## Struttura

| File | Contenuto |
|---|---|
| `src/dht-server.ts` | Avvio del nodo di avvio e dei nodi aggiuntivi (`startServer`) |
| `src/main.ts` | Riga di comando e variabili d'ambiente, chiusura ordinata |
| `src/hyperdht.d.ts` | Tipi minimi di `hyperdht` |
| `install.sh` / `uninstall.sh` | Installazione come servizio systemd |

Test: `test/integration/dht-server.test.ts` nella radice della repo. Due nodi Micelio creano un team, si invitano e si scambiano un ricordo usando solo questo server. Lo stesso test verifica anche `checkNetwork`.

## Cosa è verificato

- **Funzionamento della DHT privata:** test automatico su 127.0.0.1 con invito e replica dei ricordi; `network check` contro il server, anche con `--extra-nodes 2`.
- **`install.sh`:** provato in un container Debian (`node:24-bookworm-slim`) con `--no-systemd`. Ha compilato, creato l'utente e la configurazione; il server si è avviato e un client si è collegato. La reinstallazione ha mantenuto la configurazione.
- **Ancora da provare su una macchina vera:**
  - il servizio systemd;
  - l'attraversamento dei NAT reali fra PC su reti diverse.
