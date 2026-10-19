#!/usr/bin/env node
/**
 * @file Costruisce l'installer di Micelio per Windows: `build/win/out/Micelio-Setup-<versione>.exe`.
 *
 *   npm run package:win
 *
 * Cosa finisce nell'installazione (cartella dell'utente, nessun permesso di amministratore):
 *
 *   Micelio.exe                  l'app desktop (Electron): finestra, icona nell'area di notifica
 *   resources/app.asar           il codice dell'app desktop (desktop/dist)
 *   resources/micelio/           daemon, CLI e UI compilati (dist/) con le sole dipendenze di produzione
 *   resources/node/node.exe      il Node.js con cui Micelio è stato provato: daemon e CLI usano questo,
 *                                non quello (se c'è) installato sul PC
 *   resources/bin/micelio.cmd    il comando `micelio`; l'installer aggiunge questa cartella al PATH
 *                                dell'utente (vedi desktop/build/installer.nsh)
 *
 * I dati NON stanno nell'installazione ma in ~/.micelio, come sempre: disinstallare o aggiornare
 * non li tocca.
 *
 * Passi:
 * 1. compila e prepara in build/win/stage le risorse comuni (scripts/package-common.js);
 * 2. aggiunge micelio.cmd;
 * 3. lancia electron-builder (installer NSIS, x64).
 * Alla fine cancella la cartella di appoggio: lo spazio su disco conta.
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
const micelio = buildAndStage({
  name: 'package-win',
  out: OUT,
  stage: STAGE,
  nodeName: 'node.exe',
  // Binari nativi per sistemi diversi da Windows x64
  foreign: /^(linux|darwin|android|ios|freebsd|openbsd|netbsd|sunos|aix)([-_].*)?$|^win32-(ia32|arm64)$/
})

// ── 2. Il comando `micelio`: Node incluso + CLI. %~dp0 = cartella dello script (resources\bin\) ──
fs.writeFileSync(path.join(STAGE, 'bin', 'micelio.cmd'), [
  '@echo off',
  'rem Comando micelio dell\'installazione: usa il Node.js incluso, non quello di sistema.',
  '"%~dp0..\\node\\node.exe" "%~dp0..\\micelio\\dist\\cli\\main.js" %*',
  ''
].join('\r\n'))

// ── 3. Installer ─────────────────────────────────────────────────────────────────────
log('electron-builder')
// Nessun certificato di firma: senza questa variabile electron-builder lo cerca e, su alcune
// macchine, tiene aperto Micelio.exe mentre ne modifica l'icona ("UNKNOWN: unknown error").
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
