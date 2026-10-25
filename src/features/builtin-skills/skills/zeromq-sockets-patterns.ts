import type { BuiltinSkill } from "../types"

export const ZEROMQ_SOCKETS_PATTERNS_SKILL_NAME = "zeromq-sockets-patterns"

const ZEROMQ_SOCKETS_PATTERNS_SKILL_DESCRIPTION =
  "Use when choosing ZeroMQ socket types or designing core messaging topologies in Python with pyzmq — the socket catalogue (REQ/REP, DEALER/ROUTER, PUB/SUB, XPUB/XSUB, PUSH/PULL, PAIR) and the request-reply, pub-sub, and pipeline patterns, plus the missing-message problem solver. Related: zeromq-core, zeromq-advanced-reqrep."

export const zeromqSocketsPatternsSkill: BuiltinSkill = {
  name: ZEROMQ_SOCKETS_PATTERNS_SKILL_NAME,
  description: ZEROMQ_SOCKETS_PATTERNS_SKILL_DESCRIPTION,
  template: `# ZeroMQ — Sockets & Core Patterns (pyzmq)

## SOCKET TYPE CATALOGUE

Patterns are implemented by PAIRS of matching socket types. One socket type alone does nothing.

| Type | Send | Recv | Pattern | Notes |
|------|------|------|---------|-------|
| REQ | send, recv, alternating | recv, send, alternating | request-reply | Strict lock-step; send blocks until a reply is received. Round-robins across connected peers. |
| REP | recv, send, alternating | recv, send, alternating | request-reply | Strict lock-step; must recv before send. Envelope for ROUTER routing is handled internally. |
| DEALER | send (async) | recv (async) | request-reply | REQ without the lock-step. Round-robins outgoing messages across peers. |
| ROUTER | send (async, with routing envelope) | recv (async, prepends peer identity) | request-reply | Addressable by identity; drops unroutable messages by default (set ROUTER_MANDATORY to error instead). |
| PUB | send only | none | pub-sub | Fan-out to all connected SUBs; drops messages when no subscriber or at HWM. |
| SUB | none | recv only | pub-sub | Must setsockopt(zmq.SUBSCRIBE, ...) (empty bytes = everything); connects to PUB or XSUB. |
| XPUB | send only | recv only (subscription messages) | pub-sub | Like PUB but receives subscribe/cancel messages from SUBs (0x01 subscribe, 0x00 cancel). |
| XSUB | none | send only (subscription messages) | pub-sub | Like SUB but can send subscriptions; used in proxies. |
| PUSH | send only | none | pipeline | Round-robins to connected PULLs; blocks/drops at HWM. |
| PULL | none | recv only | pipeline | Fair-queues from connected PUSHes. |
| PAIR | send, recv | send, recv | exclusive pair | One-to-one only; silent drop when peer is gone. For threads/IPC, not TCP. |
| STREAM | send, recv | send, recv | raw TCP | Non-ZeroMQ TCP server; read identity frame first, then data; write identity then data. |

## THE FIVE CORE PATTERNS

1. **Request-reply** (REQ/REP, DEALER/ROUTER): clients to services, RPC and task distribution.
2. **Pub-sub** (PUB/SUB, XPUB/XSUB): publishers to subscribers, one-to-many fan-out.
3. **Pipeline** (PUSH/PULL): ventilator to workers to sink, parallel task distribution.
4. **Exclusive pair** (PAIR/PAIR): two threads or nodes, one-to-one, bidirectional.
5. **Advanced request-reply** (DEALER/ROUTER): nonblocking, multi-peer request-reply; the building block for brokers and proxies.

## FIGURING OUT PATTERNS — DECISION WORKFLOW

1. Who talks to whom? One-to-one (PAIR), one-to-many fan-out (PUB/SUB), many-to-one load balance (PUSH/PULL), many-to-many request-reply (DEALER/ROUTER).
2. Synchronous or asynchronous? Strict ask-then-wait: REQ/REP. Fire-and-forget either way: DEALER, PUB, PUSH.
3. Who binds, who connects? The stable, earlier-starting node binds; the dynamic node connects. Connect is the flexible side (reconnects automatically). For pub-sub, prefer SUB binds / PUB connects to fix the slow-joiner problem.
4. Need a proxy? When N publishers meet M subscribers, insert an XPUB/XSUB (or ROUTER/DEALER) proxy bound to well-known endpoints; everyone else connects.
5. Start with the simplest pattern that works; add intermediaries only when discovery or scaling demands it.

## MISSING MESSAGE PROBLEM SOLVER

Work through this checklist top-down when messages vanish:

- **SUB has no subscription.** Call sub.setsockopt(zmq.SUBSCRIBE, b"") (empty bytes receives everything) or you get nothing. The option value is bytes, not str.
- **Slow joiner.** SUB connects after PUB started sending; everything published before the connection completes is lost. Fixes: start SUB first, synchronize via a REQ/REP side-channel (syncpub pattern), or flip bind/connect so SUB binds and PUB connects.
- **HWM drops.** When a queue hits its high-water mark (zmq.SNDHWM/zmq.RCVHWM, default 1000), ZeroMQ drops messages (PUB/SUB, PUSH/PULL) or blocks (REQ/REP, DEALER/ROUTER, PAIR). Raise HWM for bursty publishers, or add flow control.
- **REQ/REP lock-step violation.** Sending twice in a row, or replying twice, puts the socket in an error state; subsequent calls raise zmq.error.ZMQError. Stick to send/recv alternation, or switch to DEALER/ROUTER.
- **Bind/connect direction.** Queues only exist once a connection is established. If the connecting side starts late, flip which side binds.
- **Wrong pattern pairing.** PUB never talks to REQ; PUSH never talks to SUB. Check the catalogue table.
- **Unroutable ROUTER sends.** ROUTER silently drops messages addressed to unknown identities; set sock.setsockopt(zmq.ROUTER_MANDATORY, 1) to surface it as EHOSTUNREACH.

## PIPELINE: VENTILATOR -> WORKERS -> SINK

Ventilator PUSH binds tcp://*:5557, workers PULL-connect and PUSH-connect to sink tcp://*:5558, sink PULL binds. PUSH round-robins tasks across workers; workers signal completion to the sink. Batch sizing matters: the ventilator should not saturate workers; the sink collects results.

\`\`\`python
# Ventilator: PUSH tasks round-robin to workers
import zmq

ctx = zmq.Context()
push = ctx.socket(zmq.PUSH)
push.bind("tcp://*:5557")
for task in range(100):
    push.send_string(str(task))
push.close(linger=0)
ctx.term()
\`\`\`

\`\`\`python
# Worker: PULL tasks, PUSH results (zguide taskwork)
import zmq

ctx = zmq.Context()
receiver = ctx.socket(zmq.PULL)
receiver.connect("tcp://localhost:5557")
sender = ctx.socket(zmq.PUSH)
sender.connect("tcp://localhost:5558")
while True:
    task = receiver.recv_string()
    sender.send(b"")  # signal done
\`\`\`

\`\`\`python
# Sink: PULL results from all workers
import zmq

ctx = zmq.Context()
pull = ctx.socket(zmq.PULL)
pull.bind("tcp://*:5558")
while True:
    msg = pull.recv_string()
    print("done:", msg)
\`\`\`

## REQUEST-REPLY EXAMPLES

\`\`\`python
# REP server
import zmq

ctx = zmq.Context()
rep = ctx.socket(zmq.REP)
rep.bind("tcp://*:5555")
while True:
    request = rep.recv_string()
    print("Received:", request)
    rep.send_string("World")
\`\`\`

\`\`\`python
# REQ client
import zmq

ctx = zmq.Context()
req = ctx.socket(zmq.REQ)
req.connect("tcp://localhost:5555")
req.send_string("Hello")
print(req.recv_string())  # "World"
\`\`\`

\`\`\`python
# DEALER client, ROUTER server (async request-reply).
# REQ auto-adds an empty delimiter frame; DEALER does not, so a DEALER
# client must send [b"", payload] to mimic REQ framing.
import zmq

ctx = zmq.Context()

# ROUTER server side
router = ctx.socket(zmq.ROUTER)
router.bind("tcp://*:5556")
ident, empty, payload = router.recv_multipart()
router.send_multipart([ident, empty, b"World"])

# DEALER client side
dealer = ctx.socket(zmq.DEALER)
dealer.setsockopt(zmq.IDENTITY, b"client-1")
dealer.connect("tcp://localhost:5556")
dealer.send_multipart([b"", b"Hello"])
print(dealer.recv_multipart())  # [b"World"]
\`\`\`

## HANDLING INTERRUPTS AND CLEAN SHUTDOWN

- Never block forever in recv; poll with a timeout so you can check a shutdown flag.
- Use zmq.Poller with zmq.POLLIN on all sockets plus a short timeout; poll() returns a dict of ready sockets.
- On SIGINT (Ctrl-C): catch KeyboardInterrupt, break the loop, close sockets, then term() the context. Blocking calls in other threads raise ZMQError with errno ETERM when the context is terminated; treat ETERM as nonfatal.
- Nonfatal errors: zmq.Again (NOBLOCK/DONTWAIT with no data) and ETERM. Everything else: log and fail fast.
- Set linger (default -1, wait forever) to a finite value, e.g. sock.close(linger=0), so close() does not hang on undelivered messages.

\`\`\`python
# Polling reactor with clean shutdown
import zmq

ctx = zmq.Context()
receiver = ctx.socket(zmq.PULL)
receiver.connect("tcp://localhost:5557")
controller = ctx.socket(zmq.SUB)
controller.connect("tcp://localhost:5559")
controller.setsockopt(zmq.SUBSCRIBE, b"")

poller = zmq.Poller()
poller.register(receiver, zmq.POLLIN)
poller.register(controller, zmq.POLLIN)

try:
    while True:
        socks = dict(poller.poll(1000))  # ms timeout
        if receiver in socks:
            task = receiver.recv_string()  # process task
        if controller in socks:
            break  # kill signal
except KeyboardInterrupt:
    pass
finally:
    poller.unregister(receiver)
    poller.unregister(controller)
    receiver.close(linger=0)
    controller.close(linger=0)
    ctx.term()
\`\`\`

## DON'T DO THIS

- Don't violate the REQ/REP state machine: no send-send, no recv-recv, no reply-before-request. Use DEALER/ROUTER for async flows.
- Don't do a blocking recv on a socket that may never receive; poll instead.
- Don't use PUB/SUB for reliable work delivery: PUB drops at HWM and drops for slow joiners. Use PUSH/PULL or DEALER/ROUTER for work.
- Don't forget setsockopt(zmq.SUBSCRIBE, ...) on a SUB socket; a SUB with no subscription receives nothing.
- Don't assume messages sent before a peer connects will be delivered; ZeroMQ queues only after a connection exists.
- Don't use PAIR over TCP for anything that reconnects; PAIR has no reconnect semantics.
- Don't ignore ZMQError after failed calls; check e.errno (EAGAIN -> zmq.Again, ETERM during shutdown).
- Don't leave linger at -1 in long-lived services that shut down; use sock.close(linger=0) and ctx.term().
- Don't mix str and bytes: send_string/recv_string are utf-8 str, raw send/recv are bytes; zmq.SUBSCRIBE takes bytes.
`,
}
