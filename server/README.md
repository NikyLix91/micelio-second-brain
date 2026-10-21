[Italiano](README.it.md) | **English**

# micelio-server: the team's private DHT

A package **separate** from the rest of Micelio: it is installed on an always-on Linux machine
reachable from the internet, and acts as the **private meeting point** for the team's nodes. It has
a single dependency (`hyperdht`) and holds no data.

## What it's for

Micelio nodes find each other on the internet through a **DHT**, a distributed hash table. Each node announces "for the team with fingerprint X, I answer at this address" and looks for the others with the same fingerprint. To enter the DHT you need at least one known address: the **bootstrap node**.

| | Public DHT (default) | Private DHT (this server) |
|---|---|---|
| Bootstrap nodes | Holepunch's (`node1..3.hyperdht.org`) | your server |
| Who sees the team fingerprint and the members' IPs | anyone taking part in the public DHT | only your server |
| Third-party dependency | yes, to join | no |
| What to ask IT for | outbound UDP to the internet | one UDP port open on **one** machine |

The server **doesn't see the content**:
- connections between nodes are encrypted (Noise);
- the team data is encrypted with the team key, which the server doesn't have;
- once established, the connection between two PCs is **direct**: the server only acts as an intermediary for *hole punching*.

With hole punching the two PCs, both behind a router, contact each other at the same instant, so the routers let the connection through.

## Requirements

- Linux with systemd, Node.js ≥ 20 and npm
- A **public IPv4** with port **UDP 49737** reachable from the internet (directly or through port forwarding)
- Resources: minimal (a few tens of MB of RAM, negligible traffic)

## Installation

From the repo's `server/` folder (copying just this folder to the machine is enough):

```bash
sudo ./install.sh --host <IP pubblico>
```

The script:
1. copies the sources to `/opt/micelio-server`, builds them and keeps only the runtime dependencies;
2. creates the `micelio` system user, with no shell and no home;
3. writes the configuration to `/etc/default/micelio-server`;
4. installs and starts the `micelio-server` systemd service, with sandboxing: no disk writes and users' home directories invisible.

At the end it prints the commands for the firewall and for the team's PCs.

Options:

| Option | Default | Meaning |
|---|---|---|
| `--host` | the machine's first IP | **Public** IPv4 the PCs use to reach the server. Required if the machine is behind NAT (many cloud VMs) |
| `--port` | 49737 | UDP port of the bootstrap node |
| `--extra-nodes` | 0 | Extra DHT nodes on the following ports (see below) |
| `--prefix` | `/opt/micelio-server` | Installation folder |
| `--no-systemd` | | Doesn't install the service (containers, testing) |

**Upgrade:** run `sudo ./install.sh` again with the new code. The configuration is kept, and changes only if you pass options.

### Firewall

```bash
sudo ufw allow 49737/udp                                    # ufw
sudo firewall-cmd --permanent --add-port=49737/udp && sudo firewall-cmd --reload   # firewalld
```

In a cloud (security group) or behind a router (port forwarding) the same UDP port to the machine must be opened there too.

### Extra nodes (`--extra-nodes 2`)

They start 2 more DHT nodes on ports 49738 and 49739. They serve two purposes:
- team announcements are stored by more than one node;
- `micelio network check` becomes able to tell whether a PC has a "symmetric" NAT (the hard case for hole punching), because figuring that out needs replies from at least two nodes.

Requirements:
- the extra ports must be opened in the firewall;
- the machine must be able to reach **its own public IP**. On some cloud VMs this isn't possible: in that case the extra nodes don't start, and you go back to `0`.

## With Docker

As an alternative to `install.sh` the server runs in a container (`server/Dockerfile`: Node 22 on Debian slim, only `hyperdht`, unprivileged user, no data to keep).

```bash
# build (from the server/ folder)
docker build -t <registry>/micelio-server:0.2.0 .

# run on the server machine
docker run -d --name micelio-server --restart unless-stopped --network host \
  -e MICELIO_SERVER_HOST=<IP pubblico della macchina> \
  <registry>/micelio-server:0.2.0

docker logs -f micelio-server     # you should see "pronto. Sui PC del team: micelio network set <IP>:49737"
```

- **Port**: inbound **UDP 49737** must be open (on the machine's firewall and, if present, the router's or the cloud provider's). No TCP.
- `--network host` (Linux) is the simplest choice for a DHT node: the container uses the machine's port directly. Alternatively: `-p 49737:49737/udp`.
- Variables: `MICELIO_SERVER_HOST` (required: the public IP the PCs use to reach it), `MICELIO_SERVER_PORT` (default 49737), `MICELIO_SERVER_EXTRA_NODES` (extra nodes on the following ports, which must be opened too).
- Debian base and not Alpine: `udx-native` (hyperdht's network module) has no binaries for musl, and on Alpine the server doesn't start.
- Registry without HTTPS: the machine pulling the image must have it among Docker's `insecure-registries` (`/etc/docker/daemon.json`, then `systemctl restart docker`); `localhost:<porta>` is allowed by default.

## On the team's PCs

All members must use **the same** server, otherwise they are in different DHTs and can't find each other:

```bash
micelio network set <IP pubblico>:49737   # takes effect immediately if the daemon is running
micelio network check
```

Or from the app: Settings, then **Network**, then *Team private DHT*. There, *Check* tests the choice before applying it.

To go back to the public DHT: `micelio network public` (the server address stays saved: `micelio network private` to use it again).

`micelio network check` tells you:
- whether the PC enters the DHT;
- which public IP it shows up with;
- whether the router has a symmetric NAT (requires `--extra-nodes`).

If two colleagues **both** have a symmetric NAT, or corporate networks that block hole punching, the direct connection between them may fail. Since version 0.2.0 the server acts as a **relay**, see below.

## Relay (since version 0.2.0)

When two PCs can't connect directly, the connection goes through the server.
- **Blind:** Holepunch's `blind-relay` forwards packets that are already encrypted between the two PCs (Noise); the server can't read them.
- **Same UDP port** as the bootstrap node: nothing more to open.
- **No configuration on the PCs:** the relay key is derived from the server address (SHA-256 of `micelio-relay/v1` + `host:porta`, in `src/relay.ts` and, identical, in the root's `src/net/relay-key.ts`). Anyone who knows the address can compute it and start a fake relay, but the traffic stays encrypted: at worst it doesn't forward.
- The PCs use it **only** after a failed hole punch or with a symmetric NAT, and only if it responds (they test it at startup and every 10 minutes).
- `micelio network check` tells you whether the server offers the relay.

**Upgrading a Docker server to 0.2.0:**

```bash
docker pull <registry>/micelio-server:0.2.0
docker rm -f micelio-server
docker run -d --name micelio-server --restart unless-stopped --network host -e MICELIO_SERVER_HOST=<IP pubblico> <registry>/micelio-server:0.2.0
docker logs -f micelio-server   # "relay attivo (chiave …)"
```

The PCs don't need to be reconfigured: address and port stay the same.

## Always-on team node (recommended, on the same machine)

The server above only acts as a meeting point. It's worth running a **real Micelio node** alongside it, a team member that is always on. It serves three purposes:
- the knowledge is available even when all the PCs are off;
- new members can join even if the one who invited them is offline;
- two colleagues who can't connect directly both sync with it.

This node uses the **headless** version of Micelio, from the repo root:

```bash
# as a normal user (not root), with the repo cloned
npm ci --workspaces=false --omit=optional && npx tsc -p tsconfig.build.json   # no UI/Electron or embedding model
node dist/cli/main.js network set 127.0.0.1:49737        # same DHT, reached locally
node dist/cli/main.js start
node dist/cli/main.js join <codice d'invito> --name server # invite created by a team member
node dist/cli/main.js autostart on                         # systemd user service
sudo loginctl enable-linger $USER                          # starts even without a login
```

The node doesn't have Claude installed, so it doesn't distill sessions: it replicates and keeps the knowledge. Alternatively there is the node's Docker image (`Dockerfile` in the repo root).

## Management

```bash
systemctl status micelio-server
journalctl -u micelio-server -f        # log: startup and a heartbeat every 15 minutes (see below)
sudo systemctl restart micelio-server  # after editing /etc/default/micelio-server
sudo ./uninstall.sh [--purge]          # --purge also removes configuration and user
```

### What the log says

Every 15 minutes the server writes what happened in the interval, for example:

```
attivo; ultimi 15 min: 2 PC, 8 annunci, 14 ricerche, 3 presentazioni, 3 hole punching; relay: 1 connessioni aperte (4 dall'avvio)
```

- **0 PCs:** the server isn't being contacted. Wrong address on the PCs, UDP port closed (firewall, cloud, router) or PCs still on the public DHT.
- **PCs and announcements, but no handshakes:** the PCs aren't looking for each other, probably because they are in different teams or not all on the private DHT.
- **Handshakes and hole punches, but 0 peers on the PCs:** hole punching fails. With 0.2.0 the relay steps in, and the relay counter goes up.

## Structure

| File | Contents |
|---|---|
| `src/dht-server.ts` | Startup of the bootstrap node and the extra nodes (`startServer`) |
| `src/relay.ts` | Relay for the connections that hole punching can't establish (B8) |
| `src/main.ts` | Command line and environment variables, periodic activity log, graceful shutdown |
| `src/hyperdht.d.ts` | Minimal types for `hyperdht` |
| `install.sh` / `uninstall.sh` | Installation as a systemd service |

Test: `test/integration/dht-server.test.ts` in the repo root. Two Micelio nodes create a team, invite each other and exchange a memory using only this server. The same test also verifies `checkNetwork`.

## What is verified

- **Private DHT operation:** automated test on 127.0.0.1 with invite and memory replication; `network check` against the server, also with `--extra-nodes 2`.
- **Relay:** automated test with two clients forced to go through the relay (they exchange data, the server counts the sessions); relay diagnosis in `network check`; same key on server and PCs.
- **`install.sh`:** tried in a Debian container (`node:24-bookworm-slim`) with `--no-systemd`. It built, created the user and the configuration; the server started and a client connected. Reinstalling kept the configuration.
- **Still to be tried on a real machine:**
  - the systemd service;
  - traversal of real NATs between PCs on different networks.
