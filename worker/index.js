// ---------------------------------------------------------------------------
// Relay for shared boards. Cloudflare Worker plus one Durable Object per room.
//
// It is a relay and not a store. Frames are forwarded to the other sockets in
// the room and the last state seen is kept only so that somebody joining a
// board mid-discussion is not shown an empty canvas. Nothing is written to
// disk, so an unshipped plan does not become somebody else's persisted data.
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true });
    }

    if (url.pathname !== '/room') {
      return new Response('not found', { status: 404 });
    }

    const room = (url.searchParams.get('room') || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/i.test(room)) {
      return json({ error: 'room must be 1 to 49 characters of letters, digits or hyphens' }, 400);
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'this endpoint speaks websocket' }, 426);
    }

    const id = env.BOARD.idFromName(room.toLowerCase());
    return env.BOARD.get(id).fetch(request);
  },
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

export class Board {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();
    this.latest = null;        // last state frame seen, in memory only
  }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);

    if (this.latest) {
      try { server.send(this.latest); } catch { /* the socket died immediately */ }
    }

    server.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 512 * 1024) return;
      let frame;
      try { frame = JSON.parse(ev.data); } catch { return; }
      if (frame?.kind === 'state') this.latest = ev.data;
      this.broadcast(ev.data, server);
    });

    const drop = () => this.sockets.delete(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(data, except) {
    for (const socket of this.sockets) {
      if (socket === except) continue;
      try { socket.send(data); } catch { this.sockets.delete(socket); }
    }
  }
}
