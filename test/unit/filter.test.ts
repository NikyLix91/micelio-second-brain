/**
 * Filtro deterministico (src/privacy/filter.ts): cosa blocca, cosa redige, e soprattutto cosa
 * NON deve toccare (falsi positivi in contesto tecnico).
 */
import { describe, expect, it } from 'vitest'
import { applyFilter, DEFAULT_BLOCK_KEYWORDS, mergeRules } from '../../src/privacy/filter'

describe('filtro: blocco degli argomenti HR e personali', () => {
  it('blocca la mail di valutazione dell\'esempio di design', () => {
    const r = applyFilter('Aiutami a scrivere la valutazione di fine anno per Marco: proporrei un aumento, RAL da 34k a 36k.')
    expect(r.blocked).toBe(true)
    expect(r.reasons).toEqual(expect.arrayContaining(['valutazione di fine anno', 'RAL']))
  })

  it('riconosce le parole intere, senza distinguere le maiuscole (salvo le sigle)', () => {
    expect(applyFilter('Domani ho il COLLOQUIO DI VALUTAZIONE').blocked).toBe(true)
    // "ral" minuscolo dentro identificatori o parole non deve far scattare la sigla RAL
    expect(applyFilter('const generalRalph = central(ral)').blocked).toBe(false)
    expect(applyFilter('il metodo malattiaCheck()').blocked).toBe(false) // non è una parola intera
  })

  it('non blocca normali sessioni tecniche', () => {
    expect(applyFilter('La build Angular va in out of memory su Azure DevOps: impostare NODE_OPTIONS.').blocked).toBe(false)
  })

  it('le parole chiave del team si aggiungono a quelle di default', () => {
    const rules = mergeRules(['progetto riservato', 42, ' '])
    expect(rules.blockKeywords).toContain('progetto riservato')
    expect(rules.blockKeywords.length).toBe(DEFAULT_BLOCK_KEYWORDS.length + 1) // 42 e ' ' scartati
    expect(applyFilter('note sul Progetto Riservato', rules).blocked).toBe(true)
  })
})

describe('filtro: redazione di segreti e dati personali', () => {
  const cases: [string, string, string][] = [
    ['github token', 'export GH=ghp_' + 'a'.repeat(36), 'github-token'],
    ['chiave AWS', 'AKIAIOSFODNN7EXAMPLE', 'aws-key'],
    ['chiave Anthropic', 'sk-ant-api03-' + 'x'.repeat(30), 'anthropic-key'],
    ['JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'jwt'],
    ['password in connection string', 'Server=db;User Id=sa;Password=S3greta!;', 'connection-password'],
    ['credenziali in URL', 'postgres://admin:supersegreta@db.interno:5432/app', 'url-credentials'],
    ['assegnazione API key', 'API_KEY=abcdef1234567890', 'assignment'],
    ['IBAN', 'IT60 X054 2811 1010 0000 0123 456', 'iban'],
    ['codice fiscale', 'RSSMRA80A01H501U', 'codice-fiscale'],
    ['email', 'scrivi a mario.rossi@azienda.it', 'email'],
    ['telefono', 'chiamami al 347 123 4567', 'telefono']
  ]
  for (const [label, input, type] of cases) {
    it(`redige: ${label}`, () => {
      const r = applyFilter(input)
      expect(r.blocked).toBe(false) // i segreti si redigono, non bloccano
      expect(r.text).toContain('[REDACTED:')
      expect(Object.keys(r.redactions).some((k) => k.endsWith(type))).toBe(true)
    })
  }

  it('mantiene il contesto attorno al segreto', () => {
    const r = applyFilter('Server=db;Password=S3greta!;Timeout=30')
    expect(r.text).toBe('Server=db;Password=[REDACTED:connection-password];Timeout=30')
    expect(applyFilter('postgres://admin:supersegreta@db:5432').text).toBe('postgres://admin:[REDACTED:url-credentials]@db:5432')
  })

  it('non redige parole che parlano di segreti senza contenerne', () => {
    const t = 'Il token è scaduto: rigenera la password dal portale.'
    expect(applyFilter(t).text).toBe(t)
  })

  it('non scambia numeri di versione o id per telefoni', () => {
    const t = 'aggiornato a 3.12.1 e la build 3401234567890 è verde'
    expect(applyFilter(t).redactions.telefono).toBeUndefined()
  })
})
