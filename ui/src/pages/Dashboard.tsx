/**
 * @file Stato del nodo: tutto a colpo d'occhio (attività 3.4).
 * Nodo e team, rete, sapere, LLM e budget, coda di ingestione, inbox, cartelle abilitate,
 * spazio occupato (totale e quota di ciascun membro).
 * Tutti i dati si aggiornano da soli grazie agli eventi SSE (api/live.ts).
 */
import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api, type StorageReport } from '../api/client'
import { Card, ErrorBox, Meter, PageHeader } from '../components/ui'
import { bytes, percent, short } from '../format'
import { defineStrings, useStrings } from '../i18n'
import { authorColor, registerAuthors } from './colors'

const S = defineStrings({
  it: {
    title: 'Stato del nodo',
    team: (name: string) => `Team «${name}»`,
    thisNode: 'Questo nodo',
    name: 'Nome',
    key: 'Chiave',
    role: 'Ruolo',
    notWriter: 'non writer',
    network: 'Rete',
    peers: 'peer connessi',
    noPeers: 'Nessun altro membro online: il nodo riprova da solo ogni pochi secondi.',
    syncing: 'Sincronizzazione attiva.',
    members: (n: number) => `${n} membri attivi →`,
    knowledge: 'Sapere del team',
    memoriesHere: 'ricordi su questo nodo',
    search: 'Cerca →',
    llm: 'Intelligenza (LLM)',
    available: 'disponibile',
    unavailable: 'NON disponibile',
    callsToday: 'Chiamate di oggi',
    noLlm: 'Nessun LLM configurato: i casi dubbi vanno tutti in inbox.',
    collection: 'Raccolta automatica',
    queued: 'in coda',
    done: 'completati',
    failed: 'falliti',
    folders: (n: number) => `${n} cartelle abilitate.`,
    noFolders: 'Nessuna cartella abilitata.',
    manage: 'Gestisci →',
    inbox: 'Inbox',
    waiting: 'ricordi in attesa di una tua decisione',
    decide: 'Decidi →',
    storage: 'Spazio occupato',
    onDisk: (log: string) => `su questo disco · log del team ${log}`,
    byMember: 'Provenienza del sapere per membro',
    noData: 'Nessun dato ancora: il log del team è vuoto.',
    barLabel: 'Quota del log del team per membro',
    member: 'Membro',
    share: 'Quota',
    log: 'Log',
    activeMemories: 'Ricordi attivi',
    memoryText: 'Testo dei ricordi',
    left: ' (uscito)',
    shareNote: 'La quota è la parte del log del team scritta da ciascun membro: ricordi, ma anche voti, uso e sogni. È uguale su ogni PC, perché ogni nodo conserva tutto.',
    thisDisk: 'Su questo disco',
    parts: {
      log: ['Log del team', 'feed replicati di tutti i membri, cifrati'],
      index: ['Indice di ricerca', 'parole chiave e vettori; si ricostruisce dal log'],
      private: ['Archivio privato', 'inbox, registro, coda: non lascia mai il PC'],
      cache: ['Documenti scaricati', 'originali chiesti ai colleghi, tenuti 30 giorni'],
      export: ['Export Markdown', 'copia in sola lettura']
    } as Record<string, [string, string]>
  },
  en: {
    title: 'Node status',
    team: (name: string) => `Team “${name}”`,
    thisNode: 'This node',
    name: 'Name',
    key: 'Key',
    role: 'Role',
    notWriter: 'not a writer',
    network: 'Network',
    peers: 'connected peers',
    noPeers: 'No other member online: the node keeps retrying every few seconds.',
    syncing: 'Synchronising.',
    members: (n: number) => `${n} active members →`,
    knowledge: 'Team knowledge',
    memoriesHere: 'memories on this node',
    search: 'Search →',
    llm: 'Intelligence (LLM)',
    available: 'available',
    unavailable: 'NOT available',
    callsToday: 'Calls today',
    noLlm: 'No LLM configured: all doubtful cases go to the inbox.',
    collection: 'Automatic collection',
    queued: 'queued',
    done: 'done',
    failed: 'failed',
    folders: (n: number) => `${n} enabled folders.`,
    noFolders: 'No folder enabled.',
    manage: 'Manage →',
    inbox: 'Inbox',
    waiting: 'memories waiting for your decision',
    decide: 'Decide →',
    storage: 'Disk usage',
    onDisk: (log: string) => `on this disk · team log ${log}`,
    byMember: 'Where the knowledge comes from, by member',
    noData: 'No data yet: the team log is empty.',
    barLabel: 'Share of the team log by member',
    member: 'Member',
    share: 'Share',
    log: 'Log',
    activeMemories: 'Active memories',
    memoryText: 'Memory text',
    left: ' (left)',
    shareNote: 'The share is the part of the team log written by each member: memories, but also votes, usage and dreams. It is the same on every PC, because every node keeps everything.',
    thisDisk: 'On this disk',
    parts: {
      log: ['Team log', 'replicated feeds of all members, encrypted'],
      index: ['Search index', 'keywords and vectors; rebuilt from the log'],
      private: ['Private store', 'inbox, log, queue: never leaves the PC'],
      cache: ['Downloaded documents', 'originals requested from colleagues, kept 30 days'],
      export: ['Markdown export', 'read-only copy']
    } as Record<string, [string, string]>
  }
})

export function Dashboard () {
  const t = useStrings(S)
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const ingest = useQuery({ queryKey: ['ingest'], queryFn: api.ingestStatus })
  const s = status.data
  const i = ingest.data

  return (
    <>
      <PageHeader help='status' title={t.title} subtitle={s?.team ? t.team(s.team.name) : undefined} />
      <ErrorBox error={status.error ?? ingest.error} />
      {s && (
        <div className='grid'>
          <Card help='status#cards' title={t.thisNode}>
            <dl className='kv'>
              <dt>{t.name}</dt><dd>{s.nodeName}</dd>
              <dt>{t.key}</dt><dd className='mono'>{short(s.nodeKey)}</dd>
              <dt>{t.role}</dt>
              <dd>
                <span className={`badge ${s.role === 'admin' ? 'accent' : ''}`}>{s.role ?? '–'}</span>{' '}
                {s.indexer && <span className='badge'>indexer</span>}{' '}
                {!s.writable && <span className='badge danger'>{t.notWriter}</span>}
              </dd>
            </dl>
          </Card>

          <Card help='p2p#connection' title={t.network}>
            <div className='row'>
              <span className={`dot ${s.peers > 0 ? 'on' : ''}`} />
              <span className='stat'>{s.peers}</span>
              <span className='muted'>{t.peers}</span>
            </div>
            <p className='muted small' style={{ marginBottom: 0 }}>{s.peers === 0 ? t.noPeers : t.syncing}</p>
            <p style={{ marginBottom: 0 }}><Link to='/team'>{t.members(s.members)}</Link></p>
          </Card>

          <Card help='memory' title={t.knowledge}>
            <div className='stat'>{s.memories}</div>
            <div className='muted'>{t.memoriesHere}</div>
            <p style={{ marginBottom: 0 }}><Link to='/memoria'>{t.search}</Link></p>
          </Card>

          <Card help='settings#llm' title={t.llm}>
            {i?.llm
              ? (
                <div className='stack'>
                  <div className='row'>
                    <span className={`dot ${i.llm.available ? 'on' : ''}`} />
                    <span>{i.llm.adapter}</span>
                    <span className='muted'>{i.llm.available ? t.available : t.unavailable}</span>
                  </div>
                  <div>
                    <div className='row small'><span>{t.callsToday}</span><span className='spacer' /><span>{i.llm.budget.used} / {i.llm.budget.limit}</span></div>
                    <Meter value={i.llm.budget.used} max={i.llm.budget.limit} />
                  </div>
                </div>
                )
              : <p className='muted'>{t.noLlm}</p>}
          </Card>

          <Card help='ingestion#queue' title={t.collection}>
            <div className='row'>
              <span className='badge'>{t.queued}: {i?.jobs.pending ?? 0}</span>
              <span className='badge accent'>{t.done}: {i?.jobs.done ?? 0}</span>
              {(i?.jobs.failed ?? 0) > 0 && <span className='badge danger'>{t.failed}: {i?.jobs.failed}</span>}
            </div>
            <p className='muted small'>
              {i?.watched.length ? t.folders(i.watched.length) : t.noFolders}{' '}
              <Link to='/impostazioni'>{t.manage}</Link>
            </p>
          </Card>

          <Card help='inbox' title={t.inbox}>
            <div className='stat'>{i?.inbox ?? 0}</div>
            <div className='muted'>{t.waiting}</div>
            {(i?.inbox ?? 0) > 0 && <p style={{ marginBottom: 0 }}><Link to='/inbox'>{t.decide}</Link></p>}
          </Card>

          {/* Occupa tutta la riga: la ripartizione per membro ha bisogno di spazio */}
          <div style={{ gridColumn: '1 / -1' }}><StorageCard /></div>
        </div>
      )}
    </>
  )
}

/** Componenti su disco, nell'ordine in cui si mostrano (le etichette sono in S.parts). */
const DISK_PARTS: (keyof StorageReport['disk'])[] = ['log', 'index', 'private', 'cache', 'export']

/**
 * Spazio occupato dal sapere: totale su questo disco, ripartizione per componente e, soprattutto,
 * quanto del log del team viene da ciascun membro. Ogni nodo replica tutto, quindi la
 * ripartizione per membro è la stessa su ogni PC del team.
 */
export function StorageCard () {
  const t = useStrings(S)
  const storage = useQuery({ queryKey: ['storage'], queryFn: api.storage })
  const r = storage.data
  // Stessi colori di Nucleo e Mappa: lì il registro contiene gli autori di almeno un ricordo.
  useMemo(() => { if (r) registerAuthors(r.members.filter((m) => m.memories > 0).map((m) => m.key)) }, [r])
  if (!r) return <Card help='status#storage' title={t.storage}><ErrorBox error={storage.error} /></Card>
  const shown = r.members.filter((m) => m.bytes > 0)

  return (
    <Card help='status#storage' title={t.storage}>
      <div className='row' style={{ alignItems: 'baseline' }}>
        <span className='stat'>{bytes(r.disk.total)}</span>
        <span className='muted'>{t.onDisk(bytes(r.teamLogBytes))}</span>
      </div>

      <h4 style={{ margin: '14px 0 6px' }}>{t.byMember}</h4>
      {shown.length === 0
        ? <p className='muted small'>{t.noData}</p>
        : (
          <>
            {/* Barra a segmenti: larghezza = quota del log del team */}
            <div className='storage-bar' role='img' aria-label={t.barLabel}>
              {shown.map((m) => (
                <div key={m.key} title={`${m.name}: ${percent(m.share)}`} style={{ width: `${m.share * 100}%`, background: authorColor(m.key) }} />
              ))}
            </div>
            <table className='small' style={{ marginTop: 8 }}>
              <thead>
                <tr><th>{t.member}</th><th className='num'>{t.share}</th><th className='num'>{t.log}</th><th className='num'>{t.activeMemories}</th><th className='num'>{t.memoryText}</th></tr>
              </thead>
              <tbody>
                {r.members.map((m) => (
                  <tr key={m.key} className={m.removed ? 'muted' : ''}>
                    <td><span className='dot' style={{ background: authorColor(m.key), marginRight: 6 }} />{m.name}{m.removed && t.left}</td>
                    <td className='num'><strong>{percent(m.share)}</strong></td>
                    <td className='num'>{bytes(m.bytes)}</td>
                    <td className='num'>{m.memories}</td>
                    <td className='num'>{bytes(m.memoryBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className='muted small' style={{ marginBottom: 0 }}>{t.shareNote}</p>
          </>
          )}

      <h4 style={{ margin: '14px 0 6px' }}>{t.thisDisk}</h4>
      <dl className='kv small' style={{ margin: 0 }}>
        {DISK_PARTS.map((key) => (
          <Fragment key={key}>
            <dt>{t.parts[key][0]}</dt>
            <dd>{bytes(r.disk[key])} <span className='muted'>· {t.parts[key][1]}</span></dd>
          </Fragment>
        ))}
      </dl>
    </Card>
  )
}
