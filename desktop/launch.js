#!/usr/bin/env node
/**
 * @file Avvia l'app desktop con Electron, ripulendo l'ambiente.
 *
 * EN: Starts the desktop app with Electron, after cleaning up the environment.
 *
 * Perché serve: i terminali integrati di VS Code (e alcuni strumenti basati su Electron)
 * impostano ELECTRON_RUN_AS_NODE=1. Ereditata, quella variabile fa partire Electron in
 * modalità "solo Node", senza finestre: l'app crasha subito. Qui la togliamo e passiamo
 * avanti gli argomenti (es. --screenshots <cartella>).
 *
 * EN: Why: VS Code integrated terminals (and some other Electron-based tools) set
 * ELECTRON_RUN_AS_NODE=1. When inherited, that variable starts Electron in "Node only"
 * mode, with no windows, and the app crashes right away. Here we remove it and pass
 * the arguments through (e.g. --screenshots <folder>).
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

const electron = require('electron') // nel processo Node, `require('electron')` è il percorso dell'eseguibile / EN: in the Node process, `require('electron')` is the executable's path
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// `npm run desktop` esegue questo script DENTRO la cartella desktop/: un MICELIO_HOME relativo
// (es. ".demo\alice") verrebbe risolto come desktop\.demo\alice, cioè un nodo nuovo e vuoto.
// Lo risolviamo rispetto alla cartella da cui l'utente ha lanciato il comando (INIT_CWD, impostata da npm).
// EN: `npm run desktop` runs this script INSIDE the desktop/ folder: a relative MICELIO_HOME
//     (e.g. ".demo\alice") would resolve to desktop\.demo\alice, i.e. a new, empty node.
//     We resolve it against the folder the user ran the command from (INIT_CWD, set by npm).
if (env.MICELIO_HOME && !path.isAbsolute(env.MICELIO_HOME)) {
  env.MICELIO_HOME = path.resolve(process.env.INIT_CWD || process.cwd(), env.MICELIO_HOME)
}

const child = spawn(electron, [path.join(__dirname), ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false })
child.on('exit', (code) => process.exit(code ?? 0))
