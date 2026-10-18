/**
 * @file Privato: registro di ciò che NON è andato al team e perché (attività 3.8).
 * Solo locale: bloccato dal filtro, privato, scartato, rifiutato, scaduto.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, OUTCOME_LABEL } from '../format'
import { defineStrings, useStrings } from '../i18n'

const S = defineStrings({
  it: { title: 'Registro privato', subtitle: 'Cosa non è andato al team e perché. Resta solo su questo PC.', empty: 'Il registro è vuoto.', when: 'Quando', outcome: 'Esito', content: 'Contenuto e motivo' },
  en: { title: 'Private log', subtitle: 'What did not reach the team, and why. It stays on this PC only.', empty: 'The log is empty.', when: 'When', outcome: 'Outcome', content: 'Content and reason' }
})

/** Colore del badge per esito: i blocchi del filtro sono quelli che proteggono di più. */
const OUTCOME_CLASS: Record<string, string> = { blocked: 'danger', private: 'warn', discarded: '', rejected: '', expired: '' }

export function Private () {
  const s = useStrings(S)
  const list = useQuery({ queryKey: ['decisions'], queryFn: () => api.decisions() })
  return (
    <>
      <PageHeader title={s.title} subtitle={s.subtitle} />
      <ErrorBox error={list.error} />
      <Card>
        {list.data?.length === 0 && <Empty>{s.empty}</Empty>}
        {!!list.data?.length && (
          <table>
            <thead><tr><th style={{ width: 140 }}>{s.when}</th><th style={{ width: 160 }}>{s.outcome}</th><th>{s.content}</th></tr></thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <td className='small muted'>{dateTime(d.created)}</td>
                  <td><span className={`badge ${OUTCOME_CLASS[d.outcome] ?? ''}`}>{OUTCOME_LABEL[d.outcome] ?? d.outcome}</span><div className='small muted'>{d.source.type}</div></td>
                  <td><div>{d.preview}</div><div className='small muted'>↳ {d.reason}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}
