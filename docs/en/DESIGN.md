[Italiano](../DESIGN.md) | **English**

# Micelio: design document

> A distributed, peer-to-peer second brain for a development team's AI tools.
> Status: **draft v0.1** (2026-10-17)

---

## 1. Vision

Micelio is a shared memory for AI agents (Claude Code, Codex CLI, IDE assistants) that **has no central server**.
Every machine on the team runs a **node**. The nodes form a diffuse network, like the mycelium of a fungus: knowledge produced on one node spreads to all the others and, once synchronization completes, **every node holds 100% of the shared knowledge**.

Intended consequences:

- whoever joins the team immediately receives all the accumulated know-how;
- everyone works autonomously, even offline, and realigns automatically when back online;
- there is no single point of failure and no server to maintain.

Beyond synchronization, the brain has its own lifecycle:

- **inbound filter**: not everything that passes through an AI agent becomes team knowledge (e.g. an email evaluating a team member);
- **priority indexing**: the most useful memories surface first;
- **dreaming**: periodic consolidation that merges duplicates, links concepts, detects contradictions and lets memories that have become useless decay.

### Principles

1. **Events, not state.** What gets replicated are immutable, signed events. State is a view recomputed deterministically, identical on every node.
2. **Private by default.** Content enters team knowledge only if it passes the filter. When in doubt, it stays on the machine.
3. **Distilled, never raw.** What travels on the network is extracted lessons, not transcripts or original files.
4. **Nothing is really deleted, everything can decay.** Reversible archiving instead of deletion (with the exception of redaction, §10.3).
5. **Derived = local.** Full-text indexes, vectors and exports are regenerated on each node and are not synchronized.
6. **No API keys.** The intelligence (classification, distillation, dreaming) uses the AI CLIs already installed and authenticated on the user's machine.

---

## 2. Core decisions

| Topic | Decision | Notes |
|---|---|---|
| Network | Internet, nodes anywhere | DHT + NAT traversal, no server |
| Scale | 10–30 nodes | Full mesh is practical; coordinated dreaming |
| LLM | `claude` (Claude Code) or `codex` (Codex CLI), headless from the terminal | No API; adapter configurable per node |
| Sources | Claude Code, Codex CLI, VS Code, WebStorm, document folders (PDF, DOCX, XLSX…) | MCP + hooks + watchers |
| Documents | Only distilled knowledge travels | The original stays on the owner's machine |
| Scopes | `private` + `team` | A project with different people is a **separate team**, not a sub-scope |
| Memory language | Team configuration (`memory.language`) | One fixed language for all memories |
| Membership | Every member can invite, only admins remove | Every join records who invited |
| Runtime | Node.js (≥ 22.13), TypeScript; NestJS for the HTTP parts | |

---

## 3. Node architecture

Each machine runs an always-on `micelio` **daemon**, plus a `micelio` CLI for administration.

```
┌──────────────────────────────── Micelio node (daemon) ────────────────────────────────┐
│                                                                                       │
│  SOURCES                       INGESTION                          KNOWLEDGE           │
│  ┌────────────────────┐   ┌──────────────────────────────┐   ┌─────────────────────┐  │
│  │ Claude Code hook   │──▶│ 1. Text extraction           │   │ "team" event log    │◀─┼──▶ P2P net
│  │ Codex sessions     │   │ 2. Deterministic filter      │──▶│ (Autobase/Hypercore)│  │   (Hyperswarm)
│  │ MCP remember()     │   │ 3. Classification (LLM)      │   └─────────┬───────────┘  │
│  │ Folder watcher     │   │ 4. Distillation (LLM)        │             │ apply()      │
│  └────────────────────┘   │ 5. Secret redaction          │   ┌─────────▼───────────┐  │
│                           └──────────────┬───────────────┘   │ Materialized view   │  │
│                                          │                   │ SQLite + FTS5 + vec │  │
│                           ┌──────────────▼───────────────┐   └─────────┬───────────┘  │
│                           │ "private" store + Inbox      │             │              │
│                           │ (local only, not replicated) │   ┌─────────▼───────────┐  │
│                           └──────────────────────────────┘   │ Recall / Ranking    │  │
│                                                              │ (hybrid + activ.)   │  │
│  ┌────────────────────┐   ┌──────────────────────────────┐   └─────────┬───────────┘  │
│  │ LLM adapter (CLI)  │◀──│ LLM job queue                │             │              │
│  │ claude -p │ codex  │   │ (ingestion, dreaming)        │   ┌─────────▼───────────┐  │
│  └────────────────────┘   └──────────────────────────────┘   │ MCP server          │◀─┼── Claude Code, Codex,
│                           ┌──────────────────────────────┐   │ (local HTTP+stdio)  │  │   VS Code, WebStorm
│                           │ Dreamer (epochs)             │   └─────────────────────┘  │
│                           └──────────────────────────────┘   Markdown export (r/o)    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|---|---|
| **Net** | Node identity, discovery (Hyperswarm), log replication, pairing/invites |
| **Log** | Writing signed events to the node's own feed, multi-writer merge (Autobase) |
| **View** | Deterministic `apply(events) → state` function, persisted in SQLite |
| **Index** | FTS5 (keyword) and sqlite-vec (semantic), derived locally from the view |
| **Ingest** | Pipeline sources → filter → classification → distillation → event |
| **LLM** | Adapter for the `claude` / `codex` CLIs, with queue, timeouts, output validation |
| **Dreamer** | Periodic consolidation, coordinated across nodes |
| **MCP** | Exposes `recall`, `remember` and the other tools to AI tools |
| **Export** | Regenerates a read-only Markdown view that can be browsed by hand |

---

## 4. Data model

### 4.1 Events

Everything that changes team knowledge is an **event** appended to the authoring node's feed. Every event has a common envelope:

```ts
interface Envelope<T> {
  v: 1;                     // schema version
  type: string;             // e.g. "memory.add"
  id: string;               // payload hash (content-addressed)
  node: string;             // public key of the authoring node
  ts: number;               // authoring node's timestamp (informational, not used for ordering)
  payload: T;
}
```

Ordering is **causal**, provided by Autobase: node clocks are not used to resolve conflicts.

| Event | Payload (summary) | Effect on the view |
|---|---|---|
| `memory.add` | `Memory` (see 4.2) | Creates a memory (idempotent on the same `id`) |
| `memory.supersede` | `{ old: id[], new: Memory, reason }` | The new memory replaces the old ones, which remain available as history |
| `memory.link` | `{ from, to, rel }` | Edge in the graph (`relates`, `refines`, `contradicts`, `depends-on`) |
| `memory.vote` | `{ id, delta: +1 \| -1 }` | Explicit usefulness signal |
| `memory.pin` / `unpin` | `{ id }` | Protects from decay |
| `memory.archive` / `restore` | `{ id, reason }` | Leaves default search / comes back |
| `memory.redact` | `{ id, reason }` | Removes the content from the view and asks nodes to delete the blocks (§10.3) |
| `usage.report` | `{ period, counts: { [id]: n } }` | Usage counters aggregated by the node (G-Counter) |
| `dream.claim` | `{ epoch }` | The node declares it is dreaming for the epoch |
| `dream.complete` | `{ epoch, summary, stats }` | Dream journal |
| `team.config` | `{ key, value }` | Shared configuration (e.g. `memory.language`, embedding model) |
| `member.add` | `{ node, name, role, invited_by }` | New writer (§9); can be published by any member |
| `member.remove` | `{ node, reason }` | Removal of a writer; valid only if the author is `admin` |

### 4.2 Memory (`Memory`)

```ts
interface Memory {
  kind: 'fact' | 'howto' | 'decision' | 'gotcha' | 'snippet' | 'reference';
  title: string;            // one line, self-explanatory
  body: string;             // Markdown, atomic and self-contained
  tags: string[];           // technologies, projects, domains
  applies_to?: string[];    // e.g. ["repo:smartlookup", "stack:angular@17"]
  source: {
    type: 'claude-code' | 'codex' | 'mcp' | 'document' | 'manual' | 'dream';
    ref: string;            // session id or path hash: never the plain path
    hash?: string;          // hash of the source content
    code?: {                // only memories from coding sessions: where to dig deeper
      project?: string;     // name of the repository root folder
      repo?: string;        // "origin" remote WITHOUT credentials
      branch?: string;
      files: string[];      // relative to the repository root, never absolute paths
      symbols: string[];    // "class OrderService", "POST /orders/confirm"…
      commits: string[];    // full hashes, verified against git
    };
  };
  confidence: number;       // 0..1, assigned by distillation / dreaming
}
```

**Code references (`source.code`).** For each memory the distiller lists the files, symbols and commits involved. The pipeline verifies them before saving (`codeRefs` in `src/ingest/git-changes.ts`):
- a commit counts only if it is among those of the session chapter, and it is saved with its full hash;
- paths become relative to the root; absolute paths outside the repository are discarded;
- project, remote (without credentials) and branch come from git, not from the model.

Outside a repository only the folder name remains, as the project. References are not part of the id: the same knowledge cited by two sessions remains a single memory. Nodes running an older version ignore the field.

`id = sha256(kind + normalize(title + body))`: two nodes that distill the same memory produce the same id, so exact duplicates eliminate themselves.

### 4.3 Materialized view (SQLite)

Main tables: `memories` (current state, `status`: `active | superseded | archived | redacted`), `links`, `usage` (per node and period), `votes`, `pins`, `members`, `dreams`.
Derived indexes: `memories_fts` (FTS5) and `memories_vec` (sqlite-vec). The view can always be rebuilt from scratch by re-reading the logs.

---

## 5. Network and replication

### 5.1 Stack

- **Hypercore**: signed append-only log, one per node.
- **Autobase**: merges the logs of multiple writers into a deterministic causal order and computes the view with an `apply` function.
- **Hyperswarm**: discovery via DHT and NAT traversal. The topic is `hash(team_secret)`. Connections are encrypted with Noise.
- **Corestore**: local management of cores.

Useful reference implementation: **Autopass** (Holepunch's P2P password manager built on Autobase with blind-pairing invites). It has exactly our shape: few writers, full replication, invites.

**Lessons from spike A** (see [Phase 0 spike](phase-0-spike.md)):

- Replication must be hooked up with `base.replicate(conn)` and **not** with `store.replicate(conn)`, as the Autobase README shows. Only the former enables the *wakeup* protocol, which tells other peers about the cores of active writers. Without it, new members are never discovered.
- **Indexers:** these are the writers whose acks fix final ordering points (`signedLength`). If all nodes are indexers, a majority must be online to make progress. If there is only one (the founder) and it disappears, ordering no longer settles. Proposed policy: **3–5 indexers** (the admins and the nodes that are on most often), all other writers non-indexers. To be validated in Phase 1.

### 5.2 Behavior

- On startup the node joins the team topic and replicates the feeds of all members from any available peer.
- The author does not need to be online: any node holding its blocks is enough.
- With 10–30 nodes, every node can keep connections with all online peers.
- Estimated volume: 10,000 memories × ~2 KB ≈ 20 MB. Full replication is trivial even for a newcomer.
- The `team` feed blocks are **encrypted with the team key**, so even an unauthorized peer that obtained them could not read them.
- Hyperswarm rarely re-runs peer lookup on the topic. If a "bridge" node drops, the others can stay isolated for a long time even if they are all online. So the node refreshes discovery every 5 s when isolated and every 60 s otherwise (verified in spike A).
- **Public or private DHT.** By default nodes join Holepunch's public DHT through its bootstrap nodes. A team can have a **private DHT** with `micelio-server`, i.e. the `server/` folder. It is a separate package installed as a systemd service on a Linux machine with a public UDP port.
  - The server acts as bootstrap node and as a relay for hole punching.
  - It holds no keys or data: it only sees fingerprints and IPs.
  - Clients set it in `network.bootstrap`, with `network.mode` = `private`, and all members must use the same one, otherwise they end up in separate DHTs.
  - When switching to the public DHT, the private nodes stay saved.
  - The switch applies live: `MicelioNode.setNetwork` closes and reopens the `TeamNode` with the new bootstrap nodes, while corestore and view stay on disk.
  - `micelio network check` (`src/net/diagnose.ts`) checks the bootstrap, the public IP and symmetric NAT. Symmetric NAT can only be detected with at least 2 DHT nodes, so the server needs `--extra-nodes`.
  - An always-on Micelio node next to the server is recommended: it acts as a bridge between peers that cannot connect directly.
- Spike A measurements (3–4 Docker nodes, public DHT): convergence in 1–2 s after concurrent writes, after a partition and after an offline node rejoins; about 40 MB of RAM per node.

### 5.3 Scopes

| Scope | Where it lives | Replication |
|---|---|---|
| `private` | Separate local SQLite | **Never**: it is not a Hypercore, so it is structurally impossible for it to end up on the network |
| `inbox` | Part of `private`, with "pending review" status | Never |
| `team` | The team's Autobase | All members |

Promotion `private → team` is an explicit action: it generates a new `memory.add` on the team feed.

There are no per-project sub-scopes. If a group of people needs to share knowledge that must not reach the rest, they form a **separate Micelio team** (with its own network, key and members). Supporting multiple teams on the same node is a future extension, outside the current roadmap.

---

## 6. Ingestion pipeline

```
source ─▶ extraction ─▶ deterministic filter ─┬─▶ BLOCKED ─▶ private (no LLM call)
                                              │
                                              └─▶ LLM classification ─┬─▶ discard
                                                                      ├─▶ private
                                                                      ├─▶ inbox (uncertain)
                                                                      └─▶ team ─▶ distillation ─▶ secret redaction ─▶ memory.add
```

### 6.1 Sources

| Source | Mechanism |
|---|---|
| **Claude Code** | `SessionEnd` hook: receives the transcript path and queues it |
| **Codex CLI** | Watcher on the Codex sessions folder (JSONL) and/or `notify` hook |
| **VS Code / WebStorm** | MCP tool `remember` invoked by the agent (with instructions in the project's rules files) |
| **Document folders** | Watcher (`chokidar`) on folders chosen by the user, with include/exclude globs |
| **Manual** | `micelio remember "..."` from the terminal |

**Anti-loop:** CLI calls made by Micelio itself run with `MICELIO_INTERNAL=1`. Hooks and watchers ignore those sessions, so a distillation does not get distilled in turn.

### 6.2 Text extraction

| Format | Candidate library |
|---|---|
| PDF | `unpdf` / `pdfjs-dist` |
| DOCX | `mammoth` |
| XLSX / CSV | `SheetJS` |
| PPTX, ODT, others | `officeparser` |
| MD, TXT, code | direct read |

Large documents are split into sections before distillation. For each file, `hash → last processed state` is stored locally, so only what changes is reprocessed.

### 6.3 Deterministic filter (local, before any LLM)

The filter exists because the CLIs send content to the cloud provider: anything that is obviously sensitive **must not even get there**.

- **Paths:** blocked globs (e.g. `**/HR/**`, `**/personale/**`, `**/contratti/**`).
- **Keywords:** configurable list (e.g. *valutazione*, *RAL*, *stipendio*, *performance review*, *colloquio*, *licenziamento*, *malattia*; i.e. evaluation, gross salary, salary, performance review, interview, dismissal, sick leave).
- **Personal data patterns:** Italian tax code (codice fiscale), IBAN, phone numbers, people's email addresses.
- **Secrets:** API keys, tokens, passwords, connection strings. In this case the content is **not** blocked: secrets are **redacted** (`[REDACTED:aws-key]`) before continuing.

Blocked content goes to `private` with no LLM calls. The rules live in the node config, with a team default distributed via `team.config`.

**Phase 9: secret safety** (`src/privacy/filter.ts`, `src/privacy/sensitive-files.ts`).

*Detection:*
- known formats, plus **high-entropy** strings: at least 32 base64/url-safe characters with uppercase, lowercase and digits, Shannon entropy ≥ 4 bits per character; hexadecimal strings are excluded so as not to hit commits and ids;
- team rules in `team.config`: `security.secretPatterns` ({ name, regex }, validated on insertion), `security.allow` (literal exceptions or `/regex/`), `security.sensitiveFiles` (globs);
- redaction is **idempotent**: a value that is already a placeholder is not detected again.

*Sensitive files:*
- they are excluded **entirely**: in transcripts, the input and result of every tool that touches them are removed. This is detected from the `file_path`/`path` fields or from the words of the Bash `command`, looking up the tool id across the whole transcript;
- in document folders they are not opened;
- in the git summary only the name appears.

*Traceability and remediation:*
- local **log** (`security_log` in `private.db`) with file types and names, never values;
- retroactive **scan** of memories;
- **cleanup** (admin): `memory.add` of the redacted version, `root.set` if it was a Root, `memory.redact` of the original.

### 6.4 Classification (LLM)

Dedicated prompt. JSON output validated with `zod`:

```json
{
  "destination": "team | private | discard",
  "category": "technical | process | personal | hr | commercial | other",
  "sensitivity": ["personal-data", "evaluation", "credentials", "customer-data"],
  "reusable": true,
  "confidence": 0.0,
  "reason": "..."
}
```

Routing rule (implemented in `route()`, Phase 2):

- `team` **only if** `destination = team`, `sensitivity` is empty and `confidence ≥ 0.8`;
- `private` if `destination = private`, `confidence ≥ 0.8` and **nothing** reusable (`reusable = false`): the content is clearly personal;
- `discard` if `destination = discard` with `confidence ≥ 0.8`;
- in all other cases → **inbox** (doubtful cases: mixed content, sensitive but useful, unsure classifier). The user reviews it with `micelio inbox` or with the MCP tools `inbox_review` / `inbox_decide`. Items expire after 14 days (decision D9).

**Explicit saves (D6):** they go through the same filter and the same classification, but without distillation (the memory is already atomic). An explicit save judged "discard" goes to the inbox: it is never silently discarded. If the LLM is unavailable or the budget is exhausted, it goes to the inbox: when in doubt, nothing is published.

**Sessions (D7):** the Claude Code `SessionEnd` hook notifies the daemon, which queues the session only if the working folder is opt-in (`micelio watch add`). A resumed session is processed only for its new part (`session_progress`). Sessions with fewer than 400 useful characters are not processed.

**Results verified in Phase 2** (evaluation set with real Claude, `npm run eval:ingest`): 22 out of 22 cases correct, 8 out of 8 sensitive cases kept out of the team. All sensitive cases in the set were recognized by the classifier; the keyword filter remains the first line of defense, the one that prevents sending to the cloud.

The evaluation-email example is already stopped at the deterministic filter (keywords) or here (`category: hr`, `sensitivity: evaluation`).

### 6.5 Distillation (LLM)

A session or document produces **0..N atomic memories**. N is `distill.maxMemories`, a team setting chosen by the admin (default 5, from 1 to 20). It is in the prompt and enforced by the pipeline. Each distilled memory carries in `source` its position (`rank`) and how many the model proposed (`batch`). With this data `src/ingest/quality.ts` computes quality metrics per position band and limit saturation (Phase 10):

- every memory is self-contained and understandable without the original conversation;
- generalize: no references to people, customers or data not needed for the technical knowledge;
- prefer *why* and *gotchas* over a play-by-play ("we tried X, it doesn't work because of Y, use Z");
- zero memories is a valid result: most sessions teach nothing new;
- memories are written in the team language (`memory.language`, e.g. `it` or `en`), whatever the source language. Identifiers, API names and code fragments stay unchanged.

**Why a fixed language rather than the source one:** full-text search does not work across languages, and consolidation during dreaming compares and merges memories better when they are written in the same language. If the team language changes, existing memories are not translated in bulk: updated versions are born in the new language as dreaming consolidates them.

**Code changes (diff-aware distillation).** The conversation explains the *why*; the changed structure lives in the repository. If the session folder is a git repository, an automatic summary is appended to the material to distill (`src/ingest/git-changes.ts`):
- the commits made during the chapter (range derived from the transcript `timestamp`s), with hash and message;
- uncommitted changes, only if the chapter is recent (less than 2 hours);
- for each file, its status (new, modified, deleted) and the added or removed declarations: classes, functions, HTTP endpoints. Detection is heuristic, with regular expressions for TS/JS, C#/Java, Python, Go and Rust.

No code is copied: only file names, declarations and commit messages, at most 4,000 characters. The summary goes through the same privacy filter as the conversation. The distiller uses it for memories about structure ("added `OrderService` in `src/orders`, commit `1a2b3c4d`: centralizes order confirmation") and not to list the touched files. It is disabled with `watch.gitChanges: false`.

Before writing, the id hash is checked to discard exact duplicates. Near-duplicates are handled by dreaming.

---

## 7. LLM adapter via CLI

```ts
interface LlmAdapter {
  name: 'claude' | 'codex';
  available(): Promise<boolean>;
  run<T>(task: { prompt: string; input: string; schema: ZodSchema<T>; timeoutMs: number }): Promise<T>;
}
```

- **claude** (verified in spike B with Claude Code 2.1.300):
  `claude -p --output-format json --json-schema <schema> --model <m> --system-prompt <p> --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence`, with input on stdin. The validated result is in `structured_output`.
  - `--tools ""` removes every tool from the agent, which can only answer. `--strict-mcp-config` excludes MCP servers, including Micelio itself. `--setting-sources ""` excludes the user's hooks and settings. `--no-session-persistence` leaves no sessions in the history.
  - The schema must be generated as **JSON Schema draft-07** (`z.toJSONSchema(s, { target: 'draft-7' })`): the CLI rejects draft 2020-12, which is the zod 4 default.
  - On Windows the process must be launched **without a shell** (`claude.exe` from the native installer). With `shell: true` the arguments are concatenated without escaping and the JSON schema breaks.
  - `--bare` cannot be used, because it requires an API key and does not accept the subscription's OAuth login.
- **Models:** the CLI default is the most powerful model, too expensive for repetitive tasks. `--model haiku` is used for classification (5/5 cases correct in the spike, about 5 s per call) and `--model sonnet` for distillation and dreaming (about 5–6 s per call, good quality).
- **codex**: `codex exec` in non-interactive mode. To be verified when a subscription is available.
- Invocations happen in an **empty, isolated working folder**, with tools and actions disabled or in a read-only sandbox: the agent must only answer, not act on the filesystem.
- Output is validated against the `zod` schema. If it is invalid, a retry is made with the error in the prompt (max 2), then the job is discarded and logged.
- A **single queue** with concurrency 1 and backoff respects subscription limits. Ingestion and dreaming share the queue, with priority to ingestion.
- The distillation prompt must enforce **faithfulness to the source**: in the spike the model added a plausible detail that was not in the source text.

A node with no CLI available is still a full node for replication and recall, but it does not distill and does not dream. Its sources stay queued until a CLI becomes available again.

---

## 8. Recall, priority and activation

### 8.1 Search

Hybrid search:

1. **FTS5** (BM25) on the query;
2. **vectors** (cosine similarity) on the query embedding;
3. fusion with **Reciprocal Rank Fusion**;
4. final re-ranking: `rank = rrf × (1 + α · activation)`.

`archived`, `superseded` and `redacted` memories are excluded by default (`include_archived` to include them).

**Local embeddings** (implemented in Phase 5, `src/embed/`) with transformers.js and `multilingual-e5-small`, in a worker thread. They stay local, so they are consistent with the "no API" constraint. The model name is stored next to each vector: if it changes, vectors are recomputed. Vector search is exhaustive in JavaScript (no sqlite-vec: with thousands of memories it costs milliseconds and no native extension is needed).

Spike C measurements (`Xenova/multilingual-e5-small`, q8 quantized, Windows):

- 130 MB download, 6 s load time, 384 dimensions, **3.3 ms per pass**;
- first result correct in 4 queries out of 4, **even across languages** (query in English, memories in Italian);
- e5 cosine scores are compressed (all around 0.80–0.90), so thresholds for deduplication and clustering must be tuned on real data and not set to "classic" values like 0.92;
- with the model loaded the process uses **about 620 MB of RAM**. The model must therefore be loaded in a worker only when needed and unloaded after a period of inactivity. e5 models require the `query: ` and `passage: ` prefixes.

### 8.2 Activation

Inspired by the base level of the ACT-R model of human memory: what is used often and recently is more accessible.

```
activation(m) = w_r · recency(m)
              + w_u · log(1 + uses_team(m))
              + w_v · votes(m)
              + w_c · centrality(m)
              + pinned(m) · ∞

recency(m)    = exp(-ln2 · days_since_last_use(m) / half_life(kind))
```

- `uses_team`: sum of the `usage.report`s from all nodes. A memory used by many colleagues weighs more.
- `half_life` depends on the kind: `decision` 365 days, `howto` 180, `gotcha` 120, `snippet` 90 (initial values, to be tuned).
- `centrality`: normalized degree in the `memory.link` graph.
- Activation is computed **at query time** with the local clock. The replicated view contains only the inputs, so it stays deterministic.

### 8.3 Usage counters

Every `recall` that returns a memory increments a local counter. Every N hours the node publishes a single aggregated `usage.report`, so as not to fill the log with one event per read.

---

## 9. Membership and identity

- **Identity:** each node (device) has a key pair. A user with two PCs has two nodes.
- **Team creation:** the founder node creates the Autobase, the encryption key and the topic secret, and becomes `admin`.
- **Invite (implemented, Phase 1):** **any member** can run `micelio invite`. The command creates a **blind-pairing** invite (valid 24 h), publishes `invite.add` with the invite id and public key, and returns the single-use code. The code does **not** contain the team encryption key (decision D2).
- **Joining (implemented, Phase 1):** the new node generates its own writer key and presents it via blind-pairing. **Any online member** that receives the request checks that the invite exists in the view and has not expired, publishes `member.add` and delivers the Autobase key and the encryption key over the encrypted channel. In `apply`, a `member.add` with an `inviteId` is valid only if the invite exists, and it consumes it (single use).
  - **The inviter can be offline**, as long as the `invite.add` event has already reached at least one other member. That is why `invite` waits up to 10 s for a peer to receive the feed and, if none has, warns the user to stay online.
  - First choice (spike A): Autobase *optimistic* blocks, validated in `apply`. Dropped because it required putting the encryption key in the invite code.
- **Invite expiry:** `apply` cannot use the local clock because it is not deterministic. Expiry is therefore checked at pairing time, on the node that accepts the request.
- **`invitedBy`** records who **created** the invite, not who accepted the request: that is the useful information for traceability.
- **Roles:** `admin` (removes members, manages team config and redactions, promotes other admins) and `member` (invites, writes memories, votes, dreams).
- **Traceability:** `micelio members` shows the invite tree (who brought in whom), so an admin can trace a suspicious join back to its origin.
- **Permissions and concurrent events (found in Phase 1 tests):** `apply` evaluates permissions in the linearized order. If a member issues an admin action *concurrently* with their own promotion, the ordering may put the promotion first and make the action valid, consistently on all nodes. Mitigation: the node rejects admin actions upfront if it is not admin locally, so a normal client never issues them. The theoretical risk of a tampered client exploiting that concurrency window remains. It is accepted for a team of colleagues.
- **Offboarding:** only an admin can publish `member.remove`. `apply` ignores removals published by non-admins. After removal, new events from the removed node are ignored. **Inherent limit:** what the node has already replicated stays in its possession. Future knowledge is protected by **full protection** (0.7.0): every node replicates only with whoever proves, on that connection, to be an active member (`src/net/member-gate.ts`), and content is encrypted with a per-generation key that changes at every removal and is handed only to active members (`src/core/team-crypto.ts`, `src/net/team-keys.ts`). On in new teams; in existing teams an admin turns it on when everyone has 0.7.0.

---

## 10. Dreaming

### 10.1 Coordination across nodes

If every node dreamed on its own, the results would diverge. That is why dreaming **never modifies the view directly**: it produces events that replicate like all the others.

- **Epoch:** fixed time window (default 24 h, `epoch = floor(unix_time / 86400)`).
- **Deterministic election:** every node with an available CLI computes `rank = hash(epoch ‖ node_key)` for all members. The lowest-ranked node among those that have shown signs of life recently (events or connections) publishes `dream.claim`. If the first has not claimed the epoch within a grace period, the next one takes over.
- **Concurrent claims:** if two nodes claim the same epoch, the one with the lowest rank according to causal order wins. The other stops working as soon as it sees it.
- **Idempotence as a safety net:** if two nodes dream in parallel anyway, their events are content-addressed. In addition, `apply` ignores a `supersede` that refers to memories already superseded: the first in causal order wins.
- **When:** preferably when the machine is idle (configurable, e.g. 13:00–14:00 or at night).
- **Budget:** at most N CLI calls per epoch (default 30), so a dream does not burn a colleague's whole subscription.

### 10.2 Phases of a dream

1. **Collection:** new memories since the last epoch, plus a sample of old memories with low activation.
2. **Clustering:** grouping by vector similarity.
3. **Consolidation:** in clusters with overlaps the LLM produces a merged memory → `memory.supersede` (the sources remain as history).
4. **Contradictions and obsolescence:** the LLM compares conflicting memories (e.g. "we use lib X" versus "we dropped X"). The more recent and better supported one replaces the other. If the LLM is unsure, it creates a `memory.link` of type `contradicts`, for manual review.
5. **Links:** `memory.link` between related memories, to enrich the graph and centrality.
6. **Decay:** memories with activation below threshold, past the minimum age and not pinned become `memory.archive`. Borderline cases go through an LLM check ("is this still valid?").
7. **Journal:** `dream.complete` with a readable summary of what changed, visible to the team.

Future phase: **abstraction**, i.e. deriving general principles from several specific memories.

### 10.3 Guardrails

- Dreaming **never deletes**: it archives or supersedes, and everything is reversible (`memory.restore`).
- Pinned memories do not decay.
- The only real deletion is **redaction** (`memory.redact`), reserved to admins for content that reached the network by mistake. Every node that receives it deletes the affected blocks locally. It is a **best-effort** operation: a malicious node could keep the content. That is exactly why the main defense is the inbound filter.

---

## 10-bis. Roots: foundational knowledge (Phase 8)

**Problem.** Usage-based priority (activation, §8.2) makes whatever is not consulted decay. Some memories, however, are pillars that are rarely consulted: architecture, network, interfaces, domain, best practices, policies. They must never be forgotten.

**Model.** A Root is a view record (`root/<id>`) tied to an active memory, with these fields:
- `category`;
- `by`/`ts`: who promoted it and when;
- `reviewedAt`/`reviewedBy`: last review;
- `status` (`ok` | `review`) and `flags` (reasons and references).

The events are `root.set`, `root.unset`, `root.flag` and `root.confirm`, and **any member** can issue them (user decision). Nodes running older versions ignore them.

**Guarantees** (in `apply`, so identical on all nodes):
- a Root is not merged (`memory.supersede`) and not archived, like a pinned memory;
- activation never drops below `ROOT_FLOOR` = 0.75, so it is never a candidate for decay (threshold 0.15);
- dreaming excludes Roots from merges and decay.

**Surfacing at the right time.**
- `recall` (MCP) adds up to 3 relevant Roots not already among the results. The semantic threshold is lower than usual (×0.85), because Roots are long, general texts.
- The `architecture` tool filters by project (`source.code.project` or tag), category, touched files (with folder matching) and text.

**Review instead of oblivion** (`src/roots/review.ts`, run manually). It produces flags (`root.flag`) from three sources:
- commits after `reviewedAt` on the cited files, and files that have disappeared, looking for the repository among the PC's enabled folders (same remote, or project name);
- source document modified or removed, only on the owner's PC;
- contradictions: `contradicts` links from dreaming, plus an LLM that compares the Root with at most 3 more recent, similar memories (at most 30 comparisons per review).

No automatic changes: a person confirms (`root.confirm`), corrects or removes.

**Entry.**
- The distiller proposes a category (`root`, or `none`). For sessions it becomes a private **suggestion** (`root_suggestions` in `private.db`).
- For document folders marked `roots: true`, promotion is direct.
- Label text is extracted from diagrams (`src/ingest/diagrams.ts`).

## 11. MCP server

The daemon (NestJS) exposes MCP over **local Streamable HTTP** (`127.0.0.1`, with a Bearer token), in **stateless** mode: every request creates a new server and transport. The **stdio shim** for clients that only support stdio is postponed to Phase 7, because all planned clients support HTTP. Phase 1 implements `recall`, `remember` and `get` (reference: [mcp.md](mcp.md)).

| Tool | Description |
|---|---|
| `recall(query, k?, tags?, include_archived?)` | Hybrid search ranked by relevance and activation |
| `remember(text, kind?, tags?, scope?)` | Proposes a memory, which still goes through filter and classification |
| `get(id)` | Full memory, with links and supersession history |
| `vote(id, delta)` / `pin(id)` | Explicit signals |
| `promote(id)` | Moves a memory from `private` to `team` |
| `inbox_review()` / `inbox_decide(id, decision)` | Review of uncertain items |
| `forget(id)` | Archives (team) or deletes (private) |

Each IDE or CLI is configured once with `micelio setup <client>`, which writes the client's MCP configuration and, where possible, a rules file that instructs the agent to use `recall` at the start of tasks and `remember` when it discovers something non-obvious.

---

## 12. Markdown export

`~/.micelio/export/team/<kind>/<slug>.md`, with frontmatter (id, tags, activation, source), regenerated on every view change. It is **read-only**: manual edits are overwritten. It can be opened with Obsidian or any editor and also serves as a debugging tool.

---

## 12-bis. Original document on request

Only distilled knowledge travels in the brain (principle 3). To dig deeper, however, you can **request the original** of a document from which a memory was distilled.

- **Source reference:** a memory distilled from a document carries `source = { type: 'document', node, hash, name, size, mime }`. The path on disk is never replicated.
- **Consent (decision D10):** automatic, per folder. When the user adds a watched folder they choose "documents downloadable on request: yes/no". If yes, the node serves the files in that folder to any active member without asking; if no, never.
- **Who serves the file (decision D11):** **only the owner node**. If it is offline, the document is not available. Downloaded copies stay in a local cache (`~/.micelio/sources/`), expire after 30 days and are **not** re-served: if the owner makes a folder non-downloadable, no copy keeps circulating.
- **Protocol:** dedicated `protomux` channel on the existing Hyperswarm connections (already encrypted with Noise). The owner node checks that the requester's key is an active member in the view, that the hash matches a file still present and unchanged in a downloadable folder, and then streams the file in blocks with hash verification on arrival.
- **Access:** MCP tool `fetch_source(memoryId)`, `micelio fetch <id>`, a button in the UI.
- **Phase:** 4 (documents), together with the watched folders that create the references. **Implemented** in `src/net/file-share.ts`.
- **Details that emerged during implementation:**
  - In Hypercore 11 a feed's key (the member's identity) is the hash of its *manifest*, not the signing key. The request therefore carries both `writer` and `signer`. The owner verifies the signature with `signer` and checks in the manifest of the `writer` feed (which it replicates) that `signer` really is its signing key.
  - The channel must be registered with `protomux.pair` as well as opened: if one side opens it before the other is ready, the open is rejected and the channel closes on both sides.
  - The signature covers the Noise session hash (`handshakeHash`) plus the file hash, so it cannot be reused on another connection.

## 12-ter. Monitoring, control and decisions UI

- **Architecture:** a **React** (Vite) web app served by the daemon (NestJS), which can also be opened in the browser on `localhost`, inside an **Electron** shell. The shell adds a tray icon, notifications and automatic daemon startup, and so covers running as a service.
- **Data:** the UI uses the same local API as the CLI, plus an **SSE** channel of real-time events (synchronization, new memories, inbox, requests, dreams). Authentication uses the same token: Electron reads it from `config.json`; in the browser it is passed once through a link opened by `micelio ui`.
- **Screens:** Dashboard (node, peers, synchronization, LLM queue and budget), Memory (search, detail, source), Inbox (decisions), Team (members, invite tree, invites, roles), Private, Settings (opt-in folders, filter rules, budget, models, language). Later phases add Document requests, Votes and pins, Dream journal.
- **Phase:** 3 (base UI, right after ingestion); each later phase adds its own screen.

## 13. Configuration and local files

```
~/.micelio/
├─ config.json        # node name, LLM adapter, watched folders, filter rules, MCP port
├─ keys/              # node identity (protected)
├─ corestore/         # Hypercore / Autobase feeds
├─ view.db            # team view + indexes (derived, rebuildable)
├─ private.db         # private scope + inbox (never replicated)
├─ export/            # read-only Markdown
└─ logs/
```

```jsonc
{
  "node": { "name": "salvo-laptop" },
  "llm": { "adapter": "claude" },                 // or "codex"
  "watch": [
    { "path": "D:/Docs/Architetture", "include": ["**/*.{pdf,docx,md}"], "exclude": ["**/HR/**"] }
  ],
  "filter": { "extraKeywords": [], "extraBlockedPaths": [] },
  "mcp": { "port": 7337 },
  "dream": { "window": "13:00-14:00", "maxCalls": 30 }
}
```

---

## 14. Technology stack

| Area | Choice |
|---|---|
| Runtime | Node.js ≥ 22.13, TypeScript 5.9 (CommonJS, for NestJS compatibility) |
| HTTP (local API + MCP) | **NestJS 11** (Express 5) |
| P2P | `autobase`, `corestore`, `hyperswarm`, `hyperbee`, `blind-pairing`, `protomux-wakeup` |
| Storage | **`node:sqlite`** (built into Node, no native dependency) + FTS5; `sqlite-vec` in Phase 5 |
| Embeddings | `@huggingface/transformers` (local) |
| Validation | `zod` |
| MCP | `@modelcontextprotocol/sdk` |
| Watcher | `chokidar` |
| Document parsing | `unpdf`, `mammoth`, `xlsx` (SheetJS), `officeparser` |
| CLI | `commander` |
| Tests | `vitest`; in-process multi-node integration tests (multiple corestores on a local DHT testnet) |

### Repo structure

The actual structure is described in [development.md](development.md). What follows was the initial proposal: compared to it, the NestJS daemon lives in `src/daemon/` and the orchestrator in `src/node/`.

A single package, organized in modules. It gets split into a monorepo only if needed.

```
src/
├─ core/       # event schema, envelope, signing, apply()
├─ net/        # swarm, autobase, pairing, membership
├─ store/      # SQLite: view, FTS, vectors, private.db
├─ ingest/     # sources, extraction, filter, classification, distillation
├─ llm/        # claude/codex adapters, queue
├─ recall/     # hybrid search, activation
├─ dream/      # election, dream phases
├─ mcp/        # MCP server + stdio shim
├─ export/     # Markdown
├─ daemon.ts
└─ cli.ts
```

---

## 15. Roadmap

| Phase | Goal | Completion criterion |
|---|---|---|
| **0: Spike** | Reduce technical risks | (a) 3 Autobase nodes in Docker containers sync via Hyperswarm, including nodes that join late or go offline; (b) headless `claude -p` returns valid JSON on Windows (`codex` to be verified when available); (c) embeddings with transformers.js working in Node on Windows |
| **1: MVP** | Minimal shared brain | Team creation, invite/join, `memory.add`, SQLite view + FTS, MCP `remember`/`recall`, Markdown export. Two real nodes in sync |
| **2: AI ingestion** | Automatic collection with filtering | Claude Code hook, Codex sessions, deterministic filter, classification, distillation, private scope, inbox |
| **3: Base UI** | Monitoring, control, decisions | React web app served by the daemon + Electron shell, SSE, Dashboard/Memory/Inbox/Team/Private/Settings screens |
| **4: Documents** | Watched folders + original on request | Watcher, PDF/DOCX/XLSX extraction, incremental processing, P2P `fetch_source` (§12-bis) |
| **5: Priority** | Smart search | Vectors, hybrid search, `usage.report`, activation, votes and pins |
| **6: Dreaming** | Consolidation | Per-epoch election, phases 1–7, dream journal |
| **7: Hardening** | Ready for the team | Offboarding and key rotation, redaction, `micelio setup` for all clients, installation packages, observability |

---

## 16. Risks and open points

| Risk | Mitigation |
|---|---|
| Autobase APIs evolve quickly | Pinned versions, access only through the `net/` module, Phase 0 spike (passed with autobase 7.28.2) |
| Embedding model RAM (~620 MB) | Worker loaded on demand and unloaded after inactivity |
| CLI flags and behavior change | Isolated adapter, zod validation, contract tests on the adapter |
| Subscription usage limits | Queue with budget, dreaming in configurable windows, priority to ingestion |
| Distillation quality (noise or banality) | Evaluation set with real anonymized sessions; prefer 0 memories over weak ones |
| Sensitive data leaking into the team | Deterministic filter before the LLM, private by default, inbox, redaction (best-effort) |
| Deletion in an append-only system | Accepted as a limit; redaction + local block deletion; GDPR to be assessed with the relevant experts |
| Embedding divergence | Model pinned in `team.config`, local reindexing if it changes |

**Still open questions:** none at the moment.
