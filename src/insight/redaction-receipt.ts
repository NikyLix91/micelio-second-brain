/**
 * @file Ricevuta di redazione (B12): documento da consegnare a chi deve sapere che un dato è stato
 * tolto (per esempio un cliente).
 *
 * EN: Redaction receipt (B12): a document to hand to whoever must know that some data was removed
 * (for example a customer).
 *
 * Due forme dello stesso contenuto:
 * - testo leggibile, in italiano o in inglese;
 * - JSON con, per ogni conferma firmata, il testo firmato, la chiave pubblica della persona e la
 *   firma Ed25519: chiunque può verificarla con uno strumento standard, senza Micelio.
 * I limiti stanno nella ricevuta stessa: dice cosa ha fatto il software, non può garantire copie
 * fatte a mano né il contenuto dei backup che dichiara.
 *
 * EN: Two forms of the same content:
 * - readable text, in Italian or English;
 * - JSON with, for each signed confirmation, the signed text, the person's public key and the
 *   Ed25519 signature: anyone can verify it with a standard tool, without Micelio.
 * The limits are in the receipt itself: it says what the software did, it can't vouch for copies
 * made by hand or for the content of the backups it declares.
 *
 * Funzione pura, testata in test/unit/redaction-receipt.test.ts.
 *
 * EN: Pure function, tested in test/unit/redaction-receipt.test.ts.
 */
import { redactAckMessage } from '../core/identity'
import type { RedactionView } from '../node/micelio-node'

const T = {
  it: {
    title: 'Ricevuta di redazione',
    team: 'Team',
    memory: 'Ricordo (id)',
    reason: 'Motivo',
    at: 'Redatto il',
    by: 'Da (admin)',
    unknown: 'non registrato (redazione precedente alla versione 0.6.0)',
    generated: 'Ricevuta generata il',
    from: 'da',
    progress: (c: number, t: number) => `PC che hanno confermato: ${c} su ${t}`,
    confirmed: 'confermato il',
    pending: 'in attesa (PC spento o versione precedente alla 0.6.0)',
    left: 'uscito dal team senza confermare',
    cleaned: (chat: number, inbox: number, personal: number) => `ripuliti: ${chat} risposte della chat, ${inbox} proposte in Inbox, ${personal} copie personali`,
    backups: (n: number) => n ? `${n} backup automatici precedenti alla redazione restano nella cartella dei backup e possono contenere il ricordo` : 'nessun backup automatico precedente nella cartella dei backup',
    signed: 'firmato con l\'identità personale',
    unsigned: 'non firmato (nodo senza identità personale)',
    limitsTitle: 'Limiti',
    limits: [
      'La ricevuta attesta che il software Micelio ha tolto il ricordo su ogni PC che ha confermato: dall\'indice di ricerca, dall\'export Markdown, dalle risposte della chat, dall\'Inbox e dalle copie personali.',
      'Non può garantire che nessuno ne abbia fatto una copia a mano (testo copiato, screenshot, file esportati).',
      'I backup elencati non vengono modificati: chi li conserva deve cancellarli se necessario. I backup fatti a mano in altre cartelle non sono noti.',
      'I blocchi cifrati del registro del team restano; il contenuto non è più mostrato da nessun nodo.'
    ],
    verify: 'Le conferme firmate si verificano con Ed25519: il testo firmato e la firma sono nel file JSON.'
  },
  en: {
    title: 'Redaction receipt',
    team: 'Team',
    memory: 'Memory (id)',
    reason: 'Reason',
    at: 'Redacted on',
    by: 'By (admin)',
    unknown: 'not recorded (redaction older than version 0.6.0)',
    generated: 'Receipt generated on',
    from: 'by',
    progress: (c: number, t: number) => `PCs that confirmed: ${c} of ${t}`,
    confirmed: 'confirmed on',
    pending: 'pending (PC off or a version older than 0.6.0)',
    left: 'left the team without confirming',
    cleaned: (chat: number, inbox: number, personal: number) => `cleaned: ${chat} chat answers, ${inbox} Inbox proposals, ${personal} personal copies`,
    backups: (n: number) => n ? `${n} automatic backups older than the redaction remain in the backup folder and may contain the memory` : 'no earlier automatic backup in the backup folder',
    signed: 'signed with the personal identity',
    unsigned: 'not signed (node without a personal identity)',
    limitsTitle: 'Limits',
    limits: [
      'The receipt certifies that the Micelio software removed the memory on every PC that confirmed: from the search index, the Markdown export, chat answers, the Inbox and personal copies.',
      'It can\'t guarantee that nobody made a copy by hand (copied text, screenshots, exported files).',
      'The listed backups are not modified: whoever keeps them must delete them if needed. Backups made by hand in other folders are not known.',
      'The encrypted blocks of the team log remain; the content is no longer shown by any node.'
    ],
    verify: 'Signed confirmations are verified with Ed25519: the signed text and the signature are in the JSON file.'
  }
}

const iso = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

/**
 * Costruisce la ricevuta di una redazione.
 *
 * EN: Builds the receipt of a redaction.
 * @param o.by nodo che genera la ricevuta (nome e chiave)
 *        EN: node generating the receipt (name and key)
 */
export function buildReceipt (o: { redaction: RedactionView, team: string, by: { name: string, key: string }, now?: number, lang?: 'it' | 'en' }): { name: string, text: string, json: unknown } {
  const r = o.redaction
  const now = o.now ?? Date.now()
  const t = T[o.lang ?? 'it']
  const lines = [
    `${t.title.toUpperCase()}`,
    '',
    `${t.team}: ${o.team}`,
    `${t.memory}: ${r.id}`,
    `${t.reason}: ${r.reason || '-'}`,
    `${t.at}: ${r.at ? iso(r.at) : t.unknown}`,
    `${t.by}: ${r.by ? `${r.by.name} (${r.by.key})` : t.unknown}`,
    `${t.generated}: ${iso(now)} ${t.from} ${o.by.name} (${o.by.key})`,
    '',
    t.progress(r.confirmed, r.total),
    ''
  ]
  for (const m of r.members) {
    lines.push(`- ${m.name} (${m.key})`)
    if (m.ack) {
      lines.push(`  ${t.confirmed} ${iso(m.ack.ts)}`)
      lines.push(`  ${t.cleaned(m.ack.cleaned.chat, m.ack.cleaned.inbox, m.ack.cleaned.personal)}`)
      lines.push(`  ${t.backups(m.ack.backups)}`)
      lines.push(`  ${m.ack.sig ? t.signed : t.unsigned}`)
    } else {
      lines.push(`  ${m.status === 'left' ? t.left : t.pending}`)
    }
  }
  lines.push('', `${t.limitsTitle}:`, ...t.limits.map((l) => `- ${l}`), '', t.verify)

  const json = {
    format: 'micelio-redaction-receipt',
    version: 1,
    team: o.team,
    memory: r.id,
    reason: r.reason,
    redactedAt: r.at,
    redactedBy: r.by,
    generatedAt: now,
    generatedBy: o.by,
    confirmed: r.confirmed,
    total: r.total,
    members: r.members.map((m) => ({
      name: m.name,
      node: m.key,
      status: m.status,
      ...(m.ack
        ? {
            confirmedAt: m.ack.ts,
            cleaned: m.ack.cleaned,
            backupsLeft: m.ack.backups,
            ...(m.ack.sig ? { signature: { algorithm: 'ed25519', person: m.ack.person, message: redactAckMessage(r.id, m.key, m.ack.ts), sig: m.ack.sig } } : {})
          }
        : {})
    })),
    limits: t.limits
  }
  return { name: `redazione-${r.id.slice(0, 12)}`, text: lines.join('\n') + '\n', json }
}
