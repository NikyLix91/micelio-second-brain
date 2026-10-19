# Network and replication

Micelio has no central server: team PCs find each other on the internet and exchange their logs directly. Every PC holds a complete copy of the knowledge.

## The team key {#team-key}

A team is born with two keys, saved in `state.json`: the **base** key (identifies the team) and the **encryption** key (32 random bytes). Whoever has both can read all the team knowledge: that is why joining goes through an invite and the keys never travel in clear.

## How PCs find each other {#discovery}

From the team key each daemon computes a **fingerprint** (a hash that cannot be turned back into the key) and announces it in a **DHT** (distributed table, HyperDHT): "for this fingerprint, I answer at this address". At the same time it looks for the others with the same fingerprint. The DHT only sees fingerprints and IP addresses, never names or content.

## The connection {#connection}

Two PCs behind routers connect through **hole punching**: a DHT node puts them in touch and both "knock" at the same moment, so the routers let the connection through. From then on the link is **direct** between the PCs, encrypted with the **Noise** protocol and authenticated with the node keys.

## Replication {#replication}

On every connection Autobase exchanges the members' feeds: each node downloads the blocks it lacks, from **any** online colleague (the author does not need to be on). The **indexers** (the admins) fix the final ordering points of the log. Every few seconds, if the node is isolated, it searches for colleagues again; otherwise every minute.

## Encryption {#encryption}

Two layers: the connection is encrypted (Noise) and the log blocks are encrypted with the team key. A foreign node getting hold of the blocks could not read them.

## Public or private DHT {#public-private}

- **Public** (default): Holepunch's bootstrap nodes. No server to manage; the team fingerprint and the members' IPs are visible in the public DHT (content never).
- **Team private**: a small Linux server (`server/` in the repository, UDP port 49737) acts as the meeting point. No third-party dependency. Choose it in **Settings → Network**: every member must use the same DHT, otherwise they do not find each other.

**Check** in that card tests the choice without applying it: it tells whether the DHT answers, which public IP you go out with and whether your router has a "symmetric" NAT (the hard case for hole punching).

## The team server relay {#relay}

Between two corporate networks, or with very restrictive routers, hole punching can fail: the two PCs find each other but cannot connect, and stay at 0 peers. With the **private DHT** the team server (from version 0.2.0) acts as a **relay**: in those cases the connection goes through the server.

- The relay is **blind**: it forwards the packets of a connection already encrypted between the two PCs (Noise). The server has no keys and reads nothing.
- It is used **only when needed**: after a failed hole punch, or if your PC has a symmetric NAT. Otherwise the connection stays direct.
- **No configuration**: the relay key is derived from the server address, which every PC of the team already knows.
- The PC tries the relay at startup and every 10 minutes, and uses it only if it answers. With an older server, or one that cannot be reached, only direct connections are used: you cannot end up disconnected because of it.

**Network → Check** tells whether the server offers the relay. The **Status** page tells how many connections went through it.

**How it works behind the scenes.** The relay is a Holepunch `blind-relay` living on the same DHT node as the server, so on the same UDP port (no extra port to open). PCs find it because a DHT node also answers for the services listening on itself. The key is derived with SHA-256 from `micelio-relay/v1` plus the `host:port` address. Whoever knows the address could therefore run a fake relay. The traffic, however, stays encrypted between the PCs: the worst it can do is not forward it. In a private DHT only the team knows the address.

## Offline {#offline}

Micelio also works alone: search, collection and distillation are local. What you write stays in your feed and reaches colleagues at the next connection; what they write reaches you the same way. An **always-on node** (e.g. on the team server) keeps the knowledge available even when the PCs are off.

## Invites {#invites}

An invite is a **single-use** code valid for 24 hours (*blind-pairing* protocol). The newcomer uses it to ask to join; **any online member** who knows the invite accepts them, passes the team keys over an encrypted channel and writes the `member.add` event. The invite code does not contain the encryption key.
