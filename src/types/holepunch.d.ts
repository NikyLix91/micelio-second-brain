// Le librerie Holepunch non pubblicano tipi TypeScript. Le tipizziamo come `any` e le
// usiamo solo dietro i wrapper di src/net, che espongono interfacce tipizzate al resto del codice.
// EN: The Holepunch libraries don't ship TypeScript types. We type them as `any` and use them
//     only behind the wrappers in src/net, which expose typed interfaces to the rest of the code.
declare module 'autobase' { const m: any; export = m }
declare module 'corestore' { const m: any; export = m }
declare module 'hyperswarm' { const m: any; export = m }
declare module 'hyperbee' { const m: any; export = m }
declare module 'hypercore-crypto' { const m: any; export = m }
declare module 'hypercore' { const m: any; export = m }
declare module 'sodium-universal' { const m: any; export = m }
declare module 'blind-pairing' { const m: any; export = m }
declare module 'protomux-wakeup' { const m: any; export = m }
declare module 'b4a' { const m: any; export = m }
declare module 'z32' { const m: any; export = m }
declare module 'hyperdht/testnet' { const m: any; export = m }
declare module 'protomux' { const m: any; export = m }
declare module 'compact-encoding' { const m: any; export = m }
declare module 'hyperdht' { const m: any; export = m }
declare module 'blind-relay' { export const Server: any }
