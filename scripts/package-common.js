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
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

/** Logger e runner con un prefisso, es. `[package-linux]`. */
function tools (name) {
  const log = (m) => console.log(`[${name}] ${m}`)
  const run = (cmd, cwd = ROOT) => { log(`$ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }) }
  return { log, run }
}

/**
 * Compila tutto e prepara in `stage` le risorse comuni: resources/micelio (dist + dipendenze di
 * produzione) e resources/node. Il comando `micelio` lo scrive ogni script (cambia per sistema).
 * @param opts.out cartella di uscita (es. build/linux); l'icona finisce in `<out>/icon.png`
 * @param opts.nodeName nome del binario di Node nel pacchetto ('node.exe' o 'node')
 * @param opts.foreign cartelle di binari nativi da togliere perché di altri sistemi
 * @returns percorso di resources/micelio nella cartella di appoggio
 */
function buildAndStage ({ name, out, stage, nodeName, foreign }) {
  const { log, run } = tools(name)
  // ── Compilazione ──
  run('npm run build')
  run('npm run build -w desktop')

  // ── Risorse ──
  fs.rmSync(stage, { recursive: true, force: true })
  fs.mkdirSync(stage, { recursive: true })
  const micelio = path.join(stage, 'micelio')

  log('copia di dist/ (daemon, CLI, UI)')
  fs.cpSync(path.join(ROOT, 'dist'), path.join(micelio, 'dist'), { recursive: true })

  // package.json minimo: nome, versione e dipendenze (serve a Node per risolvere i moduli e a chi
  // guarda l'installazione per sapere cosa c'è dentro). Niente workspace, script, devDependencies.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  fs.writeFileSync(path.join(micelio, 'package.json'), JSON.stringify({
    name: 'micelio', version: desktopVersion(), private: true, type: pkg.type, bin: pkg.bin,
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

  // Binari di altre piattaforme: inutili qui e pesanti (es. onnxruntime per gli altri sistemi)
  const pruned = pruneForeign(path.join(micelio, 'node_modules'), foreign)
  log(`tolti ${(pruned / 1024 / 1024).toFixed(0)} MB di binari per altre piattaforme`)

  log(`Node.js incluso: ${process.version}`)
  fs.mkdirSync(path.join(stage, 'node'), { recursive: true })
  fs.copyFileSync(process.execPath, path.join(stage, 'node', nodeName))
  fs.mkdirSync(path.join(stage, 'bin'), { recursive: true })

  // Icona: la stessa disegnata dall'app (desktop/src/icon.ts), a 256 px
  const { nucleusIconPng } = require(path.join(ROOT, 'desktop', 'dist', 'icon.js'))
  fs.writeFileSync(path.join(out, 'icon.png'), nucleusIconPng(256))
  return micelio
}

/** Versione dell'app (quella di desktop/package.json): è la versione dei pacchetti. */
function desktopVersion () {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version
}

/**
 * Configurazione di electron-builder comune ai sistemi; ogni script aggiunge la sua sezione
 * (win/nsis, linux/deb…) e le risorse extra.
 * @param micelio resources/micelio nella cartella di appoggio, copiato dopo l'impacchettamento
 */
function baseConfig ({ out, micelio }) {
  return {
    appId: 'it.micelio.desktop',
    productName: 'Micelio',
    electronVersion: require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version,
    directories: { output: path.join(out, 'out'), buildResources: path.join(ROOT, 'desktop', 'build') },
    // Solo il codice dell'app desktop. In una repository a workspace electron-builder troverebbe
    // il node_modules della radice e lo metterebbe in app.asar: all'app non serve (850 MB in più).
    files: ['dist/**/*', 'package.json', '!**/node_modules/**'],
    // Daemon e CLI con le loro dipendenze si copiano DOPO l'impacchettamento dell'app e prima
    // dell'installer: le risorse extra di electron-builder escludono sempre le cartelle
    // node_modules (anche con un filtro esplicito), e il daemon resterebbe senza dipendenze.
    afterPack: async (ctx) => {
      fs.cpSync(micelio, path.join(ctx.appOutDir, 'resources', 'micelio'), { recursive: true })
    },
    // Il codice dell'app desktop non ha dipendenze proprie: niente da reinstallare né ricompilare
    npmRebuild: false,
    asar: true
  }
}

/**
 * Toglie le cartelle di binari nativi per altri sistemi (prebuilds e simili).
 * @param foreign espressione sui nomi di cartella da togliere (es. /^(darwin|win32)…/)
 * @returns byte liberati
 */
function pruneForeign (dir, foreign) {
  let freed = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = path.join(d, e.name)
      // Solo dentro cartelle di binari nativi (prebuilds/, bin/, napi-vN/): una cartella JavaScript
      // chiamata "linux" o "win32" altrove potrebbe servire anche qui
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

module.exports = { ROOT, tools, buildAndStage, baseConfig, desktopVersion }
