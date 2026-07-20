import serverPackage from './package.json' with { type: 'json' }

export const SERVER_VERSION = serverPackage.version
