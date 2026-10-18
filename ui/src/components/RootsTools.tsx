/**
 * @file Radici fuori da Micelio (B4), in fondo alla pagina Radici:
 * - **File per gli agenti**: le Radici di un progetto scritte in CLAUDE.md, AGENTS.md o nelle
 *   regole di Cursor della cartella, e tenute aggiornate (src/roots/agent-files.ts);
 * - **Importa**: ADR, CLAUDE.md / AGENTS.md o un vault Markdown diventano Radici (src/roots/import.ts).
 * Nell'app desktop la cartella si sceglie con il selettore del sistema; nel browser si scrive.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { type AgentFileFormat, api } from '../api/client'
import { ROOT_CATEGORY_LABEL, ROOT_CATEGORY_ORDER } from '../format'
import { defineStrings, useStrings } from '../i18n'
import { Card, ConfirmButton, Empty, ErrorBox } from './ui'

const FORMATS: AgentFileFormat[] = ['claude', 'agents', 'cursor']

const S = defineStrings({
  it: {
    filesTitle: 'File per gli agenti',
    filesIntro: 'Le Radici del progetto scritte nei file che gli agenti leggono da soli a ogni sessione. Micelio scrive solo nel suo blocco (fra i marcatori micelio:start e micelio:end) e lo aggiorna quando le Radici cambiano; il resto del file non si tocca.',
    format: { claude: 'CLAUDE.md (Claude Code)', agents: 'AGENTS.md (Codex e altri)', cursor: 'Regole di Cursor (.cursor/rules)' } as Record<AgentFileFormat, string>,
    folder: 'Cartella del progetto (di solito la radice del repository)',
    pick: 'Scegli…',
    project: 'Progetto (vuoto = nome del repository o della cartella)',
    write: 'Scrivi e tieni aggiornato',
    written: (file: string, changed: boolean) => `${changed ? 'Scritto' : 'Già aggiornato'}: ${file}`,
    none: 'Nessun file tenuto aggiornato.',
    missing: 'file non presente',
    stop: 'Smetti di aggiornare',
    stopConfirm: 'Sì (il file resta com\'è)',
    importTitle: 'Importa Radici',
    importIntro: 'Sapere già scritto dal team: una cartella di ADR (una decisione per file), CLAUDE.md o AGENTS.md (una Radice per sezione), un vault Markdown. Nessun LLM: il testo resta quello scritto, passa dal filtro dei segreti e i contenuti riservati non entrano.',
    path: 'File o cartella',
    category: 'Categoria',
    auto: 'Categoria automatica',
    autoTitle: 'Architettura per gli ADR, best practice per il resto',
    import: 'Importa',
    imported: (n: number, u: number, d: number) => `Importate ${n} Radici${u ? `, ${u} aggiornate (file cambiati)` : ''}${d ? `, ${d} già presenti` : ''}.`,
    blocked: 'Non importati (contenuti riservati):'
  },
  en: {
    filesTitle: 'Files for agents',
    filesIntro: 'The project Roots written in the files agents read by themselves at every session. Micelio only writes its own block (between the micelio:start and micelio:end markers) and updates it when the Roots change; the rest of the file is left alone.',
    format: { claude: 'CLAUDE.md (Claude Code)', agents: 'AGENTS.md (Codex and others)', cursor: 'Cursor rules (.cursor/rules)' } as Record<AgentFileFormat, string>,
    folder: 'Project folder (usually the repository root)',
    pick: 'Choose…',
    project: 'Project (empty = name of the repository or folder)',
    write: 'Write and keep up to date',
    written: (file: string, changed: boolean) => `${changed ? 'Written' : 'Already up to date'}: ${file}`,
    none: 'No file kept up to date.',
    missing: 'file not present',
    stop: 'Stop updating',
    stopConfirm: 'Yes (the file stays as it is)',
    importTitle: 'Import Roots',
    importIntro: 'Knowledge already written by the team: a folder of ADRs (one decision per file), CLAUDE.md or AGENTS.md (one Root per section), a Markdown vault. No LLM: the text stays as written, goes through the secrets filter, and confidential content does not get in.',
    path: 'File or folder',
    category: 'Category',
    auto: 'Automatic category',
    autoTitle: 'Architecture for ADRs, best practice for the rest',
    import: 'Import',
    imported: (n: number, u: number, d: number) => `Imported ${n} Roots${u ? `, ${u} updated (changed files)` : ''}${d ? `, ${d} already present` : ''}.`,
    blocked: 'Not imported (confidential content):'
  }
})

/** Le due schede, una sotto l'altra. */
export function RootsTools () {
  return (
    <div className='stack' style={{ marginTop: 16 }}>
      <AgentFilesCard />
      <ImportCard />
    </div>
  )
}

function AgentFilesCard () {
  const s = useStrings(S)
  const client = useQueryClient()
  const files = useQuery({ queryKey: ['roots', 'agentFiles'], queryFn: api.agentFiles })
  const [dir, setDir] = useState('')
  const [format, setFormat] = useState<AgentFileFormat>('claude')
  const [project, setProject] = useState('')
  const refresh = () => void client.invalidateQueries({ queryKey: ['roots', 'agentFiles'] })
  const write = useMutation({ mutationFn: () => api.exportAgentFile({ dir: dir.trim(), format, project: project.trim() || undefined, keep: true }), onSuccess: refresh })
  const stop = useMutation({ mutationFn: (f: { dir: string, format: AgentFileFormat }) => api.removeAgentFile(f.dir, f.format), onSuccess: refresh })
  const pick = async () => { const d = await window.micelio?.pickFolder?.(); if (d) setDir(d) }

  return (
    <Card help='roots#agent-files' title={s.filesTitle}>
      <p className='muted' style={{ marginTop: 0 }}>{s.filesIntro}</p>
      {files.data?.length === 0 && <Empty>{s.none}</Empty>}
      <div className='list'>
        {files.data?.map((f) => (
          <div key={f.file} className='list-item row'>
            <span className='badge'>{f.format}</span>
            <strong>{f.project}</strong>
            <span className='mono small' style={{ overflowWrap: 'anywhere' }}>{f.file}</span>
            {!f.exists && <span className='badge warn'>{s.missing}</span>}
            <span className='spacer' />
            <ConfirmButton label={s.stop} confirmLabel={s.stopConfirm} onConfirm={() => stop.mutate(f)} />
          </div>
        ))}
      </div>
      <div className='stack' style={{ marginTop: 10 }}>
        <div>
          <label>{s.folder}</label>
          <div className='row'>
            {window.micelio?.pickFolder && <button className='btn' onClick={() => void pick()}>{s.pick}</button>}
            <input style={{ flex: 1 }} value={dir} onChange={(e) => setDir(e.target.value)} placeholder='C:\progetti\ordini' />
          </div>
        </div>
        <div className='row'>
          <select style={{ width: 260 }} value={format} onChange={(e) => setFormat(e.target.value as AgentFileFormat)}>
            {FORMATS.map((f) => <option key={f} value={f}>{s.format[f]}</option>)}
          </select>
          <input style={{ flex: 1 }} value={project} onChange={(e) => setProject(e.target.value)} placeholder={s.project} />
          <button className='btn primary' disabled={!dir.trim() || write.isPending} onClick={() => write.mutate()}>{s.write}</button>
        </div>
        {write.data && <div className='notice ok small'>{s.written(write.data.file, write.data.changed)}</div>}
        <ErrorBox error={write.error ?? stop.error} />
      </div>
    </Card>
  )
}

function ImportCard () {
  const s = useStrings(S)
  const client = useQueryClient()
  const [target, setTarget] = useState('')
  const [category, setCategory] = useState('')
  const run = useMutation({ mutationFn: () => api.importRoots(target.trim(), category || undefined), onSuccess: () => void client.invalidateQueries({ queryKey: ['roots'] }) })
  const pick = async () => { const d = await window.micelio?.pickFolder?.(); if (d) setTarget(d) }

  return (
    <Card help='roots#import' title={s.importTitle}>
      <p className='muted' style={{ marginTop: 0 }}>{s.importIntro}</p>
      <div className='row'>
        {window.micelio?.pickFolder && <button className='btn' onClick={() => void pick()}>{s.pick}</button>}
        <input style={{ flex: 1 }} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={s.path + ': C:\\progetti\\ordini\\docs\\adr'} />
        <select style={{ width: 220 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={s.category} title={s.autoTitle}>
          <option value=''>{s.auto}</option>
          {ROOT_CATEGORY_ORDER.map((c) => <option key={c} value={c}>{ROOT_CATEGORY_LABEL[c]}</option>)}
        </select>
        <button className='btn primary' disabled={!target.trim() || run.isPending} onClick={() => run.mutate()}>{s.import}</button>
      </div>
      {run.data && (
        <div className='notice ok small' style={{ marginTop: 10 }}>
          {s.imported(run.data.imported, run.data.updated, run.data.duplicates)}
          {run.data.blocked.length > 0 && <div style={{ marginTop: 4 }}>{s.blocked} {run.data.blocked.join(' · ')}</div>}
        </div>
      )}
      <ErrorBox error={run.error} />
    </Card>
  )
}
