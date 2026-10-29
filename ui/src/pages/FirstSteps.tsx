/**
 * @file Primi passi: il percorso guidato per chi ha appena creato un team o ci è entrato.
 * Collega Claude Code, abilita le cartelle dei progetti e verifica che funzioni davvero.
 *
 * EN: First steps: the guided path for whoever has just created or joined a team. It connects
 * Claude Code, enables the project folders and checks that it really works.
 *
 * PERCHÉ. Dopo la creazione del team l'app mostrava il Nucleo vuoto e nient'altro: niente diceva
 * che senza collegare Claude Code e abilitare una cartella l'agente non vede Micelio (e da una
 * cartella fuori dai team non legge nulla, 0.6.2). Chi installava restava spiazzato.
 *
 * EN: WHY. After creating the team the app showed the empty Nucleus and nothing else: nothing said
 * that without connecting Claude Code and enabling a folder the agent doesn't see Micelio (and from
 * a folder outside the teams it reads nothing, 0.6.2). Whoever installed it was left puzzled.
 *
 * COME. Ogni passo ha il pulsante che lo fa e un controllo che lo spunta da solo, letto dal daemon
 * (GET /api/setup/first-steps, aggiornato ogni 3 secondi mentre la pagina è aperta):
 * 1. Claude Code trovato sul PC e già usato da questo utente;
 * 2. registrazione MCP attiva (lo shim stdio);
 * 3. almeno una cartella abilitata nel team;
 * 4. il daemon ha ricevuto una chiamata di Claude Code da una cartella del team. Se l'ultima
 *    chiamata viene da una cartella sbagliata, la pagina lo dice e indica quale.
 *
 * EN: HOW. Every step has the button that does it and a check that ticks it by itself, read from
 * the daemon (GET /api/setup/first-steps, refreshed every 3 seconds while the page is open):
 * 1. Claude Code found on the PC and already used by this user;
 * 2. MCP registration active (the stdio shim);
 * 3. at least one folder enabled in the team;
 * 4. the daemon received a Claude Code call from a folder of the team. If the last call comes
 *    from a wrong folder, the page says so and names it.
 *
 * VISIBILITÀ. La schermata di benvenuto apre questa pagina dopo la creazione o l'ingresso nel
 * team (stato `open` in localStorage, per team). La voce in cima alla barra laterale resta finché
 * la pagina è aperta o mancano i passi necessari (2 e 3); «Ho finito» la toglie.
 *
 * EN: VISIBILITY. The welcome screen opens this page after creating or joining the team (`open`
 * state in localStorage, per team). The item at the top of the sidebar stays while the page is
 * open or the required steps (2 and 3) are missing; "I'm done" removes it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type FirstStepsStatus } from '../api/client'
import { currentTeam } from '../api/team'
import { Card, ErrorBox, PageHeader } from '../components/ui'
import { dateTime } from '../format'
import { defineStrings, useStrings } from '../i18n'

const KEY = 'micelio.firstSteps.'

/** Stato salvato del percorso per il team corrente. / EN: Saved state of the path for the current team. */
export function firstStepsState (): 'open' | 'done' | null {
  try {
    const v = localStorage.getItem(KEY + (currentTeam() ?? 'default'))
    return v === 'open' || v === 'done' ? v : null
  } catch { return null }
}

/** Segna il percorso come da fare (dopo la creazione del team) o finito. / EN: Marks the path as to do (after creating the team) or done. */
export function setFirstStepsState (v: 'open' | 'done', team = currentTeam()): void {
  try { localStorage.setItem(KEY + (team ?? 'default'), v) } catch {}
}

/** Quanti passi sono fatti (su 4). / EN: How many steps are done (out of 4). */
export function stepsDone (d: FirstStepsStatus): boolean[] {
  return [d.claude.found && d.claude.usedByThisUser, d.registration === 'shim', d.folders.length > 0, !!d.agent]
}

const S = defineStrings({
  it: {
    title: 'Primi passi',
    subtitle: 'Quattro passi per far lavorare Claude Code con la memoria del team. Ognuno si spunta da solo quando è fatto.',
    progress: (n: number) => `${n} di 4 fatti`,
    done: 'Fatto',
    recheck: 'Ricontrolla',
    s1: {
      title: '1. Claude Code su questo PC',
      why: 'Micelio è la memoria; chi la usa è Claude Code. Serve installato e con l\'accesso fatto, con lo stesso utente del PC con cui usi Micelio.',
      ok: (file: string) => `Trovato: ${file}`,
      missing: 'Claude Code non è installato, o Micelio non lo trova. Installalo dalla pagina ufficiale, aprilo una volta e fai l\'accesso con il tuo account, poi premi «Ricontrolla».',
      install: 'Come installare Claude Code',
      neverUsed: 'Claude Code c\'è, ma questo utente del PC non l\'ha mai aperto. Aprilo una volta e fai l\'accesso. Se lo usi sempre con un altro utente di Windows (per esempio un account amministratore), non vedrà Micelio: usa Micelio e Claude Code con lo stesso utente.'
    },
    s2: {
      title: '2. Collega Claude Code a Micelio',
      why: 'Registra Micelio fra gli strumenti di Claude Code (server MCP) e aggiunge gli hook che portano il sapere del team all\'inizio di ogni sessione e raccolgono le sessioni lunghe. Vale per tutti i progetti; si salva prima una copia della configurazione.',
      button: 'Collega Claude Code',
      ok: 'Collegato.',
      legacy: 'Claude Code è collegato con la registrazione vecchia: premi «Collega Claude Code» per aggiornarla.',
      after: 'Fatto. Chiudi e riapri le sessioni di Claude Code già aperte (o ricarica la finestra di VS Code): Claude Code legge gli strumenti solo all\'avvio.'
    },
    s3: {
      title: '3. Scegli le cartelle dei tuoi progetti',
      why: 'Claude Code usa la memoria del team solo nelle cartelle che abiliti qui (e nelle loro sottocartelle). Fuori da queste cartelle non legge niente: è una protezione contro repository non fidati. Valgono anche per la raccolta automatica delle sessioni.',
      pick: 'Scegli cartella…',
      add: 'Aggiungi',
      placeholder: 'percorso della cartella del progetto, es. C:\\SourceCode\\progetto',
      ok: (n: number) => n === 1 ? 'Una cartella abilitata:' : `${n} cartelle abilitate:`
    },
    s4: {
      title: '4. Prova che funziona',
      why: 'Apri Claude Code in una delle cartelle abilitate e chiedigli qualcosa che lo faccia cercare in Micelio. Questo passo si spunta da solo quando Micelio riceve la chiamata.',
      howTerminal: 'Da terminale: entra nella cartella del progetto e avvia',
      howEditor: '. In VS Code: apri la cartella e avvia una sessione nuova. Poi scrivi:',
      prompt: 'Cerca in Micelio cosa sa il team di questo progetto',
      copy: 'Copia',
      copied: 'Copiato',
      waiting: 'In attesa della prima chiamata di Claude Code…',
      ok: (when: string, cwd: string) => `Claude Code ha parlato con Micelio alle ${when}, dalla cartella ${cwd}.`,
      wrongNone: (cwd: string) => `Claude Code ha chiamato Micelio dalla cartella ${cwd}, che non è abilitata in nessun team: lì non legge la memoria. Abilitala al passo 3 (o apri Claude Code in una cartella già abilitata).`,
      wrongOther: (cwd: string) => `Claude Code ha chiamato Micelio dalla cartella ${cwd}, che appartiene a un altro team di questo PC. Per questo team apri Claude Code in una delle sue cartelle.`,
      noFolder: 'Claude Code ha chiamato Micelio senza dire da quale cartella: è la registrazione vecchia. Ripeti il passo 2 e riapri la sessione.',
      notSeen: 'Non arriva niente? Controlla che la sessione sia stata aperta DOPO il passo 2, e in Claude Code scrivi /mcp: «micelio» deve risultare collegato.'
    },
    more: {
      title: 'Poi, quando vuoi',
      documents: 'Cartelle di documenti (PDF, Office, Markdown) da trasformare in ricordi',
      invite: 'Invita un collega',
      guide: 'La guida completa'
    },
    finish: 'Ho finito',
    finishHint: 'Questa pagina resta comunque nella Guida, all\'argomento «Primi passi».'
  },
  en: {
    title: 'First steps',
    subtitle: 'Four steps to make Claude Code work with the team\'s memory. Each one ticks itself when it\'s done.',
    progress: (n: number) => `${n} of 4 done`,
    done: 'Done',
    recheck: 'Check again',
    s1: {
      title: '1. Claude Code on this PC',
      why: 'Micelio is the memory; Claude Code is what uses it. It must be installed and signed in, with the same PC user you use Micelio with.',
      ok: (file: string) => `Found: ${file}`,
      missing: 'Claude Code isn\'t installed, or Micelio can\'t find it. Install it from the official page, open it once and sign in with your account, then press "Check again".',
      install: 'How to install Claude Code',
      neverUsed: 'Claude Code is there, but this PC user has never opened it. Open it once and sign in. If you always use it with another Windows user (for example an administrator account), it won\'t see Micelio: use Micelio and Claude Code with the same user.'
    },
    s2: {
      title: '2. Connect Claude Code to Micelio',
      why: 'Registers Micelio among Claude Code\'s tools (MCP server) and adds the hooks that bring the team\'s knowledge at the start of every session and collect long sessions. It applies to all projects; a copy of the configuration is saved first.',
      button: 'Connect Claude Code',
      ok: 'Connected.',
      legacy: 'Claude Code is connected with the old registration: press "Connect Claude Code" to update it.',
      after: 'Done. Close and reopen the Claude Code sessions already open (or reload the VS Code window): Claude Code reads its tools only at startup.'
    },
    s3: {
      title: '3. Choose your project folders',
      why: 'Claude Code uses the team\'s memory only in the folders you enable here (and their subfolders). Outside these folders it reads nothing: it\'s a protection against untrusted repositories. They also apply to the automatic collection of sessions.',
      pick: 'Choose folder…',
      add: 'Add',
      placeholder: 'path of the project folder, e.g. C:\\SourceCode\\project',
      ok: (n: number) => n === 1 ? 'One folder enabled:' : `${n} folders enabled:`
    },
    s4: {
      title: '4. Check that it works',
      why: 'Open Claude Code in one of the enabled folders and ask it something that makes it search Micelio. This step ticks itself when Micelio receives the call.',
      howTerminal: 'From a terminal: go into the project folder and start',
      howEditor: '. In VS Code: open the folder and start a new session. Then write:',
      prompt: 'Search Micelio for what the team knows about this project',
      copy: 'Copy',
      copied: 'Copied',
      waiting: 'Waiting for Claude Code\'s first call…',
      ok: (when: string, cwd: string) => `Claude Code talked to Micelio at ${when}, from the folder ${cwd}.`,
      wrongNone: (cwd: string) => `Claude Code called Micelio from the folder ${cwd}, which isn't enabled in any team: there it doesn't read the memory. Enable it in step 3 (or open Claude Code in a folder already enabled).`,
      wrongOther: (cwd: string) => `Claude Code called Micelio from the folder ${cwd}, which belongs to another team on this PC. For this team, open Claude Code in one of its folders.`,
      noFolder: 'Claude Code called Micelio without saying from which folder: it\'s the old registration. Repeat step 2 and reopen the session.',
      notSeen: 'Nothing arrives? Check that the session was opened AFTER step 2, and in Claude Code type /mcp: "micelio" must show as connected.'
    },
    more: {
      title: 'Then, whenever you like',
      documents: 'Document folders (PDF, Office, Markdown) to turn into memories',
      invite: 'Invite a colleague',
      guide: 'The full guide'
    },
    finish: 'I\'m done',
    finishHint: 'This page stays in the Guide anyway, under the "First steps" topic.'
  }
})

/** Pagina della documentazione ufficiale di Claude Code. / EN: Official Claude Code documentation page. */
const CLAUDE_CODE_DOCS = 'https://code.claude.com/docs/en/setup'

export function FirstSteps () {
  const s = useStrings(S)
  const qc = useQueryClient()
  const navigate = useNavigate()
  // Ogni 3 secondi: il passo 4 si spunta appena arriva la chiamata di Claude Code
  // EN: Every 3 seconds: step 4 ticks as soon as Claude Code's call arrives
  const q = useQuery({ queryKey: ['first-steps'], queryFn: api.firstSteps, refetchInterval: 3000 })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['first-steps'] })
  const connect = useMutation({ mutationFn: () => api.setupClaudeCode(true, true), onSuccess: refresh })
  const [dir, setDir] = useState('')
  const add = useMutation({ mutationFn: (d: string) => api.watchAdd(d), onSuccess: () => { setDir(''); refresh(); void qc.invalidateQueries({ queryKey: ['watch'] }) } })
  const pick = async () => { const d = await window.micelio?.pickFolder?.(); if (d) add.mutate(d) }
  const [copied, setCopied] = useState(false)

  const finish = () => { setFirstStepsState('done'); void qc.invalidateQueries({ queryKey: ['first-steps'] }); navigate('/') }

  if (q.error) return <><PageHeader title={s.title} help='first-steps' /><ErrorBox error={q.error} /></>
  if (!q.data) return <PageHeader title={s.title} help='first-steps' />
  const d = q.data
  const done = stepsDone(d)
  const mark = (ok: boolean) => <span className={`step-mark ${ok ? 'ok' : ''}`}>{ok ? '✓' : ''}</span>
  const last = d.lastAgent
  const wrong = !d.agent && last && !last.sameTeam

  return (
    <>
      <PageHeader title={s.title} subtitle={s.subtitle} help='first-steps' actions={<span className='muted'>{s.progress(done.filter(Boolean).length)}</span>} />
      <div className='stack' style={{ maxWidth: 860 }}>
        <Card title={s.s1.title} actions={mark(done[0])} help='first-steps#claude'>
          <p className='muted' style={{ marginTop: 0 }}>{s.s1.why}</p>
          {d.claude.found && d.claude.file && <p className='small'>{s.s1.ok(d.claude.file)}</p>}
          {!d.claude.found && <div className='notice warn'>{s.s1.missing} <a href={CLAUDE_CODE_DOCS} target='_blank' rel='noreferrer'>{s.s1.install}</a></div>}
          {d.claude.found && !d.claude.usedByThisUser && <div className='notice warn'>{s.s1.neverUsed}</div>}
          {!done[0] && <div className='row' style={{ marginTop: 10 }}><button className='btn' onClick={refresh}>{s.recheck}</button></div>}
        </Card>

        <Card title={s.s2.title} actions={mark(done[1])} help='first-steps#connect'>
          <p className='muted' style={{ marginTop: 0 }}>{s.s2.why}</p>
          {d.registration === 'legacy' && <div className='notice warn' style={{ marginBottom: 10 }}>{s.s2.legacy}</div>}
          {done[1] && !connect.data && <p>{s.s2.ok}</p>}
          {(!done[1] || connect.data) && (
            <div className='row'>
              <button className='btn primary' disabled={connect.isPending || !d.claude.found} onClick={() => connect.mutate()}>{s.s2.button}</button>
            </div>
          )}
          <ErrorBox error={connect.error} />
          {connect.data && <div className='notice ok' style={{ marginTop: 10 }}>{s.s2.after}</div>}
        </Card>

        <Card title={s.s3.title} actions={mark(done[2])} help='first-steps#folders'>
          <p className='muted' style={{ marginTop: 0 }}>{s.s3.why}</p>
          {d.folders.length > 0 && (
            <>
              <div className='small'>{s.s3.ok(d.folders.length)}</div>
              <ul className='small' style={{ marginTop: 4 }}>{d.folders.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
            </>
          )}
          <div className='row'>
            {window.micelio?.pickFolder
              ? <button className={`btn ${done[2] ? '' : 'primary'}`} disabled={add.isPending} onClick={() => void pick()}>{s.s3.pick}</button>
              : (
                <>
                  <input style={{ flex: 1, minWidth: 260 }} value={dir} onChange={(e) => setDir(e.target.value)} placeholder={s.s3.placeholder} />
                  <button className='btn primary' disabled={add.isPending || !dir.trim()} onClick={() => add.mutate(dir.trim())}>{s.s3.add}</button>
                </>
                )}
          </div>
          <ErrorBox error={add.error} />
        </Card>

        <Card title={s.s4.title} actions={mark(done[3])} help='first-steps#try'>
          <p className='muted' style={{ marginTop: 0 }}>{s.s4.why}</p>
          {d.agent
            ? <div className='notice ok'>{s.s4.ok(dateTime(d.agent.at), d.agent.cwd ?? '?')}</div>
            : (
              <>
                <p>{s.s4.howTerminal} <code>claude</code>{s.s4.howEditor}</p>
                <div className='row'>
                  <code className='prompt-box'>{s.s4.prompt}</code>
                  <button className='btn small' onClick={() => { void navigator.clipboard?.writeText(s.s4.prompt).then(() => setCopied(true)) }}>{copied ? s.s4.copied : s.s4.copy}</button>
                </div>
                {wrong && last && (
                  <div className='notice warn' style={{ marginTop: 10 }}>
                    {last.cwd === null ? s.s4.noFolder : last.inSomeTeam ? s.s4.wrongOther(last.cwd) : s.s4.wrongNone(last.cwd)}
                  </div>
                )}
                <p className='muted small' style={{ marginBottom: 0 }}>{s.s4.waiting} {s.s4.notSeen}</p>
              </>
              )}
        </Card>

        <Card title={s.more.title}>
          <ul style={{ margin: 0 }}>
            <li><Link to='/impostazioni'>{s.more.documents}</Link></li>
            <li><Link to='/team'>{s.more.invite}</Link></li>
            <li><Link to='/guida'>{s.more.guide}</Link></li>
          </ul>
        </Card>

        <div className='row'>
          <button className='btn primary' onClick={finish}>{s.finish}</button>
          <span className='muted small'>{s.finishHint}</span>
        </div>
      </div>
    </>
  )
}
