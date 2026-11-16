// Where the game's data lives. './assets' next to the page in development; a deployed build
// (tools/build.mjs) sets window.PETALWAKE_ASSETS to a folder named for its content, so the files
// can be cached for good and a new version of them is a new address.
export const ASSETS = String(window.PETALWAKE_ASSETS || './assets').replace(/\/+$/, '');
