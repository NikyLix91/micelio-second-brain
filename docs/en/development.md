[Italiano](../sviluppo.md) | **English**

# Developer guide

## Requirements

- Node.js ≥ 22.13 (uses `node:sqlite`, built in and with no native dependencies)
- Docker, only for the end-to-end tests
- Claude Code installed and authenticated, only for the evaluation with the real LLM
- TypeScript 5.9 (pinned: NestJS requires `emitDecoratorMetadata`)

```bash
npm ci
npm run build        # daemon (tsc → dist/) + UI (vite → dist/ui)
npm run typecheck    # types for src + test
npm test             # unit + integration, with a fake LLM (about 1 minute)
npm run e2e:docker   # 4-container scenario on the public DHT (about 2 minutes)
npm run eval:ingest  # evaluation with the REAL Claude: uses about 25 subscription calls
npm run test:ui      # React component tests (jsdom, no browser)
npm run desktop      # desktop app
npm run demo         # local demo team (3 nodes, private DHT, fake LLM)
```

The repository is an **npm workspace**: root = daemon and CLI; `ui/` = React interface; `desktop/` = Electron app.

## Structure

```
src/
├─ core/       zod event schemas, record model, local paths
├─ net/        the ONLY module that talks to the Holepunch libraries
│  ├─ apply.ts        deterministic function events → view (Hyperbee), with permissions
│  ├─ team-node.ts    Autobase + Hyperswarm + blind-pairing
│  └─ diagnose.ts     `micelio network check`: DHT entry, public IP, NAT
├─ store/
│  ├─ memory-index.ts SQLite FTS5 search index, derived from the view
│  └─ private-store.ts private store: queue, inbox, decisions, budget (never replicated)
├─ privacy/    deterministic filter: HR/personal blocking, redaction of secrets and personal data,
│              sensitive files (.env, keys…) excluded entirely (sensitive-files.ts)
├─ llm/        adapters for the AI CLIs (Claude), fake adapter for tests, runner with budget
├─ ingest/     ingestion pipeline: transcripts, prompts, routing, inbox
├─ export/     read-only Markdown export
├─ node/       MicelioHost (all the teams on the PC) and MicelioNode (one team): framework-free
│              orchestrators + config/state, personal identity in core/identity.ts
├─ roots/      Roots (Phase 8): manual review (code, documents, contradictions)
├─ mcp/        MCP server (recall, remember, get, architecture, mark_root, inbox_review, inbox_decide…)
├─ daemon/     NestJS app: local REST API, MCP endpoint, token guard
└─ cli/        `micelio` command (commander), HTTP client for the daemon, Claude Code hooks
src/graph/     constellation: memories as nodes, correlations as weighted links

ui/src/          React interface (Vite), served by the daemon on /ui
├─ api/          typed client (types imported from the daemon), authentication, SSE events
├─ pages/        screens; nucleus/ = 3D Nucleus (three.js, lazy-loaded)
└─ components/   base components (no component libraries)

desktop/src/     Electron app: daemon startup, window, tray, notifications
server/          micelio-server: the team's private DHT. SEPARATE package (its own package.json,
                 depends only on hyperdht), not a workspace: installed on Linux with install.sh
scripts/         demo team (demo-team.js)
```

### Flow of a write

```
CLI / MCP / hook ─▶ daemon (NestJS) ─▶ MicelioNode ─▶ IngestPipeline ─▶ filter ─▶ Haiku ─▶ (Sonnet)
                                                                                        │ outcome "team"
                                                                                        ▼
Hyperbee view ◀── apply() ◀── feed linearization ◀── P2P replication ◀── TeamNode.append (memory.add)
      │ 'update' event
      ▼
MemoryIndex.rebuild (SQLite FTS5) + writeExport (Markdown)  ─▶  recall
```

### Ingestion pipeline

References: [src/ingest/pipeline.ts](../../src/ingest/pipeline.ts), DESIGN §6.

| Step | Where | Notes |
|---|---|---|
| Transcript reading | `ingest/transcript-worker.ts` | `extractTranscript` runs in a worker thread (`readTranscript`), both in the periodic scan (measure only, without the sensitive-file search) and in distillation: a 200 MB transcript takes ~6 s in the worker and blocks the main thread for less than 60 ms. The first scan starts 5 s after startup, not during it |
| Git summary | `ingest/git-changes.ts` | Only sessions in a git repository: the chapter's commits (from the transcript `timestamp`s, ±2 min) and uncommitted work if the chapter ended less than 2 hours ago. Only file names, declarations and commit messages, max 4,000 characters. Appended to the conversation **before** the filter |
| Deterministic filter | `privacy/filter.ts` | Runs **before** any LLM. Blocks HR topics and redacts secrets |
| Classification | `ingest/prompts.ts` (Haiku) | Structured output validated with zod |
| Routing | `route()` in `pipeline.ts` | Pure function: team / inbox / private / discard. Confidence threshold 0.8 |
| Distillation | `ingest/prompts.ts` (Sonnet) | Only for sessions (team or doubtful). **Faithfulness to the source** rule |
| Second filter | `filterMemory()` | On the distilled memories, before publishing them |

Sessions are jobs in a **persistent queue** (`private.db`, table `jobs`), run by a worker every 3 s:
- budget exhausted → the job moves to the next day without using up attempts;
- CLI unavailable → retry after 10 minutes;
- other errors → 3 attempts, then `failed`.

## Multiple teams (B3)

A PC can belong to several teams. The pieces:

- **`MicelioHost`** (`src/node/micelio-host.ts`) opens a `MicelioNode` for each `teams/<id>/` folder and holds what is unique per machine: personal identity, `LlmRunner` (one queue and one budget, `machine.db`), embedder, default team. On first start it moves the files of a node created before B3 into `teams/<id>/` (`migrate`).
- **Paths** (`src/core/paths.ts`): `teamPaths(root, id)` gives a node its own folder, but `config` stays the root `config.json`. `settings` is the team settings file: `loadConfig` merges the two files and `updateConfig` writes each section back to its own file (`watch`, `network`, `dream` → `settings.json`). In the single-team layout (`nodePaths`, used by the `MicelioNode` tests) the two are the same.
- **Request team** (`src/daemon/team-context.ts`): the middleware reads `x-micelio-team` and puts it in an `AsyncLocalStorage`; `MicelioService.node` returns the node of that team (or of the default one). Existing routes don't change. The exceptions are `team/init`, `team/join`, `teams/*` and `ingest/session`, which go through the host.
- **Folders**: the host passes each node `owns(dir)` (the most specific enabled folder wins, `ownerOf`) and `claimFolder` (the same folder in two teams is forbidden; document folders nested across teams are forbidden).
- **Identity** (`src/core/identity.ts`): `member.identity` signed with the feed key, verified in `apply`. `MicelioNode.linkIdentity` publishes it at startup if missing.
- **MCP**: `/mcp` = the team of the folder in `x-micelio-cwd` (sent by the `micelio mcp` shim, `src/mcp/stdio-proxy.ts`) or the default one, `/mcp/:team` = the given team (`mcp.controller.ts`, `nodeForRequest`). `registerMcp` registers the stdio shim in user scope. `registerProjectMcp` registers it with `claude mcp add --scope local` in the project folder.

Tests: `test/integration/multi-team.test.ts` (migration, separate knowledge, routing, restart, leaving), the multi-team cases in `daemon.test.ts`, `member.identity` in `test/unit/apply.test.ts`, `ui/src/__tests__/Teams.test.tsx`.

## Block B4: context, knowledge gaps, agent files, quality, personal use

Each feature lives in its own module; the node only wires them together.

| Feature | Modules | Notes |
|---|---|---|
| Automatic context | `src/context/agent-context.ts`, `MicelioNode.agentContext`, `MicelioHost.agentContext`, `POST /api/context`, `micelio hook session-start\|prompt` | Hooks installed by `installHooks` (`src/node/integrations.ts`). Machine settings `context.*` |
| Knowledge gaps and digest | `src/insight/gaps.ts`, `src/insight/digest.ts`, events `gap.report` / `gap.close` | Searches with no results in `private.db` (`search_misses`); Monday notification in `desktop/src/notifications.ts` |
| Agent files, import | `src/roots/agent-files.ts`, `src/roots/import.ts` | List of files kept up to date: `agentFiles` in the team's `settings.json`; rewritten after each `materialize` only if they change |
| Update instead of add | `src/ingest/write-update.ts`, `MicelioNode.publish` / `writeDecision` | LLM task `write-update` (classification model); `memory.supersede` for the update; team config `memory.updateOnWrite` |
| Code changed | `src/rank/code-staleness.ts` | `private.db` (`code_staleness`); `activationOf` multiplies by `stalenessFactor` |
| Local only | `TeamNodeOptions.offline`, `network.mode = 'local'` | No swarm or pairing; `invite` rejected with an explanation |
| Personal memories | `private.db` (`personal`), `MicelioNode.personalIds` | In the index together with the team's; `teamMemories()` excludes them from constellation, dreaming, metrics, scans |

Rule: team operations (vote, pin, Root, redaction) go through `requireMemory`, which rejects personal memories. The fake adapter (`src/llm/fake.ts`) also knows `write-update`: `[aggiorna]` and `[duplicato]` in the text drive the decision in tests.

## Golden rules

1. **`apply` is deterministic.** It depends only on the events and the view: no `Date.now()`, network, files or global variables. Autobase can undo and reapply blocks when the ordering changes, and every node must reach the same view. Invite expiry, for example, is checked during pairing and not in `apply`.
2. **The author comes from the feed, not the payload.** In `apply` the author is `node.from.key`, so it can't be forged.
3. **Permissions are checked twice.** In `apply`, which is the final defense, and before emitting the event (`MicelioNode.requireAdmin`), because of concurrent events (DESIGN §9).
4. **Everything derived can be rebuilt.** `view.db` and `export/` can be deleted at any time. `private.db` can **not**: it holds the inbox and the queue.
5. **The Holepunch libraries stay inside `src/net`.** They have no types (see `src/types/holepunch.d.ts`) and their API evolves.
6. **Nothing leaves the machine before the filter.** Every new content entry point must go through `IngestPipeline`, never directly through `TeamNode.append`.
7. **Event schemas are a contract between versions.** "Open" fields are free strings, not enums: an old node must accept new values.
8. **Every feature is born bilingual and with its in-app help.** A feature is done only when its texts exist in Italian and English and it has its entry in the in-app help, which also explains how it works behind the scenes. See "UI languages".

## UI languages (Italian / English)

**UI texts.** Each component declares its texts next to the code:

```tsx
const S = defineStrings({
  it: { title: 'Memoria del team', found: (n: number) => `${n} ricordi trovati` },
  en: { title: 'Team memory', found: (n: number) => `${n} memories found` }
})
const s = useStrings(S)  // → s.title, s.found(3)
```

`defineStrings` forces the English version to have the same shape as the Italian one: same keys, same parameters. If a text is missing, **TypeScript doesn't compile**. It lives in `ui/src/i18n/index.tsx`, which also contains `LangSwitch` (the IT/EN selector), `byLang` (label tables such as `KIND_LABEL`) and `currentLang`/`currentLocale` for code outside React.

**Formatting.** The functions in `ui/src/format.ts` (dates, bytes, percentages) use the locale of the chosen language.

**Daemon errors.** They are thrown with the English text alongside: `new UserError('Operazione riservata agli admin del team', 'Only team admins can do this')`. The base class is `LocalizedError` (`src/core/errors.ts`). The UI sends the language in the `x-micelio-lang` header, and `ErrorFilter` replies in that language; the CLI and MCP get Italian.

**Texts composed by the daemon** (advice, review notes…). They are returned as **a code and its values** together with the Italian text, and the UI composes the sentence in its own language. Examples: `advice.code/params` of the distillation quality, `notes[].code/params` of the Roots review.

**Desktop app.** The texts of the tray menu and of the notifications are in `desktop/src/strings.ts`. The initial language is the system one; after that the UI communicates the chosen one with `window.micelio.setLang`.

**What stays in the original language.** These are **team data**, not app texts: titles and contents of memories (in the team language `memory.language`), reasons for flags on Roots, dream summaries, reasons in the private log. The CLI and MCP responses also stay in Italian.

## In-app help

The contents are Markdown files, one per topic and per language: `ui/src/help/content/it/<topic>.md` and `ui/src/help/content/en/<topic>.md`. Vite bundles them into the UI package (`import.meta.glob` in `ui/src/help/index.tsx`), so the help works offline too.

File format:

```md
# Topic title

Introduction.

## Section title {#anchor}

Section text.
```

- The **anchor** identifies the section: it is the same in both languages, and the "?" buttons use it (`help='roots#review'`).
- The order of the index is `TOPIC_ORDER` in `ui/src/help/index.tsx`: a new topic must be added there.
- In pages: `<PageHeader help='topic' …>` and `<Card help='topic#anchor' …>` show the "?"; elsewhere use `<HelpButton topic='…' />`.
- F1 opens the topic of the current page: `PAGE_TOPIC` map in `ui/src/App.tsx`.
- `ui/src/__tests__/help.test.tsx` fails if a topic is missing in one language, if the anchors don't match or if a "?" points to a section that doesn't exist.

The help also explains **how it works behind the scenes**: where the files are, in what format, how they reach the others. A new feature updates its entry (golden rule 8).

**Screenshots in a specific language:** `#/…?lang=en` in the address forces the language, for example `MICELIO_SCREENSHOT_EXTRA="/stato?lang=en"`.

## Code conventions

- **Plenty of comments, always:**
  - every file starts with an `@file` header that explains the module's role and its boundaries;
  - classes, public methods and non-obvious parameters have JSDoc;
  - every non-obvious block of logic has a comment explaining **why** (constraints, edge cases, past bugs, references to DESIGN §x).

  Whoever reads the code for the first time must be able to change it without rebuilding the decisions from scratch.
- Comments, messages and documentation in Italian. Identifiers in English.
- Errors caused by the user → `UserError` (HTTP 400 with a readable message). Everything else is a bug (500).
- External inputs (HTTP, MCP, files, LLM output) always validated with zod.

## Adding an event type

1. Add the schema to `TeamEvent` in [src/core/events.ts](../../src/core/events.ts).
2. Handle it in `applyEvent` in [src/net/apply.ts](../../src/net/apply.ts), following the golden rules and with the permission check.
3. Add the cases to [test/unit/apply.test.ts](../../test/unit/apply.test.ts), including the forbidden ones.
4. Expose the operation in `MicelioNode`, then in the API, CLI or MCP.

An unknown or malformed event is **ignored** by `apply`. Nodes on old versions don't get stuck, but they don't see the effects of the new events until they are updated.

## Changing prompts or the filter

The prompts ([src/ingest/prompts.ts](../../src/ingest/prompts.ts)) and the filter rules decide what reaches the whole team. After every change:

1. `npm test`: the logic, with the fake LLM;
2. `npm run eval:ingest`: the quality, with the real Claude. The report goes to `test/eval/report.md`; targets ≥ 90% correct cases and 100% of sensitive cases kept out of the team;
3. if a new case comes up, add it to [test/eval/ingest-cases.ts](../../test/eval/ingest-cases.ts).

## Tests

| Level | Where | What it covers |
|---|---|---|
| Unit | `test/unit/apply.test.ts` | Permissions, single-use invites, idempotence, determinism |
| Unit | `test/unit/memory-index.test.ts` | Search: accents, prefixes, hostile input |
| Unit | `test/unit/filter.test.ts` | HR blocking, redaction of 11 types of secrets and personal data, false positives |
| Unit | `test/unit/transcript.test.ts` | Reading Claude Code transcripts, resumed sessions, truncation |
| Unit | `test/unit/pipeline.test.ts` | Routing, explicit, inbox, sessions, budget (fake LLM) |
| Integration | `test/integration/team.test.ts` | 3 real nodes on a **local DHT**: joining, convergence, permissions |
| Integration | `test/integration/daemon.test.ts` | NestJS daemon: token, API, **real MCP client**, ingestion via hook, inbox, restart |
| End-to-end | `test/e2e/docker/` | 4 containers on the **public DHT** (fake LLM) |
| Evaluation | `test/eval/` | Classification and distillation with the **real Claude** |

- `MICELIO_TEST_LOG=1 npm test` shows the node logs.
- The fake adapter ([src/llm/fake.ts](../../src/llm/fake.ts)) has simple, documented rules: for example "LEZIONE: titolo | corpo" in the text produces a memory.

## UI and desktop app

- The UI imports **types** from the daemon (`import type … from '../../../src/…'`): a shape that changes on one side is flagged by TypeScript on the other too, without duplicating definitions.
- Real-time updates go through `GET /api/events` (SSE). Each topic invalidates specific TanStack Query queries (`ui/src/api/live.ts`, `TOPIC_QUERIES`). A new screen must use keys consistent with that map.
- **Visual check without a tester:** `npm run screenshots -w desktop -- <folder>` opens the app hidden, captures every screen as PNG and exits.
  - `MICELIO_SCREENSHOT_ONLY=nucleo,team` limits the captures to some screens.
  - `MICELIO_SCREENSHOT_EXTRA="/?bloom=0|/?tour=1"` adds routes to capture. **From Git Bash** you need `MSYS_NO_PATHCONV=1`, otherwise routes starting with `/` become Windows paths and the capture shows a blank page.
  - Page errors end up in the capture log (`pagina: …`).
  - The images in `docs/img/` were produced this way, on the demo team.
- **3D Nucleus and colors:** with the post-processing chain (bloom) any background color other than black gets lightened (grey-blue). So the background stays pure black, and bloom must be inserted before any `OutputPass` (see the comments in `Nucleus.tsx`).
- **Electron from the VS Code terminal:** the inherited `ELECTRON_RUN_AS_NODE` variable makes Electron start without windows. `desktop/launch.js` removes it: always use `npm run desktop`. The same applies to trying the packaged app from the terminal: `env -u ELECTRON_RUN_AS_NODE build/win/out/win-unpacked/Micelio.exe`.

## Windows installer

`npm run package:win` (Windows only) produces `build/win/out/Micelio-Setup-<version>.exe` with electron-builder (NSIS, per user, x64). The script is `scripts/package-win.js`; the extra installer steps are in `desktop/build/installer.nsh`.

| In the installation | From where |
|---|---|
| `Micelio.exe`, `resources/app.asar` | desktop app (`desktop/dist`), without `node_modules` |
| `resources/micelio/` | `dist/` + the daemon's production dependencies **copied** from `node_modules` (list from `npm ls --omit=dev --workspaces=false`: same versions as the tests, no downloads), without binaries for other platforms |
| `resources/node/node.exe` | the Node.js running the script (same version as the tests) |
| `resources/bin/micelio.cmd` | the `micelio` command (bundled Node + CLI); added to the user's PATH by the installer |

Things to know, learned while building it:
- electron-builder's extra resources **always exclude** `node_modules` folders: `resources/micelio` is copied in the `afterPack` hook;
- in a workspace repository electron-builder would put the root `node_modules` into `app.asar` (850 MB): `files` excludes it;
- Windows Defender scans the freshly created `Micelio.exe` and sometimes keeps it open ("UNKNOWN: unknown error, open …Micelio.exe"): the script retries up to 3 times;
- the desktop app recognizes the installation from `process.resourcesPath` (`desktop/src/daemon.ts`, `PACKAGED`) and starts the daemon with the bundled Node;
- the Claude Code hooks use absolute paths (the daemon's `process.execPath` and the installation's CLI), so they work even without PATH;
- the installer is not signed (SmartScreen warns). A real distribution needs a code signing certificate.

## Linux packages

`npm run package:linux` produces in `build/linux/out/` an **AppImage** (`Micelio-<version>-x86_64.AppImage`) and a **.deb** (`micelio_<version>_amd64.deb`). The script is `scripts/package-linux.js`; the parts shared with Windows (build, dependency copy, bundled Node, icon, electron-builder configuration) are in `scripts/package-common.js`.

**It must run on Linux** (WSL2 or a container are fine too), after an `npm ci` done from Linux: the native modules in `node_modules` are those of the system where npm installed them, and they go into the package as they are. The architecture is that of the Node running the script (x64 or arm64). Without a Linux machine, from the repo root:

```bash
git archive HEAD | docker run -i --name micelio-linux-build node:24-bookworm bash -c   "mkdir /src && tar -x -C /src && cd /src && npm ci && npm run package:linux"
docker cp micelio-linux-build:/src/build/linux/out ./build/linux/
docker rm micelio-linux-build
```

| In the package (`/opt/Micelio` with the .deb) | From where |
|---|---|
| `micelio-desktop` | the desktop app (Electron). It isn't called `micelio`, which is the CLI command |
| `resources/micelio/` | `dist/` + the daemon's production dependencies, copied from `node_modules` |
| `resources/node/node` | the Node.js running the script |
| `resources/bin/micelio` | the `micelio` command. The .deb links it into `/usr/bin/micelio` |

Things to know:
- the .deb install scripts are electron-builder's **default** ones (link in `/usr/bin`, Chromium sandbox, AppArmor profile for Ubuntu 24+), with the `micelio` link appended. Replacing them entirely would have lost those steps. Removal deletes the link only if it is ours, and not during an upgrade;
- the .deb dependencies also include the audio library (`libasound2t64 | libasound2`): Electron loads it at startup, and on a minimal system the app wouldn't start;
- with the AppImage the `micelio` command stays inside the image: for the CLI use the .deb (or the sources);
- `desktop/package.json` has `homepage`: the .deb requires it.

Verified (2026-10-19, clean Debian 12 in a container, no system Node): .deb installation with dependencies, `micelio` in PATH, daemon with the bundled Node, team and memory, desktop app on a virtual display (starts the daemon, interface rendered), clean removal. Not tried: a real Linux desktop with the tray icon, Ubuntu 24 with AppArmor, arm64.

## Environment variables

| Variable | Use |
|---|---|
| `MICELIO_HOME` | Node data folder (default `~/.micelio`) |
| `MICELIO_PORT` / `MICELIO_HOST` | Port and interface of the local API (they override `config.json`, but are **not** saved: the Claude Code hook doesn't see them) |
| `MICELIO_DHT_BOOTSTRAP` | `host:port,...` for a private or test DHT. Overrides `network.bootstrap` in `config.json` (set with `micelio network set`); if both are missing, public DHT |
| `MICELIO_LLM_ADAPTER` | `claude` \| `none` \| `fake` (tests and e2e) |
| `MICELIO_INTERNAL` | Set by Micelio on its own calls to Claude: the hook ignores them (anti-loop) |

## Docker

The [Dockerfile](../../Dockerfile) at the root produces a complete node (`micelio daemon`, data in `/data`, API on `0.0.0.0:7337`). It is used for tests and for an optional "always-on" node that keeps the knowledge available when the PCs are off.

```bash
docker build -t micelio-node .
docker run -d --name micelio-peer -v micelio-data:/data micelio-node
docker exec micelio-peer micelio init "Team Dev" --name server
```

**Security:** inside the container the API listens on every interface, but it isn't published: you use it with `docker exec`. If you need to reach it from the host, publish it only locally with `-p 127.0.0.1:7337:7337`. With `-p 7337:7337` it would be reachable from the network over plain HTTP, and the token could be intercepted.

**Disk hygiene:** every rebuild leaves the previous image dangling (about 480 MB). The image has the label `org.micelio.image=node`. The e2e scenario runs this on its own at the end:

```bash
docker image prune -f --filter label=org.micelio.image=node
```

After a manual build, run it by hand. The command touches only Micelio's dangling images, never those of other projects.
