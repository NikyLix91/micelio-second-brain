# Contributing to Micelio

Thanks for your interest! Micelio is maintained by one person in their spare time, so clear issues and small, focused pull requests are the best way to help.

## Before you start

- **Bugs:** open an issue with the [bug report form](https://github.com/salvatorestracquadanio86/micelio-brain/issues/new?template=bug_report.yml). Include the version (Settings → About), the OS and, if you can, the relevant lines of the daemon log.
- **Features:** open an issue with the [feature request form](https://github.com/salvatorestracquadanio86/micelio-brain/issues/new?template=feature_request.yml) **before** writing code, so we can agree on the approach. The planned work is in [docs/en/PLAN.md](docs/en/PLAN.md).
- **Security problems:** never in a public issue. See [SECURITY.md](SECURITY.md).

## Contributor License Agreement

Before your first pull request is merged, a bot will ask you to accept the [CLA](CLA.md) by writing a comment on the pull request. You keep the copyright on your contribution; the CLA gives the maintainer the right to distribute it, also under licenses other than the AGPL (for example a commercial license), which keeps the project sustainable. You only sign once.

## Development setup

Requirements: Node.js ≥ 22.13, Git. Docker only for the end-to-end tests. Windows, macOS and Linux are all supported.

```bash
npm ci
npm run build        # daemon (tsc) + UI (Vite)
npm run desktop      # desktop app, starts the daemon too
npm run demo         # demo team with 3 nodes, no real network needed
```

The [developer guide](docs/en/development.md) explains the structure of the code, the data flow and how each part is tested.

## Checks before opening a pull request

```bash
npm run typecheck
npm test             # daemon: unit and integration tests (fake LLM, local DHT)
npm run test:ui      # UI tests (jsdom)
```

All of them must pass. If you change the ingestion prompts or the privacy filter, also run `npm run eval:ingest` (it uses the real Claude CLI) and report the results in the pull request.

## Rules of the codebase

The full list is in the [developer guide](docs/en/development.md#golden-rules). The ones that matter most:

1. **`apply` is deterministic:** no clock, network, files or globals in `src/net/apply.ts`.
2. **Nothing leaves the machine before the privacy filter:** every new content entry point goes through `IngestPipeline`.
3. **Event schemas are a contract between versions:** old nodes must accept new values.
4. **Every feature is bilingual and documented:** UI texts in Italian and English (`defineStrings` won't compile otherwise) and an entry in the in-app help (`ui/src/help/content/{it,en}/`), explaining also how it works behind the scenes. A test checks that both languages have the same sections.
5. **It must stay fast with thousands of memories:** add a test at scale (5,000 memories is the usual size) when you touch search, ranking, graphs or storage.
6. **Comments explain why.** Every file starts with an `@file` header; non-obvious logic gets a comment about the constraint, edge case or past bug behind it. Comments are bilingual, Italian first and then English (`EN:`); if you don't speak Italian, write the English one and the maintainer will add the other.

## Branches and commits

- Branch from `develop` (`feature/<name>` or `fix/<name>`) and open the pull request against `develop`. `main` only receives releases.
- One topic per pull request. Write the commit messages as a short sentence describing the change.
- Update the documentation in `docs/` (Italian) and `docs/en/` (English) when behavior changes, and add a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
