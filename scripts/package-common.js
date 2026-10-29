/**
 * @file Parti comuni degli script che costruiscono i pacchetti dell'app desktop
 * (scripts/package-win.js, scripts/package-linux.js).
 *
 * Ogni pacchetto contiene, accanto all'app Electron:
 *   resources/micelio/   daemon, CLI e UI compilati (dist/) con le sole dipendenze di produzione
 *   resources/node/      il Node.js con cui Micelio è stato provato (quello che esegue lo script):
 *                        daemon e CLI usano questo, non quello (se c'è) installato sul PC
 *   resources/bin/       il comando `micelio` (Node incluso + CLI)
 *
 * Le dipendenze si COPIANO da node_modules (stesse versioni dei test, nessun download): per
 * questo il pacchetto di un sistema va costruito SU quel sistema, perché i moduli nativi
 * installati da npm sono quelli della piattaforma corrente.
 *
 * EN: Shared parts of the scripts that build the desktop app packages
 * (scripts/package-win.js, scripts/package-linux.js).
 *
 * EN: Each package contains, next to the Electron app:
 *   resources/micelio/   compiled daemon, CLI and UI (dist/) with only the production dependencies
 *   resources/node/      the Node.js Micelio was tested with (the one running the script):
 *                        the daemon and CLI use this one, not the one (if any) installed on the PC
 *   resources/bin/       the `micelio` command (bundled Node + CLI)
 *
 * EN: Dependencies are COPIED from node_modules (same versions as the tests, no download): that's
 * why a system's package must be built ON that system, since the native modules installed by npm
 * are those of the current platform.
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

/** Logger e runner con un prefisso, es. `[package-linux]`. / EN: Logger and runner with a prefix, e.g. `[package-linux]`. */
function tools (name) {
  const log = (m) => console.log(`[${name}] ${m}`)
  const run = (cmd, cwd = ROOT) => { log(`$ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }) }
  return { log, run }
}

/**
 * Compila tutto e prepara in `stage` le risorse comuni: resources/micelio (dist + dipendenze di
 * produzione) e resources/node. Il comando `micelio` lo scrive ogni script (cambia per sistema).
 *
 * EN: Builds everything and prepares the shared resources in `stage`: resources/micelio (dist +
 * production dependencies) and resources/node. Each script writes the `micelio` command (it differs per OS).
 * @param opts.out cartella di uscita (es. build/linux); l'icona finisce in `<out>/icon.png`
 *        EN: output folder (e.g. build/linux); the icon ends up in `<out>/icon.png`
 * @param opts.nodeName nome del binario di Node nel pacchetto ('node.exe' o 'node')
 *        EN: name of the Node binary in the package ('node.exe' or 'node')
 * @param opts.foreign cartelle di binari nativi da togliere perché di altri sistemi
 *        EN: native binary folders to remove because they belong to other OSes
 * @returns percorso di resources/micelio nella cartella di appoggio
 *          EN: path of resources/micelio in the staging folder
 */
function buildAndStage ({ name, out, stage, nodeName, foreign }) {
  const { log, run } = tools(name)
  // ── Compilazione ──
  // EN: ── Build ──
  run('npm run build')
  run('npm run build -w desktop')

  // ── Risorse ──
  // EN: ── Resources ──
  fs.rmSync(stage, { recursive: true, force: true })
  fs.mkdirSync(stage, { recursive: true })
  const micelio = path.join(stage, 'micelio')

  log('copia di dist/ (daemon, CLI, UI)')
  fs.cpSync(path.join(ROOT, 'dist'), path.join(micelio, 'dist'), { recursive: true })

  // package.json minimo: nome, versione e dipendenze (serve a Node per risolvere i moduli e a chi
  // guarda l'installazione per sapere cosa c'è dentro). Niente workspace, script, devDependencies.
  // EN: Minimal package.json: name, version and dependencies (Node needs it to resolve modules, and
  //     whoever inspects the installation can see what's inside). No workspaces, scripts, devDependencies.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  fs.writeFileSync(path.join(micelio, 'package.json'), JSON.stringify({
    name: 'micelio', version: desktopVersion(), private: true, type: pkg.type, bin: pkg.bin,
    dependencies: pkg.dependencies, optionalDependencies: pkg.optionalDependencies
  }, null, 2))

  // Dipendenze di produzione del daemon: l'elenco esatto lo dà npm (anche quelle annidate; senza i
  // workspace: la UI è già compilata in dist/ui e le sue librerie non servono), poi si copiano le
  // cartelle così come sono. Ogni pacchetto senza la sua node_modules: quelle annidate sono
  // nell'elenco a parte, così non si copia nulla due volte né dipendenze di sviluppo.
  // EN: The daemon's production dependencies: npm gives the exact list (nested ones included; without
  //     workspaces: the UI is already compiled in dist/ui and its libraries aren't needed), then the
  //     folders are copied as they are. Each package without its own node_modules: the nested ones are
  //     listed separately, so nothing is copied twice and no dev dependencies are copied.
  log('copia delle dipendenze di produzione')
  const list = execSync('npm ls --omit=dev --all --parseable --workspaces=false', { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== ROOT && l.includes(`${path.sep}node_modules${path.sep}`))
  let copied = 0
  for (const src of new Set(list)) {
    // I workspace (ui, desktop) sono collegamenti alla repository: non servono a runtime
    // EN: The workspaces (ui, desktop) are links to the repository: not needed at runtime
    if (fs.lstatSync(src).isSymbolicLink()) continue
    const dest = path.join(micelio, path.relative(ROOT, src))
    fs.cpSync(src, dest, { recursive: true, filter: (f) => !(f !== src && path.basename(f) === 'node_modules' && path.dirname(f) === src) })
    copied++
  }
  log(`${copied} pacchetti copiati`)

  // Binari di altre piattaforme: inutili qui e pesanti (es. onnxruntime per gli altri sistemi)
  // EN: Binaries for other platforms: useless here and heavy (e.g. onnxruntime for the other OSes)
  const pruned = pruneForeign(path.join(micelio, 'node_modules'), foreign)
  log(`tolti ${(pruned / 1024 / 1024).toFixed(0)} MB di binari per altre piattaforme`)

  log(`Node.js incluso: ${process.version}`)
  fs.mkdirSync(path.join(stage, 'node'), { recursive: true })
  fs.copyFileSync(process.execPath, path.join(stage, 'node', nodeName))
  fs.mkdirSync(path.join(stage, 'bin'), { recursive: true })

  // Icona: la stessa disegnata dall'app (desktop/src/icon.ts), a 256 px
  // EN: Icon: the same one drawn by the app (desktop/src/icon.ts), at 256 px
  const { nucleusIconPng } = require(path.join(ROOT, 'desktop', 'dist', 'icon.js'))
  fs.writeFileSync(path.join(out, 'icon.png'), nucleusIconPng(256))
  return micelio
}

/** Versione dell'app (quella di desktop/package.json): è la versione dei pacchetti. / EN: App version (the one in desktop/package.json): it's the package version. */
function desktopVersion () {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version
}

/**
 * Configurazione di electron-builder comune ai sistemi; ogni script aggiunge la sua sezione
 * (win/nsis, linux/deb…) e le risorse extra.
 *
 * EN: electron-builder configuration shared across OSes; each script adds its own section
 * (win/nsis, linux/deb…) and the extra resources.
 * @param micelio resources/micelio nella cartella di appoggio, copiato dopo l'impacchettamento
 *        EN: resources/micelio in the staging folder, copied after packing
 */
function baseConfig ({ out, micelio }) {
  return {
    appId: 'it.micelio.desktop',
    productName: 'Micelio',
    copyright: 'Copyright © 2026 Salvatore Stracquadanio. AGPL-3.0-only',
    // Il testo della licenza viaggia con l'app (AGPL: chi riceve il programma riceve anche la licenza)
    // EN: The license text ships with the app (AGPL: whoever receives the program also receives the license)
    extraFiles: [{ from: path.join(ROOT, 'LICENSE'), to: 'LICENSE.txt' }],
    electronVersion: require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version,
    directories: { output: path.join(out, 'out'), buildResources: path.join(ROOT, 'desktop', 'build') },
    // Il codice dell'app desktop e le SOLE dipendenze di produzione di desktop/package.json
    // (electron-updater e le sue librerie, circa 2 MB): electron-builder 26 le ricava da npm anche
    // in una repository a workspace, senza prendere il node_modules della radice (850 MB).
    // EN: The desktop app code and ONLY the production dependencies of desktop/package.json
    //     (electron-updater and its libraries, about 2 MB): electron-builder 26 gets them from npm
    //     even in a workspace repository, without taking the root node_modules (850 MB).
    files: ['dist/**/*', 'package.json'],
    // Daemon e CLI con le loro dipendenze si copiano DOPO l'impacchettamento dell'app e prima
    // dell'installer: le risorse extra di electron-builder escludono sempre le cartelle
    // node_modules (anche con un filtro esplicito), e il daemon resterebbe senza dipendenze.
    // EN: The daemon and CLI with their dependencies are copied AFTER the app is packed and before
    //     the installer: electron-builder's extra resources always exclude node_modules folders
    //     (even with an explicit filter), and the daemon would be left without dependencies.
    afterPack: async (ctx) => {
      fs.cpSync(micelio, path.join(ctx.appOutDir, 'resources', 'micelio'), { recursive: true })
    },
    // Le dipendenze dell'app desktop sono solo JavaScript: niente da ricompilare per Electron
    // EN: The desktop app's dependencies are plain JavaScript: nothing to rebuild for Electron
    npmRebuild: false,
    asar: true
  }
}

/**
 * Opzioni di `builder.build()` comuni ai sistemi. `publish: 'never'`: electron-builder non carica
 * mai nulla da solo. Senza, in CI su un tag proverebbe a pubblicare su GitHub per conto suo; la
 * release la crea invece il workflow (.github/workflows/release.yml), dopo checksum e attestazione.
 * I file per gli aggiornamenti (latest.yml, latest-linux.yml) si scrivono lo stesso.
 *
 * EN: `builder.build()` options shared across OSes. `publish: 'never'`: electron-builder never
 * uploads anything on its own. Without it, in CI on a tag it would try to publish to GitHub by
 * itself; the release is created by the workflow instead (.github/workflows/release.yml), after
 * checksums and attestation. The update files (latest.yml, latest-linux.yml) are written anyway.
 */
const BUILD_OPTIONS = { publish: 'never' }

/**
 * Toglie le cartelle di binari nativi per altri sistemi (prebuilds e simili).
 *
 * EN: Removes the native binary folders for other OSes (prebuilds and similar).
 * @param foreign espressione sui nomi di cartella da togliere (es. /^(darwin|win32)…/)
 *        EN: regex on the folder names to remove (e.g. /^(darwin|win32)…/)
 * @returns byte liberati
 *          EN: bytes freed
 */
function pruneForeign (dir, foreign) {
  let freed = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = path.join(d, e.name)
      // Solo dentro cartelle di binari nativi (prebuilds/, bin/, napi-vN/): una cartella JavaScript
      // chiamata "linux" o "win32" altrove potrebbe servire anche qui
      // EN: Only inside native binary folders (prebuilds/, bin/, napi-vN/): a JavaScript folder
      //     named "linux" or "win32" elsewhere might be needed here too
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

module.exports = { ROOT, tools, buildAndStage, baseConfig, desktopVersion, BUILD_OPTIONS }
