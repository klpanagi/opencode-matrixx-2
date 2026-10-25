import type { BuiltinSkill } from "../types"

export const ZEROMQ_FRAMEWORKS_SKILL_NAME = "zeromq-frameworks"

const ZEROMQ_FRAMEWORKS_SKILL_DESCRIPTION =
  "Use when building distributed frameworks or services on top of ZeroMQ — framework patterns in Python (pyzmq): Zyre clustering via pyre, Majordomo/MDP service brokers, brokerless messaging, testing and simulation, flow control for blocked peers, and serialization with protobuf. Related: zeromq-architecture, zeromq-pubsub."

export const zeromqFrameworksSkill: BuiltinSkill = {
  name: ZEROMQ_FRAMEWORKS_SKILL_NAME,
  description: ZEROMQ_FRAMEWORKS_SKILL_DESCRIPTION,
  template: `# ZeroMQ — Distributed Computing Frameworks

## WHAT A FRAMEWORK ADDS OVER RAW ZEROMQ

Raw ZeroMQ gives you sockets and patterns. A framework turns those patterns into reusable services so ordinary developers never touch socket types, retries, or discovery. The zguide (Chapter 8) frames the goal: solve discovery, presence, group messaging, security, and monitoring once, then package it as an API, protocols, and implementations. A framework layer typically adds:

- Peer discovery and presence (who is on the network, who left)
- Logical addressing (UUIDs) instead of endpoint strings
- Group messaging (pub/sub across a mesh, not a broker)
- Flow control so one slow peer cannot kill the process
- A protocol with versioning and a codec, not ad-hoc frames
- A test harness that simulates real network activity

All examples below use Python with pyzmq (\`pip install pyzmq\`).

## ZYRE: PEER-TO-PEER CLUSTERING

Zyre is the zguide's reference framework: local area clustering over UDP beacons plus TCP. Key mechanics:

- **Discovery**: each node broadcasts a UDP beacon (1/sec) containing a 3-byte protocol id ("ZRE"), a 1-byte version, a 16-byte UUID, and a 2-byte TCP port (22-byte frame). Peers that hear a beacon connect back over TCP.
- **Presence**: any traffic from a peer counts as life. Peers send PING/HELLO; expiry is generous (5s on Ethernet; WiFi can show 30s ping latencies, so tune expiry carefully). Detect disappearance fast, delete the peer only after a longer interval.
- **Gossip**: for wide networks, replace beacons with a gossip protocol over a set of gossip endpoints; peers exchange peer lists until views converge.
- **Groups**: JOIN/LEAVE commands track group membership per peer. Broadcast to a group uses an N-tree spanning tree: each peer forwards a SHOUT to peers that have not seen it, giving fair, efficient group delivery without a broker.

### Python binding: pyre (not pip "zyre" or "pyre" from PyPI)

There is NO \`zyre\` package on PyPI, and \`pip install pyre\` installs an unrelated scientific package. The real Python Zyre binding is the GitHub repo \`zeromq/pyre\` (\`import pyre\`), a CFFI wrapper over libzyre and CZMQ, installed from source. The zguide Chapter 8 has no Python Zyre code, only C fragments, so the pyre API is the reference:

\`\`\`python
# pyre (github.com/zeromq/pyre): join a cluster and shout to a group
import pyre

node = pyre.Pyre(name="node1")
node.set_header("X-Service", "worker")
node.start()
node.join("GLOBAL")

while True:
    event = node.recv()  # list: [type, sender_or_group, ...payload]
    if event and event[0] == "SHOUT":
        node.shout(event[2], event[3])  # echo back to the same group

node.stop()
\`\`\`

Verified pyre API surface: \`Pyre(name=None)\`, \`set_name(name)\`, \`set_header(k, v)\`, \`start()\`, \`join(group)\`, \`leave(group)\`, \`shout(group, msg)\`, \`whisper(peer, msg)\`, \`recv()\`, \`peers()\`, \`stop()\`. Events arrive as ENTER, EXIT, JOIN, LEAVE, WHISPER, SHOUT.

### Illustrating the beacon + ROUTER mesh idea in pure pyzmq

If you cannot use pyre, the C-zyre "beacon plus ROUTER mesh" idea can be sketched with raw pyzmq sockets. This is illustrative only; a real implementation needs the full ZRE protocol:

\`\`\`python
# pyzmq: minimal illustrative sketch of discovery + a ROUTER mesh
import zmq, uuid

ctx = zmq.Context()
router = ctx.socket(zmq.ROUTER)
router.bind("tcp://*:5555")
identity = uuid.uuid4().bytes
print("peer id:", identity.hex())
# A real node would also broadcast a UDP beacon carrying this UUID
# and port, connect to peers that answer, and track presence timers.
\`\`\`

## MAJORDOMO (MDP) AND BROKERLESS MESSAGING

Majordomo (Chapter 3/8) is a service-oriented broker: clients and workers connect to one broker endpoint; the broker proxies requests to worker pools per service.

- Protocol frames: client sends "MDPC01", service name, body. Worker sends "MDPW01" commands: READY (service), REQUEST, REPLY, HEARTBEAT, DISCONNECT.
- Broker keeps a queue per service, routes requests to waiting workers, heartbeats both sides, and re-queues requests from dead workers.
- The broker is a single point of failure; run it as a stateless relay and add binary star failover (see zeromq-reliability) if needed.

In Python, the zguide ships \`mdbroker.py\` plus \`MDP.py\` constants:

\`\`\`python
# MDP.py: the Majordomo protocol constants used by mdbroker.py
C_CLIENT = b"MDPC01"  # client protocol version
W_WORKER = b"MDPW01"  # worker protocol version

W_READY = b"\\x01"
W_REQUEST = b"\\x02"
W_REPLY = b"\\x03"
W_HEARTBEAT = b"\\x04"
W_DISCONNECT = b"\\x05"
\`\`\`

The maintained modern Python port is \`shoppimon/majortomo\` (broker.py, client.py, worker.py, protocol.py); prefer it over hand-rolling MDP.

Brokerless alternative: Zyre-style mesh, or a DEALER-to-DEALER mesh where each node holds one DEALER per peer. Broker-based networks scale nicely and reduce endpoints to one; brokerless removes the SPOF but pushes discovery and flow control onto every node. Choose by topology: stable datacenter = broker; volatile LAN/IoT = brokerless.

## BUILDING YOUR OWN BROKER/FRAMEWORK

The zguide's recipe: start with the simplest working protocol, tag releases (Zyre did v0.1.0, v0.2.0, v0.3.0), and grow. Structure each node as an API thread plus a background agent thread connected by a PAIR pipe:

- API thread: blocking calls for the app (join, shout, recv events).
- Agent thread: one loop, \`zmq.Poller\` over the pipe plus all sockets; owns all state (peers hash, groups hash).
- One DEALER socket per peer, so no peer can block another's traffic.

## SERIALIZATION AND PROTOCOL DESIGN

- **Explicit framing + JSON**: pyzmq's \`send_json\`/\`recv_json\` keep payloads debuggable and versionable; keep ZeroMQ framing for routing/envelope and the JSON body for data.
- **protobuf** works well for payloads; keep ZeroMQ framing for the envelope and protobuf for the body. zproto is the zguide's codegen approach: it generates codecs and protocol engines from a grammar, with fixed or variable-size frames, per-command codecs, and a protocol version baked into the header.
- **Never use \`send_pyobj\`/\`recv_pyobj\` with untrusted peers**: pickle deserialization is arbitrary code execution. Reserve pyobj for trusted, same-machine pipes only.
- **Versioning**: put a version byte in a fixed header that will never change; body format depends on the version (the ZRE beacon does exactly this: 3-byte protocol, 1-byte version, 16-byte UUID, 2-byte port). Reject unknown versions early. Evolve by adding optional fields, never by reordering.

\`\`\`python
# pyzmq: JSON framing with a version byte in the first frame
import zmq

ctx = zmq.Context()
sock = ctx.socket(zmq.DEALER)
sock.connect("tcp://127.0.0.1:5555")

sock.send(b"\\x01")  # version byte, frozen forever
sock.send_json({"op": "query", "id": 42})
reply = sock.recv_json()
\`\`\`

## TESTING AND SIMULATION

The only way to know a distributed framework works is to simulate real activity on each piece. The zguide's Zyre tester runs N virtual nodes in one process:

- Each node thread polls its pipe and interface; on ENTER send WHISPER, on WHISPER reply 1/2 of the time, on SHOUT reply WHISPER 1/3 and SHOUT 1/3; once per second join or leave one of 10 random groups.
- Heavy simulation exhausts file handles; raise the limit: \`ulimit -n 30000\`.
- Test timing assumptions explicitly: heartbeats, expiry, retries. Simulate slow and dead peers, not just happy paths.

The zguide's \`eagain.py\` shows how to simulate a blocked peer and observe HWM backpressure:

\`\`\`python
# eagain.py (zguide): a DEALER whose peer never reads, hitting the HWM
import zmq

ctx = zmq.Context()
mailbox = ctx.socket(zmq.DEALER)
mailbox.setsockopt(zmq.SNDHWM, 4)
mailbox.setsockopt(zmq.SNDTIMEO, 0)
mailbox.connect("tcp://127.0.0.1:9876")

count = 0
while True:
    try:
        mailbox.send(b"message %i" % count)
        count += 1
    except zmq.Again:
        break  # peer at HWM: this is the backpressure signal
print("sent %i messages before HWM blocked us" % count)
\`\`\`

## FLOW CONTROL: DEALING WITH BLOCKED PEERS

A broker that queues for a slow client until memory dies is the classic failure. A DEALER that hits its high-water mark blocks, and one blocked peer would block the single distributing thread. Fixes:

- Poll the whole set of DEALER sockets with a \`zmq.Poller\` and only write to sockets that are writable; skip (or queue minimally for) peers at HWM.
- Set \`zmq.SNDHWM\` low and \`zmq.SNDTIMEO\` to 0, then treat \`zmq.Again\` as "peer is slow": drop, count, and apply backpressure upstream.
- Give each peer its own socket/thread boundary so TCP's fairness across connections works for you.

Know what each pattern does at the HWM: PUB and PUSH silently drop messages when the pipe is full; DEALER, ROUTER, and PULL block, or raise \`zmq.Again\` when SNDTIMEO is 0.

## FRAMEWORK API SURFACE

Design the API as messages, not callbacks, so it can be wrapped, traced, and proxied. Checklist:

- Every operation is a message on a pipe; events stream back as typed commands (ENTER, EXIT, SHOUT...).
- Headers carry metadata (\`set_header\` in pyre) so peers advertise capabilities.
- No blocking calls in the agent loop; no state outside the agent thread.
- Expose tuning knobs: expiry, beacon interval, HWM, gossip endpoints.

## PRODUCTIONIZING CHECKLIST

- Protocol: version byte in a frozen header; codec generated (zproto) or schema'd (protobuf/JSON); reject unknown versions.
- Discovery: beacon for LAN, gossip for scale; treat any TCP traffic as liveness, not just beacons.
- Flow control: per-peer DEALER, poll writability, \`zmq.Again\` policy, bounded queues everywhere.
- Failure: heartbeat + expiry tuned to the network (WiFi needs slack); re-queue in-flight work; broker failover if brokered.
- Reliability knobs: \`setsockopt(zmq.ROUTER_MANDATORY, 1)\` so unroutable peers raise instead of silently dropping; \`zmq.IMMEDIATE\` to queue only on connected peers; \`zmq.TCP_KEEPALIVE\` to detect dead TCP connections.
- Observability: trace every API message; log peer lifecycle events; expose queue depths; attach a monitor with \`sock.get_monitor_socket()\` to watch connect/disconnect events.
- Lifecycle: one \`zmq.Context\` per process; close sockets with \`sock.close(linger=0)\` and terminate with \`ctx.term()\` on shutdown.
- Security: CURVE on every TCP socket before exposing to a shared network (see zeromq-architecture).
- Testing: N-node simulation in one process, slow-peer and dead-peer cases, ulimit raised, timing assertions.
`,
}
