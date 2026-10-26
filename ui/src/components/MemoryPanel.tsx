/**
 * @file Pannello di dettaglio di un ricordo, condiviso dalle viste a grafo (Nucleo 3D, Mappa 2D).
 * Il corpo si carica al momento dell'apertura (il grafo contiene solo titolo e metadati).
 *
 * EN: Detail panel of a memory, shared by the graph views (3D Nucleus, 2D Map).
 * The body is loaded when the panel opens (the graph holds only title and metadata).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CodeRefs, type GraphNode } from '../api/client'
import { dateTime, KIND_LABEL, ROOT_CATEGORY_LABEL, ROOT_CATEGORY_ORDER, short } from '../format'
import { defineStrings, useStrings } from '../i18n'
import { authorColor } from '../pages/colors'
import { HelpButton } from '../help'
import { Card, ConfirmButton, Empty, ErrorBox, Markdown, Meter } from './ui'

const S = defineStrings({
  it: {
    fromDocument: 'Da documento:',
    downloading: 'Download…',
    download: 'Scarica l’originale',
    show: 'Mostra',
    rootAsk: 'È sapere fondante (architettura, rete, interfacce, best practice, policy…)? Rendilo una',
    rootWord: 'Radice',
    rootNever: ': non verrà mai dimenticato.',
    makeRoot: 'Rendi Radice',
    rootTitle: (cat: string) => `Radice · ${cat}`,
    toReview: 'da rivedere',
    reviewed: (d: string) => `rivista il ${d}`,
    stillValid: 'Rivista: è ancora valida',
    changeCategory: 'Cambia categoria',
    notRoot: 'Non è più una Radice',
    adminOnly: 'In questo team solo gli admin creano e tolgono le Radici. Se pensi che questo ricordo lo meriti, chiedilo a un admin.',
    fromCode: 'Dal codice:',
    project: 'progetto',
    repository: 'repository',
    files: 'File',
    symbols: 'Simboli',
    commits: 'Commit',
    activation: 'Attivazione',
    usage: (uses: number, votes: string) => `${uses} usi · voti ${votes}`,
    usefulTimes: (n: number) => ` · utile ${n} ${n === 1 ? 'volta' : 'volte'} agli agenti del team`,
    useful: 'Utile',
    misleading: 'Fuorviante o obsoleto',
    unpin: 'Sblocca',
    pin: 'Fissa: non decade e non viene archiviato',
    close: 'Chiudi',
    loading: 'Caricamento…',
    author: 'Autore',
    written: 'Scritto il',
    document: 'documento',
    openInSearch: 'Apri nella ricerca →',
    personal: 'Ricordo personale: sta solo su questo PC, il team non lo vede. Gli agenti lo trovano nelle tue ricerche.',
    share: 'Condividi con il team',
    shareConfirm: 'Sì, condividi (passa dal filtro)',
    shared: (o: string): string => o === 'team' ? 'Condiviso con il team.' : o === 'inbox' ? 'Messo in inbox per una verifica.' : 'Non condiviso: il filtro lo trattiene come privato.',
    remove: 'Cancella',
    removeConfirm: 'Sì, cancella',
    stale: (commits: number, missing: number) => `Il codice citato è cambiato dopo questo ricordo: ${commits} commit sui file citati${missing ? `, ${missing} file non più presenti` : ''}. Verifica sul codice attuale prima di fidarti.`,
    hard: (errors: number, minutes: number) => `Nato da una sessione difficile: ${errors} errori, ${minutes} minuti. Parte con un po' più di peso, che si perde se nessuno lo usa.`,
    habituation: (streak: number, pct: number) => `Fornito agli agenti ${streak} volte di fila senza servire: nel contesto automatico ora pesa il ${pct}%, nelle ricerche un po' di più. Torna al pieno appena serve una volta.`
  },
  en: {
    fromDocument: 'From document:',
    downloading: 'Downloading…',
    download: 'Download the original',
    show: 'Show',
    rootAsk: 'Is this foundational knowledge (architecture, network, interfaces, best practices, policies…)? Make it a',
    rootWord: 'Root',
    rootNever: ': it will never be forgotten.',
    makeRoot: 'Make it a Root',
    rootTitle: (cat: string) => `Root · ${cat}`,
    toReview: 'to review',
    reviewed: (d: string) => `reviewed on ${d}`,
    stillValid: 'Reviewed: still valid',
    changeCategory: 'Change category',
    notRoot: 'No longer a Root',
    adminOnly: 'In this team only admins create and remove Roots. If you think this memory deserves it, ask an admin.',
    fromCode: 'From code:',
    project: 'project',
    repository: 'repository',
    files: 'Files',
    symbols: 'Symbols',
    commits: 'Commits',
    activation: 'Activation',
    usage: (uses: number, votes: string) => `${uses} uses · votes ${votes}`,
    usefulTimes: (n: number) => ` · useful ${n} ${n === 1 ? 'time' : 'times'} to the team's agents`,
    useful: 'Useful',
    misleading: 'Misleading or outdated',
    unpin: 'Unpin',
    pin: 'Pin: it never decays and is never archived',
    close: 'Close',
    loading: 'Loading…',
    author: 'Author',
    written: 'Written on',
    document: 'document',
    openInSearch: 'Open in search →',
    personal: 'Personal memory: it lives only on this PC, the team does not see it. Agents find it in your searches.',
    share: 'Share with the team',
    shareConfirm: 'Yes, share (goes through the filter)',
    shared: (o: string): string => o === 'team' ? 'Shared with the team.' : o === 'inbox' ? 'Sent to the inbox for a check.' : 'Not shared: the filter keeps it private.',
    remove: 'Delete',
    removeConfirm: 'Yes, delete',
    stale: (commits: number, missing: number) => `The cited code changed after this memory: ${commits} commits on the cited files${missing ? `, ${missing} files no longer present` : ''}. Check the current code before trusting it.`,
    hard: (errors: number, minutes: number) => `Born from a hard session: ${errors} errors, ${minutes} minutes. It starts with a bit more weight, which fades if nobody uses it.`,
    habituation: (streak: number, pct: number) => `Delivered to agents ${streak} times in a row without helping: in automatic context it now weighs ${pct}%, a bit more in searches. It goes back to full as soon as it helps once.`
  }
})

/**
 * Riquadro "documento originale" (Fase 4): il ricordo è stato distillato da un documento, che si
 * può scaricare dal collega che lo possiede (deve essere online e condividere quella cartella).
 *
 * EN: "Original document" box (Phase 4): the memory was distilled from a document, which can be
 * downloaded from the colleague who owns it (they must be online and share that folder).
 */
function SourceBox ({ id, name, size }: { id: string, name: string, size?: number }) {
  const s = useStrings(S)
  const fetchIt = useMutation({ mutationFn: () => api.fetchSource(id) })
  return (
    <div className='notice small' style={{ marginTop: 12 }}>
      <div className='row'>
        <span>📄 {s.fromDocument} <strong>{name}</strong>{size ? ` · ${Math.max(1, Math.round(size / 1024))} KB` : ''}</span>
        <span className='spacer' />
        <button className='btn small' disabled={fetchIt.isPending} onClick={() => fetchIt.mutate()}>{fetchIt.isPending ? s.downloading : s.download}</button>
      </div>
      <ErrorBox error={fetchIt.error} />
      {fetchIt.data && (
        <div className='row' style={{ marginTop: 6 }}>
          <span className='mono' style={{ overflowWrap: 'anywhere' }}>{fetchIt.data.path}</span>
          {window.micelio?.showInFolder && <button className='btn small' onClick={() => void window.micelio!.showInFolder!(fetchIt.data!.path)}>{s.show}</button>}
        </div>
      )}
    </div>
  )
}

/**
 * Riquadro "Radice" (Fase 8). Per una Radice: categoria, stato di revisione con i motivi, e le
 * azioni (confermare dopo averla rivista, cambiare categoria, togliere). Per un ricordo normale:
 * "Rendi Radice" con la scelta della categoria. Qualunque membro può farlo, salvo che il team abbia
 * scelto «Radici solo per gli admin» (0.6.2).
 *
 * EN: "Root" box (Phase 8). For a Root: category, review status with the reasons, and the
 * actions (confirm after reviewing it, change category, remove). For a normal memory:
 * "Make it a Root" with the category choice. Any member can do it, unless the team chose "Roots for
 * admins only" (0.6.2).
 */
function RootBox ({ id, root }: { id: string, root?: { category: string, status: 'ok' | 'review' } }) {
  const s = useStrings(S)
  const client = useQueryClient()
  const [category, setCategory] = useState<string>(root?.category ?? 'architecture')
  const refresh = () => {
    for (const k of [['memories'], ['roots'], ['graph'], ['rootSuggestions']]) void client.invalidateQueries({ queryKey: k })
  }
  const detail = useQuery({ queryKey: ['roots', 'one', id], queryFn: async () => (await api.roots()).find((r) => r.id === id) ?? null, enabled: !!root })
  const set = useMutation({ mutationFn: (c: string) => api.rootSet(id, c), onSuccess: refresh })
  const unset = useMutation({ mutationFn: () => api.rootUnset(id), onSuccess: refresh })
  const confirm = useMutation({ mutationFn: () => api.rootConfirm(id), onSuccess: refresh })
  // «Radici solo per gli admin» (0.6.2): un membro vede la spiegazione invece dei pulsanti
  // EN: "Roots for admins only" (0.6.2): a member sees the explanation instead of the buttons
  const cfg = useQuery({ queryKey: ['teamConfig'], queryFn: api.teamConfig })
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const locked = !!cfg.data?.rootsAdminOnly && !!status.data && status.data.role !== 'admin'
  const select = (
    <select style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)}>
      {ROOT_CATEGORY_ORDER.map((c) => <option key={c} value={c}>{ROOT_CATEGORY_LABEL[c]}</option>)}
    </select>
  )

  if (!root) {
    return (
      <div className='notice small' style={{ marginTop: 12 }}>
        <div style={{ marginBottom: 6 }}>◆ {s.rootAsk} <strong>{s.rootWord}</strong>{s.rootNever}</div>
        {locked
          ? <div className='muted'>{s.adminOnly} <HelpButton topic='roots#admin-only' /></div>
          : (
            <div className='row'>
              {select}
              <button className='btn small primary' disabled={set.isPending} onClick={() => set.mutate(category)}>{s.makeRoot}</button>
            </div>
            )}
        <ErrorBox error={set.error} />
      </div>
    )
  }
  const flags = detail.data?.flags ?? []
  return (
    <div className={`notice small ${root.status === 'review' ? 'warn' : ''}`} style={{ marginTop: 12 }}>
      <div className='row'>
        <span className={`root-mark ${root.status}`} aria-hidden>◆</span>
        <strong>{s.rootTitle(ROOT_CATEGORY_LABEL[root.category] ?? root.category)}</strong>
        {root.status === 'review' && <span className='badge danger'>{s.toReview}</span>}
        {detail.data && <span className='muted'>{s.reviewed(dateTime(detail.data.reviewedAt))}</span>}
      </div>
      {flags.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{flags.map((f, i) => <li key={i}>{f.reason}{f.refs.length ? <span className='muted mono'> ({f.refs.slice(0, 4).join(', ')})</span> : null}</li>)}</ul>}
      <div className='row' style={{ marginTop: 8 }}>
        {root.status === 'review' && <button className='btn small primary' disabled={confirm.isPending} onClick={() => confirm.mutate()}>{s.stillValid}</button>}
        {!locked && select}
        {!locked && <button className='btn small' disabled={set.isPending || category === root.category} onClick={() => set.mutate(category)}>{s.changeCategory}</button>}
        {!locked && <button className='btn small' disabled={unset.isPending} onClick={() => unset.mutate()}>{s.notRoot}</button>}
      </div>
      <ErrorBox error={set.error ?? unset.error ?? confirm.error} />
    </div>
  )
}

/**
 * Indirizzo web di un commit, se il remote è un URL https (GitHub, GitLab, Azure DevOps e Bitbucket
 * accettano tutti la forma `<repo>/commit/<hash>`); null per remote ssh o sconosciuti.
 *
 * EN: Web address of a commit, if the remote is an https URL (GitHub, GitLab, Azure DevOps and Bitbucket
 * all accept the `<repo>/commit/<hash>` form); null for ssh or unknown remotes.
 */
function commitUrl (repo: string | undefined, hash: string): string | null {
  if (!repo || !/^https?:\/\//.test(repo)) return null
  return `${repo.replace(/\.git$/, '').replace(/\/+$/, '')}/commit/${hash}`
}

/**
 * Riquadro "riferimenti al codice": il ricordo è stato distillato da una sessione di sviluppo e dice
 * dove approfondire (progetto, branch, file, simboli, commit). I commit, se il repository è su un
 * server web, sono link alla pagina del commit.
 *
 * EN: "Code references" box: the memory was distilled from a development session and says
 * where to dig deeper (project, branch, files, symbols, commits). Commits, if the repository is on a
 * web server, link to the commit page.
 */
function CodeBox ({ code }: { code: CodeRefs }) {
  const s = useStrings(S)
  const repoUrl = code.repo && /^https?:\/\//.test(code.repo) ? code.repo : null
  return (
    <div className='notice small' style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 4 }}>
        🧩 {s.fromCode} <strong>{code.project ?? s.project}</strong>
        {code.branch && <span className='muted'> · branch <span className='mono'>{code.branch}</span></span>}
        {code.repo && (repoUrl
          ? <> · <a href={repoUrl} target='_blank' rel='noreferrer'>{s.repository}</a></>
          : <span className='muted mono'> · {code.repo}</span>)}
      </div>
      <dl className='kv' style={{ margin: 0 }}>
        {code.files.length > 0 && <><dt>{s.files}</dt><dd>{code.files.map((f) => <div key={f} className='mono' style={{ overflowWrap: 'anywhere' }}>{f}</div>)}</dd></>}
        {code.symbols.length > 0 && <><dt>{s.symbols}</dt><dd>{code.symbols.map((sym) => <span key={sym} className='badge mono' style={{ marginRight: 4 }}>{sym}</span>)}</dd></>}
        {code.commits.length > 0 && (
          <><dt>{s.commits}</dt><dd>{code.commits.map((c) => {
            const url = commitUrl(code.repo, c)
            return <span key={c} className='mono' style={{ marginRight: 8 }} title={`git show ${c}`}>{url ? <a href={url} target='_blank' rel='noreferrer'>{c.slice(0, 8)}</a> : c.slice(0, 8)}</span>
          })}</dd></>
        )}
      </dl>
    </div>
  )
}

/**
 * Priorità del ricordo (Fase 5): attivazione, usi, voti e pin. I voti e il pin sono segnali per
 * tutto il team: i ricordi utili salgono nelle ricerche, quelli fissati non decadono mai.
 *
 * EN: Memory priority (Phase 5): activation, uses, votes and pin. Votes and pin are signals for
 * the whole team: useful memories rise in searches, pinned ones never decay.
 */
function Signals ({ id, activation, votes, uses, useful = 0, pinned }: { id: string, activation: number, votes: number, uses: number, useful?: number, pinned: boolean }) {
  const s = useStrings(S)
  const client = useQueryClient()
  const refresh = () => { void client.invalidateQueries({ queryKey: ['memories'] }); void client.invalidateQueries({ queryKey: ['graph'] }) }
  const vote = useMutation({ mutationFn: (d: -1 | 0 | 1) => api.vote(id, d), onSuccess: refresh })
  const pin = useMutation({ mutationFn: () => api.pin(id, !pinned), onSuccess: refresh })
  return (
    <div style={{ marginTop: 12 }}>
      <div className='row small'><span>{s.activation}</span><span className='spacer' /><span>{Math.round(activation * 100)}%</span></div>
      <Meter value={activation} max={1} />
      <div className='row small' style={{ marginTop: 8 }}>
        {/* B11: utilità per gli agenti (confermata a fine sessione), sommata su tutto il team / EN: B11: usefulness to agents (confirmed at session end), summed over the whole team */}
        <span className='muted'>{s.usage(uses, `${votes > 0 ? '+' : ''}${votes}`)}{useful > 0 ? s.usefulTimes(useful) : ''}</span>
        <span className='spacer' />
        <button className='btn small' title={s.useful} onClick={() => vote.mutate(1)}>👍</button>
        <button className='btn small' title={s.misleading} onClick={() => vote.mutate(-1)}>👎</button>
        <button className={`btn small ${pinned ? 'primary' : ''}`} title={pinned ? s.unpin : s.pin} onClick={() => pin.mutate()}>📌</button>
      </div>
      <ErrorBox error={vote.error ?? pin.error} />
    </div>
  )
}

/** Ricordo personale (B4): solo su questo PC; si condivide con il team o si cancella. / EN: Personal memory (B4): only on this PC; it can be shared with the team or deleted. */
function PersonalBox ({ id, onDone }: { id: string, onDone: () => void }) {
  const s = useStrings(S)
  const client = useQueryClient()
  const refresh = () => { void client.invalidateQueries({ queryKey: ['memories'] }); void client.invalidateQueries({ queryKey: ['personal'] }) }
  const share = useMutation({ mutationFn: () => api.sharePersonal(id), onSuccess: refresh })
  const remove = useMutation({ mutationFn: () => api.deletePersonal(id), onSuccess: () => { refresh(); onDone() } })
  return (
    <div className='notice small' style={{ marginTop: 10 }}>
      <div>🔒 {s.personal} <HelpButton topic='solo#personal' /></div>
      <div className='row' style={{ marginTop: 8 }}>
        <ConfirmButton label={s.share} confirmLabel={s.shareConfirm} disabled={share.isPending || !!share.data} onConfirm={() => share.mutate()} />
        <ConfirmButton label={s.remove} confirmLabel={s.removeConfirm} danger disabled={remove.isPending} onConfirm={() => remove.mutate()} />
      </div>
      {share.data && <div style={{ marginTop: 6 }}>{s.shared(share.data.outcome)}</div>}
      <ErrorBox error={share.error ?? remove.error} />
    </div>
  )
}

export function MemoryPanel ({ node, onClose }: { node: GraphNode, onClose: () => void }) {
  const s = useStrings(S)
  const full = useQuery({ queryKey: ['memories', 'one', node.id], queryFn: () => api.memory(node.id) })
  // I campi si prendono dal ricordo completo appena è caricato: aperto da un link (#/memoria?id=…)
  // il nodo di partenza ha solo l'id
  // EN: Fields come from the full memory as soon as it loads: when opened from a link (#/memoria?id=…)
  //     the starting node has only the id
  const m = full.data ?? node
  return (
    <Card title={m.title} actions={<button className='btn small' onClick={onClose} aria-label={s.close}>✕</button>}>
      <div className='row small' style={{ marginBottom: 10 }}>
        <span className='badge accent'>{KIND_LABEL[m.kind] ?? m.kind}</span>
        {m.tags.map((t) => <span key={t} className='badge'>#{t}</span>)}
      </div>
      {full.data ? <Markdown text={full.data.body} /> : <Empty>{s.loading}</Empty>}
      <dl className='kv small' style={{ marginTop: 12 }}>
        <dt>{s.author}</dt><dd><span className='dot' style={{ background: authorColor(m.author), marginRight: 6 }} />{m.authorName ?? short(m.author)}</dd>
        <dt>{s.written}</dt><dd>{dateTime(m.ts)}</dd>
      </dl>
      {full.data?.stale && (
        <div className='notice warn small' style={{ marginTop: 10 }}>{s.stale(full.data.stale.commits, full.data.stale.missing)} <HelpButton topic='memory#stale' /></div>
      )}
      {/* B12: scoperta sudata (soglia HARD_EFFORT di src/ingest/effort.ts) / EN: B12: hard-won discovery (HARD_EFFORT threshold in src/ingest/effort.ts) */}
      {(full.data?.source?.effort?.score ?? 0) >= 0.5 && (
        <div className='notice small' style={{ marginTop: 10 }}>{s.hard(full.data!.source!.effort!.errors, full.data!.source!.effort!.minutes)} <HelpButton topic='priority#effort' /></div>
      )}
      {/* B12: abituazione, il ricordo viene proposto meno / EN: B12: habituation, the memory is offered less */}
      {full.data?.habituation && (
        <div className='notice small' style={{ marginTop: 10 }}>{s.habituation(full.data.habituation.streak, Math.round(full.data.habituation.factor * 100))} <HelpButton topic='efficacy#habituation' /></div>
      )}
      {full.data?.personal && <PersonalBox id={node.id} onDone={onClose} />}
      {full.data && !full.data.personal && <Signals id={node.id} activation={full.data.activation ?? 0} votes={full.data.votes ?? 0} uses={full.data.uses ?? 0} useful={full.data.useful ?? 0} pinned={!!full.data.pinned} />}
      {full.data && !full.data.personal && <RootBox key={`${node.id}-${full.data.root?.category ?? ''}`} id={node.id} root={full.data.root} />}
      {full.data?.source?.code && <CodeBox code={full.data.source.code} />}
      {full.data?.source?.type === 'document' && <SourceBox id={node.id} name={full.data.source.name ?? s.document} size={full.data.source.size} />}
      <p className='small' style={{ marginBottom: 0 }}><Link to='/memoria'>{s.openInSearch}</Link></p>
    </Card>
  )
}
