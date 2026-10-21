/**
 * Tipi minimi di hyperdht (la libreria non li pubblica): solo ciò che usa il server.
 * Riferimento: https://github.com/holepunchto/hyperdht e dht-rpc (classe base).
 *
 * EN: Minimal hyperdht types (the library does not publish them): only what the server uses.
 * Reference: https://github.com/holepunchto/hyperdht and dht-rpc (base class).
 */
declare module 'hyperdht' {
  interface DhtOptions {
    port?: number
    host?: string
    bootstrap?: (string | { host: string, port: number })[]
    ephemeral?: boolean
    firewalled?: boolean
    anyPort?: boolean
  }
  class HyperDHT {
    constructor (opts?: DhtOptions)
    /** Nodo di avvio: porta fissa, raggiungibile, annuncia `host` come proprio indirizzo pubblico. / EN: Bootstrap node: fixed port, reachable, announces `host` as its public address. */
    static bootstrapper (port: number, host: string, opts?: DhtOptions): HyperDHT
    ready (): Promise<void>
    destroy (): Promise<void>
    address (): { host: string, port: number } | null
    /** Nodi noti nella tabella di instradamento. / EN: Known nodes in the routing table. */
    toArray (): { host: string, port: number }[]
    /** Indirizzo pubblico come lo vedono gli altri nodi (null finché non è noto). / EN: Public address as other nodes see it (null until known). */
    readonly host: string | null
    readonly port: number
    readonly firewalled: boolean
    readonly ephemeral: boolean
    on (event: 'persistent' | 'ephemeral' | 'close', fn: () => void): this
    /** Coppia di chiavi Ed25519, deterministica se si passa un seme di 32 byte. / EN: Ed25519 key pair, deterministic when a 32-byte seed is given. */
    static keyPair (seed?: Buffer): { publicKey: Buffer, secretKey: Buffer }
    /** Server raggiungibile per chiave pubblica (qui: il relay, vedi relay.ts). / EN: Server reachable by public key (here: the relay, see relay.ts). */
    createServer (opts: object, onconnection: (socket: any) => void): { listen (keyPair: { publicKey: Buffer, secretKey: Buffer }): Promise<void>, close (): Promise<void> }
    /** Stream UDX sullo stesso socket del nodo (li usa il relay per inoltrare). / EN: UDX stream on the node's own socket (the relay uses them to forward). */
    createRawStream (opts?: object): any
    /** Gestore delle richieste DHT (avvolto per contare l'attività, vedi dht-server.ts). / EN: DHT request handler (wrapped to count activity, see dht-server.ts). */
    onrequest (req: any): boolean
  }
  export = HyperDHT
}

/** blind-relay (Holepunch): relay "cieco" di stream UDX già cifrati fra due peer. / EN: blind-relay (Holepunch): "blind" relay of UDX streams already encrypted between two peers. */
declare module 'blind-relay' {
  export class Server {
    constructor (opts: { createStream: (opts: object) => any })
    accept (socket: any, opts: { id: Buffer }): { on (event: 'error', fn: (err: Error) => void): any }
    close (): Promise<void>
  }
}
