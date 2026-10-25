import type { BuiltinSkill } from "../types"

export const ZEROMQ_PUBSUB_SKILL_NAME = "zeromq-pubsub"

const ZEROMQ_PUBSUB_SKILL_DESCRIPTION =
  "Use when designing ZeroMQ publish-subscribe, fan-out, or data distribution — advanced pub-sub in pyzmq: XSUB/XPUB proxies, Espresso tracing, Last-Value-Caching clone pattern, reliable pub-sub, high-speed subscribers, and distributed logging. Related: zeromq-reliability, zeromq-architecture."

export const zeromqPubsubSkill: BuiltinSkill = {
  name: ZEROMQ_PUBSUB_SKILL_NAME,
  description: ZEROMQ_PUBSUB_SKILL_DESCRIPTION,
  template: `# ZeroMQ — Advanced Publish-Subscribe (pyzmq)

All examples use Python with pyzmq (\`import zmq\`). The C/libzmq equivalents in the zguide map one-to-one (e.g. \`zmq_proxy\` is \`zmq.proxy\`); see the prose notes for those.

## PUB/SUB MECHANICS RECAP

- PUB sends each message to "all of many"; PUSH/DEALER rotate to "one of many". They are not interchangeable.
- Subscriptions are prefix (topic) matches on the first frame. Empty prefix = subscribe to everything. Unsubscribe with the exact same prefix.
- No back-pressure: publishers run at full speed, subscribers keep up or lose messages. HWM drops messages silently.
- Slow joiner: a SUB that connects misses everything published before its subscription reached the publisher. Sleep after connect, or use a proxy with XPUB subscription visibility, or sync via request-reply.
- No back-chatter: subscribers never talk to publishers (except anonymous subscription frames). Publishers cannot detect crashed or disconnected subscribers.
- SUB sockets send subscriptions; PUB sockets never receive. XPUB/XSUB expose those subscription messages as data.
- In pyzmq the SUBSCRIBE option value MUST be bytes: \`sub.setsockopt(zmq.SUBSCRIBE, b"")\`. A SUB with no subscription receives nothing.

Minimal pyzmq pub-sub:

\`\`\`python
import zmq

ctx = zmq.Context.instance()
pub = ctx.socket(zmq.PUB)
pub.bind("tcp://*:5556")

sub = ctx.socket(zmq.SUB)
sub.connect("tcp://localhost:5556")
sub.setsockopt(zmq.SUBSCRIBE, b"")   # bytes mandatory; b"" = everything
# publisher: pub.send_string("topic payload")
\`\`\`

## PUB-SUB PROXY: XSUB/XPUB

A proxy bridges publishers and subscribers, fixes slow joiner, and gives a place to add tracing, caching, and auth.

The Espresso pattern: capture everything flowing through a pub-sub proxy. XSUB connects to the publishers, XPUB binds for the subscribers, and a capture socket mirrors all traffic.

\`\`\`python
# wuproxy.py — trivial SUB->PUB bridge
import zmq

ctx = zmq.Context.instance()
frontend = ctx.socket(zmq.SUB)
frontend.connect("tcp://192.168.55.210:5556")
frontend.setsockopt(zmq.SUBSCRIBE, b"")

backend = ctx.socket(zmq.PUB)
backend.bind("tcp://10.1.1.0:8100")

while True:
    message = frontend.recv_multipart()
    backend.send_multipart(message)
\`\`\`

For the XSUB/XPUB form, pyzmq gives you \`zmq.proxy\` directly:

\`\`\`python
import zmq

ctx = zmq.Context.instance()
xsub = ctx.socket(zmq.XSUB)
xsub.connect("tcp://localhost:6000")     # publishers connect here
xpub = ctx.socket(zmq.XPUB)
xpub.bind("tcp://*:6001")                # subscribers connect here
capture = ctx.socket(zmq.PUSH)
capture.bind("tcp://*:6002")             # optional capture

zmq.proxy(xsub, xpub, capture)           # runs forever
\`\`\`

- \`zmq.proxy(frontend, backend, capture=None)\`: frontend = XSUB (publishers connect), backend = XPUB (subscribers connect). If capture is not None, every message is copied to it.
- \`zmq.proxy_steerable(frontend, backend, capture=None, control=None)\` adds PAUSE/RESUME/TERMINATE control via a control socket. \`zmq.device\` is deprecated; use \`zmq.proxy\`.
- XPUB emits subscription messages: first byte 0x01 = subscribe, 0x00 = unsubscribe, followed by the topic. XSUB accepts those same frames to add/remove subscriptions upstream.
- Espresso tracing: attach a SUB (or PULL) to the capture socket and count/log per topic. This is how you monitor a pub-sub network you cannot otherwise observe.
- In-process variant (espresso.py): use \`from zmq.devices import monitored_queue\` — \`monitored_queue(subscriber, publisher, pipe[0], b"pub", b"sub")\` with a \`zhelpers.zpipe\` PAIR socket as the in-process listener.

## BUILDING A PUB-SUB NETWORK

- Multi-hop: chain proxies. Each hop is XSUB-in/XPUB-out. Subscriptions propagate hop by hop; expect added latency and per-hop HWM drops.
- Centralized vs decentralized: a central server is simpler and scales to more nodes (10k clients to one server is easy); decentralized is harder to build but removes the bottleneck at millions of msgs/sec.
- Bind publishers, connect subscribers. For dynamic publishers, use a proxy so subscribers only ever know one stable endpoint.
- Use XPUB/XSUB when you need to see subscriptions (LVC, tracing, dynamic topic routing); plain PUB/SUB otherwise.

## LAST-VALUE CACHING (LVC)

Fixes slow joiner for late subscribers: a proxy that remembers the last message per topic and replays it when a new subscription arrives. Works because XPUB exposes subscription messages.

\`\`\`python
# lvcache.py — uses XPUB subscription messages to re-send data
import zmq

def main():
    ctx = zmq.Context.instance()
    frontend = ctx.socket(zmq.SUB)
    frontend.connect("tcp://localhost:5557")
    frontend.setsockopt(zmq.SUBSCRIBE, b"")
    backend = ctx.socket(zmq.XPUB)
    backend.bind("tcp://*:5558")

    cache = {}
    poller = zmq.Poller()
    poller.register(frontend, zmq.POLLIN)
    poller.register(backend, zmq.POLLIN)
    while True:
        try:
            items = dict(poller.poll(1000))
        except KeyboardInterrupt:
            break
        if frontend in items:
            topic, current = frontend.recv_multipart()
            cache[topic] = current
            backend.send_multipart([topic, current])
        if backend in items:
            event = backend.recv()
            # one frame: first byte 1 = subscribe, 0 = unsubscribe, rest = topic
            if event[0] == 1:
                topic = event[1:]
                if topic in cache:
                    backend.send_multipart([topic, cache[topic]])

main()
\`\`\`

- XPUB does not report duplicate subscriptions unless \`ZMQ_XPUB_VERBOSE\` is set; the cache replay only fires on new subscriptions.
- (The C/libzmq equivalent is the same loop over \`zmq_poll\` with an XPUB backend; see lvcache.c in the zguide.)

## RELIABLE PUB-SUB: THE CLONE PATTERN

Pub-sub alone is unreliable (no acks, no catch-up). The Clone pattern adds a request-reply snapshot channel so clients can catch up after (re)connect. Server holds a subtree of key-value state; clients sync then subscribe to live updates.

Protocol (zguide conventions):
- Client -> server on ROUTER snapshot socket: "ICANHAZ?" + subtree.
- Server replies with each kvmsg (key, sequence, body) matching the subtree, then "KTHXBAI" carrying the final sequence number.
- Client subscribes on the PUB socket, drops updates with sequence <= snapshot sequence, applies the rest.
- Clients can send updates back via a PULL/ROUTER collector; server stamps sequence and republishes.

Wire classes in pyzmq: \`kvsimple.py\` carries 3 frames (key, sequence, body) for the early models; \`kvmsg.py\` carries 5 frames (key, sequence, uuid, properties, body) and is the reference for Models 4-6. The Python-3 reference implementations are clonesrv5.py/clonesrv6.py and clonecli5.py/clonecli6.py (Models 1-3 were Python 2 only).

\`\`\`python
# Clone server (Model 5 style, core snapshot loop) using kvmsg.py
import zmq
from kvmsg import KVMsg

def snapshots(socket, kvmap, sequence):
    # ROUTER socket: request is [identity, "ICANHAZ?", subtree]
    identity, request, subtree = socket.recv_multipart()
    if request == b"ICANHAZ?":
        for k, msg in kvmap.items():
            if subtree and not k.startswith(subtree):
                continue
            msg.send(socket, identity)
        # now send the end-of-snapshot message with the current sequence
        msg = KVMsg(sequence, key=b"KTHXBAI", body=subtree)
        msg.send(socket, identity)
\`\`\`

\`\`\`python
# Clone client (Model 5 style): get state snapshot, then apply live updates
import zmq
from kvmsg import KVMsg

sequence = 0
ctx = zmq.Context.instance()
snapshot = ctx.socket(zmq.DEALER)
snapshot.connect("tcp://localhost:5556")
subscriber = ctx.socket(zmq.SUB)
subscriber.connect("tcp://localhost:5557")
subscriber.setsockopt(zmq.SUBSCRIBE, b"")

snapshot.send_multipart([b"ICANHAZ?", b""])
kvmap = {}
while True:
    kvmsg = KVMsg.recv(snapshot)
    if kvmsg.key == b"KTHXBAI":
        sequence = kvmsg.sequence
        break            # snapshot complete
    kvmap[kvmsg.key] = kvmsg

# then poll the SUB socket, ignoring updates with sequence <= snapshot sequence
\`\`\`

The server also runs a heartbeat: publish a \`HUGZ\` kvmsg on a timer so clients can detect a dead server.

### The five clone models

1. **Model One — simple clone**: server PUBs key-value updates, clients store them in a hash. Works only if clients start before the server and never crash.
2. **Model Two — LRU snapshot**: adds a ROUTER snapshot socket so late/crashed clients can request the full state and resume. Introduces the ICANHAZ?/KTHXBAI handshake.
3. **Model Three — subtree updates**: clients send their own updates back through a collector socket; server stamps a global sequence and republishes. State becomes shared, not just distributed.
4. **Model Four — key-value with hash**: adds a per-message hash (property) so clients can detect and reject corrupt or out-of-order updates.
5. **Model Five — key-value with update/patch**: clients send updates (not full values), server validates and applies; adds TTL/ephemeral values flushed by a timer, and subtree filtering per client.

Model Six wraps it all in a multithreaded API (clone_new/clone_connect/clone_set/clone_get) with multiple servers for failover.

\`\`\`python
# Clone API (Model Six style) — client side wrapper over a PAIR pipe to an agent thread
class Clone:
    def connect(self, address, port):
        self.pipe.send_multipart([b"CONNECT", address.encode(), b"%d" % port])
    def set(self, key, value, ttl=0):
        self.pipe.send_multipart([b"SET", key, value, b"%i" % ttl])
    def get(self, key):
        self.pipe.send_multipart([b"GET", key])
        return self.pipe.recv_multipart()
\`\`\`

## HIGH-SPEED SUBSCRIBERS (BLACK BOX PATTERN)

At ~100k msgs/sec, any per-message work in the subscriber loop makes it fall behind and never recover. Fixes:

- **Black box**: keep the subscriber loop doing nothing but receiving and forwarding into an inproc queue (inproc:// to a worker pool). Zero syscalls, no parsing in the I/O loop.
- **Subscribe to a stable prefix**: the SUB filter runs on the publisher side of the wire; a narrow, stable prefix keeps the receive loop cheap.
- **Fat pipes**: one context, many I/O threads (\`ctx.set(zmq.IO_THREADS, N)\` in pyzmq); split I/O across threads by socket.
- **Split I/O from work**: subscriber thread -> PUSH inproc -> PULL workers. The I/O thread never blocks on application logic.
- **Tune HWM**: raise \`zmq.RCVHWM\` on the subscriber so bursts buffer in memory instead of dropping.
- **PGM/epgm**: \`tcp://\` -> \`pgm://\` or \`epgm://(interface;multicast-address:port)\` for one-to-many fan-out handled by the switch. One-way, no subscription feedback, needs identical HWM on both sides; epgm = PGM encapsulated in UDP for routed networks.
- **Suicidal Snail**: a subscriber that falls too far behind is worse than a dead one (stale data). Detect staleness with timestamps in messages and self-terminate or resync when lag exceeds a threshold.

## DISTRIBUTED LOGGING

- Each process has a PUB (or PUSH into a proxy) socket emitting log lines prefixed by topic, e.g. "logs/hostname/severity".
- A logging proxy (XSUB/XPUB) fans out to subscribers: a file recorder subscribing to everything, a monitor subscribing to "logs/*/ERROR", operators subscribing per host.
- Use the Espresso capture socket on the logging proxy to mirror all traffic to an audit sink.
- For durability, combine with the Clone pattern: log records become key-value state that late joiners can catch up on.

## PUB-SUB GOTCHAS + CHECKLIST

Gotchas:
- Slow joiner drops early messages. Fix: sync handshake, LVC, or sleep-after-connect.
- No delivery guarantee: pub-sub is fire-and-forget; use the Clone pattern or request-reply when you need reliability.
- HWM drops silently at full speed. Fix: raise HWM, monitor drop counts, or switch to request-reply for delivery guarantees.
- Subscription is prefix-only on frame 1; multi-frame messages need the topic in frame 1.
- SUBSCRIBE values must be bytes in pyzmq (\`b"topic"\`), never str.
- PUB blocks (or drops, per HWM) on slow subscribers; there is no error back.
- XPUB subscription frames: first byte 0x01/0x00, then topic. Parse before forwarding.
- PGM needs identical HWM on both sides and does not work over TCP-only paths.

Checklist:
- [ ] Subscribers connect, publishers bind (or route through a proxy).
- [ ] Slow joiner handled (sync, LVC, or accept loss).
- [ ] HWM sized for burst vs subscriber speed.
- [ ] Stale-data detection (timestamps, Suicidal Snail) for fast feeds.
- [ ] Catch-up path for reconnects (Clone snapshot or LVC).
- [ ] Proxy capture socket wired for tracing in production.
- [ ] PGM considered only when subscriber count justifies multicast.
- [ ] SUBSCRIBE options set with bytes values.
\``,
}
