# Guida utente

Micelio è la memoria condivisa del team, pensata per gli assistenti AI. Ogni collega esegue un **nodo** sulla propria macchina. I nodi si sincronizzano tra loro via internet senza server centrale, e ognuno ha una copia completa del sapere del team.

> Versione attuale: **MVP (Fase 1)**. Nel brain entra solo ciò che salvi **esplicitamente** (comando `remember` o tool MCP). La raccolta automatica dalle sessioni AI, con filtro privacy, arriva in Fase 2.

## 1. Installazione

Requisiti: **Node.js ≥ 22.13** (Windows, macOS o Linux).

```bash
git clone <repo> micelio && cd micelio
npm ci
npm run build
npm link            # installa il comando `micelio` nel PATH
```

## 2. Avviare il nodo

```bash
micelio start       # avvia il daemon in background
micelio status      # stato del nodo
micelio stop        # ferma il daemon
```

Il daemon deve restare attivo perché il nodo sincronizzi e perché gli assistenti AI possano usarlo. Per ora va avviato a mano dopo ogni riavvio del PC; l'avvio automatico come servizio di sistema è previsto in Fase 6.

I dati del nodo stanno in `~/.micelio`:

| File / cartella | Contenuto |
|---|---|
| `config.json` | Porta e **token** dell'API locale |
| `state.json` | Chiavi del team. **Contiene la chiave di cifratura: trattalo come una password** |
| `corestore/` | Log replicati del team |
| `view.db` | Indice di ricerca (derivato: si può cancellare, viene ricostruito) |
| `export/` | Copia Markdown in sola lettura del sapere del team |
| `logs/daemon.log` | Log del daemon |

Con `--home <cartella>` o la variabile `MICELIO_HOME` si possono tenere più nodi sulla stessa macchina (utile per i test).

## 3. Creare un team (solo la prima volta, una persona)

```bash
micelio init "Team Dev" --name pc-mario
```

Chi crea il team ne è **admin**. Gli admin possono espellere membri e nominare altri admin. Consiglio: **nomina 2–3 admin** tra chi ha il PC più spesso acceso. Gli admin fanno anche da "garanti" dell'ordine degli eventi (*indexer*).

```bash
micelio members promote pc-lucia
```

## 4. Invitare un collega

**Qualunque membro** può invitare:

```bash
micelio invite
```

Il comando stampa un **codice monouso** valido 24 ore. Mandalo al collega su un canale privato: è un segreto. Il collega esegue:

```bash
micelio start
micelio join <codice> --name pc-lucia
```

- L'ingresso viene accettato da **qualunque membro online**, non per forza da chi ha invitato.
- Se `invite` avvisa che *nessun altro membro online ha ancora ricevuto l'invito*, resta online finché il collega non è entrato.
- Il nuovo membro riceve subito tutto il sapere già accumulato.

`micelio invites` mostra gli inviti non ancora usati.

## 5. Salvare e cercare ricordi

```bash
micelio remember "Build Angular in out of memory su Azure DevOps" \
  --kind gotcha --tags angular,ci \
  --body "Impostare NODE_OPTIONS=--max-old-space-size=6144 nello step di build."

echo "contenuto lungo..." | micelio remember "Titolo"     # corpo da stdin

micelio recall angular memoria build
micelio get c297bc9dc2d1                                  # id anche abbreviato
```

Tipi di ricordo (`--kind`): `fact`, `howto`, `decision`, `gotcha`, `snippet`, `reference`.

**Cosa salvare:** conoscenza tecnica riutilizzabile, cioè soluzioni verificate, decisioni con il loro *perché*, gotcha e procedure.
**Cosa NON salvare:** dati personali, valutazioni di persone, questioni HR, credenziali, segreti, dati di clienti. Tutto ciò che salvi arriva a **tutti** i membri e **non si può cancellare** dalle loro macchine.

Lo stesso ricordo salvato due volte, anche da persone diverse, non si duplica.

La cartella `~/.micelio/export/team/` contiene un file Markdown per ricordo, comodo da sfogliare (anche con Obsidian). È in sola lettura e viene rigenerata.

## 6. Usarlo da Claude Code

```bash
micelio setup claude-code
```

Il comando registra Micelio come server MCP di Claude Code (ambito utente, valido per tutti i progetti). Poi, in qualunque sessione:

- *"Cerca nella memoria del team se abbiamo già risolto l'out of memory della build."*
- *"Salva nella memoria del team questa decisione: …"*

Per far consultare la memoria in automatico, aggiungi al `CLAUDE.md` dei progetti una riga come:

```
Prima di task non banali cerca nella memoria del team con il tool micelio recall.
```

⚠ Quando Claude salva un ricordo, scrive lui il testo e può aggiungere dettagli che non hai detto: controlla l'esito. Il tema "come gestire il salvataggio esplicito" è in discussione per la Fase 2.

Dettagli sui tool e sugli altri client: [mcp.md](mcp.md).

## 7. Membri ed espulsioni

```bash
micelio members                 # albero degli inviti: chi ha invitato chi
micelio members remove pc-x     # solo admin
```

Un membro espulso non può più scrivere nel team. **Limite intrinseco:** ciò che aveva già ricevuto resta sulla sua macchina. La rotazione della chiave per proteggere il sapere futuro è prevista in Fase 6.

## 8. Risoluzione problemi

| Sintomo | Causa probabile |
|---|---|
| `Il daemon Micelio non risponde` | Il daemon non è avviato: `micelio start`. Se non parte, guarda `~/.micelio/logs/daemon.log` |
| `join` va in timeout | Nessun membro del team è online, oppure l'invito non è ancora arrivato a nessun membro online. Riprova quando qualcuno è acceso |
| `Peer: 0 connessi` a lungo | Nessun altro membro online, oppure la rete blocca UDP. Il nodo riprova da solo ogni pochi secondi |
| Porta 7337 occupata | Imposta `"port"` in `~/.micelio/config.json` (poi riesegui `micelio setup claude-code`) |
| Claude Code non vede i tool | Il daemon deve essere attivo. Verifica con `claude mcp list` |
