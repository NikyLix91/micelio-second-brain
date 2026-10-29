/**
 * @file Chiavi pubbliche Ed25519 accettate per gli aggiornamenti (vedi update-signature.ts).
 *
 * EN: Ed25519 public keys accepted for updates (see update-signature.ts).
 *
 * Le aggiunge `node scripts/update-signing.js keygen`, che scrive la chiave privata in un file
 * FUORI dalla repository: quella va nel segreto `UPDATE_SIGNING_KEY` dell'environment `release`
 * di GitHub e in un gestore di password, mai qui né in un commit.
 *
 * Cambio di chiave (persa o compromessa): si aggiunge la nuova in una release firmata con la
 * vecchia, e si toglie la vecchia in una release successiva. Un'app che non conosce nessuna delle
 * chiavi con cui sono firmate le release va aggiornata a mano.
 *
 * Elenco vuoto: l'app non installa nessun aggiornamento (avvisa soltanto che c'è).
 *
 * EN: Added by `node scripts/update-signing.js keygen`, which writes the private key to a file
 * OUTSIDE the repository: that one goes into the `UPDATE_SIGNING_KEY` secret of GitHub's
 * `release` environment and into a password manager, never here nor in a commit.
 *
 * EN: Key change (lost or compromised): the new one is added in a release signed with the old
 * one, and the old one is removed in a later release. An app that knows none of the keys the
 * releases are signed with must be updated by hand.
 *
 * EN: Empty list: the app installs no update (it only reports that one exists).
 */
export const UPDATE_PUBLIC_KEYS: string[] = [
]
