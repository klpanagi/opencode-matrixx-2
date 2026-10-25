import type { BuiltinSkill } from "../types"

export const ZEROMQ_ARCHITECTURE_SKILL_NAME = "zeromq-architecture"

const ZEROMQ_ARCHITECTURE_SKILL_DESCRIPTION =
  "Use when architecting large-scale ZeroMQ systems or embedding ZeroMQ inside a process — advanced architecture with pyzmq: mailbox and inproc signaling, reactors, the state-machine model, liberating APIs, million-connection scale, and cost/failure tradeoffs. Related: zeromq-core, zeromq-frameworks."

export const zeromqArchitectureSkill: BuiltinSkill = {
  name: ZEROMQ_ARCHITECTURE_SKILL_NAME,
  description: ZEROMQ_ARCHITECTURE_SKILL_DESCRIPTION,
  template: `# ZeroMQ — Advanced Architecture

Playbook for architecting large-scale ZeroMQ systems, based on the zguide (Chapter 7, Advanced Architecture using ZeroMQ), with pyzmq as the reference implementation. ZeroMQ removes friction, which makes big blunders cheap. The rarest property of any distributed system is accuracy: encode/decode data, define protocols, secure them, and make stacks robust. Design for that, not for raw speed.

## DESIGNING FOR SCALE

### The million-connections mindset
- ZeroMQ handles thousands of connections per socket; scale comes from architecture, not tuning. Think in terms of many small, independent pieces talking over contracts, not one big process.
- Brokerless (PUB-SUB, PUSH-PULL, DEALER-ROUTER direct): lowest latency, no single point of failure, but you own discovery, reconnection, and topology. Brokered (Majordomo-style broker between clients and workers): central discovery, easier monitoring, but the broker is a bottleneck and a failure point.
- Rule of thumb: brokerless for fixed topologies and high fan-out; brokered when peers are dynamic and you need service semantics. Hybrid is normal: brokers at the edge, direct links inside clusters.
- Decentralize like git, not like a cloud service: every node can be both client and server (the FileMQ model). Avoid forced symmetry in the protocol even when the architecture is symmetric.

### MOPED: grow the architecture
Message-Oriented Pattern for Elastic Design. Grow, do not build. Five steps:
1. Internalize ZeroMQ semantics (patterns, HWM, slow joiner, lost messages).
2. Draw a rough architecture on one page.
3. Decide the contracts (protocols, message shapes) before implementations.
4. Build a minimal end-to-end solution that works.
5. Solve one problem at a time, adding pieces and testing each.
Focus on contracts, not implementations, to avoid premature optimization. Ultra-short test-driven cycles.

## THE MAILBOX PATTERN: MULTITHREADING IN ONE PROCESS

The classic object model for embedding ZeroMQ in a process (the zguide's multithreading examples in Chapter 2, reused as the shape of Chapter 7's server objects such as FileMQ):

- Each object (server, client, worker) owns a background thread. The constructor starts the thread; the thread owns its own ZeroMQ context usage.
- The API object and the worker thread talk over a "pipe": two PAIR sockets connected over inproc://. PAIR is exclusive, low-overhead, and ideal for exactly one pipe per thread.
- CRITICAL: inproc:// only works across threads that share the same Context. Always pass \`zmq.Context.instance()\` into the thread; a per-thread \`zmq.Context()\` cannot see the pipe endpoint.
- The worker thread uses exactly one I/O thread (set via ZMQ_IO_THREADS, typically 1) and talks to the outside world with DEALER/ROUTER/PUB/SUB sockets.
- The classic trick for a synchronous-looking API: the caller sends a REQ over inproc to the worker's ROUTER, or the worker signals itself via an inproc PAIR socket so a blocking recv loop can wake on both commands and I/O events.
- Never share sockets between threads. A socket is not thread-safe; ownership is per-thread. Pass data as messages, not mutexes.
- Shutdown: send a terminate command down the pipe, wait for the thread to ack, then destroy. Handle KeyboardInterrupt and clean up in a finally block.

pyzmq sketch (one pipe per object, the mtrelay/zpipe shape):

\`\`\`python
import threading
import zmq

def worker(ctx):
    pipe = ctx.socket(zmq.PAIR)
    pipe.connect("inproc://myobj.pipe")
    router = ctx.socket(zmq.ROUTER)
    router.bind("tcp://*:5555")
    poller = zmq.Poller()
    poller.register(pipe, zmq.POLLIN)
    poller.register(router, zmq.POLLIN)
    while True:
        for sock, _ in poller.poll():
            if sock is pipe:
                if pipe.recv() == b"QUIT":
                    return
            else:
                handle(router.recv_multipart())

ctx = zmq.Context.instance()  # shared context: required for inproc:// across threads
threading.Thread(target=worker, args=(ctx,), daemon=True).start()
\`\`\`

For a multithreaded server (the mtserver shape): ROUTER frontend bound for clients, DEALER backend for N worker threads, and \`zmq.proxy(clients, workers)\` on the main thread to shuttle requests between them.

## REACTORS AND EVENT LOOPS

- A reactor is one thread that polls all its sockets with a poller and dispatches to handlers. One thread, many sockets, no locks. In pyzmq this is \`zmq.Poller\` (the zguide's poll-based examples live in Chapters 2-3; Chapter 7 builds servers from the same shape).
- Structure: build poll set (sockets + timeout for timers) -> poll -> dispatch readable sockets -> run expired timers -> repeat.
- Keep handlers nonblocking: recv what is ready, do bounded work, return to the loop. Never block inside a handler.
- Combine the mailbox pattern with a reactor: the worker thread polls its inproc pipe AND its network sockets in the same poll loop. This is the standard shape for protocol servers in the zguide.
- For many connections, use ROUTER on the server side and keep per-client state keyed by the routing id (\`socket.ROUTING_ID\` on a received frame / \`setsockopt(zmq.ROUTING_ID, ...)\`), rather than one socket per client.
- Non-polling alternative (the msreader shape): \`sock.recv(zmq.DONTWAIT)\` in a loop, catch \`zmq.Again\` when drained, then sleep briefly.

pyzmq reactor skeleton:

\`\`\`python
import zmq

poller = zmq.Poller()
poller.register(pipe, zmq.POLLIN)
poller.register(router, zmq.POLLIN)

while True:
    socks = dict(poller.poll(heartbeat_timeout_ms))
    if pipe in socks:
        handle_pipe()
    if router in socks:
        handle_router()
    if heartbeat_expired():
        send_heartbeat()
\`\`\`

For async applications, prefer \`zmq.asyncio\` (\`await sock.recv_multipart()\`, \`zmq.asyncio.Poller\`). The old \`zmq.eventloop.zmqstream.ZMQStream\` + IOLoop reactor is deprecated since pyzmq 17; do not build new code on it.

## THE STATE-MACHINE MODEL ("Happy Simplicity")

Model protocol handlers as explicit state machines, one instance per client. The zguide's NOM protocol example:

- States: Start -> Authenticated -> Ready. Events in UPPER CASE are external (messages from the peer: OHAI, ICANHAZ, HUGZ). Events in lower case are internal (ok, error, heartbeat). Undefined events in a state are silently ignored.
- Each state lists valid events, actions, and the next state. Example: in Start, event OHAI triggers action "check credentials", which produces ok or error; Authenticated sends OHAI-OK on ok or returns to Start on error; Ready handles ICANHAZ, HUGZ, and the heartbeat timer.
- Implementation shape in Python: a dict of state -> handler function, driven by an event loop that consumes events until the queue is empty, then flushes accumulated replies back over the ROUTER socket with the client's address frame prepended.
- Why: hand-written protocol code grows combinatorially (file transfer + heartbeating + credit + authentication). A state machine keeps it inspectable, testable, and code-generatable (the zguide generates C from an XML model with GSL). Even without codegen, write the state table first, then the code.
- Protocol design companion: the "Cheap or Nasty" pattern. Cheap = friendly, verbose, synchronous, extensible (text, ACKs). Nasty = terse, asynchronous, hand-optimized binary, no allocations in the parser, rejects anything unknown. Use Cheap for control planes, Nasty for hot data paths; sometimes both layers of one protocol.

## LIBERATING AN API

Wrap ZeroMQ behind a clean application interface so callers never see sockets:

- Expose nouns and verbs of the domain, not of messaging. FileMQ's API: fmq_server_new/bind/publish, fmq_client_new/connect/subscribe, fmq_server_destroy. No socket types, no endpoints beyond connect/bind strings.
- Multithreaded API model: constructor spawns the worker thread; methods send commands down the inproc pipe; a recv() method returns events back to the caller (message-based, not callbacks, because callbacks across thread boundaries are delicate). Example event delivery in pyzmq:

\`\`\`python
pipe.send_multipart([b"DELIVER", filename, f"{inbox}/{filename}".encode()])
\`\`\`

- Benefits: bindable in other languages in a weekend, embeddable in applications, portable to phones, and the messaging layer can change without touching callers.
- Do not put internal state on the wire or in the API. A good abstraction encapsulates natural patterns of use, gives them predictable names and properties, chooses sensible defaults, and stays simple for simple cases while expressive for complex ones.

## BIDIRECTIONAL AND MULTITHREADED STACKS

- For a full stack (client API + protocol + server API), build both halves as separate objects with the same mailbox shape, then compose them in a main application. Each half is independently testable against a fake peer.
- Server side: ROUTER front socket for many clients, DEALER/PAIR pipes to internal workers. Client side: DEALER or SUB toward the server, PAIR pipe to its API object.
- Heartbeating belongs in the stack, not the application: the protocol layer detects dead peers (HUGZ-style heartbeats) and reports them as events up the pipe.
- Credit-based flow control for bulk data: the receiver grants credit (e.g. "fetch offset size" requests with HWM 1), the sender never outruns it. This eliminates queue overflows at a cost in speed; use it for file/bulk transfer, not for small control messages.

## THE COST OF EVERY ABSTRACTION

Every layer you add costs latency, memory, and failure modes:
- Latency: each hop (inproc pipe, broker, codec) adds queueing. Measure end to end; inproc is cheap but not free.
- Memory: queues are the hidden cost. HWM bounds them; a broker with many slow clients buffers at the broker. Set HWM deliberately (0 = unlimited is a denial-of-service risk).
- Failure modes: every extra peer is a new way to lose messages (slow joiner, HWM drops, peer restart). Each abstraction must state what happens on disconnect, restart, and overflow. If you cannot answer that, the design is not done.
- Prefer fewer, well-defined pieces. The zguide's FileMQ exists because the file system is an API "my five-year-old son can understand"; that simplicity was the design goal, not an afterthought.

## SECURITY POSTURE

- ZeroMQ security: CURVE for encryption and authentication (CurveZMQ, elliptic-curve keys, \`setsockopt(zmq.CURVE_SERVER, 1)\` and the CURVE key options), ZAP (ZeroMQ Authentication Protocol) for a pluggable authentication handler on a ZMQ_REP inproc endpoint, and PLAIN/NULL mechanisms for simpler cases. In pyzmq, the \`zmq.auth\` module provides the ZAP handler machinery (e.g. \`zmq.auth.ThreadedCurveAuthenticator\` and certificate helpers).
- For application-level protocols, negotiate security explicitly: the zguide uses SASL-style negotiation at the HTTP layer (server challenges with a list of mechanisms, client picks one and answers with a blob). Start with anonymous or PLAIN, grow to CURVE without changing the protocol shape.
- Always include a security discussion section in any protocol spec you write: state exactly how secure it is and what it does not defend against.

## DECISION CHECKLIST

1. Brokerless or brokered? Fixed topology and high fan-out -> brokerless. Dynamic peers, service semantics -> broker.
2. Threads or processes? Same host, shared state -> mailbox pattern with inproc pipes over a shared Context. Cross-host -> tcp:// with explicit contracts.
3. One socket per client or ROUTER multiplexing? More than a handful of clients -> ROUTER with routing-id-keyed state.
4. Hand-written handler or state machine? Protocol with more than trivial flow -> state machine, ideally generated from a model.
5. Callbacks or message events across the API boundary? Always message events down a pipe; add a recv() method.
6. What happens on disconnect, restart, HWM overflow? Answer for every peer pair before shipping.
7. Security mechanism chosen and documented? NULL/PLAIN only for trusted networks; CURVE + ZAP otherwise.
8. Contracts written before code? Protocols and message shapes first, implementations second (MOPED step 3).
`,
}
