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
  }
  export = HyperDHT
}
