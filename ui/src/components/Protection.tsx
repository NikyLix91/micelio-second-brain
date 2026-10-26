/**
 * @file Scheda «Protezione completa» della pagina Team (0.7.0).
 *
 * EN: "Full protection" card of the Team page (0.7.0).
 *
 * Mostra se il team ha la protezione completa (replica solo fra membri attivi e contenuto cifrato
 * con una chiave per generazione), la generazione delle chiavi e, per ogni membro, la versione di
 * Micelio e se ha la chiave corrente. Un admin la accende quando tutti hanno la 0.7.0 (da lì non si
 * spegne) e può cambiare la chiave a mano, per esempio dopo un PC perso.
 *
 * EN: It shows whether the team has full protection (replication only among active members and
 * content encrypted with a per-generation key), the key generation and, for every member, the
 * Micelio version and whether they hold the current key. An admin turns it on when everyone has
 * 0.7.0 (from then on it can't be turned off) and can change the key by hand, for example after a
 * lost PC.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { defineStrings, useStrings } from '../i18n'
import { Card, ConfirmButton, ErrorBox } from './ui'

const S = defineStrings({
  it: {
    title: 'Protezione completa',
    on: (gen: number) => `Accesa. I dati del team passano solo fra membri attivi e il contenuto è cifrato con la chiave della generazione ${gen}. Quando rimuovi qualcuno la chiave cambia da sola.`,
    off: 'Spenta: il team funziona come nelle versioni precedenti alla 0.7.0. Chi viene rimosso tiene la chiave del registro e può continuare a ricevere i ricordi nuovi.',
    noKeyYet: 'Questo PC non ha ancora la chiave corrente: un membro online la consegna entro pochi secondi.',
    member: 'Membro',
    version: 'Versione',
    key: 'Chiave',
    older: 'prima della 0.7.0',
    hasKey: 'sì',
    noKey: 'non ancora',
    enable: 'Accendi la protezione completa',
    enableConfirm: 'Sì, accendila (non si torna indietro)',
    waiting: (names: string) => `Per accenderla tutti devono avere Micelio 0.7.0 o successiva. Mancano: ${names}.`,
    rotate: 'Cambia la chiave adesso',
    rotateConfirm: 'Sì, cambia la chiave',
    rotateHint: 'Per esempio dopo un PC perso o rubato: i ricordi nuovi si cifrano con una chiave che quel PC non riceve. Rimuovi prima il membro di quel PC.',
    rotated: (gen: number) => `Chiave cambiata: generazione ${gen}.`
  },
  en: {
    title: 'Full protection',
    on: (gen: number) => `On. The team's data travels only among active members and the content is encrypted with the key of generation ${gen}. When you remove someone the key changes by itself.`,
    off: 'Off: the team works as in versions before 0.7.0. Whoever is removed keeps the log key and can keep receiving new memories.',
    noKeyYet: 'This PC doesn\'t have the current key yet: an online member hands it over within a few seconds.',
    member: 'Member',
    version: 'Version',
    key: 'Key',
    older: 'before 0.7.0',
    hasKey: 'yes',
    noKey: 'not yet',
    enable: 'Turn full protection on',
    enableConfirm: 'Yes, turn it on (there\'s no way back)',
    waiting: (names: string) => `To turn it on everyone needs Micelio 0.7.0 or later. Missing: ${names}.`,
    rotate: 'Change the key now',
    rotateConfirm: 'Yes, change the key',
    rotateHint: 'For example after a lost or stolen PC: new memories get encrypted with a key that PC doesn\'t receive. Remove that PC\'s member first.',
    rotated: (gen: number) => `Key changed: generation ${gen}.`
  }
})

export function ProtectionCard ({ isAdmin }: { isAdmin: boolean }) {
  const s = useStrings(S)
  const client = useQueryClient()
  const p = useQuery({ queryKey: ['protection'], queryFn: api.protection, refetchInterval: 10_000 })
  const refresh = () => { void client.invalidateQueries({ queryKey: ['protection'] }) }
  const enable = useMutation({ mutationFn: api.enableProtection, onSuccess: refresh })
  const rotate = useMutation({ mutationFn: api.rotateKeys, onSuccess: refresh })
  const d = p.data
  return (
    <Card help='team#protection' title={s.title}>
      <ErrorBox error={p.error ?? enable.error ?? rotate.error} />
      {d && (
        <div className='stack'>
          <div className={`notice small ${d.strict ? 'ok' : 'warn'}`}>{d.strict ? s.on(d.gen) : s.off}</div>
          {d.strict && d.gen > 0 && !d.ready && <div className='notice small'>{s.noKeyYet}</div>}
          <table className='table small'>
            <thead><tr><th>{s.member}</th><th>{s.version}</th>{d.strict && <th>{s.key}</th>}</tr></thead>
            <tbody>
              {d.members.map((m) => (
                <tr key={m.key}>
                  <td>{m.name}</td>
                  <td className={m.version ? '' : 'muted'}>{m.version ?? s.older}</td>
                  {d.strict && <td className={m.hasKey ? '' : 'muted'}>{m.hasKey ? s.hasKey : s.noKey}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && !d.strict && (
            d.canEnable
              ? <div><ConfirmButton label={s.enable} confirmLabel={s.enableConfirm} disabled={enable.isPending} onConfirm={() => enable.mutate()} /></div>
              : <div className='muted small'>{s.waiting(d.waitingFor.join(', '))}</div>
          )}
          {isAdmin && d.strict && (
            <div>
              <ConfirmButton label={s.rotate} confirmLabel={s.rotateConfirm} disabled={rotate.isPending} onConfirm={() => rotate.mutate()} />
              <div className='muted small' style={{ marginTop: 4 }}>{s.rotateHint}</div>
              {rotate.data && <div className='notice ok small' style={{ marginTop: 6 }}>{s.rotated(rotate.data.gen)}</div>}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
