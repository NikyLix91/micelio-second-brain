/**
 * @file Versione dell'app, dal package.json accanto a dist/ (nell'installazione: quella dell'app).
 *
 * EN: App version, from the package.json next to dist/ (in the installation: the app's own).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const APP_VERSION: string = (require('../../package.json') as { version: string }).version
