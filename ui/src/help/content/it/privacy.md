# Filtro privacy

Il filtro decide cosa **non** deve arrivare al team. È deterministico (regole, non AI) e gira **sul tuo PC prima di qualunque chiamata a Claude**: ciò che blocca non lascia mai la macchina.

## Blocco degli argomenti personali {#block}

Se il testo contiene argomenti HR o personali (valutazioni, stipendi e RAL, provvedimenti disciplinari, malattia…, in italiano e inglese, più le parole aggiunte dal team), il contenuto resta **privato**: nessuna chiamata all'LLM, nessuna pubblicazione. L'esito finisce nel Registro privato.

## Redazione di segreti e dati personali {#redact}

Token, chiavi API, password, credenziali negli URL, chiavi private, IBAN, codici fiscali, email e telefoni vengono sostituiti da segnaposto come `[REDACTED:github-token]` e il resto prosegue (una sessione tecnica contiene spesso un token). L'elenco completo e le regole del team sono nella schermata **Sicurezza**.

## Percorsi bloccati {#paths}

Nelle cartelle di documenti, i file sotto percorsi come `**/hr/**`, `**/contratti/**`, `**/buste paga/**`, `**/private/**` non vengono nemmeno aperti. I **file sensibili** (`.env`, chiavi, credenziali) non vengono mai letti, in nessuna fonte.

## Il secondo passaggio {#second-pass}

Dopo la distillazione il filtro ripassa sui ricordi prodotti: se il modello ha riportato un dato sensibile sfuggito alla prima redazione, viene tolto; se un ricordo tocca un argomento bloccato, va in inbox invece che al team.

## I casi dubbi {#doubt}

Nel dubbio non si pubblica: contenuti misti (tecnici ma con dati sensibili), classificazioni poco sicure o salvataggi espliciti senza LLM disponibile finiscono nella tua **Inbox**, dove decidi tu.
