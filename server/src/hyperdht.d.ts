/**
 * Tipi minimi di hyperdht (la libreria non li pubblica): solo ciò che usa il server.
 * Riferimento: https://github.com/holepunchto/hyperdht e dht-rpc (classe base).
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
    /** Nodo di avvio: porta fissa, raggiungibile, annuncia `host` come proprio indirizzo pubblico. */
    static bootstrapper (port: number, host: string, opts?: DhtOptions): HyperDHT
    ready (): Promise<void>
    destroy (): Promise<void>
    address (): { host: string, port: number } | null
    /** Nodi noti nella tabella di instradamento. */
    toArray (): { host: string, port: number }[]
    /** Indirizzo pubblico come lo vedono gli altri nodi (null finché non è noto). */
    readonly host: string | null
    readonly port: number
    readonly firewalled: boolean
    readonly ephemeral: boolean
    on (event: 'persistent' | 'ephemeral' | 'close', fn: () => void): this
    /** Coppia di chiavi Ed25519, deterministica se si passa un seme di 32 byte. */
    static keyPair (seed?: Buffer): { publicKey: Buffer, secretKey: Buffer }
    /** Server raggiungibile per chiave pubblica (qui: il relay, vedi relay.ts). */
    createServer (opts: object, onconnection: (socket: any) => void): { listen (keyPair: { publicKey: Buffer, secretKey: Buffer }): Promise<void>, close (): Promise<void> }
    /** Stream UDX sullo stesso socket del nodo (li usa il relay per inoltrare). */
    createRawStream (opts?: object): any
    /** Gestore delle richieste DHT (avvolto per contare l'attività, vedi dht-server.ts). */
    onrequest (req: any): boolean
  }
  export = HyperDHT
}

/** blind-relay (Holepunch): relay "cieco" di stream UDX già cifrati fra due peer. */
declare module 'blind-relay' {
  export class Server {
    constructor (opts: { createStream: (opts: object) => any })
    accept (socket: any, opts: { id: Buffer }): { on (event: 'error', fn: (err: Error) => void): any }
    close (): Promise<void>
  }
}
