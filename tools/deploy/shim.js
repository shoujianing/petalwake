// Inlined into the built index.html by tools/build.mjs, ahead of the game's modules.
//
// The build gives every asset a name that says what is in it (terrain/height.1a2b3c4d.u16), so it
// can be cached for good, and stores the big binaries gzipped (.pwz) since most static hosts will
// not compress application/octet-stream themselves. The game still asks for ./assets/terrain/height.u16:
// this maps the address and, for a .pwz, unzips the bytes as they arrive.
(function () {
  var MAP = window.PETALWAKE_MAP || {};
  var ROOT = new URL('./', document.baseURI).href;
  var native = window.fetch.bind(window);
  var canUnzip = typeof DecompressionStream === 'function';
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    if (!url) return native(input, init);
    var abs = new URL(url, document.baseURI);
    var rel = abs.href.indexOf(ROOT) === 0 ? abs.href.slice(ROOT.length).split(/[?#]/)[0] : null;
    var to = rel && MAP[rel];
    if (!to) return native(input, init);
    var zipped = /\.pwz$/.test(to);
    if (zipped && !canUnzip) return Promise.reject(new Error('this browser cannot unpack the game data (no DecompressionStream)'));
    var opts = init || (typeof input === 'object' && !(input instanceof URL) ? { signal: input.signal, credentials: input.credentials } : undefined);
    var target = /^https?:/.test(to) ? to : ROOT + to;
    return native(target, opts).then(function (res) {
      if (!res.ok || !zipped) return res;
      return new Response(res.body.pipeThrough(new DecompressionStream('gzip')), {
        status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/octet-stream' },
      });
    });
  };
})();
