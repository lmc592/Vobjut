/**
 * Dev reverse proxy so the whole app is reachable on ONE origin (the v0 preview port).
 *   /api/*  -> FastAPI backend (BACKEND_PORT, default 8001)
 *   /*      -> Expo/Metro web dev server (METRO_PORT, default 8081)
 * Also forwards WebSocket upgrades to Metro so Fast Refresh / HMR keeps working.
 */
const http = require("http");
const net = require("net");

const LISTEN_PORT = Number(process.env.PROXY_PORT || 3000);
const METRO_PORT = Number(process.env.METRO_PORT || 8081);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8001);
const HOST = "127.0.0.1";

function targetPortFor(url) {
  return url && url.startsWith("/api") ? BACKEND_PORT : METRO_PORT;
}

const server = http.createServer((req, res) => {
  const port = targetPortFor(req.url);
  const proxyReq = http.request(
    {
      host: HOST,
      port,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );
  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Proxy error: " + err.message);
  });
  req.pipe(proxyReq, { end: true });
});

// Forward WebSocket upgrades (Metro HMR) to Metro.
server.on("upgrade", (req, socket, head) => {
  const port = targetPortFor(req.url);
  const upstream = net.connect(port, HOST, () => {
    const headerLines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(headerLines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(
    `[dev-proxy] listening on ${LISTEN_PORT} -> metro:${METRO_PORT}, backend:${BACKEND_PORT}`
  );
});
