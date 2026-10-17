#!/usr/bin/env node
/**
 * @file Avvia l'app desktop con Electron, ripulendo l'ambiente.
 *
 * Perché serve: i terminali integrati di VS Code (e alcuni strumenti basati su Electron)
 * impostano ELECTRON_RUN_AS_NODE=1. Ereditata, quella variabile fa partire Electron in
 * modalità "solo Node", senza finestre: l'app crasha subito. Qui la togliamo e passiamo
 * avanti gli argomenti (es. --screenshots <cartella>).
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

const electron = require('electron') // nel processo Node, `require('electron')` è il percorso dell'eseguibile
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// `npm run desktop` esegue questo script DENTRO la cartella desktop/: un MICELIO_HOME relativo
// (es. ".demo\alice") verrebbe risolto come desktop\.demo\alice, cioè un nodo nuovo e vuoto.
// Lo risolviamo rispetto alla cartella da cui l'utente ha lanciato il comando (INIT_CWD, impostata da npm).
if (env.MICELIO_HOME && !path.isAbsolute(env.MICELIO_HOME)) {
  env.MICELIO_HOME = path.resolve(process.env.INIT_CWD || process.cwd(), env.MICELIO_HOME)
}

const child = spawn(electron, [path.join(__dirname), ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false })
child.on('exit', (code) => process.exit(code ?? 0))
