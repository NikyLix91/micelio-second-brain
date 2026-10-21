#!/usr/bin/env node
/**
 * @file Costruisce i pacchetti di Micelio per Linux: `build/linux/out/Micelio-<versione>-<arch>.AppImage`
 * e `build/linux/out/micelio_<versione>_<arch>.deb`.
 *
 * EN: Builds the Micelio packages for Linux: `build/linux/out/Micelio-<versione>-<arch>.AppImage`
 * and `build/linux/out/micelio_<versione>_<arch>.deb`.
 *
 *   npm run package:linux
 *
 * Va eseguito SU Linux (anche WSL2), con le dipendenze installate da Linux (`npm ci`): i moduli
 * nativi in node_modules sono quelli del sistema su cui npm li ha installati, e finiscono nel
 * pacchetto così come sono. L'architettura è quella del Node che esegue lo script (x64 o arm64).
 *
 * EN: It must run ON Linux (WSL2 too), with dependencies installed from Linux (`npm ci`): the native
 * modules in node_modules are those of the system npm installed them on, and they end up in the
 * package as they are. The architecture is that of the Node running the script (x64 or arm64).
 *
 * Cosa c'è nel pacchetto (in /opt/Micelio per il .deb):
 *
 * EN: What is in the package (in /opt/Micelio for the .deb):
 *
 *   micelio-desktop              l'app desktop (Electron). Si chiama così e non `micelio` perché
 *                                `micelio` è il comando della CLI
 *                                (EN: the desktop app (Electron). It is named this way and not
 *                                `micelio` because `micelio` is the CLI command)
 *   resources/micelio/           daemon, CLI e UI compilati con le dipendenze di produzione
 *                                (EN: daemon, CLI and UI built with the production dependencies)
 *   resources/node/node          il Node.js con cui Micelio è stato provato
 *                                (EN: the Node.js Micelio was tested with)
 *   resources/bin/micelio        il comando `micelio`. Il .deb lo collega in /usr/bin/micelio;
 *                                con l'AppImage resta dentro l'immagine (la CLI si usa dai sorgenti
 *                                o dal .deb)
 *                                (EN: the `micelio` command. The .deb links it into /usr/bin/micelio;
 *                                with the AppImage it stays inside the image (use the CLI from source
 *                                or from the .deb))
 *
 * I dati NON stanno nel pacchetto ma in ~/.micelio: disinstallare o aggiornare non li tocca.
 *
 * EN: Data is NOT in the package but in ~/.micelio: uninstalling or updating does not touch it.
 *
 * Gli script di installazione del .deb sono quelli predefiniti di electron-builder (collegamento
 * in /usr/bin, sandbox di Chromium, profilo AppArmor per Ubuntu 24+) con in coda il collegamento
 * del comando `micelio`: sostituirli del tutto avrebbe perso quei passi.
 *
 * EN: The .deb install scripts are electron-builder's defaults (link in /usr/bin, Chromium
 * sandbox, AppArmor profile for Ubuntu 24+) with the `micelio` command link appended:
 * replacing them entirely would have lost those steps.
 */
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, tools, buildAndStage, baseConfig } = require('./package-common')

const OUT = path.join(ROOT, 'build', 'linux')
const STAGE = path.join(OUT, 'stage')
const { log } = tools('package-linux')

if (process.platform !== 'linux') {
  console.error('Questo script costruisce i pacchetti per Linux: va eseguito su Linux (anche WSL2), dopo `npm ci` fatto da Linux.')
  process.exit(1)
}
if (!['x64', 'arm64'].includes(process.arch)) {
  console.error(`Architettura non supportata: ${process.arch} (servono x64 o arm64)`)
  process.exit(1)
}

// ── 1. Compilazione e risorse comuni ─────────────────────────────────────────────────
// EN: ── 1. Build and shared resources ──
const micelio = buildAndStage({
  name: 'package-linux',
  out: OUT,
  stage: STAGE,
  nodeName: 'node',
  // Binari nativi per sistemi diversi da Linux con questa architettura (glibc: la musl di Alpine
  // non serve a un desktop)
  // EN: Native binaries for systems other than Linux with this architecture (glibc: Alpine's musl
  //     is not needed on a desktop)
  foreign: process.arch === 'x64'
    ? /^(win32|darwin|android|ios|freebsd|openbsd|netbsd|sunos|aix)([-_].*)?$|^linux-(ia32|arm|arm64|riscv64|ppc64|s390x)([-_].*)?$|^linuxmusl.*$|^linux-x64-musl$/
    : /^(win32|darwin|android|ios|freebsd|openbsd|netbsd|sunos|aix)([-_].*)?$|^linux-(ia32|arm|x64|riscv64|ppc64|s390x)([-_].*)?$|^linuxmusl.*$|^linux-arm64-musl$/
})

// ── 2. Il comando `micelio`: Node incluso + CLI ──────────────────────────────────────
// readlink -f: lo script si raggiunge anche dal collegamento /usr/bin/micelio, e i percorsi vanno
// calcolati dalla sua posizione VERA (resources/bin)
// EN: ── 2. The `micelio` command: bundled Node + CLI ──
//     readlink -f: the script is also reached through the /usr/bin/micelio link, and paths must be
//     computed from its REAL location (resources/bin)
fs.writeFileSync(path.join(STAGE, 'bin', 'micelio'), [
  '#!/bin/sh',
  '# Comando micelio dell\'installazione: usa il Node.js incluso, non quello di sistema.',
  'here="$(dirname "$(readlink -f "$0")")"',
  'exec "$here/../node/node" "$here/../micelio/dist/cli/main.js" "$@"',
  ''
].join('\n'), { mode: 0o755 })

// ── 3. Script di installazione del .deb: i predefiniti + il comando `micelio` ──────────
// EN: ── 3. .deb install scripts: the defaults + the `micelio` command ──
const templates = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'linux')
const afterInstall = path.join(OUT, 'after-install.sh')
const afterRemove = path.join(OUT, 'after-remove.sh')
fs.writeFileSync(afterInstall, fs.readFileSync(path.join(templates, 'after-install.tpl'), 'utf8') + [
  '',
  '# Micelio: comando `micelio` (CLI) nel PATH di tutti gli utenti',
  "ln -sf '/opt/${sanitizedProductName}/resources/bin/micelio' '/usr/bin/micelio'",
  ''
].join('\n'))
fs.writeFileSync(afterRemove, fs.readFileSync(path.join(templates, 'after-remove.tpl'), 'utf8') + [
  '',
  '# Micelio: via il comando `micelio`, ma solo alla rimozione (non durante un aggiornamento,',
  '# quando lo script di installazione della versione nuova lo ricrea) e solo se è il nostro',
  'if [ "$1" = "remove" ] || [ "$1" = "purge" ] || [ "$1" = "0" ]; then',
  "  if [ \"$(readlink /usr/bin/micelio)\" = '/opt/${sanitizedProductName}/resources/bin/micelio' ]; then rm -f /usr/bin/micelio; fi",
  'fi',
  ''
].join('\n'))

// ── 4. Pacchetti ─────────────────────────────────────────────────────────────────────
// EN: ── 4. Packages ──
log('electron-builder')
const builder = require(path.join(ROOT, 'node_modules', 'electron-builder'))
const arch = process.arch === 'arm64' ? builder.Arch.arm64 : builder.Arch.x64

builder.build({
  targets: builder.Platform.LINUX.createTarget(['AppImage', 'deb'], arch),
  projectDir: path.join(ROOT, 'desktop'),
  config: {
    ...baseConfig({ out: OUT, micelio }),
    extraResources: [
      { from: path.join(STAGE, 'node'), to: 'node' },
      { from: path.join(STAGE, 'bin'), to: 'bin' }
    ],
    linux: {
      target: ['AppImage', 'deb'],
      icon: path.join(OUT, 'icon.png'),
      executableName: 'micelio-desktop',
      category: 'Development',
      synopsis: 'Secondo cervello P2P per il team di sviluppo',
      description: 'Micelio: memoria condivisa peer-to-peer per i team di sviluppo e i loro agenti AI.',
      // Il .deb vuole un manutentore; desktop/package.json non ha un autore
      // EN: The .deb requires a maintainer; desktop/package.json has no author
      maintainer: 'Micelio <micelio@localhost>',
      artifactName: 'Micelio-${version}-${arch}.${ext}'
    },
    deb: {
      afterInstall,
      afterRemove,
      // Le dipendenze predefinite di electron-builder (app-builder-lib, FpmTarget) più la libreria
      // audio, che Electron carica all'avvio: su un sistema minimo mancava e l'app non partiva
      // ("libasound.so.2: cannot open shared object file"). Su Ubuntu 24 si chiama libasound2t64.
      // EN: electron-builder's default dependencies (app-builder-lib, FpmTarget) plus the audio
      //     library, which Electron loads at startup: on a minimal system it was missing and the app
      //     did not start ("libasound.so.2: cannot open shared object file"). On Ubuntu 24 it is called libasound2t64.
      depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libasound2t64 | libasound2'],
      artifactName: 'micelio_${version}_${arch}.${ext}'
    }
  }
}).then((files) => {
  fs.rmSync(STAGE, { recursive: true, force: true })
  for (const f of files) log(`creato: ${f}`)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
