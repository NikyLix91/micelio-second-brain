/**
 * @file Preload di Electron: il ponte (controllato) fra la UI e il processo principale.
 *
 * La UI gira isolata (contextIsolation): non vede Node né Electron. Qui esponiamo SOLO ciò che
 * serve, come `window.micelio` (tipizzato in ui/src/env.d.ts):
 * - `token`: il token dell'API locale, chiesto in modo sincrono al processo principale
 *   (deve essere disponibile prima che parta il codice della UI);
 * - `pickFolder()`: selettore di cartelle nativo, per abilitare la raccolta su un progetto.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('micelio', {
  token: ipcRenderer.sendSync('micelio:token') as string,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('micelio:pick-folder')
})
