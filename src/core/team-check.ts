/**
 * @file Controllo del team di un salvataggio dagli agenti (0.6.1): la cartella da cui arriva la
 * sessione deve essere abilitata nel team su cui l'agente sta salvando.
 *
 * EN: Team check of a save from agents (0.6.1): the folder the session comes from must be enabled
 * in the team the agent is saving to.
 *
 * Bug reale (2026-10-24, e prima ancora 2026-10-21): una sessione di Claude Code collegata con la
 * registrazione MCP vecchia (HTTP, senza cartella) salvava nel team predefinito ricordi di un
 * progetto di un altro team, e se ne accorgeva solo l'utente leggendo la risposta. Ora `remember`
 * confronta sempre la cartella della sessione con le cartelle abilitate di TUTTI i team: se non
 * corrisponde al team della connessione, il ricordo non viene pubblicato ma va nell'Inbox con il
 * problema e la soluzione proposta. Meglio un clic in più che un ricordo visibile alle persone
 * sbagliate.
 *
 * EN: Real bug (2026-10-24, and before that 2026-10-21): a Claude Code session connected with the
 * old MCP registration (HTTP, no folder) saved into the default team memories of a project that
 * belongs to another team, and only the user noticed by reading the reply. Now `remember` always
 * compares the session's folder with the enabled folders of ALL teams: if it doesn't match the
 * connection's team, the memory isn't published but goes to the Inbox with the problem and the
 * proposed fix. Better one extra click than a memory visible to the wrong people.
 *
 * Solo funzioni pure: chi le usa passa la funzione che trova il team di una cartella
 * (MicelioHost.ownerOf) e i nomi dei team.
 *
 * EN: Pure functions only: callers pass the function that finds a folder's team
 * (MicelioHost.ownerOf) and the team names.
 */

/**
 * Cosa non torna:
 * - `other-team`: la cartella è abilitata in un ALTRO team (es. registrazione `/mcp/<team>` vecchia);
 * - `not-enabled`: la cartella non è abilitata in nessun team;
 * - `no-folder`: il client non ha detto da quale cartella arriva (registrazione HTTP vecchia o
 *   client MCP diverso dallo shim `micelio mcp`).
 *
 * EN: What doesn't match:
 * - `other-team`: the folder is enabled in ANOTHER team (e.g. an old `/mcp/<team>` registration);
 * - `not-enabled`: the folder isn't enabled in any team;
 * - `no-folder`: the client didn't say which folder it comes from (old HTTP registration or an MCP
 *   client other than the `micelio mcp` shim).
 */
export type TeamCheckProblem = 'other-team' | 'not-enabled' | 'no-folder'

/** Un team con il suo nome leggibile. / EN: A team with its readable name. */
export interface TeamRef { id: string, name: string }

/**
 * Esito negativo del controllo: viaggia con l'elemento dell'Inbox, così l'interfaccia può
 * spiegare il problema e proporre la soluzione.
 *
 * EN: Negative outcome of the check: it travels with the Inbox item, so the interface can explain
 * the problem and propose the fix.
 */
export interface TeamCheck {
  problem: TeamCheckProblem
  /** Cartella della sessione (null se il client non l'ha mandata). / EN: The session's folder (null if the client didn't send it). */
  cwd: string | null
  /** Team su cui la sessione stava salvando. / EN: Team the session was saving to. */
  session: TeamRef
  /** Team che possiede la cartella (solo `other-team`). / EN: Team that owns the folder (`other-team` only). */
  folder?: TeamRef
}

/**
 * Confronta la cartella della sessione con il team su cui si salva.
 *
 * EN: Compares the session's folder with the team being saved to.
 * @param cwd cartella di lavoro dell'agente, null se sconosciuta
 *        EN: the agent's working folder, null if unknown
 * @param session team della connessione MCP
 *        EN: team of the MCP connection
 * @param ownerOf team che possiede una cartella (la più specifica fra quelle abilitate), o null
 *        EN: team owning a folder (the most specific enabled one), or null
 * @param nameOf nome leggibile di un team
 *        EN: readable name of a team
 * @returns null se tutto torna, altrimenti il problema
 *          EN: null if everything matches, otherwise the problem
 */
export function checkSessionTeam (
  cwd: string | null,
  session: TeamRef,
  ownerOf: (dir: string) => string | null,
  nameOf: (id: string) => string
): TeamCheck | null {
  if (!cwd) return { problem: 'no-folder', cwd: null, session }
  const owner = ownerOf(cwd)
  if (!owner) return { problem: 'not-enabled', cwd, session }
  if (owner !== session.id) return { problem: 'other-team', cwd, session, folder: { id: owner, name: nameOf(owner) } }
  return null
}

/**
 * Motivo breve, salvato nell'Inbox e nel registro delle decisioni (in italiano, come gli altri
 * motivi della pipeline).
 *
 * EN: Short reason, stored in the Inbox and in the decision log (in Italian, like the pipeline's
 * other reasons).
 */
export function teamCheckReason (c: TeamCheck): string {
  switch (c.problem) {
    case 'other-team': return `la cartella ${c.cwd} è abilitata nel team «${c.folder!.name}», ma la sessione salvava nel team «${c.session.name}»`
    case 'not-enabled': return `la cartella ${c.cwd} non è abilitata in nessun team`
    case 'no-folder': return 'Claude Code non ha indicato da quale cartella arriva il salvataggio (registrazione MCP vecchia)'
  }
}

/**
 * Risposta degli strumenti di lettura MCP (recall, get, architecture…) quando la sessione arriva da
 * una cartella che non è in nessun team, o non ha detto da quale cartella arriva. In italiano,
 * come le altre risposte MCP: l'agente la riferisce all'utente.
 *
 * EN: Reply of the MCP read tools (recall, get, architecture…) when the session comes from a folder
 * that is in no team, or didn't say which folder it comes from. In Italian, like the other MCP
 * replies: the agent relays it to the user.
 */
export function lockedReadsMessage (cwd: string | null): string {
  const where = cwd ? `la cartella ${cwd} non è abilitata in nessun team` : 'il client non ha indicato da quale cartella arriva (registrazione MCP vecchia o client diverso dallo shim «micelio mcp»)'
  return `Micelio non legge la memoria da questa sessione: ${where}. ` +
    'È una protezione: un repository non fidato non deve poter far leggere all\'agente i ricordi di un team. ' +
    'Per usarla: in Micelio, Impostazioni → Raccolta automatica, abilita la cartella nel team giusto (vale subito, senza riaprire la sessione). ' +
    '«remember» funziona anche qui: il ricordo va nell\'Inbox per una verifica, non viene pubblicato. Dillo all\'utente.'
}

/**
 * Soluzione proposta, per la risposta all'agente (MCP, in italiano come le altre risposte MCP).
 * L'interfaccia ha i suoi testi in italiano e inglese.
 *
 * EN: Proposed fix, for the reply to the agent (MCP, in Italian like the other MCP replies).
 * The interface has its own texts in Italian and English.
 */
export function teamCheckSolution (c: TeamCheck): string {
  switch (c.problem) {
    case 'other-team':
      return `Nell'Inbox del team «${c.folder!.name}» basta approvarlo per pubblicarlo lì. Per i prossimi salvataggi: in Micelio, Impostazioni → Claude Code → «Configura», poi chiudi e riapri questa sessione di Claude Code (anche con /resume).`
    case 'not-enabled':
      return `Abilita la cartella nel team giusto (Micelio, Impostazioni → Raccolta automatica), poi dall'Inbox pubblicalo nel team giusto con «Pubblica in…».`
    case 'no-folder':
      return `In Micelio, Impostazioni → Claude Code → «Configura», poi chiudi e riapri questa sessione di Claude Code (anche con /resume). Intanto dall'Inbox puoi pubblicarlo nel team giusto con «Pubblica in…».`
  }
}
