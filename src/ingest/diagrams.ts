/**
 * @file Testo dai diagrammi (Fase 8): le Radici nascono spesso da schemi di architettura e mappe
 * di rete, non solo da documenti di testo.
 *
 * EN: Text from diagrams (Phase 8): Roots often come from architecture diagrams and network maps, not just
 * from text documents.
 *
 * Formati:
 * - draw.io / diagrams.net (.drawio): XML `mxfile` con una o più pagine (`<diagram>`). Il contenuto
 *   di una pagina è `<mxGraphModel>` in chiaro oppure COMPRESSO (deflate "raw" + base64 + URL
 *   encoding, il formato storico di draw.io). Il testo utile sta negli attributi `value` delle
 *   celle (etichette di blocchi e frecce), spesso in HTML, e nei nomi delle pagine.
 * - SVG (.svg): testo in `<text>`/`<tspan>`, più `<title>` e `<desc>`.
 * - PlantUML (.puml, .plantuml) e Mermaid (.mmd, .mermaid) sono già testo: li legge extract.ts.
 *
 * EN: Formats:
 * - draw.io / diagrams.net (.drawio): `mxfile` XML with one or more pages (`<diagram>`). The content of
 *   a page is `<mxGraphModel>` in plain text or COMPRESSED (raw deflate + base64 + URL encoding, the
 *   legacy draw.io format). The useful text is in the `value` attributes of the cells (labels of blocks
 *   and arrows), often as HTML, and in the page names.
 * - SVG (.svg): text in `<text>`/`<tspan>`, plus `<title>` and `<desc>`.
 * - PlantUML (.puml, .plantuml) and Mermaid (.mmd, .mermaid) are already text: extract.ts reads them.
 *
 * Dal diagramma si ricava un elenco di etichette, una per riga: abbastanza perché il distillatore
 * capisca componenti, collegamenti e nomi (es. "API Gateway → servizio ordini → coda eventi").
 *
 * EN: From the diagram we get a list of labels, one per line: enough for the distiller to understand
 * components, links and names (e.g. "API Gateway → servizio ordini → coda eventi").
 */
import zlib from 'node:zlib'

/** Decodifica le entità XML/HTML più comuni (&amp; &lt; &#39; &#x2192; &nbsp;…). / EN: Decodes the most common XML/HTML entities (&amp; &lt; &#39; &#x2192; &nbsp;…). */
export function decodeEntities (s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Toglie i tag HTML (le etichette di draw.io sono spesso HTML) e compatta gli spazi. / EN: Strips HTML tags (draw.io labels are often HTML) and collapses whitespace. */
function stripTags (s: string): string {
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Contenuto di una pagina draw.io: in chiaro, oppure decompresso dal formato storico. / EN: Content of a draw.io page: plain, or decompressed from the legacy format. */
function drawioPage (inner: string): string {
  const t = inner.trim()
  if (t.startsWith('<')) return t
  try {
    const raw = zlib.inflateRawSync(Buffer.from(t, 'base64')).toString('utf8')
    return decodeURIComponent(raw)
  } catch {
    return '' // pagina illeggibile: la si salta senza fermare il resto / EN: unreadable page: skip it without stopping the rest
  }
}

/**
 * Testo di un file draw.io: per ogni pagina il nome e le etichette (senza doppioni).
 *
 * EN: Text of a draw.io file: for each page, its name and labels (no duplicates).
 * @param xml contenuto del file
 *            EN: file content
 */
export function drawioText (xml: string): string {
  const out: string[] = []
  const pages = [...xml.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)]
  // Un file può anche contenere direttamente un mxGraphModel (esportazioni vecchie)
  // EN: A file can also contain an mxGraphModel directly (old exports)
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

/** Testo di un SVG: titolo, descrizione ed etichette (`<text>`, con i loro `<tspan>`). / EN: Text of an SVG: title, description and labels (`<text>`, with their `<tspan>`). */
export function svgText (xml: string): string {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of xml.matchAll(/<(title|desc|text)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const t = stripTags(decodeEntities(m[2]))
    if (t && !seen.has(t)) { seen.add(t); out.push(m[1] === 'text' ? `- ${t}` : t) }
  }
  return out.join('\n')
}
