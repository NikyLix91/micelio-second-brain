/**
 * @file Token di iniezione e chiavi di metadati del daemon NestJS.
 *
 * EN: Injection tokens and metadata keys of the NestJS daemon.
 */

/** Token con cui si iniettano le DaemonOptions (vedi MicelioModule.forRoot). / EN: Token used to inject the DaemonOptions (see MicelioModule.forRoot). */
export const DAEMON_OPTIONS = Symbol('DAEMON_OPTIONS')

/**
 * Chiave di metadato per marcare una rotta come accessibile SENZA token:
 * `@SetMetadata(PUBLIC_ROUTE, true)`. Oggi la usa solo /api/health.
 *
 * EN: Metadata key to mark a route as accessible WITHOUT a token: `@SetMetadata(PUBLIC_ROUTE, true)`. Today
 * only /api/health uses it.
 */
export const PUBLIC_ROUTE = 'micelio:public'
