/**
 * @file Token di iniezione e chiavi di metadati del daemon NestJS.
 */

/** Token con cui si iniettano le DaemonOptions (vedi MicelioModule.forRoot). */
export const DAEMON_OPTIONS = Symbol('DAEMON_OPTIONS')

/**
 * Chiave di metadato per marcare una rotta come accessibile SENZA token:
 * `@SetMetadata(PUBLIC_ROUTE, true)`. Oggi la usa solo /api/health.
 */
export const PUBLIC_ROUTE = 'micelio:public'
