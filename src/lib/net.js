// ---------------------------------------------------------------------------
// Sharing a board.
//
// Two transports, same message shape:
//
//   BroadcastChannel  other tabs in this browser. Always on, needs nothing.
//   WebSocket         other people, via the relay in worker/. Opt in with
//                     ?room=<name>, and the board keeps working if it fails.
//
// Local-first on purpose. The board is useful with no network at all, so
// sharing is an additive layer rather than a dependency, and a relay that is
// down cannot take the tool with it.
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 4000;
const PEER_TIMEOUT_MS = 12000;

export function share({ room, relay, scene, identity, onRemote, onPeers }) {
  const peers = new Map();          // id -> { id, name, seen }
  const channel = 'BroadcastChannel' in globalThis
    ? new BroadcastChannel(`redline:${room || 'local'}`)
    : null;
  let socket = null;
  let closed = false;
  let heartbeat = null;

  const send = payload => {
    const message = { ...payload, from: identity.id, name: identity.name, room };
    channel?.postMessage(message);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  function receive(message) {
    if (!message || message.from === identity.id) return;   // never echo ourselves
    if (message.room && room && message.room !== room) return;

    touchPeer(message.from, message.name);

    if (message.kind === 'state') {
      const changed = scene.merge(message.doc);
      if (changed.length) onRemote?.(changed, message);
      return;
    }
    if (message.kind === 'hello') {
      // Somebody just arrived: hand them what we have rather than waiting for
      // the next edit, or their board stays empty until someone types.
      send({ kind: 'state', doc: scene.toJSON() });
    }
  }

  function touchPeer(id, name) {
    if (!id) return;
    const known = peers.get(id);
    peers.set(id, { id, name: name || known?.name || 'someone', seen: Date.now() });
    if (!known) onPeers?.(livePeers());
  }

  function livePeers() {
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    for (const [id, p] of peers) if (p.seen < cutoff) peers.delete(id);
    return [...peers.values()];
  }

  if (channel) channel.onmessage = ev => receive(ev.data);

  if (relay && room) {
    try {
      const url = new URL(relay);
      url.searchParams.set('room', room);
      socket = new WebSocket(url.toString());
      socket.onmessage = ev => {
        try { receive(JSON.parse(ev.data)); } catch { /* ignore malformed frames */ }
      };
      socket.onopen = () => send({ kind: 'hello' });
      socket.onerror = () => { /* the board still works; nothing to do */ };
      socket.onclose = () => { if (!closed) socket = null; };
    } catch {
      socket = null;
    }
  }

  send({ kind: 'hello' });
  heartbeat = setInterval(() => {
    send({ kind: 'hello' });
    onPeers?.(livePeers());
  }, HEARTBEAT_MS);

  return {
    /** Call after any local change. Sends the whole board; it is a few KB. */
    publish() { if (!closed) send({ kind: 'state', doc: scene.toJSON() }); },
    peers: livePeers,
    connected: () => socket?.readyState === WebSocket.OPEN,
    close() {
      closed = true;
      clearInterval(heartbeat);
      channel?.close();
      socket?.close();
    },
  };
}

/**
 * Identity is per tab, held in sessionStorage rather than localStorage.
 *
 * localStorage is shared across every tab in the browser, so both sides of a
 * two-tab board would have had the same id and each would have discarded the
 * other's messages as its own echo. sessionStorage survives a reload of one tab
 * and is invisible to the others, which is exactly the scope wanted here.
 */
export function whoAmI() {
  const KEY = 'redline:me';
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved?.id) return saved;
  } catch { /* fall through and make a new one */ }
  const me = { id: Math.random().toString(36).slice(2, 10), name: pickName() };
  try { sessionStorage.setItem(KEY, JSON.stringify(me)); } catch { /* ignore */ }
  return me;
}

// Readable rather than unique. Two people called "quiet-heron" is a smaller
// problem than a board full of hex.
const ADJECTIVES = ['quiet', 'plain', 'level', 'brisk', 'candid', 'patient', 'sharp'];
const ANIMALS = ['heron', 'otter', 'marten', 'shrike', 'ibex', 'plover', 'kite'];
const pickName = () =>
  `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}-`
  + ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
