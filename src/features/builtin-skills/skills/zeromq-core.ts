import type { BuiltinSkill } from "../types"

export const ZEROMQ_CORE_SKILL_NAME = "zeromq-core"

const ZEROMQ_CORE_SKILL_DESCRIPTION =
  "Use when setting up ZeroMQ contexts, sockets, or transports in Python with pyzmq — ZeroMQ fundamentals: the sockets-on-steroids mental model, context/socket lifecycle, tcp/ipc/inproc/pgm/epgm transports, bind versus connect semantics and reconnection, multipart framing, zmq.Poller reactors, high-water marks, LINGER, and the ecosystem. Related: zeromq-sockets-patterns."

export const zeromqCoreSkill: BuiltinSkill = {
  name: ZEROMQ_CORE_SKILL_NAME,
  description: ZEROMQ_CORE_SKILL_DESCRIPTION,
  template: `# ZeroMQ — Core Fundamentals

## MENTAL MODEL: SOCKETS ON STEROIDS

ZeroMQ sockets are not TCP sockets. They carry whole messages instead of bytes, they can be both client and server at once, they work across transports (threads, processes, machines) with the same API, and they reconnect silently when peers disappear. One ZeroMQ socket can hold many connections; there is no accept() call. Bind and connect can happen in either order for tcp/ipc: connections happen in the background, and messages sent before a peer appears are queued until it does.

The core rule: ZeroMQ assembles asynchronous I/O into an abstraction that behaves like a concurrency framework. You choose a socket type (pattern), wire endpoints, and let the library handle framing, queuing, reconnection, and flow control.

## CONTEXT AND SOCKET LIFECYCLE

- The context (zmq.Context in pyzmq) owns I/O threads and all sockets. Create ONE context per process, share it across threads.
- ctx.set(zmq.IO_THREADS, n) BEFORE creating sockets. Default is 1; rule of thumb is one I/O thread per GB/s of data. For pure inproc (no network I/O) you can set 0.
- ctx.set(zmq.MAX_SOCKETS, n) caps socket count (default 1023).
- Shutdown order: close every socket first (sock.close()), then ctx.term(). If you term while sockets are open, ctx.term blocks until they close, and blocking socket calls raise zmq.ContextTerminated (ETERM).
- LINGER (zmq.LINGER, per socket): how long close() waits for unsent messages. Default is -1 (wait forever, can hang shutdown). Set 0 to discard pending messages immediately, or a positive millisecond value to wait that long. For most services, set an explicit finite LINGER.
- with zmq.Context() as ctx: calls destroy() on exit, which force-closes remaining sockets. Convenient for scripts; for services prefer explicit close + term.

\`\`\`python
# Python (pyzmq): full lifecycle
import zmq

ctx = zmq.Context()
sock = ctx.socket(zmq.REP)
sock.linger = 1000  # ms after close; default -1 (infinite) can hang shutdown
sock.bind("tcp://*:5555")

msg = sock.recv()          # bytes
sock.send(b"World")

sock.close(linger=1000)    # or sock.close(); linger already set
ctx.term()
\`\`\`

\`\`\`python
# Python (pyzmq): context manager form (destroy() on exit)
import zmq

with zmq.Context() as ctx:
    with ctx.socket(zmq.REP) as sock:
        sock.bind("tcp://*:5555")
        sock.send(sock.recv())
# both socket and context are closed here
\`\`\`

## TRANSPORT MATRIX

| Transport | Endpoint form | Use for | Constraints |
|---|---|---|---|
| tcp | tcp://*:5555, tcp://host:port | machine-to-machine, general default | disconnected; elastic; portable |
| ipc | ipc:///tmp/feed.ipc | local process-to-process | Unix-like only (not Windows); file permissions matter; use .ipc suffix |
| inproc | inproc://name | inter-thread in one process | fastest; bind MUST happen before any connect (fixed in v4.0 but still required for older releases); cannot share across contexts |
| pgm | pgm://... | reliable multicast fan-out | requires network multicast support; advanced |
| epgm | epgm://... | multicast with encapsulation | same caveats as pgm |

Default to tcp. Use inproc for threads in one process, ipc for local processes. Do not reach for multicast unless unicast fan-out is genuinely impossible.

## BIND VS CONNECT AND RECONNECTION

- bind = endpoint is well-known (server side); connect = endpoint is arbitrary (client side). One socket may bind many endpoints and/or connect to many endpoints, across mixed transports.
- With tcp/ipc, connect can precede bind: ZeroMQ retries in the background. With inproc, bind must come first.
- Reconnection is automatic (zmq.RECONNECT_IVL, default 100 ms; zmq.RECONNECT_IVL_MAX for backoff). A dead peer's messages queue on the connecting side until it returns.
- Convention: bind REP/ROUTER/PUB/PULL, connect REQ/DEALER/SUB/PUSH. It is a convention, not a rule; either side can bind.
- You cannot bind the same endpoint twice (EADDRINUSE), except tcp with ROUTER (and similar) sockets in specific setups; do not rely on it.

## MESSAGE FRAMING

- A message is one or more frames. send/recv handle single-part messages; use send_multipart/recv_multipart for multipart messages.
- Frames are length-prefixed on the wire; you never deal with byte counts.
- Multipart messages are delivered atomically: all frames or none.
- The "identity" on ROUTER/DEALER is just an ordinary frame, not a special header. Envelopes are frames you compose yourself (address frame, empty delimiter, payload).
- Prefer single-part messages unless you need routing envelopes; every extra frame costs bandwidth and code.

\`\`\`python
# Python (pyzmq): multipart send and receive
import zmq

sock.send_multipart([b"key", b"value"])
frames = sock.recv_multipart()   # list[bytes]: [b"key", b"value"]
\`\`\`

## POLL LOOP / REACTOR

Use zmq.Poller to wait on multiple sockets instead of busy loops:

\`\`\`python
# Python (pyzmq): poll loop
import zmq

poller = zmq.Poller()
poller.register(frontend, zmq.POLLIN)
poller.register(backend, zmq.POLLIN)

while True:
    socks = dict(poller.poll(timeout=1000))  # timeout in ms; None or -1 blocks forever
    if frontend in socks:
        poller.unregister(frontend)  # for REQ/REP, unregister while handling
        msg = frontend.recv_multipart()
        frontend.send_multipart(msg)
        poller.register(frontend, zmq.POLLIN)
    if backend in socks:
        msg = backend.recv_multipart()
        backend.send_multipart(msg)
\`\`\`

For per-socket checks, sock.poll(ms, zmq.POLLIN) returns a bitmask. In asyncio code use zmq.asyncio (zmq.eventloop is deprecated since pyzmq 17). Reactors turn the code inside out: main loop is tiny, logic lives in handlers.

## HIGH-WATER MARKS AND FLOW CONTROL

- HWM (zmq.SNDHWM / zmq.RCVHWM) caps each pipe's queue. Default 1000 messages per direction.
- PUB and PUSH have only send buffers; SUB, PULL, REQ, REP only receive; DEALER, ROUTER, PAIR have both.
- When HWM is reached: blocking sockets block (or raise zmq.Again in non-blocking mode); PUB/SUB and PUSH/PULL drop messages rather than block.
- HWM is per connection, not per socket. Set it deliberately: too high blows memory on slow consumers, too low drops data. There is no built-in "queue full" notification; design for loss or use patterns that signal backpressure.

\`\`\`python
# Python (pyzmq): set HWM before bind/connect
sock.setsockopt(zmq.SNDHWM, 500)
sock.setsockopt(zmq.RCVHWM, 500)
\`\`\`

## ENVIRONMENT TUNING

- zmq.IO_THREADS: I/O threads per context (set via ctx.set before creating sockets).
- zmq.MAX_SOCKETS: socket cap per context (default 1023).
- Set socket options BEFORE bind/connect where the option affects connection setup. SUBSCRIBE/UNSUBSCRIBE and LINGER are the exceptions: SUBSCRIBE/UNSUBSCRIBE work any time, and LINGER applies at close time. Everything else (HWM, identities, timeouts, ROUTER_MANDATORY, TCP_KEEPALIVE, ...) only takes effect for subsequent bind/connect calls.
- The attribute form also works: sock.linger = 0, sock.hwm = 500.

\`\`\`python
# Python (pyzmq): SUBSCRIBE must be bytes
import zmq

ctx = zmq.Context()
sub = ctx.socket(zmq.SUB)
sub.setsockopt(zmq.SUBSCRIBE, b"")          # subscribe to everything
sub.setsockopt(zmq.SUBSCRIBE, b"prices ")   # prefix filter: leading bytes only
sub.connect("tcp://127.0.0.1:5555")
\`\`\`

## ERROR HANDLING QUICK TABLE

| Error | Meaning | Typical response |
|---|---|---|
| ETERM | Context was terminated | Exit loop, clean up, shut down |
| EAGAIN | Non-blocking op would block (HWM full, no message) | Retry later or drop |
| EFSM | Operation illegal for socket state (e.g. REQ send twice) | Fix pattern usage, not the call |
| EINTR | Interrupted by signal | Retry the call |
| EADDRINUSE | Endpoint already bound | Pick another endpoint |

In pyzmq these surface as exceptions, not return codes: zmq.ZMQError with .errno, and specific subclasses zmq.Again (EAGAIN), zmq.ContextTerminated (ETERM), zmq.InterruptedSystemCall (EINTR). zmq.NOBLOCK and zmq.DONTWAIT are the same flag (value 1). Catch zmq.Again explicitly, not bare ZMQError.

\`\`\`python
# Python (pyzmq): non-blocking receive with proper error handling
import zmq

try:
    msg = sock.recv(zmq.NOBLOCK)   # zmq.DONTWAIT is the same flag
except zmq.Again:
    pass  # nothing ready; retry later
except zmq.ContextTerminated:
    raise  # context gone; shut down
\`\`\`

## ECOSYSTEM AND COMMUNITY

- libzmq is the reference implementation (C), licensed MPLv2. Bindings: pyzmq (Python), zeromq.js (Node), JZMQ (Java), zmq (Ruby), clrzmq (.NET), erlzmq (Erlang), and many more.
- CZMQ is the high-level C framework (zsock, zloop, zstr, zframe, zproc); zproto generates protocol implementations. Its zhelpers map to small Python equivalents: socket_set_hwm(sock, hwm), dump(msg_or_socket), set_id(sock), and zpipe(ctx) (two inproc PAIR sockets, linger=0, hwm=1).
- The ZeroMQ community runs on the C4 (Collective Code Construction Contract): patches via pull requests, one commit one change, merge by any maintainer after review, no feature branches on master, remixability first. RFCs (e.g. ZMTP specs like ZMTP 3.0, ZMTP curve) define the wire protocols.
- The zguide (zguide.zeromq.org) is the canonical book; examples live in the zguide/examples repository and translations are contributed per language. Contributions follow the C4 process: fork, commit, pull request.
- Related reading: Chapter 2 for socket types and patterns (see zeromq-sockets-patterns).
`,
}
