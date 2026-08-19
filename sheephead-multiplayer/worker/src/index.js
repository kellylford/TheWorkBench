/* Sheephead multiplayer - the Cloudflare edge of the room.
 *
 * Deliberately thin. Everything that decides anything — the rules, who may act,
 * what each seat may see, what survives eviction — lives in ../../js and is
 * tested in plain Node. This file does three things the platform requires and
 * nothing else: accept a WebSocket, route it to the right room, and translate
 * between the platform's hibernation API and the room's own vocabulary.
 *
 * That split is the point. A Durable Object is awkward to test and slow to
 * iterate on; a pure function of (storage, clock, alarms, deliver) is neither.
 * If a bug can be reproduced in tests/room.js it will be, and only what genuinely
 * cannot be — the platform's own behaviour — is left here.
 */

/* The engine files are plain scripts that attach to a global. Workers have no
 * `window`, so give them one before they load: it is the same shim
 * tests/*.js use, and it means the engine deployed here is the exact file the
 * browser runs and the tests exercise, not a port of it. */
globalThis.window = globalThis;

import '../../js/cards.js';
import '../../js/game.js';
import '../../js/ai.js';
import '../../js/view.js';
import '../../js/room.js';

const SH = globalThis.SH;

/* Codes people have to read to each other.
 *
 * No 0/O and no 1/I/L: a code is spoken down a phone or typed by somebody who
 * cannot see the screen, and "was that a one or an I" is a bad first experience
 * of a game built for exactly that person. Five characters from 23 letters is
 * about 6.4 million combinations, which with the rate limit below is not
 * walkable. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/* Accept the same code however it was typed: lower case, with the spaces or
 * hyphens people add when reading aloud, or with a stray dash from a copy and
 * paste. Anything that is not in the alphabet simply is not part of the code. */
function normaliseCode(raw) {
  return String(raw || '').toUpperCase().split('').filter(c => CODE_ALPHABET.includes(c)).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* WebSockets bypass CORS entirely, so without this any page anywhere could
     * open a socket to somebody's table. It is the cheapest abuse defence there
     * is and the one most often left out. */
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = !origin || allowed.length === 0 || allowed.includes(origin);

    if (url.pathname === '/health') return json({ ok: true });

    if (url.pathname === '/new' && request.method === 'POST') {
      if (!originOk) return json({ error: 'not allowed from there' }, 403);
      const code = makeCode();
      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      const body = await request.json().catch(() => ({}));
      await stub.fetch('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code, config: body.config || null })
      });
      return json({ code });
    }

    if (url.pathname === '/join') {
      if (!originOk) return json({ error: 'not allowed from there' }, 403);
      const code = normaliseCode(url.searchParams.get('code'));
      if (code.length < 5) return json({ error: 'that is not a table code' }, 400);
      const id = env.ROOM.idFromName(code);
      return env.ROOM.get(id).fetch(request);
    }

    return json({ error: 'not found' }, 404);
  }
};

export class SheepheadRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
  }

  /* Build the room over this object's storage.
   *
   * Rebuilt on every wake rather than held: the platform may have evicted us
   * between any two messages, and pretending otherwise is how a room ends up
   * with a version counter that restarts and clients that silently discard
   * everything after it. */
  ensureRoom(config) {
    if (this.room) return this.room;

    const cache = this.cache || (this.cache = {});
    const storage = {
      get: key => (key in cache ? cache[key] : null),
      put: (key, value) => {
        cache[key] = value;
        /* Written through on every change rather than batched. A room is a few
         * kilobytes and a hand is a few dozen writes; correctness under eviction
         * is worth far more here than the writes saved. */
        this.ctx.storage.put(key, value);
      }
    };

    this.room = SH.Room.create({
      config,
      storage,
      now: () => Date.now(),
      setAlarm: at => this.ctx.storage.setAlarm(at),
      deliver: (connId, message) => this.send(connId, message),
      botDelay: 1200
    });
    return this.room;
  }

  /* Load storage into the cache the room reads through. Async, so it happens
   * once per wake before anything touches the room. */
  async hydrate() {
    if (this.cache) return;
    this.cache = {};
    const all = await this.ctx.storage.list();
    for (const [k, v] of all) this.cache[k] = v;
  }

  /* The sockets the platform kept alive while we were evicted. The seat lives in
   * the socket's attachment because it is the only thing that survives with it —
   * and because the seat must come from the connection, never from a message. */
  liveConnections() {
    return this.ctx.getWebSockets().map(ws => {
      const att = ws.deserializeAttachment() || {};
      return { id: att.connId, seat: att.seat, ws };
    }).filter(c => c.id !== undefined && typeof c.seat === 'number');
  }

  send(connId, message) {
    for (const c of this.liveConnections()) {
      if (c.id === connId) {
        try { c.ws.send(JSON.stringify(message)); } catch (e) { /* closing */ }
        return;
      }
    }
  }

  async wakeRoom(config) {
    await this.hydrate();
    const room = this.ensureRoom(config);
    room.wake(this.liveConnections().map(c => ({ id: c.id, seat: c.seat })));
    return room;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/create') {
      const body = await request.json().catch(() => ({}));
      await this.hydrate();
      if (!this.cache.meta) {
        this.cache.meta = { code: body.code, createdAt: Date.now() };
        await this.ctx.storage.put('meta', this.cache.meta);
      }
      const room = await this.wakeRoom(body.config || defaultConfig());
      if (!this.cache.state) room.start();
      return new Response('ok');
    }

    if (url.pathname === '/join') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected a websocket', { status: 426 });
      }
      const seat = Number(url.searchParams.get('seat'));
      const name = url.searchParams.get('name') || '';

      const room = await this.wakeRoom(defaultConfig());
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const connId = crypto.randomUUID();

      /* Hibernation, not a held socket: the object may be evicted while this
       * connection is idle, which for a card game is most of the time. Without
       * it the room would be billed for every second somebody sits thinking
       * about their bury. */
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ connId, seat });

      const r = room.join(connId, seat, name);
      if (!r.ok) {
        try { server.close(4001, r.reason); } catch (e) { /* already gone */ }
        return new Response(null, { status: 101, webSocket: client });
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws, raw) {
    const att = ws.deserializeAttachment() || {};
    if (att.connId === undefined) return;

    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;

    /* Answered before the room is woken, deliberately. A keepalive must not cost
     * a storage read and a rebuild every twenty-five seconds per player — that
     * would turn an idle table, which is most of a card game, into the most
     * expensive thing the room does. */
    if (msg.type === 'ping') {
      try { ws.send(JSON.stringify({ type: 'pong', at: msg.at })); } catch (e) { /* closing */ }
      return;
    }

    const room = await this.wakeRoom(defaultConfig());
    if (msg.type === 'action') room.action(att.connId, msg);
    else if (msg.type === 'leave') room.leave(att.connId);
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment() || {};
    if (att.connId === undefined) return;
    const room = await this.wakeRoom(defaultConfig());
    room.leave(att.connId);
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }

  /* The only thing that moves a table along when nobody is typing. A hibernated
   * object has no timers at all, so every delay in this game is an alarm or it
   * does not happen. */
  async alarm() {
    const room = await this.wakeRoom(defaultConfig());
    room.onAlarm();
  }
}

function defaultConfig() {
  return {
    numPlayers: 5,
    names: ['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4', 'Seat 5'],
    allPass: 'leaster',
    difficulty: 'hard',
    blackQueenDoubler: false,
    redQueenDoubler: false,
    redealDoubler: false
  };
}
