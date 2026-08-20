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

/* CORS, without which the browser never reaches this Worker at all.
 *
 * POST /new sends application/json, which forces a preflight. With no OPTIONS
 * handler and no Access-Control headers, that preflight 404'd and "Start a new
 * table" failed one hundred per cent of the time — the player heard "the table
 * could not be made" and there was nothing in the Worker's logs to suggest why,
 * because the request that failed never got as far as the route. */
function corsHeaders(origin, allowed) {
  if (!origin) return {};
  if (allowed.length && allowed.indexOf(origin) < 0) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

function json(body, status = 200, cors = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign(
      { 'content-type': 'application/json', 'cache-control': 'no-store' },
      cors
    )
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
    const cors = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/health') return json({ ok: true }, 200, cors);

    if (url.pathname === '/new' && request.method === 'POST') {
      if (!originOk) return json({ error: 'not allowed from there' }, 403, cors);

      /* The per-IP cap the wrangler.toml declares. It was declared and never
       * consulted, while both this file and the toml claimed the code space was
       * "not walkable" because of it — a security property asserted in a comment
       * and implemented nowhere. */
      if (env.NEW_TABLE_LIMIT) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const { success } = await env.NEW_TABLE_LIMIT.limit({ key: ip });
        if (!success) {
          return json({ error: 'too many tables from here just now; wait a minute' }, 429, cors);
        }
      }

      const code = makeCode();
      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      const body = await request.json().catch(() => ({}));
      await stub.fetch('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code, config: body.config || null })
      });
      return json({ code }, 200, cors);
    }

    if (url.pathname === '/join') {
      if (!originOk) return json({ error: 'not allowed from there' }, 403, cors);
      const code = normaliseCode(url.searchParams.get('code'));
      if (code.length < 5) return json({ error: 'that is not a table code' }, 400, cors);
      const id = env.ROOM.idFromName(code);
      return env.ROOM.get(id).fetch(request);
    }

    return json({ error: 'not found' }, 404, cors);
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
      botDelay: 1200,
      /* Ninety seconds before a SILENT seat is played by the computer, and half
       * an hour before a seat whose browser is still pinging is.
       *
       * Those were one number, and ninety seconds is an ordinary length of time
       * to spend on a bury when the hand has to be read aloud first — so the
       * clock ran out on players who were sitting right there, took their cards,
       * and never gave the seat back. A client that is still answering its pings
       * has not stopped responding, whatever it is doing with its turn.
       *
       * The seat is not lost either way now: any move takes it straight back. */
      turnGrace: 90000,
      awayGrace: 30 * 60 * 1000,
      /* THREE MINUTES, NOT ONE, AND THE REASON IS THE BROWSER RATHER THAN THE
       * NETWORK.
       *
       * This was two ping intervals — sixty seconds — on the reasoning that a
       * live client pings every twenty-five and one may go missing. That
       * reasoning holds only while the tab is in front. Chrome throttles timers
       * in a BACKGROUNDED tab to roughly once a minute, and harder still after
       * a few minutes hidden, so a perfectly healthy browser that the player
       * has alt-tabbed away from pings at about the same rate as the window it
       * had to beat.
       *
       * Caught in real play, and it took both seats at once: two live,
       * responsive tabs were declared to have stopped responding and the
       * computer played out the whole hand. Alt-tabbing is not a fault
       * condition — it is what everybody does, and a screen reader user may
       * have the browser behind something else the entire time.
       *
       * The cost is that a client that really has died holds the table for
       * longer than ninety seconds. Be honest about how much longer: presence
       * is POLLED, once per turnGrace, so a check landing just inside the
       * window re-arms for another ninety seconds. Worst case is
       * presenceWindow + turnGrace — four and a half minutes, not three.
       *
       * Still the right way round: a slow recovery from a genuine disconnection
       * is an inconvenience, and playing a present player's cards for them is
       * the bug we are fixing. */
      presenceWindow: 180000
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
      return { id: att.connId, seat: att.seat, seenAt: att.seenAt, ws };
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
    room.wake(this.liveConnections().map(c => ({ id: c.id, seat: c.seat, seenAt: c.seenAt })));
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
      room.start();   // prepares the room; the first hand waits for a player to begin
      return new Response('ok');
    }

    if (url.pathname === '/join') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected a websocket', { status: 426 });
      }
      const rawSeat = url.searchParams.get('seat');
      const seat = rawSeat === null || rawSeat === '' ? null : Number(rawSeat);
      const name = url.searchParams.get('name') || '';

      await this.hydrate();
      /* A code nobody created is not a table.
       *
       * idFromName() always resolves, so without this a typo'd code silently
       * produced a BRAND NEW EMPTY ROOM that looked perfectly fine — the player
       * would sit alone at a table their friend was not at, with nothing to say
       * anything was wrong. Refusing is far kinder than a table that works and
       * is the wrong one. */
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      /* A code nobody created is refused over the SOCKET, not with an HTTP 404.
       *
       * A 404 to an upgrade request reaches the browser as a bare onerror plus a
       * close with code 1006 and no reason, so net.js could only report "the
       * connection was lost" — telling somebody who mistyped one character that
       * their network had broken. Accepting and closing with 4004 lets the
       * carefully written "there is no table with that code" actually reach them.
       * The 4004 branch in net.js was unreachable until now. */
      if (!this.cache.meta) {
        this.ctx.acceptWebSocket(server);
        try { server.close(4004, 'no table with that code'); } catch (e) { /* gone */ }
        return new Response(null, { status: 101, webSocket: client });
      }

      const room = await this.wakeRoom(defaultConfig());
      const connId = crypto.randomUUID();

      /* Hibernation, not a held socket: the object may be evicted while this
       * connection is idle, which for a card game is most of the time. Without
       * it the room would be billed for every second somebody sits thinking
       * about their bury. */
      this.ctx.acceptWebSocket(server);

      /* THE ATTACHMENT IS WRITTEN AFTER THE SEAT IS KNOWN.
       *
       * It used to be written first, with whatever the client asked for — and
       * the client deliberately asks for nothing, so it stored seat: null.
       * liveConnections() drops anything without a numeric seat, so the socket
       * was invisible to the room from the moment it opened: the welcome went
       * nowhere, every broadcast went nowhere, and after an eviction the room
       * believed the table was empty and handed the next player the same seat.
       *
       * The player saw "Connected to table P, 4, K, 7, M." and then silence, for
       * ever, with no error anywhere. Online mode could not work at all. */
      const r = room.join(connId, seat, name);
      if (!r.ok) {
        try { server.close(4001, r.reason); } catch (e) { /* already gone */ }
        return new Response(null, { status: 101, webSocket: client });
      }
      server.serializeAttachment({ connId, seat: r.seat, seenAt: Date.now() });

      /* join() delivered the welcome while the attachment was still unwritten,
       * so send it now that this socket can be found. */
      room.resend(connId);
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

    /* ANY FRAME IS PROOF OF LIFE, and the mark goes on the socket.
     *
     * The attachment is the one thing that survives hibernation without a
     * storage write and without rebuilding the room, which is what lets the
     * keepalive stay cheap. wake() rebuilds the room's whole connection map
     * from these attachments, so this is not merely the cheapest channel for
     * presence — it is the ONLY one that reaches the room at all.
     *
     * That is why this is not in the ping branch, where it started. The room
     * also stamps its own in-memory record when a seat acts, and that write was
     * silently thrown away on the very next wake: actions never touched the
     * attachment, so the room's presence check could only ever see pings. A
     * player actively playing cards is the least ambiguous evidence there is
     * that somebody is there, and it was the one signal not being counted. */
    ws.serializeAttachment(Object.assign({}, att, { seenAt: Date.now() }));

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
