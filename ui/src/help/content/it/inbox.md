# Inbox

L'inbox raccoglie **solo i casi dubbi**: ricordi che il filtro non ha potuto pubblicare da solo. Nel dubbio non si pubblica: decidi tu.

## Perché un ricordo finisce qui {#why}

- la classificazione non è abbastanza sicura (confidenza sotto 0,8);
- il contenuto è **misto**: sapere tecnico utile ma con dati sensibili;
- il ricordo tocca un argomento bloccato dopo la distillazione;
- è un salvataggio esplicito ma l'LLM non è disponibile o il budget è finito.

Il motivo è scritto su ogni elemento.

## Cosa puoi fare {#actions}

- **Pubblica nel team**: il ricordo entra nel tuo feed e arriva a tutti;
- **Correggi**: modifichi titolo e testo (per esempio togli un dettaglio sensibile), poi pubblichi la versione corretta;
- **Scarta**: il ricordo non va al team; la decisione resta nel Registro privato.

Anche un agente può mostrarti l'inbox (tool `inbox_review`) e applicare la tua decisione (`inbox_decide`), solo dopo che l'hai presa tu.

## Dove sta e quanto dura {#storage}

L'inbox è nel tuo `private.db` e **non viene mai replicata**: i colleghi non vedono i tuoi casi dubbi. Un elemento non deciso **scade dopo 14 giorni** e viene registrato come scaduto. L'app desktop ti avvisa con una notifica quando arrivano elementi nuovi.
