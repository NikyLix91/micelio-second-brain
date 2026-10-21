/**
 * @file Backup e ripristino del sapere di un team (B7) nell'interfaccia.
 *
 * EN: Backup and restore of a team's knowledge (B7) in the UI.
 *
 * - BackupCard (pagina Team): crea il file di backup del team e ripristina un backup, dentro
 *   questo team (solo admin) o in un team nuovo;
 * - RestoreBackup: il ripristino da solo, usato anche nella schermata di benvenuto («Ripristina da
 *   un backup»: un PC nuovo, o il sapere di un team da portare altrove);
 * - AutoBackupCard (Impostazioni): backup automatici giornalieri del team.
 *
 * EN:
 * - BackupCard (Team page): creates the team's backup file and restores a backup, into
 *   this team (admin only) or into a new team;
 * - RestoreBackup: the restore on its own, also used in the welcome screen («Restore from
 *   a backup»: a new PC, or a team's knowledge to move elsewhere);
 * - AutoBackupCard (Settings): daily automatic backups of the team.
 *
 * Il file viaggia fra UI e daemon in base64 (JSON, come le altre chiamate). Il daemon lo cifra e lo
 * decifra: la UI non vede mai il contenuto, solo il manifesto (nome del team, data, conteggi).
 *
 * EN: The file travels between UI and daemon in base64 (JSON, like the other calls). The daemon
 * encrypts and decrypts it: the UI never sees the content, only the manifest (team name, date, counts).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type BackupManifest, type RestoreReport } from '../api/client'
import { setCurrentTeam } from '../api/team'
import { HelpButton } from '../help'
import { defineStrings, useStrings } from '../i18n'
import { Card, ErrorBox } from './ui'

const MIN_PASSWORD = 8

const S = defineStrings({
  it: {
    title: 'Backup e ripristino',
    intro: 'Il backup è un file con tutto il sapere del team: ricordi (anche lo storico), Radici, collegamenti, voti, lacune. Non contiene chiavi né membri: un team ripristinato ha chiavi nuove e i colleghi rientrano con un invito.',
    create: 'Crea un backup',
    password: 'Password',
    repeat: 'Ripeti la password',
    passwordHint: `Almeno ${MIN_PASSWORD} caratteri. Conservala: senza, il backup non si apre.`,
    mismatch: 'Le due password non coincidono',
    download: 'Crea e scarica',
    created: (n: string, m: number, r: number) => `Creato «${n}»: ${m} ricordi, ${r} Radici.`,
    restore: 'Ripristina un backup',
    chooseFile: 'File di backup (.micelio-backup)',
    manifest: (team: string, at: string, by: string) => `Backup di «${team}» del ${at}, creato da ${by}`,
    counts: (m: number, a: number, r: number, g: number) => `${m} ricordi (${a} attivi), ${r} Radici, ${g} lacune`,
    into: 'Dove ripristinarlo',
    intoThis: 'Dentro questo team',
    intoThisHint: 'Si aggiunge al sapere del team, per tutti i colleghi. I ricordi già presenti restano come sono. Solo admin.',
    intoNew: 'In un team nuovo su questo PC',
    intoNewHint: 'Ne diventi fondatore e admin; inviti tu i colleghi.',
    newName: 'Nome del team nuovo',
    adminOnly: 'Solo gli admin possono ripristinare dentro un team esistente.',
    restoreBtn: 'Ripristina',
    restoring: 'Ripristino in corso: con migliaia di ricordi può volerci qualche decina di secondi…',
    restored: (r: RestoreReport) => `Ripristinati ${r.added} ricordi${r.existing ? `; ${r.existing} c'erano già e restano come sono` : ''} (${(r.ms / 1000).toFixed(1)} s).`,
    openTeam: 'Apri il team ripristinato',
    autoTitle: 'Backup automatici',
    autoIntro: 'Un backup al giorno di questo team, nella cartella che scegli (anche condivisa o di rete). La password resta solo su questo PC.',
    enabled: 'Attivi',
    folder: 'Cartella',
    folderPlaceholder: 'es. D:\\Backup\\Micelio',
    pickFolder: 'Scegli cartella…',
    keep: 'Quanti tenerne',
    autoPassword: 'Password dei backup',
    passwordSet: '•••••••• (impostata: lascia vuoto per non cambiarla)',
    save: 'Salva',
    last: (at: string, file: string) => `Ultimo backup: ${at} · ${file}`,
    lastError: (at: string, err: string) => `Ultimo tentativo ${at}: ${err}`
  },
  en: {
    title: 'Backup and restore',
    intro: 'A backup is a file with all the knowledge of the team: memories (history included), Roots, links, votes, gaps. It contains no keys or members: a restored team has new keys and colleagues rejoin with an invite.',
    create: 'Create a backup',
    password: 'Password',
    repeat: 'Repeat the password',
    passwordHint: `At least ${MIN_PASSWORD} characters. Keep it: without it the backup cannot be opened.`,
    mismatch: 'The two passwords do not match',
    download: 'Create and download',
    created: (n: string, m: number, r: number) => `Created “${n}”: ${m} memories, ${r} Roots.`,
    restore: 'Restore a backup',
    chooseFile: 'Backup file (.micelio-backup)',
    manifest: (team: string, at: string, by: string) => `Backup of “${team}” from ${at}, made by ${by}`,
    counts: (m: number, a: number, r: number, g: number) => `${m} memories (${a} active), ${r} Roots, ${g} gaps`,
    into: 'Where to restore it',
    intoThis: 'Into this team',
    intoThisHint: 'It is added to the knowledge of the team, for all colleagues. Memories already there stay as they are. Admins only.',
    intoNew: 'Into a new team on this PC',
    intoNewHint: 'You become its founder and admin; you invite your colleagues.',
    newName: 'Name of the new team',
    adminOnly: 'Only admins can restore into an existing team.',
    restoreBtn: 'Restore',
    restoring: 'Restoring: with thousands of memories it can take a few tens of seconds…',
    restored: (r: RestoreReport) => `Restored ${r.added} memories${r.existing ? `; ${r.existing} were already there and stay as they are` : ''} (${(r.ms / 1000).toFixed(1)} s).`,
    openTeam: 'Open the restored team',
    autoTitle: 'Automatic backups',
    autoIntro: 'One backup a day of this team, in the folder you choose (shared or network folders work too). The password stays on this PC only.',
    enabled: 'On',
    folder: 'Folder',
    folderPlaceholder: 'e.g. D:\\Backup\\Micelio',
    pickFolder: 'Choose folder…',
    keep: 'How many to keep',
    autoPassword: 'Backup password',
    passwordSet: '•••••••• (set: leave empty to keep it)',
    save: 'Save',
    last: (at: string, file: string) => `Last backup: ${at} · ${file}`,
    lastError: (at: string, err: string) => `Last attempt ${at}: ${err}`
  }
})

/** Il contenuto di un file del browser in base64 (senza il prefisso "data:…;base64,"). / EN: The content of a browser file in base64 (without the "data:…;base64," prefix). */
function fileToBase64 (file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Fa scaricare al browser (o all'app desktop) un file ricevuto in base64. / EN: Makes the browser (or the desktop app) download a file received in base64. */
function downloadBase64 (name: string, data: string): void {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Pagina Team: crea un backup e ripristina. / EN: Team page: create a backup and restore. */
export function BackupCard ({ isAdmin }: { isAdmin: boolean }) {
  const s = useStrings(S)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const create = useMutation({
    mutationFn: () => api.createBackup(pw),
    onSuccess: (r) => { downloadBase64(r.name, r.data); setPw(''); setPw2('') }
  })
  const mismatch = pw2.length > 0 && pw !== pw2
  return (
    <Card help='backup' title={s.title}>
      <p className='muted' style={{ marginTop: 0 }}>{s.intro}</p>
      <h3 style={{ marginBottom: 6 }}>{s.create} <HelpButton topic='backup#create' /></h3>
      <div className='row' style={{ alignItems: 'flex-end' }}>
        <div><label>{s.password}</label><input type='password' value={pw} onChange={(e) => setPw(e.target.value)} autoComplete='new-password' /></div>
        <div><label>{s.repeat}</label><input type='password' value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete='new-password' /></div>
        <button className='btn primary' disabled={create.isPending || pw.length < MIN_PASSWORD || pw !== pw2} onClick={() => create.mutate()}>{s.download}</button>
      </div>
      <div className={`small ${mismatch ? 'warn' : 'muted'}`}>{mismatch ? s.mismatch : s.passwordHint}</div>
      <ErrorBox error={create.error} />
      {create.data && <div className='notice small'>{s.created(create.data.name, create.data.manifest.counts.memories, create.data.manifest.counts.roots)}</div>}
      <h3 style={{ marginBottom: 6 }}>{s.restore} <HelpButton topic='backup#restore' /></h3>
      <RestoreBackup canIntoThis={isAdmin} />
    </Card>
  )
}

/**
 * Ripristino di un backup: file → cosa contiene → password → dove.
 *
 * EN: Restoring a backup: file → what it contains → password → where.
 *
 * @param canIntoThis l'utente è admin del team corrente (può ripristinare al suo interno)
 *                    EN: the user is admin of the current team (can restore into it)
 * @param newTeamOnly schermata di benvenuto: c'è solo il team nuovo
 *                    EN: welcome screen: only the new team option exists
 * @param nodeName / network con newTeamOnly: il nome e la rete scelti nel modulo di benvenuto
 *                 EN: with newTeamOnly, the name and network chosen in the welcome form
 * @param onNewTeam chiamata con l'id del team nuovo (benvenuto: si entra subito nel team)
 *                  EN: called with the new team's id (welcome: you enter the team right away)
 */
export function RestoreBackup ({ canIntoThis = false, newTeamOnly = false, nodeName, network, onNewTeam }: { canIntoThis?: boolean, newTeamOnly?: boolean, nodeName?: string, network?: 'public' | 'local', onNewTeam?: (id: string) => void }) {
  const s = useStrings(S)
  const client = useQueryClient()
  const [data, setData] = useState<string | null>(null)
  const [manifest, setManifest] = useState<BackupManifest | null>(null)
  const [pw, setPw] = useState('')
  const [target, setTarget] = useState<'this' | 'new'>(newTeamOnly || !canIntoThis ? 'new' : 'this')
  const [teamName, setTeamName] = useState('')
  const [newId, setNewId] = useState<string | null>(null)
  const read = useMutation({
    mutationFn: async (file: File) => {
      const b64 = await fileToBase64(file)
      const m = await api.backupManifest(b64)
      return { b64, m }
    },
    onSuccess: ({ b64, m }) => { setData(b64); setManifest(m); setTeamName(m.team); setNewId(null) }
  })
  const restore = useMutation({
    mutationFn: async (): Promise<RestoreReport> => {
      if (target === 'this') return api.restoreBackup(data!, pw)
      const r = await api.restoreAsNewTeam(data!, pw, { teamName: teamName.trim() || undefined, name: nodeName?.trim() || undefined, network })
      setNewId(r.id)
      return r.report
    },
    onSuccess: () => {
      setPw('')
      void client.invalidateQueries({ queryKey: ['teams'] })
      void client.invalidateQueries({ queryKey: ['memories'] })
    }
  })
  const openTeam = (id: string) => {
    setCurrentTeam(id)
    void client.resetQueries()
    onNewTeam?.(id)
  }
  return (
    <div className='stack'>
      <div>
        <label>{s.chooseFile}</label>
        <input type='file' accept='.micelio-backup' onChange={(e) => { const f = e.target.files?.[0]; if (f) read.mutate(f) }} />
      </div>
      <ErrorBox error={read.error} />
      {manifest && (
        <div className='notice small'>
          <div>{s.manifest(manifest.team, new Date(manifest.createdAt).toLocaleString(), manifest.createdBy)}</div>
          <div>{s.counts(manifest.counts.memories, manifest.counts.active, manifest.counts.roots, manifest.counts.gaps)}</div>
        </div>
      )}
      {manifest && !restore.data && (
        <>
          {!newTeamOnly && (
            <div>
              <label>{s.into}</label>
              <label className='row' style={{ margin: 0 }}>
                <input type='radio' checked={target === 'this'} disabled={!canIntoThis} onChange={() => setTarget('this')} /> {s.intoThis}
              </label>
              <div className='muted small'>{canIntoThis ? s.intoThisHint : s.adminOnly}</div>
              <label className='row' style={{ margin: 0 }}>
                <input type='radio' checked={target === 'new'} onChange={() => setTarget('new')} /> {s.intoNew}
              </label>
              <div className='muted small'>{s.intoNewHint}</div>
            </div>
          )}
          {target === 'new' && <div style={{ maxWidth: 360 }}><label>{s.newName}</label><input value={teamName} onChange={(e) => setTeamName(e.target.value)} /></div>}
          <div className='row' style={{ alignItems: 'flex-end' }}>
            <div><label>{s.password}</label><input type='password' value={pw} onChange={(e) => setPw(e.target.value)} autoComplete='current-password' /></div>
            <button className='btn primary' disabled={restore.isPending || !pw} onClick={() => restore.mutate()}>{s.restoreBtn}</button>
          </div>
        </>
      )}
      {restore.isPending && <div className='notice small'>{s.restoring}</div>}
      <ErrorBox error={restore.error} />
      {restore.data && (
        <div className='notice small'>
          {s.restored(restore.data)}
          {newId && <> <button className='btn small primary' onClick={() => openTeam(newId)}>{s.openTeam}</button></>}
        </div>
      )}
    </div>
  )
}

/** Impostazioni: backup automatici giornalieri del team. / EN: Settings: daily automatic backups of the team. */
export function AutoBackupCard () {
  const s = useStrings(S)
  const client = useQueryClient()
  const q = useQuery({ queryKey: ['backupSettings'], queryFn: api.backupSettings })
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [keep, setKeep] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const save = useMutation({
    mutationFn: () => api.setBackupSettings({
      enabled: enabled ?? undefined,
      folder: folder ?? undefined,
      keep: keep !== null ? Number(keep) : undefined,
      password: pw || undefined
    }),
    onSuccess: () => {
      setEnabled(null); setFolder(null); setKeep(null); setPw(''); setPw2('')
      void client.invalidateQueries({ queryKey: ['backupSettings'] })
    }
  })
  const b = q.data
  if (!b) return <Card help='backup#auto' title={s.autoTitle}><ErrorBox error={q.error} /></Card>
  const dirty = enabled !== null || folder !== null || keep !== null || pw.length > 0
  const pwBad = pw.length > 0 && (pw.length < MIN_PASSWORD || pw !== pw2)
  return (
    <Card help='backup#auto' title={s.autoTitle}>
      <p className='muted' style={{ marginTop: 0 }}>{s.autoIntro}</p>
      <div className='stack'>
        <label className='row' style={{ margin: 0 }}>
          <input type='checkbox' checked={enabled ?? b.enabled} onChange={(e) => setEnabled(e.target.checked)} /> {s.enabled}
        </label>
        <div>
          <label>{s.folder}</label>
          <div className='row'>
            {/* Nell'app desktop la finestra di scelta del sistema; nel browser si scrive il percorso / EN: In the desktop app, the system picker dialog; in the browser, you type the path */}
            {window.micelio?.pickFolder && <button className='btn' onClick={() => void window.micelio!.pickFolder!().then((d) => { if (d) setFolder(d) })}>{s.pickFolder}</button>}
            <input style={{ flex: 1 }} value={folder ?? b.folder} onChange={(e) => setFolder(e.target.value)} placeholder={s.folderPlaceholder} />
          </div>
        </div>
        <div style={{ maxWidth: 160 }}><label>{s.keep}</label><input type='number' min={1} max={365} value={keep ?? String(b.keep)} onChange={(e) => setKeep(e.target.value)} /></div>
        <div className='row' style={{ alignItems: 'flex-end' }}>
          <div><label>{s.autoPassword}</label><input type='password' value={pw} placeholder={b.hasPassword ? s.passwordSet : ''} onChange={(e) => setPw(e.target.value)} autoComplete='new-password' /></div>
          {pw.length > 0 && <div><label>{s.repeat}</label><input type='password' value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete='new-password' /></div>}
        </div>
        {pw.length > 0 && <div className={`small ${pwBad ? 'warn' : 'muted'}`}>{pw2 && pw !== pw2 ? s.mismatch : s.passwordHint}</div>}
        {b.last && <div className={`small ${b.last.error ? 'warn' : 'muted'}`}>{b.last.error ? s.lastError(new Date(b.last.at).toLocaleString(), b.last.error) : s.last(new Date(b.last.at).toLocaleString(), b.last.file ?? '')}</div>}
        <ErrorBox error={save.error} />
        <div><button className='btn primary' disabled={!dirty || pwBad || save.isPending} onClick={() => save.mutate()}>{s.save}</button></div>
      </div>
    </Card>
  )
}
