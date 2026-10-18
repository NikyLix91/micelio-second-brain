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
 * 1. compila daemon, CLI, UI e app desktop;
 * 2. prepara in build/win/stage le risorse: dist/, le dipendenze di produzione COPIATE da
 *    node_modules (le stesse versioni con cui girano i test, senza scaricare nulla), node.exe,
 *    micelio.cmd e l'icona;
 * 3. lancia electron-builder (installer NSIS, x64).
 * Alla fine cancella la cartella di appoggio: lo spazio su disco conta.
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'build', 'win')
const STAGE = path.join(OUT, 'stage')
const log = (m) => console.log(`[package-win] ${m}`)
const run = (cmd, cwd = ROOT) => { log(`$ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }) }

if (process.platform !== 'win32') {
  console.error('Questo script costruisce l\'installer di Windows: va eseguito su Windows.')
  process.exit(1)
}

// ── 1. Compilazione ──────────────────────────────────────────────────────────────────
run('npm run build')
run('npm run build -w desktop')

// ── 2. Risorse ───────────────────────────────────────────────────────────────────────
fs.rmSync(STAGE, { recursive: true, force: true })
fs.mkdirSync(STAGE, { recursive: true })
const micelio = path.join(STAGE, 'micelio')

log('copia di dist/ (daemon, CLI, UI)')
fs.cpSync(path.join(ROOT, 'dist'), path.join(micelio, 'dist'), { recursive: true })

// package.json minimo: nome, versione e dipendenze (serve a Node per risolvere i moduli e a chi
// guarda l'installazione per sapere cosa c'è dentro). Niente workspace, script, devDependencies.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const desktopPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'))
fs.writeFileSync(path.join(micelio, 'package.json'), JSON.stringify({
  name: 'micelio', version: desktopPkg.version, private: true, type: pkg.type, bin: pkg.bin,
  dependencies: pkg.dependencies, optionalDependencies: pkg.optionalDependencies
}, null, 2))

// Dipendenze di produzione del daemon: l'elenco esatto lo dà npm (anche quelle annidate; senza i
// workspace: la UI è già compilata in dist/ui e le sue librerie non servono), poi si copiano le
// cartelle così come sono. Ogni pacchetto senza la sua node_modules: quelle annidate sono
// nell'elenco a parte, così non si copia nulla due volte né dipendenze di sviluppo.
log('copia delle dipendenze di produzione')
const list = execSync('npm ls --omit=dev --all --parseable --workspaces=false', { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== ROOT && l.includes(`${path.sep}node_modules${path.sep}`))
let copied = 0
for (const src of new Set(list)) {
  // I workspace (ui, desktop) sono collegamenti alla repository: non servono a runtime
  if (fs.lstatSync(src).isSymbolicLink()) continue
  const dest = path.join(micelio, path.relative(ROOT, src))
  fs.cpSync(src, dest, { recursive: true, filter: (f) => !(f !== src && path.basename(f) === 'node_modules' && path.dirname(f) === src) })
  copied++
}
log(`${copied} pacchetti copiati`)

// Binari di altre piattaforme: inutili su Windows e pesanti (es. onnxruntime per Linux e macOS)
const pruned = pruneForeign(path.join(micelio, 'node_modules'))
log(`tolti ${(pruned / 1024 / 1024).toFixed(0)} MB di binari per altre piattaforme`)

log(`Node.js incluso: ${process.version}`)
fs.mkdirSync(path.join(STAGE, 'node'), { recursive: true })
fs.copyFileSync(process.execPath, path.join(STAGE, 'node', 'node.exe'))

// Il comando `micelio`: Node incluso + CLI. %~dp0 = cartella dello script (resources\bin\).
fs.mkdirSync(path.join(STAGE, 'bin'), { recursive: true })
fs.writeFileSync(path.join(STAGE, 'bin', 'micelio.cmd'), [
  '@echo off',
  'rem Comando micelio dell\'installazione: usa il Node.js incluso, non quello di sistema.',
  '"%~dp0..\\node\\node.exe" "%~dp0..\\micelio\\dist\\cli\\main.js" %*',
  ''
].join('\r\n'))

// Icona: la stessa disegnata dall'app (desktop/src/icon.ts), a 256 px come chiede Windows
const { nucleusIconPng } = require(path.join(ROOT, 'desktop', 'dist', 'icon.js'))
fs.writeFileSync(path.join(OUT, 'icon.png'), nucleusIconPng(256))

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
    appId: 'it.micelio.desktop',
    productName: 'Micelio',
    electronVersion: require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version,
    directories: { output: path.join(OUT, 'out'), buildResources: path.join(ROOT, 'desktop', 'build') },
    // Solo il codice dell'app desktop. In una repository a workspace electron-builder troverebbe
    // il node_modules della radice e lo metterebbe in app.asar: all'app non serve (850 MB in più).
    files: ['dist/**/*', 'package.json', '!**/node_modules/**'],
    extraResources: [
      { from: path.join(STAGE, 'node'), to: 'node' },
      { from: path.join(STAGE, 'bin'), to: 'bin' }
    ],
    // Daemon e CLI con le loro dipendenze si copiano DOPO l'impacchettamento dell'app e prima
    // dell'installer: le risorse extra di electron-builder escludono sempre le cartelle
    // node_modules (anche con un filtro esplicito), e il daemon resterebbe senza dipendenze.
    afterPack: async (ctx) => {
      fs.cpSync(micelio, path.join(ctx.appOutDir, 'resources', 'micelio'), { recursive: true })
    },
    // Il codice dell'app desktop non ha dipendenze proprie: niente da reinstallare né ricompilare
    npmRebuild: false,
    asar: true,
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

/**
 * Toglie le cartelle di binari nativi per sistemi diversi da Windows x64 (prebuilds e simili).
 * @returns byte liberati
 */
function pruneForeign (dir) {
  const foreign = /^(linux|darwin|android|ios|freebsd|openbsd|netbsd|sunos|aix)([-_].*)?$|^win32-(ia32|arm64)$/
  let freed = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = path.join(d, e.name)
      // Solo dentro cartelle di binari nativi (prebuilds/, bin/, napi-vN/): una cartella JavaScript
      // chiamata "linux" altrove potrebbe servire anche su Windows
      if (foreign.test(e.name) && /^(prebuilds|bin|napi-v\d+)$/i.test(path.basename(d))) {
        freed += size(p)
        fs.rmSync(p, { recursive: true, force: true })
      } else {
        walk(p)
      }
    }
  }
  walk(dir)
  return freed
}

function size (p) {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.size
  return fs.readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0)
}
