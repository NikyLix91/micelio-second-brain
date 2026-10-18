/**
 * @file Selettore del team nella barra laterale (B3: più team sullo stesso PC).
 *
 * Mostra il team su cui sta lavorando l'interfaccia e permette di passare a un altro o di
 * aggiungerne uno (pagina /team/nuovo). Cambiare team qui NON cambia il predefinito del PC
 * (quello di CLI e agenti, che si sceglie nella pagina Team): è la scelta di questa finestra.
 *
 * Al cambio si svuota la cache delle query: ogni schermata ricarica i dati del nuovo team, e
 * lo stream degli eventi si riapre sul nuovo team (vedi api/live.ts).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { setCurrentTeam, useCurrentTeam } from '../api/team'
import { HelpButton } from '../help'
import { defineStrings, useStrings } from '../i18n'

const S = defineStrings({
  it: { label: 'Team', add: '＋ Aggiungi un team…', syncing: '(in sincronizzazione)', isDefault: 'predefinito', loading: 'Caricamento…' },
  en: { label: 'Team', add: '＋ Add a team…', syncing: '(syncing)', isDefault: 'default', loading: 'Loading…' }
})

/** Valore speciale dell'elenco: apre la pagina per aggiungere un team. */
const ADD = '__add__'

export function TeamSwitch () {
  const s = useStrings(S)
  const client = useQueryClient()
  const navigate = useNavigate()
  const selected = useCurrentTeam()
  const teams = useQuery({ queryKey: ['teams'], queryFn: api.teams })
  const list = teams.data?.teams ?? []
  // Team mostrato: quello scelto, se esiste ancora; altrimenti il predefinito del PC
  const shown = list.find((t) => t.id === selected) ?? list.find((t) => t.isDefault) ?? list[0]

  // Il team scelto non c'è più (tolto da questo PC, anche da un'altra finestra): si torna al predefinito
  useEffect(() => {
    if (selected && teams.data && !list.some((t) => t.id === selected)) {
      setCurrentTeam(null)
      client.resetQueries()
    }
  }, [selected, teams.data])

  const choose = (value: string) => {
    if (value === ADD) return navigate('/team/nuovo')
    setCurrentTeam(value)
    // Dati del team precedente fuori dalla cache: ogni schermata ricarica quelli del nuovo
    client.resetQueries()
    navigate('/')
  }

  return (
    <div className='team-switch'>
      <label htmlFor='team-switch'>{s.label} <HelpButton topic='teams#switch' /></label>
      <select id='team-switch' value={shown?.id ?? ''} onChange={(e) => choose(e.target.value)}>
        {/* Finché l'elenco non arriva: senza questa voce il browser mostrerebbe «Aggiungi un team» come scelta */}
        {!shown && <option value='' disabled>{s.loading}</option>}
        {list.map((t) => (
          <option key={t.id} value={t.id}>{t.name ?? s.syncing}{t.isDefault ? ` · ${s.isDefault}` : ''}</option>
        ))}
        <option value={ADD}>{s.add}</option>
      </select>
    </div>
  )
}
