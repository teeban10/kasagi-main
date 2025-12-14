import http from 'node:http';
import { config } from './config/env.js';
import { getRoomStats, rooms } from './rooms/room-manager.js';
import { logger } from '../utils/logger.js';

const debugLogger = logger.child({ module: 'debug-ui', instanceId: config.instanceId });
let server: http.Server | null = null;

function buildStatsPayload() {
  const stats = getRoomStats();
  const roomDetails = stats.roomDetails.map((detail) => {
    const room = rooms.get(detail.roomId);
    return {
      ...detail,
      entities: room?.state.entities ?? {},
    };
  });
  return {
    ...stats,
    roomDetails,
  };
}

const htmlTemplate = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Kasagi Rooms Debug</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 20px; background: #0f0f0f; color: #f5f5f5; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
      th, td { border: 1px solid #555; padding: 8px; text-align: left; }
      tr:hover { background: rgba(255,255,255,0.08); cursor: pointer; }
      pre { background: #111; border: 1px solid #444; padding: 10px; max-height: 300px; overflow: auto; }
      .meta { margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <h1>Kasagi Rooms</h1>
    <div class="meta" id="meta">Loading...</div>
    <table>
      <thead>
        <tr><th>Room</th><th>Clients</th><th>Tick</th><th>Seq</th></tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <h2>Last payload (click row to inspect)</h2>
    <pre id="payload"></pre>
    <script>
      async function refresh() {
        try {
          const resp = await fetch('/debug/rooms');
          if (!resp.ok) throw new Error(resp.statusText);
          const data = await resp.json();
          document.getElementById('meta').textContent =
            'rooms=' + data.totalRooms + ' clients=' + data.totalClients;
          const rows = document.getElementById('rows');
          rows.innerHTML = '';
          data.roomDetails.forEach((room) => {
            const tr = document.createElement('tr');
            tr.innerHTML =
              '<td>' + room.roomId + '</td>' +
              '<td>' + room.clients + '</td>' +
              '<td>' + room.tick + '</td>' +
              '<td>' + room.seq + '</td>';
            tr.addEventListener('click', () => {
              document.getElementById('payload').textContent = JSON.stringify(room.entities, null, 2);
            });
            rows.appendChild(tr);
          });
        } catch (err) {
          document.getElementById('meta').textContent = 'Error: ' + err.message;
        }
      }
      setInterval(refresh, 1500);
      refresh();
    </script>
  </body>
</html>
`;

function sendJson(res: http.ServerResponse) {
  const payload = buildStatsPayload();
  const body = JSON.stringify(payload);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.writeHead(200);
  res.end(body);
}

export function startDebugUi(): void {
  if (!config.debugUI.enabled) {
    debugLogger.info('Debug UI is disabled');
    return;
  }

  server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end('Missing URL');
      return;
    }

    const path = req.url.split('?')[0];
    if (path === '/debug/rooms') {
      sendJson(res);
      return;
    }

    if (path === '/debug' || path === '/debug/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(htmlTemplate);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(config.debugUI.port, () => {
    debugLogger.info({ port: config.debugUI.port }, 'Debug UI listening');
  });
}

export async function stopDebugUi(): Promise<void> {
  if (!server) {
    return;
  }

  return new Promise((resolve) => {
    server!.close(() => {
      debugLogger.info('Debug UI stopped');
      server = null;
      resolve();
    });
  });
}
