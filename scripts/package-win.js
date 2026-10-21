#!/usr/bin/env node
/**
 * @file Costruisce l'installer di Micelio per Windows: `build/win/out/Micelio-Setup-<versione>.exe`.
 *
 * EN: Builds the Micelio installer for Windows: `build/win/out/Micelio-Setup-<versione>.exe`.
 *
 *   npm run package:win
 *
 * Cosa finisce nell'installazione (cartella dell'utente, nessun permesso di amministratore):
 *
 * EN: What ends up in the installation (user folder, no administrator rights):
 *
 *   Micelio.exe                  l'app desktop (Electron): finestra, icona nell'area di notifica
 *   resources/app.asar           il codice dell'app desktop (desktop/dist)
 *   resources/micelio/           daemon, CLI e UI compilati (dist/) con le sole dipendenze di produzione
 *   resources/node/node.exe      il Node.js con cui Micelio è stato provato: daemon e CLI usano questo,
 *                                non quello (se c'è) installato sul PC
 *   resources/bin/micelio.cmd    il comando `micelio`; l'installer aggiunge questa cartella al PATH
 *                                dell'utente (vedi desktop/build/installer.nsh)
 *
 * EN:
 *   Micelio.exe                  the desktop app (Electron): window, icon in the notification area
 *   resources/app.asar           the desktop app code (desktop/dist)
 *   resources/micelio/           compiled daemon, CLI and UI (dist/) with production dependencies only
 *   resources/node/node.exe      the Node.js Micelio was tested with: daemon and CLI use this one,
 *                                not the one (if any) installed on the PC
 *   resources/bin/micelio.cmd    the `micelio` command; the installer adds this folder to the
 *                                user's PATH (see desktop/build/installer.nsh)
 *
 * I dati NON stanno nell'installazione ma in ~/.micelio, come sempre: disinstallare o aggiornare
 * non li tocca.
 *
 * EN: Data is NOT in the installation but in ~/.micelio, as always: uninstalling or updating
 * doesn't touch it.
 *
 * Passi:
 * 1. compila e prepara in build/win/stage le risorse comuni (scripts/package-common.js);
 * 2. aggiunge micelio.cmd;
 * 3. lancia electron-builder (installer NSIS, x64).
 * Alla fine cancella la cartella di appoggio: lo spazio su disco conta.
 *
 * EN: Steps:
 * 1. builds and prepares the common resources in build/win/stage (scripts/package-common.js);
 * 2. adds micelio.cmd;
 * 3. runs electron-builder (NSIS installer, x64).
 * At the end it deletes the staging folder: disk space matters.
 */
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, tools, buildAndStage, baseConfig } = require('./package-common')

const OUT = path.join(ROOT, 'build', 'win')
const STAGE = path.join(OUT, 'stage')
const { log } = tools('package-win')

if (process.platform !== 'win32') {
  console.error('Questo script costruisce l\'installer di Windows: va eseguito su Windows.')
  process.exit(1)
}

// ── 1. Compilazione e risorse comuni ─────────────────────────────────────────────────
// EN: ── 1. Build and common resources ──
const micelio = buildAndStage({
  name: 'package-win',
  out: OUT,
  stage: STAGE,
  nodeName: 'node.exe',
  // Binari nativi per sistemi diversi da Windows x64
  // EN: Native binaries for systems other than Windows x64
  foreign: /^(linux|darwin|android|ios|freebsd|openbsd|netbsd|sunos|aix)([-_].*)?$|^win32-(ia32|arm64)$/
})

// ── 2. Il comando `micelio`: Node incluso + CLI. %~dp0 = cartella dello script (resources\bin\) ──
// EN: ── 2. The `micelio` command: bundled Node + CLI. %~dp0 = the script's folder (resources\bin\) ──
fs.writeFileSync(path.join(STAGE, 'bin', 'micelio.cmd'), [
  '@echo off',
  'rem Comando micelio dell\'installazione: usa il Node.js incluso, non quello di sistema.',
  '"%~dp0..\\node\\node.exe" "%~dp0..\\micelio\\dist\\cli\\main.js" %*',
  ''
].join('\r\n'))

// ── 3. Installer ─────────────────────────────────────────────────────────────────────
// EN: ── 3. Installer ──
log('electron-builder')
// Nessun certificato di firma: senza questa variabile electron-builder lo cerca e, su alcune
// macchine, tiene aperto Micelio.exe mentre ne modifica l'icona ("UNKNOWN: unknown error").
// EN: No signing certificate: without this variable electron-builder looks for one and, on some
//     machines, keeps Micelio.exe open while editing its icon ("UNKNOWN: unknown error").
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
const builder = require(path.join(ROOT, 'node_modules', 'electron-builder'))
const options = () => ({
  targets: builder.Platform.WINDOWS.createTarget(['nsis'], builder.Arch.x64),
  projectDir: path.join(ROOT, 'desktop'),
  config: {
    ...baseConfig({ out: OUT, micelio }),
    extraResources: [
      { from: path.join(STAGE, 'node'), to: 'node' },
      { from: path.join(STAGE, 'bin'), to: 'bin' }
    ],
    win: { target: 'nsis', icon: path.join(OUT, 'icon.png') },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'Micelio',
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      artifactName: 'Micelio-Setup-${version}.${ext}',
      include: path.join(ROOT, 'desktop', 'build', 'installer.nsh')
    }
  }
})

/**
 * Lancia electron-builder, riprovando se Micelio.exe appena creato risulta bloccato: l'antivirus
 * (Windows Defender) lo analizza e per qualche secondo electron-builder non riesce ad aprirlo per
 * scriverci icona e versione ("UNKNOWN: unknown error, open …Micelio.exe"). Errore intermittente.
 * Le opzioni si ricreano a ogni tentativo: electron-builder le modifica durante la costruzione.
 *
 * EN: Runs electron-builder, retrying if the freshly created Micelio.exe is locked: the antivirus
 * (Windows Defender) scans it and for a few seconds electron-builder can't open it to write the
 * icon and version ("UNKNOWN: unknown error, open …Micelio.exe"). Intermittent error.
 * The options are recreated on every attempt: electron-builder modifies them during the build.
 */
async function buildWithRetry (attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await builder.build(options())
    } catch (err) {
      const locked = /UNKNOWN|EBUSY|EPERM/.test(String(err?.message)) && /Micelio\.exe/i.test(String(err?.message))
      if (!locked || i >= attempts) throw err
      log(`Micelio.exe bloccato (probabilmente dall'antivirus): nuovo tentativo ${i + 1} di ${attempts} fra 10 secondi`)
      await new Promise((r) => setTimeout(r, 10_000))
    }
  }
}

buildWithRetry().then((files) => {
  fs.rmSync(STAGE, { recursive: true, force: true })
  for (const f of files) log(`creato: ${f}`)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
