/**
 * @file Privato: registro di ciò che NON è andato al team e perché (attività 3.8).
 * Solo locale: bloccato dal filtro, privato, scartato, rifiutato, scaduto.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, OUTCOME_LABEL } from '../format'

/** Colore del badge per esito: i blocchi del filtro sono quelli che proteggono di più. */
const OUTCOME_CLASS: Record<string, string> = { blocked: 'danger', private: 'warn', discarded: '', rejected: '', expired: '' }

export function Private () {
  const list = useQuery({ queryKey: ['decisions'], queryFn: () => api.decisions() })
  return (
    <>
      <PageHeader title='Registro privato' subtitle='Cosa non è andato al team e perché. Resta solo su questo PC.' />
      <ErrorBox error={list.error} />
      <Card>
        {list.data?.length === 0 && <Empty>Il registro è vuoto.</Empty>}
        {!!list.data?.length && (
          <table>
            <thead><tr><th style={{ width: 140 }}>Quando</th><th style={{ width: 160 }}>Esito</th><th>Contenuto e motivo</th></tr></thead>
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
