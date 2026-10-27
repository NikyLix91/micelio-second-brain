#!/usr/bin/env node
/**
 * @file Prepara una versione nuova: allinea i numeri di versione e chiude la sezione
 * "Unreleased" del CHANGELOG.
 *
 * EN: Prepares a new version: aligns the version numbers and closes the "Unreleased" section
 * of the CHANGELOG.
 *
 *   npm run version:set 0.7.1
 *   npm run version:set 0.8.0-rc.1
 *
 * Cosa cambia:
 * - `package.json` (radice) e `desktop/package.json`: la versione dell'app. Il daemon la legge
 *   dalla radice (src/core/version.ts), i pacchetti da desktop (scripts/package-common.js): se
 *   divergono, l'app e il daemon direbbero versioni diverse;
 * - `package-lock.json`: le stesse due voci, così `npm ci` non lo trova disallineato;
 * - `CHANGELOG.md`, solo per le versioni stabili: il contenuto di "Unreleased" passa sotto
 *   `## [X.Y.Z] - <data di oggi>`, e i collegamenti in fondo si aggiornano. Una pre-release
 *   (`-rc.1`) non lo tocca: le sue note si prendono da "Unreleased".
 *
 * UI (`ui/`) e server del team (`server/`) hanno versioni proprie e non si toccano.
 * Lo script non fa commit né tag: il flusso completo è in docs/sviluppo.md, "Rilasciare una versione".
 *
 * EN: What changes:
 * - `package.json` (root) and `desktop/package.json`: the app version. The daemon reads it from
 *   the root (src/core/version.ts), the packages from desktop (scripts/package-common.js): if they
 *   diverged, the app and the daemon would report different versions;
 * - `package-lock.json`: the same two entries, so `npm ci` doesn't find it out of sync;
 * - `CHANGELOG.md`, only for stable versions: the content of "Unreleased" moves under
 *   `## [X.Y.Z] - <today's date>`, and the links at the bottom are updated. A pre-release
 *   (`-rc.1`) doesn't touch it: its notes are taken from "Unreleased".
 *
 * EN: The UI (`ui/`) and the team server (`server/`) have their own versions and are left alone.
 * The script makes no commit or tag: the full flow is in docs/en/development.md, "Releasing a version".
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const REPO = 'https://github.com/salvatorestracquadanio86/micelio-second-brain'

const version = process.argv[2]
// Semver senza metadati di build: X.Y.Z oppure X.Y.Z-qualcosa (es. -rc.1)
// EN: Semver without build metadata: X.Y.Z or X.Y.Z-something (e.g. -rc.1)
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('Uso / usage: npm run version:set X.Y.Z   (es. / e.g. 0.7.1, 0.8.0-rc.1)')
  process.exit(1)
}
const prerelease = version.includes('-')

/** Legge un JSON, lo modifica e lo riscrive nel formato di npm (2 spazi, a capo finale). / EN: Reads a JSON, edits it and writes it back in npm's format (2 spaces, final newline). */
function editJson (file, edit) {
  const p = path.join(ROOT, file)
  const data = JSON.parse(fs.readFileSync(p, 'utf8'))
  edit(data)
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n')
  console.log(`${file}: ${version}`)
}

const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
if (current === version) {
  console.error(`La versione è già ${version}. / The version is already ${version}.`)
  process.exit(1)
}

// Il CHANGELOG si controlla PRIMA di toccare qualunque file: se manca qualcosa non resta nulla a metà
// EN: The CHANGELOG is checked BEFORE touching any file: if something is missing nothing is left half-done
const changelogPath = path.join(ROOT, 'CHANGELOG.md')
let changelog = fs.readFileSync(changelogPath, 'utf8')
if (!prerelease) {
  const m = changelog.match(/^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[)/m)
  if (!m || !m[1].trim()) {
    console.error('CHANGELOG.md: la sezione "Unreleased" è vuota, scrivi prima le note. / The "Unreleased" section is empty, write the notes first.')
    process.exit(1)
  }
  if (changelog.includes(`## [${version}]`)) {
    console.error(`CHANGELOG.md: la sezione ${version} esiste già. / Section ${version} already exists.`)
    process.exit(1)
  }
}

editJson('package.json', (p) => { p.version = version })
editJson('desktop/package.json', (p) => { p.version = version })
editJson('package-lock.json', (l) => {
  l.version = version
  l.packages[''].version = version
  l.packages.desktop.version = version
})

if (!prerelease) {
  // Data locale (non UTC): è il giorno in cui chi rilascia prepara la versione
  // EN: Local date (not UTC): it's the day the person releasing prepares the version
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  changelog = changelog.replace(/^## \[Unreleased\]\s*\n/m, `## [Unreleased]\n\n## [${version}] - ${today}\n\n`)
  // Collegamenti in fondo: "Unreleased" confronta con la versione nuova, che prende il suo
  // EN: Links at the bottom: "Unreleased" compares against the new version, which gets its own
  changelog = changelog.replace(/^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n[${version}]: ${REPO}/releases/tag/v${version}`)
  fs.writeFileSync(changelogPath, changelog)
  console.log(`CHANGELOG.md: "Unreleased" → ${version} (${today})`)
}

console.log(`\nFatto. Controlla con \`git diff\`, poi fai il commit "Release ${version}".`)
console.log(`EN: Done. Check with \`git diff\`, then commit "Release ${version}".`)
