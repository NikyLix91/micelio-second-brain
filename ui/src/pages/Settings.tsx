/**
 * @file Impostazioni locali (attività 3.9): rete P2P (DHT pubblica o privata), cartelle abilitate
 * alla raccolta, modelli e budget LLM, configurazione di Claude Code. Sono impostazioni di QUESTO
 * nodo (config.json), non del team.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type NetworkMode } from '../api/client'
import { Card, ConfirmButton, Empty, ErrorBox, PageHeader } from '../components/ui'
import { HelpButton } from '../help'
import { defineStrings, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    title: 'Impostazioni',
    subtitle: 'Impostazioni di questo PC. Quelle condivise dal team sono nella schermata Team.',
    remove: 'Rimuovi',
    pickFolder: 'Scegli cartella…',
    cancel: 'Annulla',
    save: 'Salva',
    net: {
      title: 'Rete',
      privateInUse: (list: string) => `DHT privata: ${list}`,
      publicInUse: 'DHT pubblica di Holepunch',
      fixed1: 'In uso:',
      fixed2: ', fissata dalla variabile',
      fixed3: '(demo, container o test): da qui non si può cambiare.',
      intro: 'Dove i nodi del team si incontrano su internet. I contenuti viaggiano sempre cifrati e direttamente fra i PC: la DHT serve solo a trovarsi.',
      inUseNow: 'In uso adesso:',
      publicTitle: 'DHT pubblica',
      publicHint: "Nessun server da gestire. L'impronta del team e gli IP dei membri sono visibili nella DHT pubblica, i contenuti mai.",
      privateTitle: 'DHT privata del team',
      privateSub: '(server del team)',
      privateHint: 'Nessuna dipendenza da terzi; impronta e IP restano sul vostro server. Si installa a parte: vedi server/README.md.',
      localTitle: 'Solo locale',
      localSub: '(nessuna rete)',
      localHint: 'Per chi usa Micelio da solo: il nodo non entra in nessuna DHT e non cerca colleghi. Per invitare qualcuno scegli una delle due reti.',
      localInUse: 'nessuna rete (solo locale)',
      bootstrap: 'Nodi di avvio (uno per riga, host:porta)',
      reachable: (nodes: number, ms: number, ip: string, nat: string) => `Raggiungibile: ${nodes} nodi in ${ms} ms · IP pubblico ${ip} · NAT simmetrico: ${nat}`,
      ipUnknown: 'non determinato',
      natUnknown: 'non determinabile',
      natYes: 'SÌ (la connessione diretta può fallire con colleghi nella stessa situazione)',
      natNo: 'no',
      unreachable: "Nessun nodo ha risposto: server spento, porta UDP chiusa sul server, oppure questa rete blocca l'UDP in uscita.",
      checking: 'Verifica in corso…',
      check: 'Verifica',
      apply: 'Applica',
      applyConfirm: 'Sì, cambia rete: tutti i membri devono usare la stessa',
      reconnecting: 'Riconnessione…'
    },
    watch: {
      title: 'Raccolta automatica dalle sessioni di Claude Code',
      intro: 'Solo le sessioni avviate in queste cartelle (e sottocartelle) vengono elaborate. Tutto passa comunque dal filtro privacy.',
      teamNote: 'Le cartelle valgono per il team scelto nella barra laterale: le sessioni di una cartella vanno solo a questo team (una cartella appartiene a un solo team).',
      empty: 'Nessuna cartella abilitata.',
      enable: 'Abilita',
      link: 'Collega Claude Code',
      linkConfirm: 'Sì, collega a questo team',
      linkTitle: 'Claude Code avviato in questa cartella userà questo team (registrazione MCP solo per la cartella)',
      linked: (url: string) => `Fatto: Claude Code avviato in questa cartella userà ${url}`
    },
    docs: {
      title: 'Cartelle di documenti',
      intro1: 'PDF, Word, Excel, PowerPoint, OpenDocument e Markdown vengono distillati in ricordi (filtro privacy incluso; le cartelle come «HR» o «contratti» non vengono nemmeno lette).',
      intro2a: "Al team arriva solo il distillato: l'originale resta qui e, se la cartella è",
      shareableWord: 'condivisibile',
      intro2b: ', i colleghi possono scaricarlo su richiesta.',
      intro3a: 'Una cartella',
      rootsWord: 'di Radici',
      intro3b: '(architettura, policy, regole di sviluppo…) trasforma i suoi ricordi in Radici; si leggono anche i diagrammi (draw.io, SVG, PlantUML, Mermaid).',
      empty: 'Nessuna cartella di documenti.',
      shareable: 'originali scaricabili',
      distilledOnly: 'solo distillato',
      rootsBadge: '◆ di Radici',
      stat: { done: 'elaborati', queued: 'in coda', blocked: 'bloccati', failed: 'illeggibili', removed: 'rimossi' } as Record<string, string>,
      rootsHint: 'I ricordi distillati dai documenti di questa cartella diventano Radici (architettura, policy, regole…)',
      add: 'Aggiungi'
    },
    llm: {
      title: 'Intelligenza (LLM)',
      shared: 'Valgono per tutti i team di questo PC: un solo abbonamento, una chiamata a Claude alla volta, un solo limite giornaliero.',
      inUse: (a: string) => `LLM in uso: ${a}`,
      command: (c: string) => ` (comando: ${c})`,
      adapter: {
        claude: 'Claude Code (la CLI installata su questo PC): usa il tuo abbonamento, nessuna API key.',
        fake: "FINTO, solo per demo e test: non chiama Claude, classifica e distilla con regole banali sul testo. Il team demo lo usa apposta, per non consumare l'abbonamento.",
        none: 'Nessuno: niente classificazione né distillazione automatica, i casi dubbi vanno tutti in inbox.'
      } as Record<string, string>,
      change1: 'Per cambiarlo modifica',
      change2: 'in',
      change3: 'e riavvia il daemon.',
      classify: 'Modello per classificare (veloce)',
      distill: 'Modello per distillare (più capace)',
      budget: 'Chiamate massime al giorno',
      models: { haiku: 'Haiku: veloce ed economico', sonnet: 'Sonnet: equilibrato', opus: 'Opus: il più capace, più lento' } as Record<string, string>,
      other: 'Altro…',
      modelName: (label: string) => `${label}: nome del modello`,
      modelPlaceholder: 'nome o id del modello, es. claude-opus-5-5'
    },
    ctx: {
      title: 'Contesto automatico per gli agenti',
      intro: 'Con gli hook di Claude Code (installati da «Configura» qui sotto), Micelio inserisce da solo nella conversazione il sapere utile, senza aspettare che l\'agente lo cerchi. Vale per tutti i team di questo PC.',
      sessionStart: 'A inizio sessione: Radici e ricordi più utili del progetto della cartella',
      prompt: 'A ogni richiesta: ricordi e Radici pertinenti al testo (solo se lo sono davvero, mai ripetuti)',
      maxChars: 'Caratteri massimi inseriti ogni volta',
      save: 'Salva'
    },
    cc: {
      title: 'Claude Code',
      intro1: "Registra Micelio come server MCP di Claude Code e, se vuoi, gli hook: a fine sessione avvisano Micelio (raccolta automatica, solo nelle cartelle abilitate), a inizio sessione e a ogni richiesta inseriscono il contesto automatico.",
      intro2: 'Modifica la configurazione di Claude Code nel tuo profilo utente; viene salvata una copia di backup.',
      full: 'Configura MCP + raccolta + contesto automatico',
      fullConfirm: 'Sì, modifica la configurazione',
      mcpOnly: 'Solo MCP',
      mcpOnlyConfirm: 'Sì, registra MCP',
      done: (url: string) => `Server MCP registrato su ${url}.`,
      hook: (file: string) => ` Hook installato in ${file}.`
    }
  },
  en: {
    title: 'Settings',
    subtitle: 'Settings of this PC. Those shared by the team are on the Team screen.',
    remove: 'Remove',
    pickFolder: 'Choose folder…',
    cancel: 'Cancel',
    save: 'Save',
    net: {
      title: 'Network',
      privateInUse: (list: string) => `Private DHT: ${list}`,
      publicInUse: 'Holepunch public DHT',
      fixed1: 'In use:',
      fixed2: ', set by the variable',
      fixed3: '(demo, container or tests): it cannot be changed from here.',
      intro: 'Where the team nodes meet on the internet. Content always travels encrypted and directly between PCs: the DHT is only used to find each other.',
      inUseNow: 'In use now:',
      publicTitle: 'Public DHT',
      publicHint: 'No server to manage. The team fingerprint and the members’ IPs are visible in the public DHT, the content never.',
      privateTitle: 'Team private DHT',
      privateSub: '(team server)',
      privateHint: 'No third-party dependency; fingerprint and IPs stay on your server. It is installed separately: see server/README.md.',
      localTitle: 'Local only',
      localSub: '(no network)',
      localHint: 'For those who use Micelio on their own: the node joins no DHT and looks for no colleagues. To invite someone, choose one of the two networks.',
      localInUse: 'no network (local only)',
      bootstrap: 'Bootstrap nodes (one per line, host:port)',
      reachable: (nodes: number, ms: number, ip: string, nat: string) => `Reachable: ${nodes} nodes in ${ms} ms · public IP ${ip} · symmetric NAT: ${nat}`,
      ipUnknown: 'unknown',
      natUnknown: 'cannot be determined',
      natYes: 'YES (direct connections may fail with colleagues in the same situation)',
      natNo: 'no',
      unreachable: 'No node answered: server down, UDP port closed on the server, or this network blocks outgoing UDP.',
      checking: 'Checking…',
      check: 'Check',
      apply: 'Apply',
      applyConfirm: 'Yes, change network: every member must use the same one',
      reconnecting: 'Reconnecting…'
    },
    watch: {
      title: 'Automatic collection from Claude Code sessions',
      intro: 'Only sessions started in these folders (and subfolders) are processed. Everything still goes through the privacy filter.',
      teamNote: 'Folders belong to the team chosen in the sidebar: the sessions of a folder go to this team only (a folder belongs to one team only).',
      empty: 'No folder enabled.',
      enable: 'Enable',
      link: 'Connect Claude Code',
      linkConfirm: 'Yes, connect to this team',
      linkTitle: 'Claude Code started in this folder will use this team (MCP registration for this folder only)',
      linked: (url: string) => `Done: Claude Code started in this folder will use ${url}`
    },
    docs: {
      title: 'Document folders',
      intro1: 'PDF, Word, Excel, PowerPoint, OpenDocument and Markdown are distilled into memories (privacy filter included; folders such as “HR” or “contracts” are not even read).',
      intro2a: 'Only the distilled knowledge reaches the team: the original stays here and, if the folder is',
      shareableWord: 'shareable',
      intro2b: ', colleagues can download it on request.',
      intro3a: 'A',
      rootsWord: 'Roots folder',
      intro3b: '(architecture, policies, development rules…) turns its memories into Roots; diagrams are read too (draw.io, SVG, PlantUML, Mermaid).',
      empty: 'No document folder.',
      shareable: 'originals downloadable',
      distilledOnly: 'distilled only',
      rootsBadge: '◆ Roots',
      stat: { done: 'processed', queued: 'queued', blocked: 'blocked', failed: 'unreadable', removed: 'removed' } as Record<string, string>,
      rootsHint: 'Memories distilled from the documents of this folder become Roots (architecture, policies, rules…)',
      add: 'Add'
    },
    llm: {
      title: 'Intelligence (LLM)',
      shared: 'They apply to all the teams on this PC: one subscription, one call to Claude at a time, one daily limit.',
      inUse: (a: string) => `LLM in use: ${a}`,
      command: (c: string) => ` (command: ${c})`,
      adapter: {
        claude: 'Claude Code (the CLI installed on this PC): uses your subscription, no API key.',
        fake: 'FAKE, for demos and tests only: it does not call Claude, it classifies and distils with trivial rules on the text. The demo team uses it on purpose, so as not to consume the subscription.',
        none: 'None: no automatic classification or distillation, all doubtful cases go to the inbox.'
      } as Record<string, string>,
      change1: 'To change it edit',
      change2: 'in',
      change3: 'and restart the daemon.',
      classify: 'Model to classify (fast)',
      distill: 'Model to distil (more capable)',
      budget: 'Maximum calls per day',
      models: { haiku: 'Haiku: fast and cheap', sonnet: 'Sonnet: balanced', opus: 'Opus: the most capable, slower' } as Record<string, string>,
      other: 'Other…',
      modelName: (label: string) => `${label}: model name`,
      modelPlaceholder: 'model name or id, e.g. claude-opus-5-5'
    },
    ctx: {
      title: 'Automatic context for agents',
      intro: 'With Claude Code hooks (installed by "Configure" below), Micelio inserts useful knowledge into the conversation by itself, without waiting for the agent to look for it. It applies to all the teams on this PC.',
      sessionStart: 'At session start: Roots and most useful memories of the folder\'s project',
      prompt: 'At every request: memories and Roots relevant to the text (only if they really are, never repeated)',
      maxChars: 'Maximum characters inserted each time',
      save: 'Save'
    },
    cc: {
      title: 'Claude Code',
      intro1: 'Registers Micelio as an MCP server of Claude Code and, if you want, the hooks: at the end of a session they notify Micelio (automatic collection, only in enabled folders), at session start and at every request they insert the automatic context.',
      intro2: 'It changes the Claude Code configuration in your user profile; a backup copy is saved.',
      full: 'Configure MCP + collection + automatic context',
      fullConfirm: 'Yes, change the configuration',
      mcpOnly: 'MCP only',
      mcpOnlyConfirm: 'Yes, register MCP',
      done: (url: string) => `MCP server registered at ${url}.`,
      hook: (file: string) => ` Hook installed in ${file}.`
    }
  }
})

export function Settings () {
  const s = useStrings(S)
  return (
    <>
      <PageHeader help='settings' title={s.title} subtitle={s.subtitle} />
      <div className='stack'>
        <NetworkCard />
        <WatchCard />
        <DocumentsCard />
        <LlmCard />
        <ContextCard />
        <ClaudeCodeCard />
      </div>
    </>
  )
}

/**
 * Rete P2P: DHT pubblica di Holepunch o DHT privata del team (server/README.md).
 * - "Verifica" prova la scelta IN BOZZA senza cambiare nulla (ingresso, IP pubblico, NAT);
 * - "Applica" salva e ricollega subito il nodo, dopo una conferma: tutti i membri del team
 *   devono usare la stessa DHT, altrimenti non si trovano più.
 * I server privati restano salvati anche passando alla DHT pubblica.
 */
export function NetworkCard () {
  const s = useStrings(S)
  const t = s.net
  const client = useQueryClient()
  const net = useQuery({ queryKey: ['network'], queryFn: api.network })
  // Bozza: null = nessuna modifica rispetto a quanto salvato
  const [mode, setMode] = useState<NetworkMode | null>(null)
  const [text, setText] = useState<string | null>(null)
  const check = useMutation({ mutationFn: () => api.checkNetwork(draftMode, draftList) })
  const apply = useMutation({
    mutationFn: () => api.setNetwork(draftMode, draftMode === 'private' ? draftList : undefined),
    onSuccess: () => { setMode(null); setText(null); check.reset(); void client.invalidateQueries({ queryKey: ['network'] }); void client.invalidateQueries({ queryKey: ['status'] }) }
  })
  const n = net.data
  if (!n) return <Card help='settings#network' title={t.title}><ErrorBox error={net.error} /></Card>

  const draftMode = mode ?? n.mode
  // Un nodo per riga (accetta anche virgole e spazi come separatori)
  const draftList = (text ?? n.bootstrap.join('\n')).split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
  const changed = draftMode !== n.mode || (draftMode === 'private' && draftList.join(',') !== n.bootstrap.join(','))
  const inUse = n.mode === 'local' ? t.localInUse : n.active.length ? t.privateInUse(n.active.join(', ')) : t.publicInUse

  if (n.fixedByEnv) {
    return (
      <Card help='settings#network' title={t.title}>
        <div className='notice warn'>{t.fixed1} <span className='mono'>{n.fixedByEnv}</span>{t.fixed2} <code>MICELIO_DHT_BOOTSTRAP</code> {t.fixed3}</div>
      </Card>
    )
  }

  const c = check.data
  return (
    <Card help='settings#network' title={t.title}>
      <p className='muted' style={{ marginTop: 0 }}>
        {t.intro} {t.inUseNow} <strong>{inUse}</strong>.
      </p>
      <div className='stack'>
        <label className={`choice ${draftMode === 'public' ? 'selected' : ''}`}>
          <input type='radio' name='dht' checked={draftMode === 'public'} onChange={() => { setMode('public'); check.reset() }} />
          <span>
            <strong>{t.publicTitle}</strong> (Holepunch)<br />
            <span className='muted small'>{t.publicHint}</span>
          </span>
        </label>
        <label className={`choice ${draftMode === 'private' ? 'selected' : ''}`}>
          <input type='radio' name='dht' checked={draftMode === 'private'} onChange={() => { setMode('private'); check.reset() }} />
          <span>
            <strong>{t.privateTitle}</strong> {t.privateSub}<br />
            <span className='muted small'>{t.privateHint}</span>
          </span>
        </label>
        <label className={`choice ${draftMode === 'local' ? 'selected' : ''}`}>
          <input type='radio' name='dht' checked={draftMode === 'local'} onChange={() => { setMode('local'); check.reset() }} />
          <span>
            <strong>{t.localTitle}</strong> {t.localSub}<br />
            <span className='muted small'>{t.localHint}</span>
          </span>
        </label>
        {draftMode === 'private' && (
          <div>
            <label>{t.bootstrap}</label>
            <textarea rows={2} className='mono' value={text ?? n.bootstrap.join('\n')} onChange={(e) => { setText(e.target.value); check.reset() }} placeholder='203.0.113.10:49737' />
          </div>
        )}
      </div>

      {c && (
        <div className={`notice ${c.reachable ? (c.randomizedPort ? 'warn' : 'ok') : 'error'}`} style={{ marginTop: 10 }}>
          {c.reachable
            ? t.reachable(c.nodes, c.ms, c.publicHost ?? t.ipUnknown, c.randomizedPort === null ? t.natUnknown : c.randomizedPort ? t.natYes : t.natNo)
            : t.unreachable}
        </div>
      )}
      <ErrorBox error={check.error ?? apply.error} />
      <div className='row' style={{ marginTop: 10 }}>
        <button className='btn' disabled={check.isPending || draftMode === 'local' || (draftMode === 'private' && draftList.length === 0)} onClick={() => check.mutate()}>
          {check.isPending ? t.checking : t.check}
        </button>
        <ConfirmButton
          label={t.apply}
          confirmLabel={t.applyConfirm}
          onConfirm={() => apply.mutate()}
          disabled={!changed || apply.isPending || (draftMode === 'private' && draftList.length === 0)}
        />
        {changed && <button className='btn' onClick={() => { setMode(null); setText(null); check.reset() }}>{s.cancel}</button>}
        {apply.isPending && <span className='muted small'>{t.reconnecting}</span>}
      </div>
    </Card>
  )
}

/** Cartelle in cui le sessioni di Claude Code vengono raccolte (opt-in, D7). */
function WatchCard () {
  const s = useStrings(S)
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [path, setPath] = useState('')
  const refresh = () => void client.invalidateQueries({ queryKey: ['settings'] })
  const add = useMutation({ mutationFn: (p: string) => api.watchAdd(p), onSuccess: () => { setPath(''); refresh() } })
  const remove = useMutation({ mutationFn: (p: string) => api.watchRemove(p), onSuccess: refresh })
  // B3: Claude Code avviato nella cartella parla con QUESTO team (MCP in ambito "local")
  const link = useMutation({ mutationFn: (p: string) => api.setupProject(p) })

  /** Nell'app desktop usiamo il selettore di cartelle del sistema; nel browser si scrive il percorso. */
  const pick = async () => {
    const chosen = await window.micelio?.pickFolder?.()
    if (chosen) add.mutate(chosen)
  }

  return (
    <Card help='settings#watch' title={s.watch.title}>
      <p className='muted' style={{ marginTop: 0 }}>{s.watch.intro}</p>
      <p className='muted small'>{s.watch.teamNote} <HelpButton topic='teams#folders' /></p>
      {settings.data?.watched.length === 0 && <Empty>{s.watch.empty}</Empty>}
      <div className='list'>
        {settings.data?.watched.map((w) => (
          <div key={w} className='list-item row'>
            <span className='mono small' style={{ overflowWrap: 'anywhere' }}>{w}</span>
            <span className='spacer' />
            {/* I pulsanti restano insieme anche con percorsi lunghi */}
            <span className='row' style={{ flexShrink: 0, flexWrap: 'nowrap' }}>
              <span title={s.watch.linkTitle}><ConfirmButton label={s.watch.link} confirmLabel={s.watch.linkConfirm} disabled={link.isPending} onConfirm={() => link.mutate(w)} /></span>
              <button className='btn small' onClick={() => remove.mutate(w)}>{s.remove}</button>
            </span>
          </div>
        ))}
      </div>
      <div className='row' style={{ marginTop: 10 }}>
        {window.micelio?.pickFolder && <button className='btn' onClick={() => void pick()}>{s.pickFolder}</button>}
        <input style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} placeholder='C:\progetti\ordini' />
        <button className='btn primary' disabled={!path.trim() || add.isPending} onClick={() => add.mutate(path.trim())}>{s.watch.enable}</button>
      </div>
      <ErrorBox error={add.error ?? remove.error ?? link.error} />
      {link.data && <div className='notice ok small' style={{ marginTop: 10 }}>{s.watch.linked(link.data.mcpUrl)}</div>}
    </Card>
  )
}

/** Cartelle di documenti sorvegliate (Fase 4). */
function DocumentsCard () {
  const s = useStrings(S)
  const d = s.docs
  const client = useQueryClient()
  const docs = useQuery({ queryKey: ['documents'], queryFn: api.documents })
  const [path, setPath] = useState('')
  const [shareable, setShareable] = useState(false)
  const [rootsFolder, setRootsFolder] = useState(false)
  const refresh = () => void client.invalidateQueries({ queryKey: ['documents'] })
  const add = useMutation({ mutationFn: (p: string) => api.documentsAdd(p, shareable, rootsFolder), onSuccess: () => { setPath(''); refresh() } })
  const remove = useMutation({ mutationFn: (p: string) => api.documentsRemove(p), onSuccess: refresh })
  const pick = async () => {
    const chosen = await window.micelio?.pickFolder?.()
    if (chosen) add.mutate(chosen)
  }
  const stats = docs.data?.stats ?? {}

  return (
    <Card help='settings#documents' title={d.title}>
      <p className='muted' style={{ marginTop: 0 }}>
        {d.intro1} {d.intro2a} <strong>{d.shareableWord}</strong>{d.intro2b} {d.intro3a} <strong>{d.rootsWord}</strong> {d.intro3b}
      </p>
      {docs.data?.folders.length === 0 && <Empty>{d.empty}</Empty>}
      <div className='list'>
        {docs.data?.folders.map((f) => (
          <div key={f.path} className='list-item row'>
            <span className='mono small' style={{ overflowWrap: 'anywhere' }}>{f.path}</span>
            <span className={`badge ${f.shareable ? 'accent' : ''}`}>{f.shareable ? d.shareable : d.distilledOnly}</span>
            {f.roots && <span className='badge accent'>{d.rootsBadge}</span>}
            <span className='spacer' />
            <button className='btn small' onClick={() => remove.mutate(f.path)}>{s.remove}</button>
          </div>
        ))}
      </div>
      {Object.keys(stats).length > 0 && (
        <div className='row small' style={{ marginTop: 8 }}>
          {Object.entries(stats).map(([k, v]) => <span key={k} className='badge'>{d.stat[k] ?? k}: {v}</span>)}
        </div>
      )}
      <div className='row' style={{ marginTop: 10 }}>
        {window.micelio?.pickFolder && <button className='btn' onClick={() => void pick()}>{s.pickFolder}</button>}
        <input style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} placeholder='C:\\documenti\\architettura' />
        <label className='row' style={{ margin: 0, color: 'var(--text)' }}>
          <input type='checkbox' style={{ width: 'auto' }} checked={shareable} onChange={(e) => setShareable(e.target.checked)} /> {d.shareable}
        </label>
        <label className='row' style={{ margin: 0, color: 'var(--text)' }} title={d.rootsHint}>
          <input type='checkbox' style={{ width: 'auto' }} checked={rootsFolder} onChange={(e) => setRootsFolder(e.target.checked)} /> {d.rootsBadge}
        </label>
        <button className='btn primary' disabled={!path.trim() || add.isPending} onClick={() => add.mutate(path.trim())}>{d.add}</button>
      </div>
      <ErrorBox error={add.error ?? remove.error} />
    </Card>
  )
}

/**
 * Modelli proposti nelle tendine. Sono gli alias della CLI di Claude Code (`claude --model …`),
 * che puntano sempre all'ultima versione di ciascuna famiglia. Con «Altro…» si scrive qualunque
 * nome accettato dalla CLI (es. l'id completo di una versione precisa). Le etichette sono in S.
 */
export const MODEL_OPTIONS = ['haiku', 'sonnet', 'opus']

/**
 * Tendina di scelta del modello: alias noti più «Altro…», che mostra un campo libero.
 * Un valore già salvato che non è un alias noto (es. un id completo) apre direttamente «Altro…».
 */
export function ModelSelect ({ value, onChange, label }: { value: string, onChange: (v: string) => void, label: string }) {
  const s = useStrings(S).llm
  const known = MODEL_OPTIONS.includes(value)
  const [custom, setCustom] = useState(!known)
  return (
    <div style={{ flex: 1 }}>
      <label>{label}</label>
      <select
        aria-label={label}
        value={custom ? '__altro' : value}
        onChange={(e) => {
          if (e.target.value === '__altro') { setCustom(true); return }
          setCustom(false)
          onChange(e.target.value)
        }}
      >
        {MODEL_OPTIONS.map((o) => <option key={o} value={o}>{s.models[o]}</option>)}
        <option value='__altro'>{s.other}</option>
      </select>
      {custom && (
        <input
          style={{ marginTop: 6 }}
          aria-label={s.modelName(label)}
          value={known ? '' : value}
          placeholder={s.modelPlaceholder}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      )}
    </div>
  )
}

/** Modelli e budget giornaliero: hanno effetto subito, senza riavviare il daemon. */
function LlmCard () {
  const s = useStrings(S)
  const t = s.llm
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [draft, setDraft] = useState<{ classifyModel?: string, distillModel?: string, dailyBudget?: string }>({})
  const save = useMutation({
    mutationFn: () => api.updateLlm({
      classifyModel: draft.classifyModel,
      distillModel: draft.distillModel,
      dailyBudget: draft.dailyBudget !== undefined ? Number(draft.dailyBudget) : undefined
    }),
    onSuccess: () => { setDraft({}); void client.invalidateQueries({ queryKey: ['settings'] }) }
  })
  const llm = settings.data?.llm
  if (!llm) return null
  const changed = Object.keys(draft).length > 0

  return (
    <Card help='settings#llm' title={t.title}>
      <p className='muted small' style={{ marginTop: 0 }}>{t.shared}</p>
      <div className={`notice small ${llm.adapter === 'fake' ? 'warn' : ''}`} style={{ marginBottom: 10 }}>
        <strong>{t.inUse(llm.adapter)}</strong>{llm.adapter === 'claude' ? t.command(llm.command) : ''}. {t.adapter[llm.adapter] ?? ''}
        {' '}{t.change1} <code>llm.adapter</code> {t.change2} <code>config.json</code> {t.change3}
      </div>
      <div className='row' style={{ alignItems: 'flex-start' }}>
        <ModelSelect label={t.classify} value={draft.classifyModel ?? llm.classifyModel} onChange={(v) => setDraft({ ...draft, classifyModel: v })} />
        <ModelSelect label={t.distill} value={draft.distillModel ?? llm.distillModel} onChange={(v) => setDraft({ ...draft, distillModel: v })} />
        <div style={{ width: 200 }}>
          <label>{t.budget}</label>
          <input type='number' min={0} value={draft.dailyBudget ?? String(llm.dailyBudget)} onChange={(e) => setDraft({ ...draft, dailyBudget: e.target.value })} />
        </div>
      </div>
      <ErrorBox error={save.error} />
      <div className='row' style={{ marginTop: 10 }}>
        <button className='btn primary' disabled={!changed || save.isPending} onClick={() => save.mutate()}>{s.save}</button>
        {changed && <button className='btn' onClick={() => setDraft({})}>{s.cancel}</button>}
      </div>
    </Card>
  )
}

/** Contesto automatico per gli agenti (B4): cosa inseriscono gli hook di Claude Code. */
function ContextCard () {
  const t = useStrings(S).ctx
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [max, setMax] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (patch: { sessionStart?: boolean, prompt?: boolean, maxChars?: number }) => api.updateContext(patch),
    onSuccess: () => { setMax(null); void client.invalidateQueries({ queryKey: ['settings'] }) }
  })
  const c = settings.data?.context
  if (!c) return null
  return (
    <Card help='context' title={t.title}>
      <p className='muted' style={{ marginTop: 0 }}>{t.intro}</p>
      <div className='stack'>
        <label className='row'><input type='checkbox' checked={c.sessionStart} onChange={(e) => save.mutate({ sessionStart: e.target.checked })} /> {t.sessionStart}</label>
        <label className='row'><input type='checkbox' checked={c.prompt} onChange={(e) => save.mutate({ prompt: e.target.checked })} /> {t.prompt}</label>
        <div className='row'>
          <label style={{ margin: 0 }}>{t.maxChars}</label>
          <input type='number' min={500} max={20000} step={500} style={{ width: 110 }} value={max ?? c.maxChars} onChange={(e) => setMax(e.target.value)} />
          {max !== null && <button className='btn small primary' disabled={save.isPending} onClick={() => save.mutate({ maxChars: Number(max) })}>{t.save}</button>}
        </div>
      </div>
      <ErrorBox error={save.error} />
    </Card>
  )
}

/** Registra MCP e hook di fine sessione in Claude Code (come `micelio setup claude-code`). */
function ClaudeCodeCard () {
  const t = useStrings(S).cc
  const setup = useMutation({ mutationFn: (hook: boolean) => api.setupClaudeCode(hook) })
  return (
    <Card help='settings#claude-code' title={t.title}>
      <p className='muted' style={{ marginTop: 0 }}>{t.intro1} {t.intro2}</p>
      <div className='row'>
        <ConfirmButton label={t.full} confirmLabel={t.fullConfirm} onConfirm={() => setup.mutate(true)} disabled={setup.isPending} />
        <ConfirmButton label={t.mcpOnly} confirmLabel={t.mcpOnlyConfirm} onConfirm={() => setup.mutate(false)} disabled={setup.isPending} />
      </div>
      <ErrorBox error={setup.error} />
      {setup.data && (
        <div className='notice ok' style={{ marginTop: 10 }}>
          {t.done(setup.data.mcpUrl)}{setup.data.hookFile ? t.hook(setup.data.hookFile) : ''}
        </div>
      )}
    </Card>
  )
}
