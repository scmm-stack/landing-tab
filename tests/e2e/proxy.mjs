import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

/**
 * A forward proxy that records every request and refuses it, so nothing reaches
 * the internet during a test. The exceptions are TEST_SITE, a made-up host served
 * from here so favicon lookup can run end to end, and ASSET_HOST, the separate
 * domain its page keeps its big icon on, as large sites do.
 */
export const TEST_SITE = 'favicon-test.invalid';
export const ASSET_HOST = 'favicon-test-assets.invalid';

const ICON = readFileSync(new URL('../../public/icon/128.png', import.meta.url));
// Shaped like a real home page, because the inline style and script tags matter: the
// extension's content security policy refuses them if they ever reach a parser.
const PAGE = `<!doctype html><html><head><title>Test</title>
<link rel="stylesheet" href="/site.css" onload="tracked()"><style>body { color: red }</style>
<link rel="icon" sizes="16x16" href="/small-icon.png"><link rel="icon" sizes="128x128" href="http://${ASSET_HOST}/site-icon.png">
<script>window.tracked = true</script><script src="/app.js"></script></head>
<body style="margin: 0" onload="tracked()"><img src="/photo.jpg" onerror="tracked()"><iframe src="/frame"></iframe>hi</body></html>`;

export async function startProxy() {
  const log = [];
  const site = { pageDelayMs: 0 };
  const record = (entry) => log.push({ at: Date.now(), ...entry });

  const server = createServer((req, res) => {
    const url = new URL(req.url);
    record({ host: url.hostname, method: req.method, path: url.pathname + url.search, headers: req.headers });
    if (url.hostname !== TEST_SITE && url.hostname !== ASSET_HOST) {
      res.writeHead(502).end();
      return;
    }
    const headers = { 'access-control-allow-origin': '*' };
    if (url.hostname === ASSET_HOST) {
      if (url.pathname === '/site-icon.png') res.writeHead(200, { ...headers, 'content-type': 'image/png' }).end(ICON);
      else res.writeHead(404, headers).end();
    } else if (url.pathname === '/') {
      setTimeout(() => res.writeHead(200, { ...headers, 'content-type': 'text/html', 'set-cookie': 'tracking=1; Path=/' }).end(PAGE), site.pageDelayMs);
    }
    else res.writeHead(404, headers).end();
  });

  // HTTPS traffic arrives as CONNECT. Logging the host and dropping it is enough.
  server.on('connect', (req, socket) => {
    const [host] = req.url.split(':');
    record({ host, method: 'CONNECT', path: '', headers: {} });
    socket.end('HTTP/1.1 502 Refused\r\n\r\n');
  });
  server.on('clientError', (_error, socket) => socket.destroy());

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    log,
    site,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

export const hostsIn = (entries) => [...new Set(entries.map((e) => e.host))].sort();
