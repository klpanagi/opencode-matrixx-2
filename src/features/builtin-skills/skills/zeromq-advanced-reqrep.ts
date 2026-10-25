import type { BuiltinSkill } from "../types"

export const ZEROMQ_ADVANCED_REQREP_SKILL_NAME = "zeromq-advanced-reqrep"

const ZEROMQ_ADVANCED_REQREP_SKILL_DESCRIPTION =
  "Use when building ZeroMQ brokers, custom routing, or ROUTER/DEALER messaging in Python (pyzmq) — advanced request-reply: envelopes and identities, load-balancing brokers (ROUTER-to-REQ and ROUTER-to-DEALER), LRU routing, header/body framing, shared queues, and ROUTER-to-ROUTER. Related: zeromq-sockets-patterns, zeromq-reliability."

export const zeromqAdvancedReqrepSkill: BuiltinSkill = {
  name: ZEROMQ_ADVANCED_REQREP_SKILL_NAME,
  description: ZEROMQ_ADVANCED_REQREP_SKILL_DESCRIPTION,
  template: `# ZeroMQ — Advanced Request-Reply

## THE REPLY ENVELOPE MODEL

Every request-reply exchange is wrapped in an envelope: zero or more reply addresses (identity frames), then an empty delimiter frame, then the message body (zero or more frames). The envelope is the return address that lets a stateless ZeroMQ network route replies back.

What each socket does with the envelope:

- **REQ**: prepends an empty delimiter frame before data on send; on receive, expects the reply to start with that empty frame. Synchronous, strict send-then-receive lockstep, one peer at a time.
- **REP**: on receive, saves all frames up to and including the empty delimiter (the envelope) and hands the body to the app; on send, re-attaches the saved envelope. Synchronous, replies to the peer of the last request.
- **DEALER**: envelope-oblivious. Treats everything as plain multipart. Asynchronous, round-robins sends, fair-queues receives.
- **ROUTER**: envelope-oblivious but identity-aware. On receive, prepends the connection's identity as the first frame. On send, pops the first frame and uses it as a routing key to pick the connection. Asynchronous.

So a REQ-to-REP exchange on the wire is two frames each way: an empty frame, then the body. A ROUTER in the middle sees: [client-identity, "", body]. With N ROUTER hops the envelope grows to N identity frames before the delimiter.

In pyzmq you always see the envelope on a ROUTER, so read it with recv_multipart():

\`\`\`python
import zmq

context = zmq.Context()
router = context.socket(zmq.ROUTER)
router.bind("tcp://*:5559")

identity, empty, body = router.recv_multipart()
# identity: return address (bytes), empty: b"" delimiter, body: request payload
router.send_multipart([identity, b"", b"pong"])
\`\`\`

REQ inserts the empty delimiter automatically; DEALER does not. That asymmetry is the source of most broker bugs.

## IDENTITIES

A ROUTER assigns a random identity to each connection unless the peer sets one. Set your own with ZMQ_IDENTITY before connecting:

\`\`\`python
import zmq

    context = zmq.Context()
        worker = context.socket(zmq.DEALER)
            worker.setsockopt(zmq.IDENTITY, b"worker-1")
            worker.connect("tcp://localhost:5671")
            \`\`\`

            The zguide examples use a zhelpers.set_id(sock) helper that assigns a short printable random identity; set an explicit one like b"worker-1" for anything long-lived.

            Identities are binary strings, unique per ROUTER. Use them as dict keys to track peers. If you send to an identity the ROUTER has never seen (or that disconnected), the message is silently dropped unless ZMQ_ROUTER_MANDATORY is set (then it fails with EHOSTUNREACH). ZMQ_ROUTER_HANDOVER lets a new connection take over an existing identity instead of being rejected.

            ## CUSTOM ROUTING: WHY ROUTER EXISTS

    REQ/REP hide routing; DEALER/ROUTER expose it. The ROUTER is the only socket that lets your code choose a destination per message. That enables proxies, brokers, and any topology where routing is a decision, not a round-robin.

        The extended request-reply pattern inserts ROUTER/DEALER proxies between REQ and REP. The proxy is dumb plumbing: read all frames from one side, send them to the other. In pyzmq that is a Poller loop forwarding multipart messages verbatim:

\`\`\`python
import zmq

context = zmq.Context()
frontend = context.socket(zmq.ROUTER)
backend = context.socket(zmq.DEALER)
frontend.bind("tcp://*:5560")
backend.bind("tcp://*:5561")

poller = zmq.Poller()
poller.register(frontend, zmq.POLLIN)
poller.register(backend, zmq.POLLIN)

while True:
    socks = dict(poller.poll())
    if socks.get(frontend) == zmq.POLLIN:
        backend.send_multipart(frontend.recv_multipart())  # client -> worker
    if socks.get(backend) == zmq.POLLIN:
        frontend.send_multipart(backend.recv_multipart())  # worker -> client
\`\`\`

Or just use zmq.proxy(frontend, backend) for the standard case.

## THE LOAD-BALANCING BROKER (ROUTER + DEALER)

The classic broker: ROUTER frontend for clients, DEALER backend for workers, glued by a proxy. DEALER round-robins to workers, which is fair only when tasks take similar time. For uneven workloads, replace the backend with ROUTER and do LRU routing yourself (next section).

\`\`\`python
import zmq

context = zmq.Context()
frontend = context.socket(zmq.ROUTER)
frontend.bind("tcp://*:5559")
backend = context.socket(zmq.DEALER)
backend.bind("tcp://*:5560")
zmq.proxy(frontend, backend)
\`\`\`

## ROUTER-TO-REQ WORKERS: LRU ROUTING

Workers use REQ sockets and signal readiness by sending a "ready" message. The broker keeps a queue of available worker identities and always picks the least-recently-used one. Key rule: only poll the frontend when at least one worker is available, otherwise requests pile up with nowhere to go.

    Broker core (pyzmq; the worker's REQ auto-inserts the empty delimiter, so the broker sees [worker-id, "", ...] on every backend message):

    \`\`\`python
        import zmq

        context = zmq.Context()
        frontend = context.socket(zmq.ROUTER)
        frontend.bind("tcp://*:5559")          # clients
        backend = context.socket(zmq.ROUTER)
            backend.bind("tcp://*:5560")           # workers (REQ)

            poller = zmq.Poller()
            poller.register(frontend, zmq.POLLIN)
            poller.register(backend, zmq.POLLIN)
            workers = []                           # LRU queue of worker identities

            while True:
    socks = dict(poller.poll())
    if socks.get(backend) == zmq.POLLIN:
        frames = backend.recv_multipart()
        worker_id = frames.pop(0)
        workers.append(worker_id)      # queue worker as available (LRU tail)
        # frames is [b"ready"] or [client_addr, b"", reply]
        if frames[0] != b"ready":
            client_addr, empty, reply = frames
            frontend.send_multipart([client_addr, b"", reply])
    if workers and socks.get(frontend) == zmq.POLLIN:
        client_addr, empty, request = frontend.recv_multipart()
        worker_id = workers.pop(0)     # dequeue the LRU worker
        backend.send_multipart([worker_id, b"", client_addr, b"", request])
        \`\`\`

        The gate "if workers" is what stops requests from piling up with no worker to serve them.

    Worker side (REQ, "ready" ping loop):

\`\`\`python
import random
import time
import zmq
import zhelpers

    context = zmq.Context()
    worker = context.socket(zmq.REQ)
    zhelpers.set_id(worker)                # printable identity
    worker.connect("tcp://localhost:5671")

    total = 0
        while True:
    worker.send(b"ready")              # tell broker we're available
    # REQ auto-inserts the delimiter, so the reply arrives as [b"", client_addr, b"", request]
    empty, client_addr, empty2, request = worker.recv_multipart()
    if request == b"Fired!":
        break
    total += 1
    time.sleep(random.randint(1, 500) / 1000)   # do the work
    print(f"Completed: {total} tasks")
    \`\`\`

    The broker replies "Fired!" to shut workers down cleanly. Note the reply path: the worker's REQ envelope is [worker-id, "", "ready"]; the broker strips the identity, keeps it for LRU, and when replying re-attaches it as the routing frame.

## ROUTER-TO-DEALER WORKERS

Swap REQ for DEALER and the "ready" handshake disappears from the protocol's perspective: DEALER is asynchronous, so the broker can push work whenever a worker is in its LRU queue. Two differences to remember:

- REQ always inserts the empty delimiter before data; DEALER does not. A broker written for REQ workers must not expect that delimiter from DEALER workers.
- REQ sends one message then blocks until the reply; DEALER can pipeline. This matters for failure recovery (Chapter 4 territory), not for strict request-reply.

Worker side (DEALER; the broker sends [ident, work], so the worker receives exactly one frame per message):

\`\`\`python
import random
import time
import zmq
    import zhelpers

    context = zmq.Context()
    worker = context.socket(zmq.DEALER)
    zhelpers.set_id(worker)
    worker.connect("tcp://localhost:5671")

        total = 0
        while True:
    worker.send(b"ready")
    workload = worker.recv()           # DEALER: exactly one frame
    if workload == b"Fired!":
        break
    total += 1
    time.sleep(random.randint(1, 500) / 1000)
    print(f"Completed: {total} tasks")
    \`\`\`

The matching broker sends work as send_multipart([worker_id, workload]) and reads replies as recv_multipart() with the worker identity as frame 0.

## MULTIPART FRAMING CONVENTIONS (zhelpers)

The zguide's C examples use tiny helpers (s_send, s_sendmore, s_recv) to hide the SNDMORE dance; in pyzmq you don't need them, because multipart is built in:

- sock.send_multipart([a, b, c]): send frames as one multipart message.
- sock.recv_multipart(): receive all frames of one message as a list of bytes.
  - zhelpers.dump(sock): pretty-print every frame (identity, delimiter, body) for debugging.
  - zhelpers.set_id(sock): assign a printable random identity.

  Broker message shapes to keep straight:

    - Client -> broker (frontend ROUTER receives): [client-id, "", request...]
    - Broker -> worker (backend ROUTER sends): [worker-id, client-id, "", request...]
    - Worker -> broker (backend ROUTER receives): [worker-id, client-id, "", reply...]
  - Broker -> client (frontend ROUTER sends): [client-id, "", reply...]

The empty delimiter separates envelope from body at every hop. Getting one delimiter wrong is the most common broker bug; print every frame while debugging.

## DROPPING, STEALING, AND RE-SENDING

Because ROUTER gives you raw identities, you own the routing decisions:

- **Drop**: if no worker is available, you can simply not read the frontend (backpressure lives in the socket queue), or read and discard. With ZMQ_ROUTER_MANDATORY off, sends to dead identities vanish silently, which is sometimes exactly what you want for stale replies.
- **Steal / re-route**: a reply addressed to client A can be sent to any connected identity, including a different broker's frontend. Inter-broker routing exploits this: brokers connect their backends to peer frontends and route replies across the cluster by prefixing the peer's identity.
- **Re-send**: nothing stops you from sending the same body to two identities, or re-sending a request after a timeout. The envelope is just data; reliability patterns (Chapter 4) build on this.

ROUTER-to-ROUTER peering: each broker binds a ROUTER and connects to peers, setting explicit identities so each side knows which peer a message came from. Envelopes then carry peer-id, client-id, "", body. Federation (brokers posing as clients/workers for each other) is simpler but lock-step; peering is fully asynchronous and is what you want for load-sharing clusters.

## ASYNCHRONOUS CLIENT/SERVER

For a server that answers zero-or-more replies per request: ROUTER frontend facing clients, DEALER or inproc backend facing a worker pool. Clients use DEALER instead of REQ so they can receive replies while sending new requests. Poll at high frequency rather than sleeping between requests, or you'll pace yourself to the slowest reply.

In pyzmq the modern async client is zmq.asyncio: a DEALER that sends and receives without lockstep, awaiting frames as they arrive:

\`\`\`python
import asyncio
import zmq
import zmq.asyncio

ctx = zmq.asyncio.Context()
dealer = ctx.socket(zmq.DEALER)
dealer.setsockopt(zmq.IDENTITY, b"client-1")
dealer.connect("tcp://localhost:5555")

async def main():
    await dealer.send_multipart([b"", b"hello"])   # DEALER: no auto-delimiter
    while True:
        reply = await dealer.recv_multipart()
        print("got:", reply)

asyncio.run(main())
\`\`\`

## REQUEST-REPLY BEST PRACTICES

- Never mix REQ with ROUTER directly unless you account for REQ's empty delimiter; DEALER is the safer peer for ROUTER.
- Only poll the client frontend when a worker is available; let ZeroMQ's socket buffers be your queues.
- Set explicit identities on every long-lived peer; random identities break reconnect semantics and logging.
- Use ZMQ_ROUTER_MANDATORY when silent drops would hide bugs; catch zmq.ZMQError and check errno == zmq.EHOSTUNREACH.
- Route replies by echoing the exact identity frames you received; never reconstruct them from memory.
- One poll loop, one state machine per broker. Keep the LRU queue as a plain list of identities.
- Print frames (identity, delimiter, body) during development with zhelpers.dump; envelope bugs are invisible in logs that only show bodies.

## FAILURE MODES

- **Missing delimiter**: broker sends [worker, client, body] instead of [worker, client, "", body]; the worker's REQ/DEALER misparses everything after.
- **Reply to unknown identity**: silently dropped (or EHOSTUNREACH with ROUTER_MANDATORY). Usually a stale LRU entry after a worker died; purge identities on disconnect (zmq.EVENT_DISCONNECTED via socket monitor) or on send failure.
- **REQ lockstep violation**: sending twice on REQ without a reply raises a ZMQError with errno == zmq.EFSM. Use DEALER when you can't guarantee the rhythm.
- **Frontend polled with no workers**: requests accumulate unboundedly; gate the poller on worker availability.
- **Identity reuse**: two peers claiming the same identity on one ROUTER; the second connection is rejected unless ZMQ_ROUTER_HANDOVER is set. Generate unique identities.
- **Non-blocking timeouts**: with zmq.NOBLOCK (or DONTWAIT), an empty queue raises zmq.Again; catch it and retry or back off.
- **Blocking sends on ROUTER**: with HWM reached, ROUTER drops or blocks per ZMQ_ROUTER_BEHAVIOR; decide explicitly (sndhwm, ZMQ_IMMEDIATE) rather than by accident.
`,
}

