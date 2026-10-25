import type { BuiltinSkill } from "../types"

export const PYTHON_ASYNCIO_SKILL_NAME = "python-asyncio"

const PYTHON_ASYNCIO_SKILL_DESCRIPTION =
  "Use when writing asyncio code for trading connectors, market-data loops, or concurrent symbol feeds — structured concurrency, TaskGroup, cancellation, backpressure, and per-loop error containment. Related: ccxt-rest, ccxt-pro-websockets."

export const pythonAsyncioSkill: BuiltinSkill = {
  name: PYTHON_ASYNCIO_SKILL_NAME,
  description: PYTHON_ASYNCIO_SKILL_DESCRIPTION,
  template: `# Python asyncio — Concurrency for Connector Fleets

## MENTAL MODEL

asyncio runs one event loop on one thread. Concurrency comes from interleaving coroutines at await points, not from parallelism. For a trading connector fleet this is ideal: dozens of symbol loops and websocket feeds are I/O-bound, so a single loop handles them all cheaply. The two failure modes to design against are (1) one blocking call freezing every loop, and (2) one failing symbol loop taking down the whole process.

## STRUCTURED CONCURRENCY: TaskGroup

Python 3.11+ \`asyncio.TaskGroup\` is the default way to run a fleet. If any child raises an unhandled exception, the group cancels the siblings and re-raises an \`ExceptionGroup\`. That is the containment boundary you want: failures are loud, not swallowed.

\`\`\`python
import asyncio

async def symbol_loop(exchange, symbol):
    while True:
        ticker = await exchange.fetch_ticker(symbol)
        await asyncio.sleep(1)

async def main():
    symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
    async with asyncio.TaskGroup() as tg:
        for sym in symbols:
            tg.create_task(symbol_loop(exchange, sym))
# any child failure cancels the rest and raises here
\`\`\`

For older Pythons, \`gather(..., return_exceptions=True)\` collects failures instead of propagating them. Use it when one symbol failing must NOT cancel the others, and inspect the results explicitly:

\`\`\`python
results = await asyncio.gather(
    *(symbol_loop(ex, s) for s in symbols),
    return_exceptions=True,
)
for sym, res in zip(symbols, results):
    if isinstance(res, BaseException):
        logger.error("loop for %s died: %r", sym, res)  # record, then restart it
\`\`\`

Never call bare \`asyncio.gather(...)\` without \`return_exceptions=True\` for independent loops: the first exception propagates and the remaining tasks keep running as orphans nobody awaits or observes.

## PER-LOOP ERROR CONTAINMENT

One failure must break only its own loop. Wrap the loop body, not the fleet:

\`\`\`python
async def symbol_loop(exchange, symbol):
    while True:
        try:
            await poll_once(exchange, symbol)
        except ccxt.NetworkError as e:
            logger.warning("%s transient: %r", symbol, e)
            await asyncio.sleep(backoff)          # bounded retry, stays in loop
        except ccxt.ExchangeError as e:
            logger.error("%s fatal: %r", symbol, e)
            break                                  # fatal: this loop exits, others live on
        except asyncio.CancelledError:
            raise                                  # never swallow cancellation
\`\`\`

Rules:
- Catch narrowly per branch; a broad \`except Exception\` that logs-and-continues turns every failure into a silent stall (see silent-failure-detection).
- Re-raise \`asyncio.CancelledError\` always. Swallowing it breaks graceful shutdown and TaskGroup semantics.
- A loop that exits fatally should record WHY (counter, log, typed outcome) so the fleet supervisor can disable or restart that unit deliberately.

## CANCELLATION AND SHUTDOWN

\`task.cancel()\` raises \`CancelledError\` at the next await point inside the task. Correct shutdown: cancel all tasks, then await them, then close resources.

\`\`\`python
async def graceful_shutdown(tasks, exchange):
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)  # observe cancellations
    await exchange.close()                                # ccxt: always close
\`\`\`

Inside a cancelled coroutine, cleanup goes in \`finally\` (or an async context manager's \`__aexit__\`). Do not await long operations in a cancelled task without shielding: \`await asyncio.shield(critical_flush())\` protects a step that must complete, but note the shielded work keeps running even if the outer await is cancelled.

## NEVER BLOCK THE LOOP

A blocking call (time.sleep, requests, heavy CPU, synchronous DB drivers) freezes EVERY coroutine on the loop: heartbeats stop, websockets stall, timers slip. Offload it:

\`\`\`python
result = await asyncio.to_thread(blocking_function, arg)      # 3.9+
result = await loop.run_in_executor(None, blocking_fn, arg)   # explicit executor
await asyncio.sleep(1)   # never time.sleep(1) inside a coroutine
\`\`\`

Audit rule: every \`await\`-less call inside an async function is a suspect. If it does I/O or burns >10ms of CPU, it belongs in a thread or a process.

## TIMEBOUNDS: wait_for

Every external wait gets a deadline. An unbounded await on a dead socket is a silent hang.

\`\`\`python
try:
    msg = await asyncio.wait_for(ws.recv(), timeout=10)
except asyncio.TimeoutError:
    logger.warning("recv timed out; treating peer as degraded")
\`\`\`

\`wait_for\` cancels the inner awaitable on timeout, so the timeout itself is a cancellation you must handle at the call site.

## BACKPRESSURE: bounded queues

An unbounded \`asyncio.Queue\` hides a slow consumer by eating memory. Bound it and let the producer feel the pressure:

\`\`\`python
queue: asyncio.Queue = asyncio.Queue(maxsize=10_000)

async def producer():
    while True:
        tick = await fetch_tick()
        try:
            queue.put_nowait(tick)
        except asyncio.QueueFull:
            logger.warning("queue full; dropping tick")  # deliberate, counted policy
            dropped.inc()

async def consumer():
    while True:
        tick = await queue.get()
        await persist(tick)
\`\`\`

Decide the overflow policy explicitly (drop-oldest, drop-newest, block) and count drops. A queue that silently grows is a silent failure.

## ASYNC CONTEXT MANAGERS

Use \`async with\` for anything with an async close: ccxt pro exchanges, aiohttp sessions, zmq.asyncio sockets. It guarantees \`__aexit__\` runs on both normal exit and cancellation.

\`\`\`python
async with ccxtpro.binance() as ex:
    async for trade in ex.watch_trades("BTC/USDT"):
        handle(trade)
# ex.close() runs even if the body raises or is cancelled
\`\`\`

## RULES OF THUMB

- One event loop per process; never mix threads that touch the loop.
- TaskGroup (3.11+) or gather(return_exceptions=True); never bare gather.
- Per-symbol loops contain their own errors; fatal errors exit one loop, not the fleet.
- Re-raise CancelledError; shutdown = cancel + await + close.
- asyncio.to_thread for anything blocking; time.sleep is forbidden in coroutines.
- wait_for a timeout on every external await.
- Bounded queues with a counted overflow policy.
- No thread-based designs for the connector fleet: threads plus asyncio share nothing safely and hide races.
`,
}
