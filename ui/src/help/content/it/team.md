# Team

Un team è un gruppo di PC che condividono lo stesso sapere. Un progetto con persone diverse è un team separato.

## Membri e ruoli {#members}

- **Membro**: può scrivere nel proprio feed (ricordi, voti, Radici, inviti). Ogni membro è un *writer* di Autobase.
- **Admin**: in più può espellere, promuovere, cambiare le impostazioni condivise e redigere ricordi. Gli admin sono anche **indexer**: fissano l'ordine definitivo del log del team.

Il fondatore è il primo admin. L'albero nella pagina Team mostra chi è entrato con l'invito di chi.

## Inviti {#invites}

**Qualunque membro** può creare un invito: un codice monouso, valido 24 ore, da mandare solo alla persona interessata (è un segreto). Il collega lo usa con «Ho un invito» nell'app o con `micelio join <codice> --name <nome-pc>`. Lo accoglie qualunque membro online che ha già ricevuto l'invito: per questo, se nessun altro membro è online, chi ha creato l'invito deve restare acceso finché il collega non è entrato.

## Espulsione {#removal}

Solo un admin può espellere un membro (evento `member.remove`): da quel momento i suoi nuovi eventi vengono ignorati da tutti. Ciò che aveva già scritto resta nel log. Limite attuale: l'espulso conserva la copia del sapere che aveva già sul suo PC.

## Impostazioni condivise {#shared-settings}

Le impostazioni del team sono eventi `team.config`, scritti da un admin e replicati a tutti:
- **lingua dei ricordi distillati** (italiano o inglese): i ricordi nascono in questa lingua, qualunque sia la lingua della fonte;
- **ricordi massimi per distillazione** (1–20, default 5): vedi Qualità della distillazione;
- **parole che bloccano** un contenuto, in aggiunta a quelle di default;
- le **regole di sicurezza** (schermata Sicurezza).

Le impostazioni personali del tuo PC (rete, cartelle, modelli LLM) sono invece in Impostazioni.
