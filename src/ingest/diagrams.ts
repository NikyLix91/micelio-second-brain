/**
 * @file Testo dai diagrammi (Fase 8): le Radici nascono spesso da schemi di architettura e mappe
 * di rete, non solo da documenti di testo.
 *
 * Formati:
 * - draw.io / diagrams.net (.drawio): XML `mxfile` con una o più pagine (`<diagram>`). Il contenuto
 *   di una pagina è `<mxGraphModel>` in chiaro oppure COMPRESSO (deflate "raw" + base64 + URL
 *   encoding, il formato storico di draw.io). Il testo utile sta negli attributi `value` delle
 *   celle (etichette di blocchi e frecce), spesso in HTML, e nei nomi delle pagine.
 * - SVG (.svg): testo in `<text>`/`<tspan>`, più `<title>` e `<desc>`.
 * - PlantUML (.puml, .plantuml) e Mermaid (.mmd, .mermaid) sono già testo: li legge extract.ts.
 *
 * Dal diagramma si ricava un elenco di etichette, una per riga: abbastanza perché il distillatore
 * capisca componenti, collegamenti e nomi (es. "API Gateway → servizio ordini → coda eventi").
 */
import zlib from 'node:zlib'

/** Decodifica le entità XML/HTML più comuni (&amp; &lt; &#39; &#x2192; &nbsp;…). */
export function decodeEntities (s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Toglie i tag HTML (le etichette di draw.io sono spesso HTML) e compatta gli spazi. */
function stripTags (s: string): string {
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Contenuto di una pagina draw.io: in chiaro, oppure decompresso dal formato storico. */
function drawioPage (inner: string): string {
  const t = inner.trim()
  if (t.startsWith('<')) return t
  try {
    const raw = zlib.inflateRawSync(Buffer.from(t, 'base64')).toString('utf8')
    return decodeURIComponent(raw)
  } catch {
    return '' // pagina illeggibile: la si salta senza fermare il resto
  }
}

/**
 * Testo di un file draw.io: per ogni pagina il nome e le etichette (senza doppioni).
 * @param xml contenuto del file
 */
export function drawioText (xml: string): string {
  const out: string[] = []
  const pages = [...xml.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)]
  // Un file può anche contenere direttamente un mxGraphModel (esportazioni vecchie)
  const bodies = pages.length ? pages.map((p) => ({ attrs: p[1], body: drawioPage(p[2]) })) : [{ attrs: '', body: xml }]
  for (const { attrs, body } of bodies) {
    const name = attrs.match(/\bname="([^"]*)"/)?.[1]
    if (name) out.push(`Pagina: ${decodeEntities(name)}`)
    const seen = new Set<string>()
    for (const m of body.matchAll(/\bvalue="([^"]*)"/g)) {
      const label = stripTags(decodeEntities(m[1]))
      if (label && !seen.has(label)) { seen.add(label); out.push(`- ${label}`) }
    }
  }
  return out.join('\n')
}

/** Testo di un SVG: titolo, descrizione ed etichette (`<text>`, con i loro `<tspan>`). */
export function svgText (xml: string): string {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of xml.matchAll(/<(title|desc|text)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const t = stripTags(decodeEntities(m[2]))
    if (t && !seen.has(t)) { seen.add(t); out.push(m[1] === 'text' ? `- ${t}` : t) }
  }
  return out.join('\n')
}
