[Italiano](../PLAN.md) | **English**

# Micelio: Work plan

> Living document: updated at every step forward. Reference design: [DESIGN.md](DESIGN.md). Documentation index: [README.md](README.md).
> Last updated: **2026-10-23**. Phases 0–6 completed, Phase 7 partial. Awaiting review after the autonomous work.

## Status

| Phase | Goal | Status |
|---|---|---|
| 0: Spike | Reduce technical risks | ✅ Completed |
| 1: MVP | Minimal shared brain, usable from Claude Code | ✅ Completed |
| 2: AI ingestion | Automatic collection with privacy filter | ✅ Completed |
| 3: Basic UI | Desktop app for monitoring, control and decisions (React + Electron) | ✅ Completed |
| 4: Documents | Watched folders + original document on request | ✅ Completed |
| 5: Priority | Vectors, hybrid search, activation | ✅ Completed |
| 6: Dreaming | Coordinated consolidation | ✅ Completed |
| 7: Hardening | Offboarding, redaction, installer, other clients | 🔄 In progress (partial) |

---

## Decisions made

| # | Decision | Outcome |
|---|---|---|
| D1 | Language | TypeScript. The web/HTTP parts use **NestJS** |
| D2 | Delivering the key to a new member | Blind-pairing with any online member: the invite code does not contain the key |
| D3 | Indexers | Admins are the indexers. 2–3 admins recommended |
| D4 | What goes into the MVP | Only explicit saves. "How to handle explicit saves" is defined in Phase 2 (see D6) |
| D5 | Operating systems | All of them. Development on Windows, Linux verified in Docker, macOS not yet tried |
| D6–D9 | AI ingestion | See Phase 2 |
| D10 | Consent to downloading a document's original | Automatic per folder: "downloadable on request yes/no" chosen when the folder is added (DESIGN §12-bis) |
| D11 | Who serves the original | Only the owning node. Downloaded copies stay in the local cache for 30 days and are not served again |
| D12 | UI | **React** web app served by the daemon + Electron shell (notifications, tray icon, automatic daemon startup). Dedicated phase right after Phase 2 (DESIGN §12-ter). Initially proposed in Angular; the team uses React |

---

## Phase 0: Spike ✅

Full report: [phase-0-spike.md](phase-0-spike.md). In short: P2P 6/6 scenarios, Claude CLI 5/5 classifications, local embeddings 4/4 queries. Codex is not verified (no subscription).

---

## Phase 1: MVP ✅

| # | Task | Status |
|---|---|---|
| 1.1 | Project setup: TypeScript 5.9, vitest + SWC, build | ✅ |
| 1.2 | `core/`: zod event schemas, content-addressed ids | ✅ |
| 1.3 | `net/`: Autobase + Hyperswarm (discovery refresh, wakeup), encryption, admin = indexer | ✅ |
| 1.4 | Membership: init, blind-pairing invite (the inviter can be offline), removal and promotion by admins only, invite tree | ✅ |
| 1.5 | `store/`: FTS5 index on `node:sqlite` derived from the view | ✅ |
| 1.6 | NestJS daemon + `micelio` CLI | ✅ |
| 1.7 | MCP Streamable HTTP (`recall`, `remember`, `get`) + `micelio setup claude-code` | ✅ |
| 1.8 | Read-only Markdown export | ✅ |
| 1.9 | Tests: 25 unit and integration tests + end-to-end Docker scenario (11 checks) | ✅ |
| 1.10 | Documentation: README, user guide, developer guide, MCP | ✅ |

**Completion criterion: met.**
- A node on the Windows PC joined the team of a node in a container via the public DHT (14 s).
- Real Claude Code found with `recall` a memory written by the container.
- Claude Code saved a decision with `remember`, and the container saw it immediately.

**Problems found and solved during the phase:**
1. An invite created by a node that goes offline right away cannot be verified by the others. Now `invite` waits until at least one peer has received it, otherwise it warns.
2. With concurrent events, an admin action issued by a non-admin could become valid. Now the node rejects it up front (DESIGN §9).
3. On Windows `SIGTERM` kills the process without an orderly shutdown. Now shutdown goes through an internal signal.
4. The invite tree attributed the invite to whoever accepted the request. Now it attributes it to whoever created it.

**Important observation for Phase 2:** when Claude saves a memory with `remember`, it writes the text itself and **adds details the user did not say** (also seen in spike B). To be addressed together with decision D6.

**Not verified:** `npm link` on macOS/Linux and the `micelio setup claude-code` command on the real configuration. To avoid changing your configuration I tried it with a temporary `--mcp-config`.

---

## Phase 2: AI ingestion ✅

**Goal:** knowledge comes in even without an explicit `remember`, from Claude Code sessions, and **nothing personal or sensitive reaches the team**. References: DESIGN §6–7.

### Decisions

| # | Question | Outcome |
|---|---|---|
| D6 | How to treat explicit saves (`remember`) | ✅ They **also** go through the deterministic filter and classification. If clean they go to the team, otherwise to the inbox. The tool replies by showing the saved text, so the user immediately sees what was written on their behalf |
| D7 | Automatic collection from Claude Code sessions | ✅ **Opt-in per project:** active only in the folders listed by the user (`micelio watch add <cartella>`) |
| D8 | LLM call budget per node | ✅ Configurable, default **300 calls per day**. When the budget runs out the work stays queued for the next day. Classification with Haiku, distillation with Sonnet |
| D9 | Inbox | ✅ Collects **only doubtful incoming cases** (mixed content, sensitive data flagged together with useful content, low-confidence classifier). Clean content goes to the team without approval, clearly personal or HR content stays private. Review from the CLI (`micelio inbox`) and from MCP; items expire after 14 days. It does **not** cover memories that became useless: those are archived by dreaming (Phase 6), reversibly |

### Tasks

| # | Task | Status |
|---|---|---|
| 2.1 | `llm/`: Claude CLI adapter (from spike B) behind a common interface, queue with concurrency 1, daily budget, retry on invalid output, `MICELIO_INTERNAL` anti-loop | ✅ |
| 2.2 | Private store `private.db` (never replicated) + inbox: CLI `micelio inbox [approve\|reject\|edit]` and MCP tools `inbox_review` / `inbox_decide` | ✅ |
| 2.3 | Deterministic filter: paths, keywords (HR, evaluations, salaries…), personal data patterns (tax code, IBAN, phone, email), **secret redaction** (API keys, tokens, passwords, connection strings). Default rules + team rules via `team.config` | ✅ (path rules postponed to Phase 4, where they are needed for document folders) |
| 2.4 | Classification with Haiku (schema and prompt from spike B, expanded set of test cases) | ✅ |
| 2.5 | Distillation with Sonnet: 0..N atomic memories, **faithfulness-to-source rule**, team language (`memory.language`) | ✅ |
| 2.6 | Claude Code `SessionEnd` hook installed by `micelio setup claude-code`: sends the transcript path to the daemon, only for opt-in folders (D7) | ✅ |
| 2.7 | Explicit `remember` through filter + classification (D6) | ✅ |
| 2.8 | Evaluation set: 20–30 realistic anonymized sessions (technical, HR, mixed, trivial) with the expected outcome, runnable with `npm run eval:ingest` | ✅ |
| 2.9 | Tests and documentation (user guide: privacy and inbox; development: pipeline) | ✅ |

**Completion criterion:**
- A technical session in an opt-in folder produces memories in the team with no intervention.
- A session about an evaluation email, or with credentials, produces **nothing** in the team (it stays private or in the inbox).
- The evaluation set passes at least 90% of cases, and 100% of the sensitive cases.

**Completion criterion: met**, with real tools:
- a **real Claude Code session** in an opt-in folder triggered the hook, was classified (Haiku, 4.9 s) and distilled (Sonnet, 6.1 s), and produced a faithful memory, retrievable with `recall`;
- a **real session** asking for a colleague's year-end evaluation email was blocked by the local filter **without any call to Claude**: the team stayed unchanged and the private log records the reason;
- **evaluation set** with real Claude: 22 out of 22 cases correct, 8 out of 8 sensitive cases kept out of the team (`test/eval/report.md`);
- 66 automated tests and the end-to-end Docker scenario (11/11) green.

**Problems found and solved during the phase:**
1. **Windows, 8.3 short names:** Claude Code reports the working folder with the long name, while the enabled folder could be saved with the short one (`MARIOR~1.ROS`). Sessions were silently ignored. Paths are now normalized.
2. **Silent hook:** a hook error left no trace. It now goes to `logs/hook.log`, and ignored sessions are reported in the daemon log.
3. **Event schema:** `source.type` was a strict enum, so older nodes would have ignored memories with new sources. It is now a free string (forward compatibility).
4. **Code comments:** at your request, all code was rewritten with headers, JSDoc and comments on the why. The rule is in the conventions ([development.md](development.md)).
5. **Disk:** Docker rebuilds left orphan images (about 480 MB each). They were removed, and the e2e scenario now cleans up Micelio images by itself.

**Not covered in Phase 2:** Codex CLI (a subscription is needed to try it), document folders (Phase 4).

---

## Phase 3: Basic UI ✅

**Goal:** a desktop app to monitor the node, search the team's knowledge, make decisions (inbox, members) and configure collection, without using the terminal. Reference: DESIGN §12-ter.

### Decisions

| # | Question | Outcome |
|---|---|---|
| D13 | Where the code lives | ✅ Same repository: `ui/` (React + Vite) and `desktop/` (Electron), as npm workspaces. The daemon serves the built UI at `http://127.0.0.1:7337/ui` |
| D14 | App or browser | ✅ The **desktop app** is preferred, but the same UI also works in the browser: `micelio ui` opens a one-time link that hands the token to the page. The Electron app reads the token directly from `config.json` |
| D15 | Notifications | ✅ New inbox items, node isolated for more than 10 minutes, LLM budget almost exhausted |
| D16 | Installation packages | ✅ **None for now**: the app is started from the console (`npm run desktop`). Installers for all systems, and auto-start at login, in Phase 7 |

### Tasks

| # | Task | Status |
|---|---|---|
| 3.1 | Daemon: real-time event channel (SSE `/api/events`): sync, new memories, inbox, queue, peers | ✅ |
| 3.2 | Daemon: serving the built UI and `micelio ui` command with a one-time link | ✅ |
| 3.3 | React: skeleton, navigation, light/dark theme, typed API client, real-time updates | ✅ |
| 3.4 | Dashboard screen: node, team, peers, sync, LLM and budget, queue | ✅ |
| 3.5 | Memory screen: search, detail, author, source | ✅ |
| 3.6 | Inbox screen: preview, approve (with editing), reject | ✅ |
| 3.7 | Team screen: invite tree, create and copy an invite, promote and remove (admins only), team settings | ✅ |
| 3.8 | Private screen: decision log | ✅ |
| 3.9 | Settings screen: enabled folders, LLM budget and models, Claude Code configuration | ✅ |
| 3.10 | Electron: automatic daemon startup, window, tray icon, notifications (D15), start from the console | ✅ |
| 3.11 | Tests: SSE and API (integration), main React components (unit), screenshots of the screens from the real app | ✅ |
| 3.12 | Documentation: app guide, UI development | ✅ |
| 3.13 | **3D Nucleus** (requested along the way): navigable holographic home with guided exploration, search that "lights up" topics, colors by author/type. **2D Map** for targeted analysis | ✅ |
| 3.14 | Demo team (`npm run demo`): 3 local nodes, ~50 memories, private DHT, fake LLM | ✅ |

**Completion criterion:** on the Windows PC, the desktop app starts the daemon by itself and allows, without a terminal, to:
- see the node status;
- search for a memory;
- approve or reject an inbox item, receiving its notification;
- create an invite;
- enable a folder for collection.

The same UI also works from the browser with `micelio ui`.

**Outcome:**
- **Criterion met and verified with screenshots of the real app** (`docs/img/`). The app starts the daemon by itself and shows status, search, inbox with approval and correction, invites, enabled folders and Claude Code configuration.
- **Notifications** for inbox, isolation and budget, with the rules covered by tests.
- **Browser** with `micelio ui` (one-time link).
- **Tests:** 72 for the daemon + 8 for the UI.

**Problems found and solved:**
1. Two copies of three.js (0.169 and 0.186) and of React (18 and 19), pulled in by dependencies: everything aligned on three 0.186 and React 19.
2. Electron launched from the VS Code terminal started without windows (inherited `ELECTRON_RUN_AS_NODE`): added `desktop/launch.js`.
3. 3D Nucleus with a gray-blue background instead of black: with the post-processing chain the background color was lightened. Diagnosed by comparing screenshots with and without bloom; solved with a pure black background and bloom inserted before the color conversion.
4. 2D Map "shrunk" in the center: added automatic framing.

**Note on disk:** React, Vite and Electron add about 600–800 MB of development dependencies in `node_modules` (no extra Docker images). For UI tests I will not use Playwright, which would download more browsers: component tests and manual verification in the app are enough.

---

## Phase 4: Documents ✅

| # | Task | Status |
|---|---|---|
| 4.1 | Document folders in config (with "shareable" flag, D10), CLI `micelio docs`, API, Settings screen | ✅ |
| 4.2 | Watching with chokidar, incremental processing by hash (`documents` table in the private store) | ✅ |
| 4.3 | Text extraction with officeparser (PDF, DOCX, XLSX, PPTX, ODT, RTF, MD…), splitting into chunks | ✅ |
| 4.4 | Path rules (postponed from Phase 2): HR/contracts/… folders never opened, plus team rules (`filter.blockedPaths`) | ✅ |
| 4.5 | Source reference in memories (hash, name, size, type; never the path) | ✅ |
| 4.6 | P2P protocol `micelio/file/v1`: active members only (signature bound to the connection), only from the owner (D11), hash verification, 30-day local cache | ✅ |
| 4.7 | `micelio fetch`, MCP tool `fetch_source` (path + text), "Download the original" button in the app | ✅ |
| 4.8 | Tests (unit + integration on real nodes with real DOCX files), demo team with documents, documentation | ✅ |

**Outcome:** 85 daemon tests + 8 UI tests. Also verified between real daemons in the demo team: Bruno downloaded `architettura-ordini.docx` from Alice, byte-for-byte identical.

**Problems found and solved:**
1. **File exchange channel closed immediately** (race between the two sides on opening): solved with `protomux.pair`.
2. **"You are not a member"** even for a member: in Hypercore 11 the feed key and the signing key are different. Solved by verifying through the manifest (DESIGN §12-bis).
3. **No documents detected under a hidden folder (`.demo/`):** the rule that ignores `.git` and similar applied to the whole path; it now applies only below the watched folder.
4. **chokidar uses "/" even on Windows:** comparisons with the configured paths failed. Normalized.
5. **Windows short and long paths** in tests too: comparisons on canonical paths.

---

## Phase 5: Priority ✅

| # | Task | Status |
|---|---|---|
| 5.1 | Events `memory.vote`, `memory.pin`/`unpin`, `usage.report` (G-Counter: the maximum per node is kept) | ✅ |
| 5.2 | Activation (DESIGN §8.2): recency with half-life per type, uses, votes, links, pins | ✅ |
| 5.3 | Local embeddings in a worker thread (multilingual-e5-small), loaded on demand and unloaded after 10 minutes; background computation of missing vectors | ✅ |
| 5.4 | Hybrid search: BM25 + cosine with a per-model threshold, RRF fusion, activation weight | ✅ |
| 5.5 | Local usage counters published every 30 minutes and on shutdown | ✅ |
| 5.6 | Semantic links in the constellation; in the Nucleus, larger golden stars for the most alive memories | ✅ |
| 5.7 | `micelio vote/pin/unpin`, MCP tool `vote`, 👍 👎 📌 and activation in the app | ✅ |
| 5.8 | Tests (unit: activation, RRF, G-Counter; integration: propagated votes/usage/pins, semantic links) and documentation | ✅ |

**Outcome:** 98 daemon tests + 8 UI tests. Real embedder verified from the compiled code: model downloaded once (130 MB, shared cache), "which ORM to use for a new microservice" finds the memory about Drizzle.

**Choices and problems:**
1. **No sqlite-vec:** vector search is exhaustive in JavaScript. With a few thousand 384-dimension memories it costs milliseconds, and it does not introduce a native extension to distribute on three operating systems. To be reconsidered beyond ~50,000 memories.
2. **The worker kept the process "detached" even with open requests:** outside the daemon the process ended before the response. It now stays attached while there are requests.
3. **Model-dependent semantic threshold:** e5 has scores compressed between 0.8 and 0.9 (spike C), so the threshold is 0.83. The fake embedder in tests uses 0.3.
4. **Tests, e2e and demo use the fake embedder** (`MICELIO_EMBEDDER=hash`): fast, deterministic, no download. In production the default is the real one.

---

## Phase 6: Dreaming ✅

| # | Task | Status |
|---|---|---|
| 6.1 | Events `memory.supersede`, `memory.link`, `memory.archive`/`restore`, `dream.claim`, `dream.complete`, with deterministic rules in apply: the first merge wins, pinned memories are untouchable, the journal is accepted only from the epoch's winner | ✅ |
| 6.2 | Rotation per epoch (day): deterministic order by hash(epoch + key), window from 13:00, one turn every 30 minutes; wait after the claim to reduce double dreams | ✅ |
| 6.3 | Groups of near-duplicates (union-find on vectors, per-model threshold) → LLM decision: merge / superseded / link / nothing; cautious prompt faithful to the content | ✅ |
| 6.4 | Deterministic decay (activation < 15%, older than 90 days, not pinned), at most 20 per dream | ✅ |
| 6.5 | Budget: at most 30 calls per dream, within the daily budget | ✅ |
| 6.6 | Journal, archive and restore: `micelio dream now/log`, `micelio archive/restore`, Dreams screen; in the Nucleus dreaming synapses are golden | ✅ |
| 6.7 | Tests (unit: selection, decay, rotation, apply rules; integration: replicated merge, restore, concurrent dreams) and documentation | ✅ |

**Outcome:** 107 daemon tests + 8 UI tests. In the demo team a dream merged two pairs of near-duplicates written by different colleagues (screenshot in `docs/img/sogni.png`).

**Problem found:** two nodes dreaming the same epoch at the same instant both see their own claim before the other's. Correctness is guaranteed by apply (a single journal, no duplicate merges); to reduce wasted work the node waits 5 seconds after the claim and checks again who won.

**Known limit:** the quality of merges with real Claude has not yet been measured with an evaluation set like the one in Phase 2. It must be done before enabling dreaming on a real team.

---

## Phase 7: Hardening 🔄 (partial)

| # | Task | Status |
|---|---|---|
| 7.1 | MCP stdio shim (`micelio mcp`): forwards to the daemon, verified with a real MCP stdio client | ✅ |
| 7.2 | `micelio setup codex / vscode / webstorm`: prints the configuration to paste (formats documented by the clients, not tried in the clients themselves) | ✅ |
| 7.3 | Redaction (`memory.redact`, admins only, not restorable) via CLI and API | ✅ |
| 7.4 | Metrics (`micelio metrics`, `GET /api/metrics`) | ✅ |
| 7.5 | **Team key rotation on offboarding** | ⬜ To do: requires creating a new Autobase encrypted with a new key and migrating the remaining members; delicate work, to be designed together |
| 7.6 | **Local deletion of redacted blocks** (beyond the view) | ⬜ To do |
| 7.7 | **Desktop app installer** (Windows/macOS/Linux) | 🔄 **Windows done** (branch `feature/installer-windows`): `npm run package:win`, per-user NSIS installer with bundled Node and the `micelio` command on the PATH; tried from `win-unpacked` (CLI, native modules, embeddings, app starting the daemon). The real installation still needs trying; macOS and Linux to do. Previously: postponed by decision D16. Automatic daemon startup at login already exists: `micelio autostart on` |
| 7.8 | **Tests on macOS** and real trials with Codex, VS Code and WebStorm | ⬜ Needs a macOS machine and the clients installed |
| 7.10 | **Change-aware distillation**: git summary of the session chapter (commits, uncommitted work, classes/functions/endpoints) added to the distiller's material, with references to files and commits. Option `watch.gitChanges`. Every memory from a session carries **code references** (`source.code`: project, repository, branch, files, symbols, verified commits), visible in the app, CLI, MCP and export | ✅ |
| 7.11 | **Team server (private DHT)**: separate package `server/` (`micelio-server`, only `hyperdht`) with `install.sh`/`uninstall.sh` for systemd; on the client side `network.bootstrap` and `micelio network show/set/public/check`. Verified: automated test (team via the server only), installation in a Debian container, diagnosis of the public DHT from Windows. **To try**: real systemd service and NAT on a real Linux machine | 🔄 Partial |
| 7.12 | **Network and disk space from the UI**: public/private DHT choice in Settings (check without applying, hot apply with reconnection, private nodes kept), `micelio network private`; *Disk usage* tab in Status (total on disk per component, share of the team log per member from `core.byteLength`) | ✅ |
| 7.9 | **Dreaming evaluation set** with real Claude (like the Phase 2 one) | ⬜ To do before enabling dreaming on a real team |

---

## Phase 8: Roots: foundational knowledge ✅ (branch `feature/radici`)

Some memories are **pillars**: architectural paradigms, network maps, application interfaces, domain model, best practices (e.g. rules for coding with AI), security policies. They are consulted rarely, but must never be forgotten. They can come from code, documentation, PDFs, schemas, diagrams or vaults.

User decisions (2026-10-18):
- **name:** "Roots" («Radici»);
- **who promotes:** any member can promote or remove a Root;
- **pin:** stays separate;
- **review:** no periodic reminders; it is started by hand;
- **graphical views:** Roots are marked distinctly.

| # | Task | Status |
|---|---|---|
| 8.1 | **Model and permissions:** events `root.set/unset/flag/confirm`, record with category, review status and flags. Roots are not merged and not archived. Activation never below 0.75 (`ROOT_FLOOR`); dreaming excludes them | ✅ |
| 8.2 | **They surface when needed:** "Relevant Roots" appended to every MCP `recall`; MCP tools `architecture` (filters by project, category, touched files, text) and `mark_root`; API `/api/roots`; CLI `micelio roots` (alias `radici`) | ✅ |
| 8.3 | **Manual review** (`micelio roots review`, `POST /api/roots/review`): flags Roots whose code (commits after the review on the cited files, files that disappeared) or source document has changed, or that more recent memories contradict (dreaming links + LLM, max 30 comparisons). Repositories are searched in the folders enabled on this PC | ✅ |
| 8.4 | **Ingestion:** the distiller *suggests* Roots (private store; promote or "ignore" from the UI/CLI `micelio roots suggested`); "Roots" document folders (`micelio docs add --roots`): their memories become Roots by themselves; text from diagrams: draw.io (compressed too), SVG, PlantUML, Mermaid | ✅ |
| 8.5 | **UI:** *Roots* view (by category, filter by project and text, status and reasons, review with report, suggestions to promote or ignore); Root box in the memory detail; "Roots" folders in Settings; in the **3D Nucleus** Roots sit at the center of the sphere with a ring (red if they need review), in the **2D Map** they are diamonds; "◆ Roots" isolates them. Verified with screenshots of the app | ✅ |
| 8.6 | Documentation: user guide §7-ter-bis, MCP, app, DESIGN §10-bis, development | ✅ |

---

## Phase 9: Secret security ✅ (branch `feature/sicurezza-segreti`)

User request (2026-10-18): a security mechanism, in the backend and with a dedicated screen, for sensitive information such as passwords and `.env` files. The starting point is what already exists: secret redaction in text and blocked paths for documents.

| # | Task | Status |
|---|---|---|
| 9.1 | **Secret detection:** new formats (Azure, Stripe, npm, PyPI, SendGrid, Authorization/Bearer headers, private keys in JSON); high-entropy strings (hex hashes excluded); team patterns and exceptions (`security.secretPatterns`, `security.allow`) | ✅ |
| 9.2 | **Sensitive files:** `.env*`, keys, `credentials`, kubeconfig, `.npmrc`… In sessions, content read or written by Claude is removed entirely (including `cat .env` via Bash); in document folders they are not opened; in the git summary the diff is excluded. Additional team patterns (`security.sensitiveFiles`) | ✅ |
| 9.3 | **Local audit log** (`private.db`): what was removed, from where, of what type. Never the value | ✅ |
| 9.4 | **Retroactive scan** of published memories and "clean up" (admin): redacted version published, original removed; a Root stays a Root | ✅ |
| 9.5 | ***Security* UI:** test bench (text or file name), built-in and team rules (editing by admins only, validated patterns), scan with *Clean up*, log of this PC. CLI `micelio security test|scan|clean|log|rules`. Verified with screenshots of the app | ✅ |
| 9.6 | Tests (unit: detectors, entropy, idempotence, sensitive files, transcripts; integration: rules, scan, cleanup, git diff; UI) and documentation (guide §5-bis, app, DESIGN §6.3) | ✅ |

---

## Phase 10: Limit on distilled memories ✅ (branch `feature/limite-distillazione`)

User request (2026-10-18):
- the number of memories per distillation becomes a team setting chosen by the admin, default 5;
- it is raised only **with precise quality metrics**.

The reason for the limit is not cost (with the subscription CLI calls are not paid one by one) but noise.

| # | Task | Status |
|---|---|---|
| 10.1 | `distill.maxMemories` (team, admins only, 1–20, validated): in the prompt and enforced by the pipeline; every distilled memory carries `source.rank` (position) and `source.batch` (proposed by the model) | ✅ |
| 10.2 | Metrics (`src/ingest/quality.ts`): per position band, useful memories, voted useless, merged or archived, never used, score; limit saturation; recommendation (raise, keep, lower, insufficient data) with declared thresholds. Only memories older than 3 days | ✅ |
| 10.3 | UI (Team page: setting and "Distillation quality" tab), API `GET /api/distill/quality`, CLI `micelio quality`, tests, documentation | ✅ |

---

## Backlog (to be tackled, each on a dedicated branch cut from `develop`)

**Branch flow (since 2026-10-19):** `develop` was cut from `main`. Every `feature/*` is cut from `develop` and, when finished, merged back into `develop`; then `develop` is merged into `main`. Up to B9 branches started directly from `main`.

User requests of 2026-10-18 (B1–B3) and brainstorming on competitors on the same day (B4–B6).

| # | Task | Branch | Notes |
|---|---|---|---|
| B1 | **English UI** with an Italian/English selector | `feature/ui-inglese` | ✅ Done. All screens, the memory panel, the graphical views, the desktop app (menus and notifications) and the daemon's 38 error messages (`x-micelio-lang` header). Texts composed by the daemon come back as a code plus values. The team's **data** (memories, flags, dreams), the CLI and MCP responses stay in their original language. Rule: `defineStrings` makes it impossible to compile a function without the English version |
| B2 | **Comprehensive in-app help** | `feature/guida-in-linea` | ✅ Done. 21 topics in Italian and English (Markdown in `ui/src/help/content/<lingua>/`), with sections that also explain how it works behind the scenes: where the files are, in what format, how they travel. "?" button on the titles of every page and tab (side panel on the right section), F1 on the current page, "Help" page with index and search. A test verifies that every topic exists in both languages with the same sections and that every "?" points to an existing section. Original request: for every screen, button and feature: not only *what* it does but *how it works behind the scenes*. For example, for distillation: where memories physically end up (Hypercore/Autobase, corestore, Hyperbee view, SQLite index, Markdown export), in what format, how they reach the other nodes. Contextual help ("?" icon) and a complete navigable guide |
| B3 | **Multiple teams in the same app (workspaces)** | `feature/multi-team` | ✅ Done. `MicelioHost` manages multiple teams on the same PC, each in `teams/<id>/` with its own keys, log, index, private store, settings and network; automatic migration from the single-team layout. A single personal identity (`identity.json`) bound to each team with the signed event `member.identity`: the Team page shows the same person in the other teams. LLM (queue and budget) and embedder shared. Sessions go to the team of the most specific folder; a folder belongs to only one team. API with the `x-micelio-team` header, MCP `/mcp/<team>` registered per project in Claude Code's *local* scope, CLI `--team` and `micelio teams`, selector in the UI, help topic "Multiple teams". Original request: a node takes part in multiple teams, with separate knowledge (keys, logs, indexes, private store per team). Team selector in the UI. Routing by project folder: sessions from a folder go to that folder's team. Agents: per-team MCP endpoint (`/mcp/<team>`) registered **per project** (e.g. the repository's `.mcp.json`), so an agent only sees the project's team. To be verified client by client (Claude Code, Codex, VS Code, WebStorm). It is the most demanding one |
| B4 | **Automatic context, knowledge gaps, files for agents, quality, personal use** | `feature/contesto-e-qualita` | ✅ Done. Five features in a single block, chosen from the brainstorming on competitors: (1) **automatic context**: Claude Code `SessionStart` and `UserPromptSubmit` hooks that insert relevant Roots and memories without waiting for `recall`; (2) **knowledge gaps** (searches with no result, reportable to the team) and **weekly summary**; (3) **CLAUDE.md / AGENTS.md / Cursor rules** generated from Roots and kept up to date, plus **import** of ADRs, CLAUDE.md and Markdown vaults as Roots; (4) **update instead of add** on write (like mem0) and **memories that age with the code** (commits on the cited files); (5) **local-only mode** (no network until needed) and **personal memories** that never leave the PC |
| G | **Galaxies: dense views for large projects** | `feature/galassie` | ✅ Done. Beyond 250 memories, the Nucleus and the 2D Map start from one galaxy per topic (Louvain on links, names from characteristic tags), you enter with a click, search and filters show only the results or light up the galaxies that contain them, tour across galaxies, at most 600 stars per galaxy. Performance measured at 5,000 memories: write ~0.3 s, search < 10 ms, cached constellation ~70 ms, startup without recomputation (neighbors saved); heavy recomputations in the background and in chunks |
| B5 | **VS Code extension** | `feature/vscode` | To do after B4. Memories and Roots relevant to the open file, search, saving a memory from the selection, node status |
| B6 | **Connectors for code review and issues** (GitHub, GitLab, Jira) | to be defined | On the roadmap, not planned. PR comments and issues are where many decisions are born: distill them (through the same privacy filter) |
| B7 | **Backup and restore of a team's knowledge** | `feature/backup-team` | ✅ Done. Encrypted `.micelio-backup` file (scrypt + AES-256-GCM) with all of the team's knowledge; restore into a new team (also from the welcome screen) or into an existing one (admins only), without duplicates, with original author and date; automatic daily backups per team. Team page, Settings, CLI `micelio backup`, help topic "Backup and restore". 5,000 memories restored in ~10 s. See "B7 in detail" below |
| B8 | **A private server that really works** | `feature/server-privato` | ✅ Done (code). `blind-relay` relay on the server node, same UDP port, key derived from the address (no configuration on the PCs); PCs use it only after a failed hole punch or with a symmetric NAT, and only if it responds. Server log with activity every 15 minutes. `network check`, Settings → Network and Status tell whether there is a relay and how much it is used. Server 0.2.0. Remaining: Docker image to publish and a real trial between two different networks. See "B8 in detail" |
| B9 | **Linux package** (AppImage and .deb) | `feature/package-linux` | ✅ Done. `npm run package:linux` (also in a container), parts shared with Windows in `scripts/package-common.js`. Tried in a clean Debian 12: .deb with dependencies, `micelio` on the PATH, daemon with the bundled Node, desktop app on a virtual display, removal. Fixed the missing dependency on the audio library. To be tried on a real Linux desktop |
| B10 | **AI chat over the memory, with a mind map of knowledge** | `feature/chat-memoria` | ✅ Done. "Ask" page: LLM answer written only from the team's memories with clickable [n] references, "I don't know" without calling the LLM and reporting of the knowledge gap, instant mind map (themes as link communities, memories with their first line, dreaming links, expand), follow-up questions, "Save as memory", local-only history. Map over 5,000 memories in ~0.1 s. See "B10 in detail" |
| B11 | **Measuring the system's effectiveness** | `feature/efficacia` | ✅ Done. "Effectiveness" page: agent lookups in real time (MCP tools and automatic context, with response time), per-memory outcomes once the session is over (heuristic always, LLM in the same call as distillation), automatic thumbs-up on memories confirmed useful (never over a manual vote), usefulness shared with the team (`useful.report`, weight 3 in activation), noise, wrong memories, unanswered questions, desktop notifications only for useful/wrong. See "B11 in detail" |
| B12 | **Memory that learns from use** (ideas from Spector) | `feature/memoria-dall-uso` | ✅ Done (0.6.0). Four changes to how memories rise and fall: (1) habituation, memories offered often and never useful drop in the ranking; (2) co-use synapses, two memories useful in the same session strengthen their link; (3) weight for hard-won discoveries, more importance to memories born from a long struggle; (4) redaction receipt, every node confirms it removed the content. See "B12 in detail" |
| B13 | **Public repository and automatic updates** | `feature/repo-pubblica` | 🔄 In progress. The app updates itself instead of having everyone download and install each new version by hand: today every fix (0.5.1, 0.5.2, 0.5.3) means passing the installer to every colleague. Choice: `electron-updater` with GitHub Releases, so the repository must become public first. Four phases, each presented and approved before starting: (1) public repository ✅, that is GNU AGPL-3.0 license with CLA, new README, CONTRIBUTING, SECURITY, code of conduct, CHANGELOG, GitHub templates, «About» card in Settings, cleanup of IPs, names of people and internal projects, spikes removed, and at the end rewriting the history's authors to the personal email; (2) CI with GitHub Actions (Linux only while the repository is private: 2,000 free minutes a month); (3) automatic release from a tag, with installers and `latest.yml`; (4) automatic updates with our own Ed25519 signature |

### B7 in detail: backup and restore of a team's knowledge

**What it is for.** Today a team's knowledge survives as long as at least one team PC has the data: P2P replication is a copy, not a backup. It does not protect against a wrong redaction or an abandoned team, and it does not allow moving the knowledge to a new team. The backup is a **file** that contains the team's knowledge and can be restored into a new team or an existing one.

**What is in the file** (`<team>-<data>.micelio-backup`: compressed JSON with a manifest):
- active memories **and** history (archived, superseded, with the reason), with original author and date;
- Roots (category, status, flags), links, votes and pinned memories, knowledge gaps;
- shared team configuration (memory language and similar).

**What is NOT in it:** keys, members, invites (a restored team has new keys: colleagues rejoin with an invite); private store, Inbox and personal memories (they live on a single PC); original documents; redacted memories.

**Security:** the file contains all of the team's knowledge. Password encryption (scrypt + AES-256-GCM).

**Restore:**
- into a **new team** (whoever restores becomes its founder) or **into an existing team** (merge);
- duplicates are skipped automatically: a memory's id derives from its content;
- original author and date stay visible and count for activation: an old memory does not come back as "new";
- writing in chunks and a single index update at the end. Goal: 5,000 memories in under a minute, with the daemon still responding.

**User decisions (2026-10-19):**
- **backup:** any member (they already see all the knowledge);
- **restore into an existing team:** admins only. Into a new team anyone, because they become its admin;
- **password required;**
- **automatic daily backups:** per team, off by default, in a chosen folder, the last N are kept (default 7). The password for automatic backups is set once and stays only on the PC, in `teams/<id>/settings.json`: the team's data on that disk is already in clear, and encryption protects the copies in the backup folder (which may be shared or on the network).

**Where it is used:** Team page ("Backup and restore" tab), CLI `micelio backup create|restore`, API. IT/EN in-app help with the internals; tests, including a 5,000-memory trial.

### B8 in detail: a private server that really works

**What we know (2026-10-19).** The server responds (86 ms from a team PC). Two nodes on the same PC find each other through the server in 1 second. Two colleagues on different networks, instead, stayed at 0 peers for 9 minutes, while with the public DHT they connect in 3 seconds. The "different networks" case cannot be reproduced from a single PC. The server log does not say who contacts it.

**Most likely cause:** hole punching between two corporate networks, or with restrictive NATs, fails, and today Micelio has no plan B. With the public DHT it may succeed more often, because there are many nodes to measure one's own NAT against.

**Plan:**
1. **Observable server.** Every 15 minutes, and on request, the log says how many PCs contacted it, how many teams are announced, how many hole punches it brokered and how many connections it relayed. This way a problem is visible from the server.
2. **Relay on the server** (Holepunch's `blind-relay`). When hole punching fails, or a PC's NAT is symmetric, the connection goes through the server. It stays end-to-end encrypted (Noise): the server forwards bytes it cannot read. Data and traffic pass through the server only in those cases.
3. **Client.** With the private DHT the node uses the server's relay automatically when needed. Status and `micelio network check` tell whether a connection is direct or relayed, and whether the relay is reachable.
4. **New Docker image** (0.2.0), to be published to the registry, with the command to update.
5. **Tests:** forced relay between two nodes with a test DHT. Real trial with you and the colleague on different networks.
6. **Guide** (Network, P2P) and `server/README.md`.

### B11 in detail: Micelio's effectiveness for agents

**Request (2026-10-19).** See in the UI every time Claude Code queries Micelio and whether it receives useful data. Memories with a certain positive use automatically receive a thumbs-up.

**User decisions:**
- **Notifications:** the "Effectiveness" page with the real-time feed; desktop notifications only for "useful" and "wrong" outcomes, and they can be turned off.
- **Judgment:** heuristic always (free), plus the LLM when the session is distilled. The thumbs-up fires only with the LLM's confirmation.
- **Sharing:** how many times a memory was useful is also shared with the team.

**Plan:**
1. **Lookup log** (`private.db`, only on this PC). Every agent request: MCP tools (`recall`, `architecture`, `get`, `fetch_source`) and automatic context (session start, prompt). Time, project, session, question and returned memories are recorded. The UI receives each lookup immediately (`efficacy` event). Retention: 90 days.
2. **Outcome for each returned memory**, when the session is over (the same moment it is collected today). From the transcript we derive the memories Micelio actually provided (tool results and inserted context, which carry the id) and what Claude did next.
   - **Heuristic, for all sessions:** distinctive elements of the memory (files, commands, symbols, configurations, URLs) appear in later messages and commands. Outcome "probably useful", with the evidence (e.g. "ran `npm cache clean` from memory X").
   - **LLM, for sessions that are distilled:** in the distillation call already planned, one extra question: for each memory provided, "used", "ignored" or "wrong or outdated", with the reason.
   - **Automatic thumbs-up** (+1 vote from your node) only when the LLM confirms "used". Never over a manual vote.
   - **"Wrong":** notification and a proposed action on the page (review, vote down, archive; for a Root, "flag for review"). Nothing automatic.
3. **Usefulness shared with the team.** New event `useful.report`: cumulative counters per memory and per node, like `usage.report`; nodes on earlier versions ignore it. A memory's detail shows "useful N times in the team". Activation (priority) gives more weight to USEFUL use than to just "returned": today a memory counts as used as soon as it is returned.
4. **"Effectiveness" page:**
   - feed of lookups with the outcomes that arrive later;
   - metrics: lookups per day, percentage with results, percentage useful;
   - memories that help the most;
   - memories often returned but never used (noise);
   - memories reported as wrong;
   - unanswered questions (linked to knowledge gaps).
   Filters by project and period. Settings: notifications on/off.
5. **Performance:** recording a lookup must not slow down the response to the agent (background write, indexes). Heuristic linear in the session length. Trial with thousands of lookups.
6. **Guide** "Effectiveness" IT/EN with the internals; unit tests (heuristic, vote plan) and integration tests (lookup → outcome → vote → team counter).

### B12 in detail: memory that learns from use

**Origin (2026-10-21).** A comment on the LinkedIn post about Micelio pointed to [Spector](https://github.com/spectrayan/spector), a memory engine for agents written in Java (Apache-2.0). It isn't a direct competitor: it's a memory for a single user or agent, with no team sharing and no automatic collection from sessions. We already have many of its ideas (decay, reinforcement through use, hybrid search with RRF, consolidation, graph). Four are worth bringing into Micelio. The user asked to plan all four.

**Why now.** In the first three days the Effectiveness page showed that only part of the memories handed to the agent are really useful: 28% in one team, 10% in another. Automatic context often offers the same memories even when they're off topic. Every useless memory in the context is noise for the agent and wasted tokens.

**1. Habituation: what doesn't help goes down.**
- Today "noise" (memories returned at least 5 times and never useful) is only visible on the Effectiveness page; the ranking ignores it.
- A habituation factor is added to activation: the more often a memory has been returned without being useful, the lower it goes. A useful outcome resets it, because the memory has proven its worth.
- It applies mostly to automatic context (`SessionStart`, `UserPromptSubmit`), where the agent didn't ask for anything. An explicit `recall` applies it more lightly, because there the question is precise.
- Roots don't go below the current floor, pinned memories aren't affected.
- Data: the run of outcomes with no use since the last useful one, read from THIS PC's outcomes (Effectiveness page), not from the team counters. Decision of 2026-10-22: the team counters (`usage.report`, `useful.report`) are cumulative and have no order in time, so they can't be reset after a useful outcome, and they also count deliveries never evaluated.
- Weights: up to 2 outcomes with no use 100%, then minus 15% per outcome, minimum 30% (3 → 85%, 5 → 55%, 7 or more → 30%). It doesn't touch activation: constellation and dreaming stay the same.
- Success measure: the share of useful memories on the Effectiveness page must go up in the weeks after release, for the same number of lookups.

**2. Co-use synapses (Hebbian learning).**
- Today synapses come from shared tags, similar meaning and dreaming.
- New "use" synapse type: when two memories turn out useful in the same session, their link gets stronger. A link that is no longer reinforced weakens over time, like activation.
- In search, a memory that is found brings along its strongest co-use neighbours, even if they don't contain the searched words: they are the ones usually needed together.
- In the constellation and in the chat's map these synapses have their own colour.
- Team sharing: a new event with the pairs and their weight, accumulated like the other counters; nodes on older versions ignore it.
- Performance: pairs grow with the square of the useful memories per session, so there is a cap on pairs per session and on neighbours per memory. Trial with thousands of memories.

**3. Weight for hard-won discoveries.**
- A gotcha found after an hour of errors is worth more than an obvious fact, but today it starts with the same weight.
- During distillation we measure how hard the part of the session that produced the memory was: failed commands, repeated attempts, duration, user messages. The data is already in the transcript and needs no extra LLM calls.
- The memory starts with a higher initial importance, which decays normally if nobody uses it afterwards. It shows in the memory's details ("born from a hard session").
- Tuned on 2026-10-22 on 196 real chapters: the first guess (6 errors, 60 minutes, 12 messages) made 43% of chapters "hard"; chosen with the user 15 errors, 120 minutes, 25 messages (about one in five).

**4. Redaction receipt.**
- Today an admin's redaction removes the content from every node, but whoever asked for it doesn't know when it actually happened on each one.
- Every node, after removing the content (index, Markdown export, caches), publishes a signed confirmation event with the memory id and the time.
- In the UI, for each redaction: the list of members with "confirmed on …" or "pending" (nodes that are off). Exportable, for whoever has to show a customer that some data was removed.
- Limit to state in the guide: the receipt says the software removed the data, not that nobody made a manual copy.

**Proposed order:** 1, then 2, then 4, then 3. The first has the most direct effect on effectiveness and is the smallest; the third needs thresholds tuned on real data.

**For each item:** in-app guide IT/EN with the internals, UI text in both languages, unit and integration tests, trial at scale with thousands of memories.

### B10 in detail: AI chat over the memory, with a mind map of knowledge

**Request (2026-10-20).** An AI chat to query the memory and rebuild a navigable tree of links and know-how, readable by a person.

**User decisions:**
- the tree is a **mind map**;
- good answers are saved as a memory with a button;
- history stays only on this PC.

**How it works for the user.** "Ask" page: the conversation on the left, the mind map on the right. You ask a question in plain language and get two things:
1. **an answer written only from the team's memories and Roots**, with numbered references to the source memories. If the memory does not know, it says so and offers to report the knowledge gap to the team;
2. **the mind map of the topic**: the question at the center, themes around it, then the memories. Lines show the links (elaborates, depends on, contradicts, similar). A click on a memory opens it; "expand" adds its neighbors.

Follow-up questions take the conversation into account. Below each answer there is "Save as memory".

**Plan:**
1. **Search, without LLM and immediate:**
   - hybrid search (keywords + meaning) and relevant Roots;
   - one-step expansion over the constellation's links (shared tags, meaning, dreaming);
   - at most ~30 memories, sorted by relevance and activation.
2. **Map, immediate:** the memories found are grouped into themes with the same method as galaxies (communities over links) and each theme is named after its characteristic tags. Each memory shows its title and first line. The map appears before the answer.
3. **Answer, LLM:**
   - one call with the memories found as the only material. Rule: nothing outside of them, every statement with its reference, "I don't know" if something is missing;
   - in the same call the LLM gives the map's themes a readable name;
   - model and daily budget are the ones already configured (Settings → LLM);
   - follow-up questions carry the last 3 questions and answers with them.
4. **Expand a memory:** its neighbors in the constellation are added to the map, without LLM.
5. **Save as memory:** the answer becomes a team memory, with the list of source memories. It goes the same way as an explicit save (privacy filter, possible Inbox).
6. **History** in `private.db`: conversations and messages, to reopen, rename or delete. Only on this PC.
7. **Effectiveness:** chat questions appear among the lookups ("chat" channel).
8. **Performance:** search and map in under 100 ms even with 5,000 memories; no waiting for the LLM to see the map. Trial at scale.
9. **Guide** "Ask" IT/EN with the internals; unit tests (expanded search, map themes) and integration tests (question, answer, save, history) with the fake LLM.

---

## Log

| Date | Event |
|---|---|
| 2026-10-17 | Design v0.1. Nodes on the internet, 10–30 nodes, LLM via CLI without API, distilled knowledge only, private + team scopes, language configurable per team, invites open to everyone with removal reserved to admins, one project = one separate team |
| 2026-10-17 | Phase 0 completed (spikes A, B, C) |
| 2026-10-17 | Decisions D1–D5 confirmed. Phase 1 started |
| 2026-10-17 | Phase 1 completed: 25 tests + Docker e2e 11/11 + real Windows ↔ container trial with Claude Code. Documentation in `docs/`. Phase 2 proposed (decisions D6–D9) |
| 2026-10-17 | Decisions D6–D9 confirmed (default LLM budget raised to 300 calls per day; inbox only for doubtful cases) |
| 2026-10-17 | New features: original document on request (D10–D11, Phase 4) and Electron desktop UI (D12, new Phase 3). Following phases renumbered. Phase 2 started |
| 2026-10-17 | On request: code rewritten with abundant comments (rule in the conventions). Docker hygiene: orphan images removed and automatic cleanup |
| 2026-10-17 | Phase 2 completed: 66 tests + e2e 11/11 + evaluation with real Claude 22/22 (sensitive 8/8) + real trial of the Claude Code hook (technical session → memory; evaluation email → blocked locally). Phase 3 proposed (decisions D13–D16) |
| 2026-10-17 | Decisions D13–D16 confirmed: **React** instead of Angular, same repository, desktop app preferred (browser supported), no installer for now (start from the console). Phase 3 started |
| 2026-10-17 | Request: "wow" 3D home with guided navigation (hologram style) and 2D views for specific purposes. Phase 3 completed: React UI + Electron app, 3D Nucleus, 2D Map, notifications, demo team, documentation with real screenshots. Phase 4 started autonomously |
| 2026-10-17 | Phase 4 completed: document folders, path rules, original document on request via P2P (verified between real daemons). Phase 5 started |
| 2026-10-17 | Phase 5 completed: activation, hybrid search with local embeddings, votes, pins, shared usage (G-Counter), semantic links. Phase 6 started |
| 2026-10-17 | Phase 6 completed: coordinated dreaming (merges, superseded, links, decay, journal, archive). Phase 7 started |
| 2026-10-17 | Phase 7 partial: MCP stdio shim, configurations for Codex/VS Code/WebStorm, redaction, metrics. Remaining: key rotation, installer, tests on macOS and dreaming evaluation |
| 2026-10-17 | Reliable collection: ongoing Claude Code sessions distilled in chapters and recovery of lost ones (session-scanner); the hook starts the daemon if it is off; `micelio autostart on/off` (Windows, macOS, Linux). Hook and startup scripts verified for real on Windows |
| 2026-10-17 | Change-aware distillation (7.10): the distiller receives the git summary of the session chapter. Tested with a temporary git repository (commits dated inside and outside the chapter, uncommitted work) |
| 2026-10-17 | Code references in memories (`source.code`), on request: they help decide whether to dig deeper into a memory. Commits verified against git, relative paths, remotes without credentials |
| 2026-10-17 | Team server (7.11) on request: separate installation for Linux, `micelio network` commands. From the development PC: public DHT reachable, NAT not symmetric |
| 2026-10-18 | Network configurable from the UI and disk usage per member (7.12), on request. Verified with integration tests (hot DHT switch between two nodes, shares that add up to 100%) and app screenshots |
| 2026-10-18 | Phase 8 completed on branch `feature/radici`: Roots (foundational knowledge never forgotten), manual review, suggestions, Roots folders, diagrams, view and graphical marking. Found with the screenshots and fixed a route conflict (`roots/review` taken for an id) |
| 2026-10-18 | Phase 9 completed on branch `feature/sicurezza-segreti`. Found and fixed two defects: non-idempotent redaction (placeholders were detected again as secrets) and empty git summary on a repository's first commit |
| 2026-10-18 | Phase 10 completed on branch `feature/limite-distillazione`: limit on distilled memories chosen by the admin, quality metrics per position and recommendation on the limit |
| 2026-10-18 | B1 completed on branch `feature/ui-inglese`: interface, desktop app and daemon errors in Italian and English. New rule: every feature is born bilingual and with in-app help |
| 2026-10-18 | Fixes from the real trial (version 0.3.2): Nucleus still white with the author/type filters and in the tour (lit Roots went back to full brightness; beyond 20 Roots they now sit in the shell, unlit ones without a ring, tour with distance based on the stop's size); 2D Map with the detail off-screen (now above the map); per-prompt context still off-topic (now only what stands out from the rest passes: mean + 2 standard deviations), Obsidian callouts in the first line |
| 2026-10-18 | Fixes from the real trial (version 0.3.1): Nucleus unusable with 63 Roots from a vault (nucleus that grows with the number of Roots, Roots and rings dimmed when there are many); import that left Obsidian's YAML front matter in the text and linked everything with the `import` tag (now title and tags from the front matter, and re-importing updates changed files); per-prompt context with off-topic Roots (higher threshold, the same for memories and Roots) |
| 2026-10-18 | Windows installer (7.7) on branch `feature/installer-windows`, at the user's request to try a real version. Found and solved: electron-builder excludes `node_modules` from extra resources (copied in `afterPack`), it put the root `node_modules` in `app.asar`, Windows Defender intermittently blocks `Micelio.exe` (retries) |
| 2026-10-20 | B10 chat over the memory (branch `feature/chat-memoria`). With the galaxy sizes (groups of up to 150 memories) the map of a question ended up in a single theme: added sizes for the chat (themes of at most a third of the memories). Map made readable after the first screenshot: themes collected at 3 memories, non-dreaming links only on mouse hover, narrower columns |
| 2026-10-19 | B11 effectiveness. Measuring the automatic context on the user's PC: every message to Claude Code waited ~2.3 s because of a safety timer that kept the hook alive (now ~0.4 s; with the daemon busy the hook reached the 10 s limit and was cancelled, 6 times out of 14 in one day). Load test: without WAL every SQLite write cost ~12 ms (waiting for the disk), now 0.14 ms; the report read at most 5,000 lookups (totals wrong beyond that), fixed |
| 2026-10-19 | B9 Linux packages, built in a `node:24-bookworm` container. Found and fixed: the .deb requires `homepage`; on a minimal system the app did not start because of the missing audio library (added to the dependencies). The Windows installer was also re-verified with the shared parts |
| 2026-10-19 | B8 private server: with two nodes on the same PC the private server works (invite in 1 s); the real case (two different networks, 0 peers) cannot be reproduced from a single PC. Added relay on the server and activity log. Prototype verified first: a DHT node also answers for services listening on itself, so the relay does not need another port. The relay is used only if it responds, otherwise with an old server two PCs would stay disconnected forever |
| 2026-10-19 | B7 backup and restore (branch `feature/backup-team`). Found and fixed with the 5,000-memory trial: vectors saved with one disk commit per row (33 s, now one transaction per group), meaning-based neighbors updated one by one even with thousands of new memories (13 s, now a single recomputation in the background): this also helps import and first startup. Restore from 58 s to ~10 s. Also fixed a Windows CLI error on exit with an error after several calls to the daemon |
| 2026-10-18 | Galaxies and performance at scale (branch `feature/galassie`), on request after the trial with a vault: "2 seconds is tolerable, tens of seconds means not using the system". Load test at 5,000 memories: found and fixed a stack overflow in the constellation (~1,800 memories), meaning-based neighbors recomputed from scratch on every write (now incremental and saved), index rebuilt from scratch, activation with one read per memory (2.1 s → 40 ms) |
| 2026-10-18 | Team server in Docker (branch `feature/server-docker`): `server/Dockerfile` on Debian slim (on Alpine `udx-native` has no musl binaries and the server did not start). Tried locally with two DHT clients finding each other through the container; image published to the user's registry |
| 2026-10-18 | B4 completed on branch `feature/contesto-e-qualita`: automatic context (SessionStart and UserPromptSubmit hooks), knowledge gaps and weekly summary (Summary page, Monday notification), CLAUDE.md / AGENTS.md / Cursor rules from Roots and import of ADRs, update instead of add, memories that age with the code, local-only mode and personal memories. Found and fixed two defects: sharing a personal memory was mistaken for a duplicate of itself; `git log --since` skipped commits with out-of-order dates (now only the history of the cited files is read) |
| 2026-10-18 | B3 completed on branch `feature/multi-team`: multiple teams on the same PC with separate knowledge and a common personal identity (user's choice: "same person + team"). Found and fixed a defect in `canonicalPath`: for a non-existent path it did not expand Windows 8.3 short names |
| 2026-10-18 | B2 completed on branch `feature/guida-in-linea`: in-app help in Italian and English, contextual "?", F1, Help page. The parity test confirmed that all 21 topics have the same sections in both languages |
| 2026-10-21 | Serious bug fixed on branch `fix/mcp-team-cartella` (0.5.1): the user-scope MCP was registered over HTTP and always worked on the default team, so 25 memories saved from a session in a project of team A ended up in team B, the default one. The user-scope MCP is now the `micelio mcp` stdio shim, which sends the project folder on every request, and the daemon picks the team that owns it. `remember` says which team it publishes to. The 25 memories were copied to team A and redacted from the wrong one |
| 2026-10-21 | Slow startup fixed on branch `fix/avvio-lento` (0.5.2): the daemon took 55 s to start (the app waited 30 and said "daemon not running"), because of the synchronous scan of a 209 MB transcript. Causes: the sensitive-file check recompiled 33 expressions for every word (36 s out of 40); the scan ran on the main thread and during startup. Now cached expressions, transcripts read in a worker thread, first scan after startup, unripe sessions not re-read, app wait at 90 s. Maximum main-thread block with the 209 MB transcript: 51 ms |
| 2026-10-21 | Added B12 "Memory that learns from use" to the backlog: habituation, co-use synapses, weight for hard-won discoveries, redaction receipt. Ideas taken from comparing with Spector, pointed out in a comment on the LinkedIn post |
| 2026-10-22 | "Connect Claude Code" works on every install, on branch `fix/collega-claude-code` (0.5.3): some colleagues didn't see Micelio in `/mcp`. Causes: `claude` started without a shell doesn't run if it's npm's `claude.cmd` or if there's only the VS Code extension, and one colleague uses Claude Code with an admin account different from Micelio's. Now `claude` is looked for outside the PATH too (native, npm through `cli.js`, WinGet, VS Code, Cursor, Windsurf extensions), for distillation as well; if missing, the registration is written into `~/.claude.json`; if Claude Code has never been used by Micelio's user a warning appears |
| 2026-10-22 | B12 completed on branch `feature/memoria-dall-uso` (0.6.0). (1) Habituation: runs of outcomes with no use from this PC's outcomes, full weight in automatic context and half in searches, a useful outcome resets it. (2) Use synapses: pairs of memories useful in the same session, `couse.report` event, new synapse kind and neighbors brought into search. (4) Redaction receipt: cleanup of chat, Inbox and personal copies, Ed25519-signed `redact.ack` event, Security → Redactions card, `micelio redactions`. (3) Hard-won discoveries: chapter effort in `source.effort`, head start up to +0.15 in activation. Chat timings on 5,000 memories unchanged compared with develop |
| 2026-10-23 | B13 phase 1 on branch `feature/repo-pubblica`: repository ready to be public. GNU AGPL-3.0 license (the author's choice) with a CLA, so Micelio can also be released under another license; README, CONTRIBUTING, SECURITY, code of conduct, CHANGELOG, GitHub templates and CLA check; «About» card in Settings with the link to the source (effectively required by the AGPL) and license inside the installers. Removed from the files the team server's IP, names of people, teams and work projects, and the spike code. Found that the 0.4.1 commit (Wayland on Linux, by Federico Partesano) exists only on `origin/main` |
| 2026-10-24 | Memories still in the wrong team, fixed on branch `fix/team-sbagliato` (0.6.1): a Claude Code session opened the evening before, with the user-scope MCP registration still over HTTP (never updated after 0.5.1), saved 3 memories of a team A project into the default team B, even after the folder had been enabled in A (moved by hand to A and redacted from B). Causes: updating the app didn't change the registration, and without a folder the daemon silently used the default. Now the daemon migrates the old HTTP registrations to the shim at startup (with a backup of `~/.claude.json`), and at the user's request `remember` always checks the session's folder against the enabled folders of all teams: if it doesn't match the team the memory goes to the Inbox with problem and fix, and "Publish to…" takes it to the right team. Per-folder "Connect Claude Code" registers the shim, it no longer pins a team |
| 2026-10-26 | B13 phase 1, last step: the public repository is a new one, `micelio-second-brain`, and the old `micelio-brain` stays private as an archive (simpler than deleting and recreating it). On branch `fix/nome-repo` every address was updated (package.json, README, CONTRIBUTING, SECURITY, CHANGELOG, GitHub templates, source link in Settings): automatic updates will read this address. The published history is the rewritten one (personal email, Federico Partesano with his GitHub noreply address, no IPs or internal names) |
| 2026-10-26 | Security review before publishing the repository (three reviews in parallel: team access, local surfaces, secrets in the history). Outcome: nobody gets into a team from outside (data encrypted with a random key, single-use invites without the key, signed events, roles checked in the log); clean history. Fixed on branch `fix/sicurezza`: arbitrary file read through the reference of a "from document" memory; team keys handed over even to a rejected join; daemon crashing on a malformed join request; folders outside every team receiving the default team's memory (now no context and read tools blocked, `remember` goes to the Inbox); unsigned "yes" for original documents; `~/.micelio` readable by other users on macOS/Linux; Roots for admins only (`roots.adminOnly` setting, on in new teams). SECURITY.md with the known limitations. To plan: key rotation when a member is removed, daemon proving its identity to clients, random relay key, installer that doesn't close Micelio |
| 2026-10-26 | 0.6.2 on branch `fix/installer-e-identita`, the other points of the security review: (A) the Windows installer really closes Micelio (an "installation in progress" marker that stops hook and shim restarts, orderly stop, closing every process of the folder with 10 attempts; the cause of the 0.6.1 bug was hooks and shim restarting the daemon over and over); (B) the daemon proves its identity before a client sends it the token (`GET /api/hello`, HMAC of a random number with the token; the shim and the app ask for it on every call); (C) team server relay with a random key (server 0.3.0): address for the PCs `host:port#key`, old key kept on for the transition until `MICELIO_SERVER_RELAY_LEGACY=0`. Key rotation on member removal remains (0.7.0), with its own plan |
