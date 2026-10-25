import type { BuiltinSkill } from "../types"

export const ZEROMQ_RELIABILITY_SKILL_NAME = "zeromq-reliability"

const ZEROMQ_RELIABILITY_SKILL_DESCRIPTION =
  "Use when ZeroMQ messages must survive crashes, restarts, or slow consumers — reliability patterns in pyzmq: Lazy Pirate, Simple Pirate, Paranoid Pirate, Majordomo, Titanic, Binary Star failover, Freelance brokerless request-reply, heartbeating, retries, disk queuing, and idempotency. Related: zeromq-advanced-reqrep, zeromq-pubsub."

export const zeromqReliabilitySkill: BuiltinSkill = {
  name: ZEROMQ_RELIABILITY_SKILL_NAME,
  description: ZEROMQ_RELIABILITY_SKILL_DESCRIPTION,
  template: `# ZeroMQ — Reliable Messaging Patterns (pyzmq)

## WHAT RELIABILITY MEANS IN ZEROMQ

ZeroMQ gives you no reliability by itself. Core sockets reconnect and load balance, but messages sent into a dead peer are lost silently. Define reliability as: the set of failures you can survive. Rank failures by probability:

1. Application code: crashes, freezes, runs too slowly, exhausts memory.
2. System code (your brokers): same failures, plus OOM when queuing for slow clients.
3. Message queues overflow and start discarding messages.
4. Networks fail (WiFi drops, switch ports die). ZeroMQ reconnects automatically, but in-flight messages are lost.
5. Hardware fails, taking all processes on the box with it.

The first five cover 99.9% of real-world needs. Design methodology: ask "what can fail, and what should the application do about it?" for each component, then pick the smallest pattern that answers it.

All examples below use Python 3 with pyzmq. Common ground rules: catch \`zmq.Again\` when using NOBLOCK, always \`setsockopt(zmq.LINGER, 0)\` before closing a socket you are about to rebuild, and remember the Context is thread-safe but sockets are not (across threads, use \`zmq.Context.instance()\` for inproc).

## LAZY PIRATE (client-side reliability)

REQ + timeout + retry. Poll instead of blocking recv; on timeout, close the socket and open a fresh one (a REQ in a bad state will keep discarding replies). Retry the same request; give up after N retries. Sequence numbers detect stale/duplicate replies.

\`\`\`python
import zmq

REQUEST_TIMEOUT = 2500  # ms
REQUEST_RETRIES = 3
SERVER_ENDPOINT = "tcp://localhost:5555"

ctx = zmq.Context()
client = ctx.socket(zmq.REQ)
client.connect(SERVER_ENDPOINT)
poller = zmq.Poller()

sequence = 0
retries_left = REQUEST_RETRIES
while retries_left:
    sequence += 1
    request = str(sequence).encode()
    client.send(request)
    while True:
        if poller.poll(REQUEST_TIMEOUT) & zmq.POLLIN:
            reply = client.recv()
            if int(reply) == sequence:
                print("Server replied OK")
                retries_left = REQUEST_RETRIES
                break
            else:
                print("Malformed reply, aborting")
                break
        else:
            retries_left -= 1
            if retries_left == 0:
                print("Server seems offline, abandoning")
                break
            print("Timeout, retrying")
            # Old socket is confused; close it and open a fresh one
            client.setsockopt(zmq.LINGER, 0)
            client.close()
            poller.unregister(client)
            client = ctx.socket(zmq.REQ)
            client.connect(SERVER_ENDPOINT)
            poller.register(client)
            client.send(request)
\`\`\`

## SIMPLE PIRATE (load-balanced workers)

Add a queue broker between clients and workers: ROUTER facing clients, DEALER facing workers (the load-balancing pattern from Chapter 3). Workers signal READY with the one-byte command \`LRU_READY = b"\x01"\`; the queue keeps a ready list and routes requests only to ready workers. Workers use REQ with a random printable identity so the queue can address them. Still no heartbeating, so a crashed worker's in-flight request is lost. Cheap, works well when workers are short-lived and requests are idempotent.

\`\`\`python
# spworker.py core: REQ worker with a random identity
import random
import zmq

LRU_READY = b"\x01"

worker = context.socket(zmq.REQ)
worker.setsockopt(zmq.IDENTITY, b"%04X-%04X" % (
    random.randint(0, 0x10000), random.randint(0, 0x10000)))
worker.connect("tcp://localhost:5556")
worker.send(LRU_READY)
while True:
    request = worker.recv_multipart()
    # ... do the work ...
    worker.send_multipart([b"", reply])
\`\`\`

The queue (\`spqueue.py\`) keeps a \`workers\` list: on a worker message, if the last frame is LRU_READY append the identity to the ready list; to dispatch, pop from the front of the ready list and route the request through the ROUTER socket.

## PARANOID PIRATE (heartbeating worker-queue)

Same topology, but workers use DEALER with a custom envelope and both sides heartbeat. Protocol (PPP): frame 0 is the command, \`PPP_READY = b"\x01"\`, \`PPP_HEARTBEAT = b"\x02"\`. Queue sends HEARTBEAT to workers; workers reply with their own. Liveness counter: decrement once per heartbeat interval without input; at zero, reconnect with exponential backoff.

The queue (\`ppqueue.py\`) tracks workers in a \`collections.OrderedDict\` keyed by identity, where insertion order is the LRU order, and implements \`purge()\` to drop workers whose expiry has passed plus \`next()\` to pop the least-recently-used ready worker.

\`\`\`python
# ppworker.py core
import random
import time
import zmq

PPP_READY = b"\x01"
PPP_HEARTBEAT = b"\x02"
HEARTBEAT_LIVENESS = 3      # 3-5 is reasonable
HEARTBEAT_INTERVAL = 1      # seconds
INTERVAL_INIT = 1           # initial reconnect delay
INTERVAL_MAX = 32           # exponential backoff cap

ctx = zmq.Context()
poller = zmq.Poller()

def worker_socket(ctx):
    worker = ctx.socket(zmq.DEALER)
    worker.setsockopt(zmq.IDENTITY, b"%04X-%04X" % (
        random.randint(0, 0x10000), random.randint(0, 0x10000)))
    worker.connect("tcp://localhost:5556")
    poller.register(worker, zmq.POLLIN)
    worker.send(PPP_READY)
    return worker

liveness = HEARTBEAT_LIVENESS
interval = INTERVAL_INIT
worker = worker_socket(ctx)
heartbeat_at = time.time() + HEARTBEAT_INTERVAL

while True:
    socks = dict(poller.poll(HEARTBEAT_INTERVAL * 1000))
    if socks.get(worker) == zmq.POLLIN:
        frames = worker.recv_multipart()
        if not frames:
            break  # interrupted
        if frames[0] == PPP_HEARTBEAT:
            liveness = HEARTBEAT_LIVENESS
        else:
            # ... do the work, send reply frames ...
            pass
    else:
        liveness -= 1
        if liveness == 0:
            print("Heartbeat failure, can't reach queue")
            print("Reconnecting in %0.2fs" % interval)
            time.sleep(interval)
            if interval < INTERVAL_MAX:
                interval *= 2
            poller.unregister(worker)
            worker.setsockopt(zmq.LINGER, 0)
            worker.close()
            worker = worker_socket(ctx)
            liveness = HEARTBEAT_LIVENESS
    # Send heartbeat to queue if it's time
    if time.time() > heartbeat_at:
        heartbeat_at = time.time() + HEARTBEAT_INTERVAL
        worker.send(PPP_HEARTBEAT)
\`\`\`

## MAJORDOMO (service-oriented reliable queuing)

Majordomo Protocol (MDP) formalizes the Pirate patterns into a broker API: clients ask for a named service, broker routes to registered workers. In the zguide's Python implementation the protocol lives in \`MDP.py\` (uppercase file name): client prefix \`C_CLIENT = b"MDPC01"\`, worker prefix \`W_WORKER = b"MDPW01"\`, and worker commands \`W_READY = b"\x01"\`, \`W_REQUEST = b"\x02"\`, \`W_REPLY = b"\x03"\`, \`W_HEARTBEAT = b"\x04"\`, \`W_DISCONNECT = b"\x05"\`. The broker (\`mdbroker.py\`) uses a single ROUTER socket for both clients and workers, tracks worker liveness, purges dead workers, and sends DISCONNECT to misbehaving ones. Wrap it in client and worker APIs that hide the frames: \`mdcliapi.py\` (REQ client), \`mdwrkapi.py\` (DEALER worker), and \`mdcliapi2.py\` (DEALER client, async, many in-flight requests at the cost of losing broker-failure recovery).

Note: the zguide's Python MDP files are Python 2 only. For Python 3, use the maintained port \`shoppimon/majortomo\` (pip install majortomo), which implements the same protocol with a modern asyncio-friendly API.

## TITANIC (disk-based, disconnected queuing)

Titanic layers on MDP instead of extending it: a "persistence" worker sits behind the broker and writes requests to disk, so clients and workers can be sporadically connected (email-like). Three MDP services:

- titanic.request: save request, return UUID.
- titanic.fetch: fetch reply for a UUID (client polls).
- titanic.close: confirm reply received so it can be deleted.

Requests and replies live in files named by UUID under \`.titanic/\`; a queue worker drains the disk queue to real MDP workers. The zguide's \`titanic.py\` persists with \`pickle\` and uses \`zhelpers.zpipe(ctx)\` for the internal dispatcher pipe. Key rule: never trust the network, only the disk. Keep the request file until the reply is safely stored; delete the reply only after the close/ack.

## BINARY STAR (primary-backup failover)

Two servers run the same finite state machine. States: \`STATE_PRIMARY\`, \`STATE_BACKUP\`, \`STATE_ACTIVE\`, \`STATE_PASSIVE\`. Events: PEER_PRIMARY, PEER_BACKUP, PEER_ACTIVE, PEER_PASSIVE, CLIENT_REQUEST. Primary starts ACTIVE, backup starts PASSIVE; each publishes its state to the peer over PUB/SUB every heartbeat. Failover: when the active peer goes silent past the timeout, the passive one becomes ACTIVE. Clients (\`bstarcli.py\`) reconnect to whichever server is active: try one endpoint with \`REQUEST_TIMEOUT\`, on timeout wait \`SETTLE_DELAY\`, rebuild the REQ socket, and try the other endpoint. Limits: one pair only, no state replication (in-flight requests are lost on failover), and a split-brain risk if the heartbeat timeout is too short.

\`\`\`python
# bstarsrv.py state machine core
STATE_PRIMARY = 1
STATE_BACKUP = 2
STATE_ACTIVE = 3
STATE_PASSIVE = 4

# Transitions:
# on PEER_ACTIVE while STATE_PRIMARY -> STATE_ACTIVE
# on PEER_ACTIVE while STATE_BACKUP  -> STATE_PASSIVE
# on heartbeat timeout while STATE_ACTIVE -> STATE_PRIMARY (restart)
# on heartbeat timeout while STATE_PASSIVE -> STATE_ACTIVE (takeover)

# Server loop: publish state to the peer every BSTAR_HEARTBEAT,
# subscribe to the peer's state, run the FSM on each event.
\`\`\`

Note: the zguide's \`bstar.py\` helper uses \`zmq.eventloop\`, which is deprecated since pyzmq 17. For new code, build the state loop on \`zmq.asyncio\` instead.

## FREELANCE (brokerless request-reply)

Three models: (1) REQ to a fixed server, no resilience; (2) REQ with a list of endpoints, try each in turn; (3) ROUTER-ROUTER with a control envelope: frame 0 = server identity, frame 1 = control command (CONNECT, PING, REQUEST), frame 2 = body. The client tracks server liveness with PING/PONG and TTLs, retries on other servers, and matches replies by sequence number. Brokerless means no single point of failure, but the client carries all the intelligence.

Caveat: the zguide's \`flcliapi.py\` (model 3) is Python 2 only and contains a dead stub, so do not copy it. For Python 3, implement ROUTER-to-ROUTER directly, or start from pyzmq's \`examples/asyncio/router_router.py\` and set \`setsockopt(zmq.ROUTER_HANDOVER, 1)\` on both ROUTER sockets so a reconnecting peer with the same identity takes over cleanly.

## IDEMPOTENCY AND DELIVERY SEMANTICS

ZeroMQ patterns give you at-least-once delivery at best: retries mean the server may process the same request twice (the reply may have been lost, not the work). Exactly-once is impossible without application-level deduplication. Make requests idempotent: attach a unique request ID (UUID or sequence number), have the server remember recently processed IDs and return the cached reply instead of redoing work. Titanic's close/ack protocol is exactly this idea applied to disk queuing.

## PARAMETER TABLE

| Parameter | Value | Notes |
|---|---|---|
| REQUEST_TIMEOUT | 2500 ms | Lazy Pirate client reply timeout (> 1000) |
| REQUEST_RETRIES | 3 | before abandoning the server |
| HEARTBEAT_LIVENESS | 3 | missed heartbeats before failure (3-5 reasonable) |
| HEARTBEAT_INTERVAL | 1000 ms | must be well under any network timeout |
| INTERVAL_INIT | 1000 ms | first reconnect delay |
| INTERVAL_MAX | 32000 ms | exponential backoff cap (double each failure) |
| PING_INTERVAL | ~2000 ms | Freelance model 3 server pings |
| SERVER_TTL | ~6000 ms | Freelance server expiry (3 x PING_INTERVAL) |
| BINARY_STAR peer timeout | 2000-5000 ms | too short risks split-brain |

## RULES OF THUMB

- Never reuse a REQ socket after a timeout; \`setsockopt(zmq.LINGER, 0)\`, close, and rebuild it.
- Heartbeat both directions; one-way liveness lies.
- Back off exponentially on reconnect (1s, 2s, 4s ... cap 32s).
- Put state in the middle only when peers are sporadically connected (Titanic).
- Design for duplicate delivery, not for exactly-once.
- Prefer \`zmq.asyncio\` over the deprecated \`zmq.eventloop\` for async pyzmq code.
`,
}
