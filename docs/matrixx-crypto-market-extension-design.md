# Matrixx Crypto Market Extension Design

> **What this is**: the domain analysis and architecture/capability design for extending
> Matrixx to support DW Finance Group (DWF Labs) software engineering — short-term
> systematic crypto trading, market-data ingestion, and the exchange-to-monitoring pipeline.
> **Companion artifact**: the working draft lives at
> `.matrixx/plans/dwfinance-crypto-market-data-extension-design.md` (local dev state, gitignored).
> This file is the durable record — commit it (PR targets `dev`) to make it the versioned source of truth.

---

## Part I — Domain Analysis

### The position in one line

DWF is hiring for **short-term systematic trading systems engineering, Python-first** — the
bar is independent end-to-end ownership, robustness over features, and AI-coding fluency
treated as a real engineering skill.

### What the role actually demands

- **Independent ownership** of ambiguous tasks, carried through to something that runs.
- **AI-coding fluency** (Claude-class) as a core skill — writing, reviewing, debugging.
- **Analytical + synthetic thinking** — decompose an ambiguous brief, then execute it.
- **Robustness over scope** — Task F's thesis: *"a failure that produces a plausible-looking
  answer is worse than a crash."*
- **Scale as a first-class concern** — more exchanges, more markets, more pairs, without
  redesign.
- **English working language**, remote, with European-hours overlap.

### Technology surface (fixed by the onboarding briefs)

Python · asyncio · ccxt / ccxt.pro · ZeroMQ (pyzmq) · InfluxDB 2.x · Grafana ·
Telegram (python-telegram-bot / aiogram) · SQLite/JSON persistence · Linux/Ubuntu 24.04 ·
systemd · git. Read-only market data — no execution/trading at any layer.

### Matrixx gap analysis (what exists today)

- **Reusable now**: the **7 `zeromq-*` skills** (PUB/SUB semantics, Lazy Pirate, Paranoid
  Pirate, conflation, reconnect, one-context-per-process, `zmq.asyncio`) — the single most
  valuable existing asset for this domain. Plus `software-dev`, `tdd-enforcer`,
  `quality-gate`, `review-work`, `security-*`.
- **Missing (greenfield)**: ccxt ingestion, asyncio patterns, market-data bus contract,
  InfluxDB/Grafana modelling, Telegram control plane, crypto market structure,
  data-quality/observability, and any finance-domain agent.

### Design principle

> Knowledge → **skill** · Deterministic operation → **tool** · External server → **MCP** ·
> Distinct reviewing persona → **agent**

### Landscape (what others use in this domain)

Official **ccxt-mcp** (config-file-only escalation; keys never to the model), **InfluxDB3 MCP**
(read-only workflows), **Grafana MCP** (RBAC service tokens, default-off tool categories),
**ClickHouse MCP** (3 read-only tools), plus CoinGecko / Dune / OpenBB / Financial-Datasets
MCPs and `mcp-pandas` / `mcp-python-repl` for sandboxed analysis. Published domain skills
(`agiprolabs/claude-trading-skills`, quantitative-trading backtesting) and backtesting engines
(backtrader, vectorbt, hftbacktest). Consistent security posture across the ecosystem:
**read-only, least privilege, tool categories off by default**.

---

## Part II — Extension Design

> **Deliverable type**: Architecture & Capability Design (NOT an execution plan).
> **Target domain**: DW Finance Group / DWF Labs — short-term systematic crypto trading (minutes→2 days), Python/asyncio + ccxt/ccxt.pro + ZeroMQ + InfluxDB + Grafana + Telegram, Linux/systemd, high-throughput, failure-hard, observable.
> **Design rule honored**: ZERO human-intervention verification is a *runtime* concern; here it is expressed as "no silent failure — every outcome must be distinguishable from success."

---

## TL;DR

Matrixx already has **the single most reusable asset for this domain: 7 `zeromq-*` skills.** The correct strategy is **skills-first, agents-last**, because most domain value is *knowledge injection* (cheap, reversible, zero runtime risk) and only two competencies genuinely require a distinct persona.

| Lever | Recommendation |
|-------|----------------|
| **Agents** | Add **2** net-new: `neo` (market-data systems architect/reviewer) and `tank` (resilience & silent-failure hunter, Task F generalized). Defer `dozer`/`switch`/`apoc`; reject `link`/`cypher`. |
| **Skills** | Add **~13** new skills in 7 layers; **reuse** all 7 `zeromq-*`; **extend** `security-secrets` for exchange API keys. |
| **Tools** | Add **4** high-leverage deterministic tools: `silent-failure-scanner`, `staleness-gap-checker`, `market-symbol-validator`, `dashboard-flux-validator` (+ optional `exchange-probe`). |
| **MCPs** | Add **0 built-in**. Ship **user-configured, default-off, read-only** presets: ccxt-mcp, InfluxDB, Grafana (+ optional CoinGecko/Dune/OpenBB/ClickHouse). Telegram MCP: read-only or none. |
| **Hooks** | **2 light** hooks (`domain-keyword-detector`, `silent-failure-guard`) + a finance rules file consumed by the existing `rules-injector`, plus a Python `quality-gate` profile. No heavy `PreToolUse`. |
| **Reference arch** | One canonical pipeline spec encoded in `market-data-architecture`, so every agent builds the same shape. |
| **Task F** | First-class 4-part capability: static scanner + dynamic invariants + adversarial `tank` review + mandatory failure-injection test pattern. |

**Why this is the right shape**: ingestion/storage/observability/control-plane are *techniques* → skills; deterministic repeated checks → tools; external systems with existing servers → MCPs; only **architecture review** and **adversarial failure-hunting** need their own cognitive persona → agents.

### Success criteria (how we know the extension worked)

Two goals are possible and imply different builds; pick one explicitly before implementing:

- **(a) Augment Matrixx for day-to-day DWF work** — success = domain skills load, the scanner runs in CI, `neo`/`tank` review finance diffs. No runnable product required.
- **(b) Demonstrate job-readiness end-to-end** — the employer's stated bar is "carried through to something that runs"; success additionally requires a **runnable, minimal, read-only market-data skeleton** (one publisher + one consumer) that exercises `silent-failure-scanner` green, ships ≥1 failure-injection test, and reaches Grafana.

**Recommendation: (b), narrowed.** The brief rewards robustness over breadth. **MVP gate** = `silent-failure-detection` + `resilience-error-taxonomy` + `silent-failure-scanner` + the failure-injection DoD, **green in CI**, before any breadth. This is the single open product decision (see §10).

---

## 0. Verified Extension Anchors (cite these exactly)

| Thing | File / symbol (verified in this repo) |
|-------|----------------------------------------|
| New skill file | Create `src/features/builtin-skills/skills/<kebab-name>.ts` (a `*_SKILL_NAME` const + a `BuiltinSkill = { name, description, template }`) → register in the **runtime** `skillLoaders` map in `src/features/builtin-skills/skills.ts` (`"<name>": () => require("./skills/<name>").<camel>Skill`). `skills/index.ts` is **type-only** and is NOT a runtime registry. `BuiltinSkillNameSchema` (`src/config/schema/agent-names.ts:21`) validates only `disabled_skills` and is **incomplete** (omits `zeromq-*`) — never treat it as the list of loadable skills. |
| Existing zeromq skills | `src/features/builtin-skills/skills/zeromq-{core,sockets-patterns,pubsub,advanced-reqrep,reliability,architecture,frameworks}.ts` (exported `index.ts:52-58`) |
| New agent | `src/agents/<name>.ts` → add to `agentSources` in `src/agents/builtin-agents.ts:37` → add to `BuiltinAgentNameSchema` in `src/config/schema/agent-names.ts:3` |
| New tool | `src/tools/<kebab-name>/` (`index.ts`/`types.ts`/`constants.ts`/`tools.ts`) → register in `src/plugin/tool-registry.ts`; gating in `src/plugin/tool-gating.ts`; composed in `src/create-tools.ts` |
| New MCP | `src/mcp/` + `createBuiltinMcps()` (`src/mcp/index.ts:48`) — **recommended NOT used** (see §5) |
| New hook | `src/hooks/<name>/` → add to `HookNameSchema` (`src/config/schema/hooks.ts:79`) → register in `src/plugin/hooks/create-{core,continuation,skill,tool-guard,transform,session}-hooks.ts` |
| Schema regen | `bun run build:schema` (regenerates `dist/matrixx.schema.json` + `assets/matrixx.schema.json`) |
| Tests | new tests under `tests/**` (CI-discovered by `find tests script -name '*.test.ts'`); `mock.module()` tests MUST be added to `script/mock-heavy-list.txt` |
| Full CI | `bash script/run-ci.sh` |

**Verified inventory**: `BuiltinAgentNameSchema` = 15 agents (morpheus, keymaker, oracle, merovingian, operator, trinity, construct, seraph, smith, auditor, architect, cipher, sentinel, sati, bdd-contract). `src/mcp/` = websearch, context7, document-reader. Runtime skills live in the `skillLoaders` map (`src/features/builtin-skills/skills.ts`); `BuiltinSkillNameSchema` is **incomplete** (omits the `zeromq-*` skills) and gates only `disabled_skills`. Hook tiers = core/continuation/skill/session/tool-guard/transform.

---

## 1. Competency Model — what the domain needs, and which mechanism carries it

The domain decomposes into six competencies. The mechanism assignment follows one rule: **knowledge → skill, deterministic operation → tool, external server → MCP, distinct cognitive persona → agent.**

| # | Competency | Failure it owns | Mechanism | Why |
|---|------------|-----------------|-----------|-----|
| 1 | **Ingestion / streaming** | stale snapshot after reconnect, missed symbols, cross-loop death | **Skill** (`ccxt-rest`, `ccxt-pro-websockets`, `python-asyncio`) | Pure technique; no persona needed to *write* a connector. Implementation delegations pass these skills explicitly (`skills=[…]`) — categories carry no skills. |
| 2 | **Data / storage** | field-type conflict, server-side timestamps, cardinality blow-up | **Skill** (`influxdb-timeseries`, `time-series-fundamentals`) | Declarative schema/query knowledge |
| 3 | **Observability** | masked gaps, silent staleness | **Skill** (`data-quality-observability`) + **Tool** (`staleness-gap-checker`) + **MCP** (Grafana/Influx read-only) | Knowledge + deterministic detection + live query |
| 4 | **Resilience** | swallowed errors, transient-vs-fatal confusion | **Skill** (`resilience-error-taxonomy`, `silent-failure-detection`) + **Agent** (`tank`) | Knowledge + adversarial hunting persona |
| 5 | **Control-plane** | lost commands, reused REQ, unauth bots | **Skill** (`telegram-bot`) + reuse `zeromq-advanced-reqrep`/`reliability` | Technique; control is code, not model tools |
| 6 | **Quant research** | lookahead bias, overfitting, PIT violations | **Skill** (`quant-backtesting`, `crypto-market-structure`) | Knowledge; deferred to Phase 3+ |
| ★ | **Architecture review (cross-cutting)** | inconsistent pipeline shapes, backpressure blindness | **Agent** (`neo`) | A review persona that reasons across the whole pipeline and issues a verdict |

**Key insight**: this domain's center of gravity is **not** "more agents"; it is **encoding hard-won invariants where agents can reach them**. Agent sprawl here would *increase* the risk they warn about (a plausible-looking agent that silently does the wrong thing). Two personas, many skills.

---

## 2. Agents

### 2.1 Candidate mapping (be explicit about what we refuse)

| Candidate | Verdict | Rationale |
|-----------|---------|-----------|
| **neo** | **ADD** | Market-data systems architect/reviewer — the domain's core review persona. |
| **tank** | **ADD** | Resilience & silent-failure hunter — Task F generalized into a persistent persona. |
| **dozer** | DEFER | Data/storage engineer. Influx/Grafana/recorder work is **mechanical** and fully covered by `influxdb-timeseries` + `grafana-dashboards` skills executed by the `source` category. Adding a persona buys little. Revisit only if storage work becomes a standing specialty. |
| **switch** | DEFER | Control-plane/failover. Telegram + ROUTER control is code; `telegram-bot` skill + `source` suffice. Failover is systemd's job, not an agent's. |
| **apoc** | DEFER | Chaos/adversarial fault-injection. Genuinely useful, but its *hunting* half is `tank`; its *injection* half is better as a **test pattern** (§8) than an agent. Fold into `tank` + the failure-injection test pattern. |
| **link** | REJECT | Exchange-connectivity *implementation* persona. Implementation is the `source` category's job (delegations pass `ccxt-rest`/`ccxt-pro-websockets` via `skills=[…]`). A persona adds surface, not capability. |
| **cypher** | REJECT | Name is a near-collision with the existing `cipher` (DSL). Never ship a one-letter-different agent name — it guarantees operator confusion. |

**Net: +2 agents.** This is intentional discipline, not under-delivery.

### 2.2 `neo` — Market-Data Systems Architect / Reviewer

- **Purpose**: Own the end-to-end *design and adversarial review* of ingestion → bus → consumers → storage pipelines. Enforce the robustness invariants (§7) as a verdict-producing review, not just advice.
- **When to invoke**: "design the ingestion pipeline", "review this for exchange-failure robustness", "why does the bus drop messages under load", "make this horizontally scalable", "is the backpressure correct", "review the snapshot/stream contract".
- **Model / temperature**: frontier reasoning tier (same class as `merovingian`/`morpheus`), **temp 0.1** (code/critical, per Matrixx convention ≤0.3).
- **Tools / skills**: `read`, `lsp`, `grep`, `ast_grep_search`, `delegate-task`, `ctx_*`; skills → `market-data-architecture`, `ccxt-pro-websockets`, `ccxt-rest`, `zeromq-pubsub`, `zeromq-reliability`, `zeromq-architecture`, `data-quality-observability`, `resilience-error-taxonomy`, `crypto-market-structure`. **Read-only** (like `sentinel`/`merovingian`) — it reviews, it does not edit.
- **Why an agent (not a skill)**: A skill injects knowledge into whoever is already working. `neo` must *adopt a critical stance*, reason across a whole pipeline it did not write, and return a **verdict with specific invariant violations**. That is a persona property (cf. why `sentinel` is an agent, not a "security skill").
- **Output & boundary**: emits a structured verdict `{ status: "pass"|"warn"|"fail", confidence, violations: [{ invariant, file, line, evidence }] }` consumed by the finance review gate. Boundary vs `merovingian`: `merovingian` = general hard reasoning/debugging; `neo` = market-data-pipeline invariants only.

### 2.3 `tank` — Resilience & Silent-Failure Hunter

- **Purpose**: Given a module, diff, or log set, adversarially answer *"what failure here would look like success?"* Detect swallowed exceptions, transient-vs-fatal misclassification, and outcomes indistinguishable from genuine ones (the exact Task F shape).
- **When to invoke**: "review this for swallowed failures", "did anything fail silently", "is this error handling correct", "classify these exceptions", **automatically** as a pre-merge review on finance-domain diffs.
- **Model / temperature**: frontier reasoning, **temp 0.0** (maximum determinism for a hunting task).
- **Tools / skills**: `read`, `grep`, `ast_grep_search`, `lsp`, `silent-failure-scanner` (tool, §4); skills → `silent-failure-detection`, `resilience-error-taxonomy`, `data-quality-observability`, `ccxt-rest` (error taxonomy), `zeromq-reliability`. **Read-only**.
- **Why an agent (not a skill)**: Hunting for *absence of evidence* is a search+judgement loop, not a knowledge lookup. A skill cannot pursue a hypothesis across files; `tank` can. This is the direct, durable productization of Task F.
- **Output & integration**: same structured verdict shape as `neo`, focused on invariants #4/#9. Integration point = the finance diff filter feeding `review-work`/`quality-gate` (a scoped gate, not an always-on `PreToolUse` hook).

### 2.4 Agent–skill dependency graph

```
neo  ← market-data-architecture, ccxt-rest, ccxt-pro-websockets,
       zeromq-{pubsub,reliability,architecture}, data-quality-observability,
       resilience-error-taxonomy, crypto-market-structure
tank ← silent-failure-detection, resilience-error-taxonomy,
       data-quality-observability, zeromq-reliability, ccxt-rest
```
Both are **read-only consultation agents**; implementation is delegated to the `source` category carrying the same skills.

---

## 3. Skills (the highest-ROI investment)

### 3.1 Reuse decision (do NOT duplicate)

- **`zeromq-*` (7)**: **reuse unchanged.** They already cover PUB/SUB drops@HWM, snapshot+stream, Lazy Pirate, Paranoid Pirate, slow-joiner, conflation, RECONNECT_IVL, heartbeat, one-context-per-process, zmq.asyncio. **Do not add** `zmq-core`-style duplicates.
- **`security-secrets`**: **extend, not new.** Add an exchange-API-key profile: keys never to the model, config-file-only, read-only trading scope, sub-account/IP-allowlist, systemd credentials/env, no keys in logs/TG.
- **`tdd-enforcer`**: **extend** with the finance failure-injection test profile (§8).
- **`review-work` / `quality-gate`**: **extend** with a "silent-failure" checklist item that routes to `tank`.
- **Decision**: **add** `market-data-bus` as a distinct skill (counted in the 13). Domain envelope semantics (seq/exchange_ts/pub_ts, resync command channel, per-consumer conflate policy) are not generic ZMQ knowledge; keeping it separate lets `market-data-architecture` own the whole pipeline and `market-data-bus` own the wire contract.

### 3.2 Full skill set by layer

| Layer | Skill | One-line purpose | Body must teach (concrete) |
|-------|-------|------------------|----------------------------|
| **A. Runtime** | `python-asyncio` | Correct async concurrency for connector fleets | loop-per-process; TaskGroup & `gather(return_exceptions=True)`; per-loop error containment (break only own loop); cancellation; **never blocking recv in the loop**; bounded queues as backpressure; async context managers; structured concurrency |
| **B. Exchange** | `ccxt-rest` | Reliable REST client lifecycle & error taxonomy | one client/exchange for process lifetime; `load_markets()` once + periodic reload; `close()`; `has[]` gating; `market()`→`BadSymbol`; symbol model `BTC/USDT` vs `BTC/USDT:USDT`; never hardcode ids, iterate `exchange.symbols`; `enableRateLimit` on + token bucket + `rollingWindow`; NetworkError(transient)→backoff vs ExchangeError(fatal)→skip; mark vs last; volume=0; ms-epoch-UTC |
| **B. Exchange** | `ccxt-pro-websockets` | Robust streaming ingestion | `watch_*`; `watch_order_book_for_symbols` multiplexing; `un_watch` on stop; **deque cache limits set before first watch**; auto-reconnect + exponential backoff; **stale WS snapshot after reconnect** → resync; has[] gating; one watch-loop per symbol+exchange |
| **C. Messaging** | `market-data-bus` | Domain wire contract over ZMQ | snapshot+stream envelope (`seq`, `exchange_ts`, `pub_ts`); per-symbol monotonic seq; resync via command channel; `conflate=False` recorder / `=True` latest-price UI (single-frame only); HWM backpressure + drop counter; slow-joiner; DEALER↔ROUTER commands (never reuse REQ after timeout) |
| **D. Storage** | `influxdb-timeseries` | Correct time-series modelling | one measurement; low-cardinality tags `exchange/market_type/symbol`; float fields `price/bid/ask`; **explicit UTC-ns `Point.time`**; `WriteOptions(batch_size, flush_interval, retry, jitter)` + callbacks; bucket retention 30d; least-privilege tokens; anti-patterns: server-side timestamps, TZ, field-type conflict, high-cardinality tag creep |
| **D. Storage** | `grafana-dashboards` | Provisioning + honest dashboards | provisioned datasource; `schema.tagValues` variables (one `symbol` var covers spot+perp); stat panels + value mappings for **0/1/2 staleness states**; annotations; Flux shapes (price-over-time, basis via `union`+`pivot` — never join, staleness via `last()`+`system.time()`); **never `createEmpty:true`** (it hides gaps); read-only tokens; alerting **queries only**, not alerting management |
| **E. Control** | `telegram-bot` | Operator control plane | python-telegram-bot/aiogram async handlers; command/response over bus (DEALER/ROUTER); auth allowlist; **no secrets echoed**; idempotent ops; rate limits; status/resync/restart verbs |
| **F. Resilience** | `resilience-error-taxonomy` | One canonical error doctrine | transient (`NetworkError` → `RequestTimeout`/`ExchangeNotAvailable`/`DDoSProtection`/`RateLimitExceeded`) → backoff+jitter+retry; fatal (`ExchangeError` → `BadSymbol`/`NotSupported`/`Auth`/`InsufficientFunds`) → skip+flag; **never map a caught error to a valid outcome**; per-loop containment; crash-only + systemd restart; finite `LINGER`; **never reuse a timed-out REQ** |
| **F. Resilience** | `silent-failure-detection` | The anti-pattern catalog + detection recipes (**Task F core**) | patterns: `except: pass`; `except …: logger.warning()` then a default-return recorded as an outcome; `gather()` without return_exceptions; `createEmpty`/alerts masking gaps; missing heartbeat; indistinguishable outcome records. Detection: static (ast-grep rules), dynamic (typed outcomes + counters + canary + reconciliation), and the **"what would look like success?" review question** |
| **F. Quality** | `data-quality-observability` | Continuously prove liveness | per-symbol seq-gap detection; staleness `exchange_ts` vs now → 0/1/2; ZMTP heartbeat + app Paranoid Pirate (3 misses×1s, backoff 1s→32s); monitor socket; publish-rate/zero-volume/gap metrics; **explicit flags, never silent** |
| **G. Domain** | `crypto-market-structure` | Unified-model reality | spot vs perp (`:` settle); linear/inverse; `market[]` fields `spot/swap/linear/inverse/active`; funding, basis, mark vs last; field-absence; exchange quirks |
| **G. Domain** | `market-data-architecture` | **The canonical reference architecture + invariants** (absorbs `market-data-pipelines`) | the §7 diagram; the 9 invariants; backpressure policy; process isolation; scalability levers; time discipline |
| **G. Domain** | `time-series-fundamentals` | Sampling vs event data | tick vs bar; alignment/resampling; gap semantics; retention/downsampling; UTC/monotonicity; never fabricate points |
| **G. Quant** | `quant-backtesting` *(deferred, Phase 3)* | Honest backtests | backtrader/vectorbt/hftbacktest; event-driven vs vectorized; lookahead/survivorship bias; PIT data; costs/slippage; walk-forward |

**Note on requested items**: the brief lists both `market-data-architecture` and `market-data-pipelines` — they are the **same concern** and must not be duplicated; `architecture` absorbs `pipelines`.

### 3.3 Skill-count discipline

New: **13** = **12 core** + `market-data-bus`. **Plus** `quant-backtesting` (deferred — not counted until Phase 3). **Plus 3 extensions**: `security-secrets` (exchange-key profile), `tdd-enforcer` (failure-injection), `review-work`/`quality-gate` (silent-failure item). **Merge rule**: if a proposed skill's body would be >60% overlap with a listed one, merge instead of add.

---

## 4. Tools (highest leverage, deterministic, CI-able)

Tools beat MCPs when the operation is **deterministic, repeatable, repo-convention-encoding, and CI-runnable without external services.** Matrixx tools are TypeScript; `@ast-grep/napi` supports Python, so Python analysis tools are feasible in TS.

| Tool | What it does | Why a tool (vs MCP / vs skill) |
|------|--------------|--------------------------------|
| **`silent-failure-scanner`** ★ | AST/regex scan over Python (and TS) for silent-failure anti-patterns: bare `except: pass`, `except …: logger.warning(...)` followed by default-return-as-outcome, `gather()` without return_exceptions handling, `createEmpty`/alerts masking, missing heartbeat hooks. Emits structured findings + non-zero exit for CI. | Deterministic, must run as a **CI gate**; an MCP can't lint a diff; a skill can't guarantee execution. The *deterministic half* of Task F. |
| **`staleness-gap-checker`** ★ | Given (symbol, seq, exchange_ts, pub_ts) samples or a recorder log, detect seq gaps, staleness windows, zero-volume bursts; emit a report. | Pure computation over data — exactly what tools are for; testable; runs in CI against fixtures. |
| **`market-symbol-validator`** ★ | Validate symbols used in code/config against `exchange.symbols`; enforce `:settle` suffix for perps; flag hardcoded ids; assert `has[]` capabilities. | Catches a **silent** class of bugs (BadSymbol at runtime, wrong market) statically; deterministic; no live secrets required if run against a checked-in symbol snapshot. |
| **`dashboard-flux-validator`** ★ | Validate Grafana provisioning YAML + dashboard JSON (datasource, variables, panels, value mappings) and lint Flux for anti-patterns (server-side timestamps, field-type conflict, unaligned `union`/`pivot` basis, `createEmpty:true`). | Deterministic lint in CI; no cluster needed; complements the *live* Grafana MCP. |
| `exchange-probe` *(optional)* | One-shot: load markets, print normalized `market[]`, resolve one symbol, fetch one REST ticker/OHLCV. | **Trade-off flagged**: requires a Python runtime invoked from a TS tool — a real architectural commitment. If you want to avoid that, ship the probe as a **skill + script template** and run it via `interactive_bash`/`bash` instead. Recommend deferring until the Python-runtime decision is made explicitly. |

**Build order**: `silent-failure-scanner` → `staleness-gap-checker` → `market-symbol-validator` → `dashboard-flux-validator`.

### 4.1 Tool invocation contract (required before build)

Every tool MUST declare, in `constants.ts`/`types.ts`:

- **Input schema** (Zod) — explicit fields; no "parse whatever".
- **Output schema** (JSON) — `{ ok, findings: [{ rule, severity, file, line, col, message, evidence }], summary }`.
- **Severity model** — `error | warning | info`.
- **Exit-code contract** — `0` clean · `1` findings at/above configured severity · `2` tool error (bad input/parse). Usable directly as a CI step.
- **Rule ids** — stable, matching the skill's anti-pattern catalog 1:1, e.g. `SF001 bare-except-pass`, `SF002 except-log-then-default`, `SF003 gather-without-return-exceptions`, `SF004 masking-createEmpty`, `SF005 missing-heartbeat`.
- **Fixtures** — `tests/tools/<name>/` must include **must-flag** and **must-not-flag** (false-positive guard) corpora. A tool without negative fixtures is not done.

Data-source contracts:

- `staleness-gap-checker`: input = a JSONL stream of `{symbol, exchange, seq, exchange_ts, pub_ts}` **or** a recorder log path; thresholds passed as arguments.
- `market-symbol-validator`: input = code/config paths + a **checked-in `exchange.symbols` snapshot** (`{exchange: {symbol: {spot|swap|linear|inverse, active}}}`) generated by the deferred `exchange-probe` script; regeneration is documented, and a missing snapshot ⇒ `info` skip, **never a false pass**.
- `dashboard-flux-validator`: input = provisioning YAML + dashboard JSON; Flux rules `GF001 server-side-time`, `GF002 field-type-conflict`, `GF003 unaligned-basis`, `GF004 masking-createEmpty`.

**Registration**: `src/tools/<name>/{index,types,constants,tools}.ts` → `src/plugin/tool-registry.ts`; gate in `src/plugin/tool-gating.ts`; ensure tools are conditional (not always-on) so non-finance users see no surface change.

---

## 5. MCPs (all user-configured, default-off, least-privilege)

**Opinionated stance: add ZERO built-in MCPs.** Every candidate needs secrets or an external service; baking them in would violate least privilege and the "keys never to the model" rule.

| MCP | Source | Posture | Built-in? |
|-----|--------|---------|-----------|
| **ccxt-mcp** (official) | sst/ccxt | **Config-file-only** permission escalation; **keys never passed by the model**; disable private/trade scope; read-only market data | User-configured |
| **InfluxDB MCP** | InfluxDB3 official (read-only) or idoru/v2 | Read-only token; narrow bucket scope | User-configured |
| **Grafana MCP** | official | RBAC **service token**; **default-off tool categories** (alerting/admin off); read-only | User-configured |
| **Telegram MCP** | community | **Read-only message search only, or none.** Control-plane should be *code*, not a model tool — giving a model bot-send authority is a privilege the domain explicitly distrusts | User-configured (recommend none) |
| CoinGecko / Dune / OpenBB / ClickHouse | official/community | Optional research; ClickHouse = 3 read-only tools posture; default-off | User-configured |

**Delivery mechanism**: rather than `src/mcp/`, ship **hardened config presets + docs** (a `docs/` guide + example `~/.config/opencode` snippets) and, optionally, a small **scaffold command** that writes a least-privilege MCP config block. This keeps secrets out of the plugin and the blast radius at zero by default.

**Posture summary (encode as a skill/doc)**: config-file-only escalation · read-only default · default-off tool categories · least-privilege tokens · no private/trade scope · never echo secrets.

---

## 6. Hooks / Cross-cutting (light only)

Hooks run on every message/tool call — **keep them cheap**.

| Hook | Type | Behavior |
|------|------|----------|
| `domain-keyword-detector` | transform (mirror existing `keyword-detector`) | On crypto/ccxt/influx/zmq/telegram/influx signal → inject the relevant finance skills into the session context. Pure routing; no blocking. |
| `silent-failure-guard` | `tool-guard` tier (post-edit), scoped | Runs the scanner's fast subset **only on Python edits under finance paths**; config key `finance.silent_failure_guard`, default `warn`; skips files >200 LOC / ~20 ms budget. Never scans every edit — the CI scanner is the hard gate. |
| finance rules file (not a hook) | extend `rules-injector` | Add a domain rule file `AGENTS.finance.md` (consumer project root, or repo `docs/` when self-configuring): "no silent failures; explicit error taxonomy; UTC-ns; never hardcode symbols; keys never to model." Reuses the existing `rules-injector`; **no new hook**. |
| Python quality profile | quality-gate config | Thin Python profile (ruff/type conventions) alongside the existing TS-focused gate. |

**Knowledge-surface precedence (no duplication):** `skills` = authoritative technique (what agents reach); the finance rules file = terse **non-negotiables** only; `docs/` = narrative. Each of the 9 invariants lives authoritatively in **one** skill and is mirrored as a one-liner in the rules file — never re-taught in prose in `docs/`.

**Secrets:** presets/examples use placeholders only; the repo already ships `secret-leak-guard` / `input-secret-guard` / `env-file-write-guard` hooks — extend those to cover the finance preset examples rather than adding new secret handling.

**Rule**: no heavy `PreToolUse`. Prefer skill-injection + opt-in scanner tool + a `tank` review gate over an always-on hook.

---

## 7. Reference Architecture (canonical — encode in `market-data-architecture`)

```
[Exchange A..N]
   │  REST snapshot + WS stream · one client/process · load_markets() once + periodic reload
   │  ccxt / ccxt.pro · one asyncio task per (symbol, exchange) · per-loop error containment
   ▼
[Ingestion workers]            process-isolated per exchange (systemd unit each)
   │  normalise → unified symbol · stamp seq (per-symbol monotonic) + exchange_ts + pub_ts
   ▼
[ZMQ PUB bus]                  snapshot+stream envelope
   │   HWM backpressure · PUB drops by design (documented + drop counter)
   ├──▶ [Recorder]  conflate=False ──▶ [InfluxDB 2.x] ──▶ [Grafana]
   │        single measurement · low-card tags · explicit UTC-ns · batched writes   provisioned ds · tag vars · 0/1/2 staleness mappings
   ├──▶ [Live consumers / UI]  conflate=True (latest-price only)
   └──▶ [Control plane]  DEALER↔ROUTER  ←  [Telegram bot]
              ▲ resync command channel  (Lazy Pirate: 2500ms, 3 retries, recreate socket, correlation id)
[Supervisor]  systemd · one process per exchange · restart policy · finite LINGER
[Observability] per-symbol seq-gap · staleness(exchange_ts vs now) · ZMTP heartbeat + app Paranoid Pirate (3×1s, backoff 1s→32s) · monitor socket
```

### The 9 robustness invariants (non-negotiable)

1. **Snapshot+stream pairing** with monotonic `seq` + `exchange_ts` + `pub_ts`; a consumer can detect a gap and resync.
2. **Per-symbol seq-gap detection**; a gap is an **explicit flag**, never silent.
3. **Staleness** = `exchange_ts` vs wall clock → **0 healthy / 1 warn / 2 stale**; defaults **warn > 2× the publish interval**, **stale > 5×** (configurable), surfaced as explicit Grafana states — never inferred silently.
4. **Error taxonomy**: transient→backoff+retry (jitter); fatal→skip+flag. **A caught error must never be recorded as a valid outcome.**
5. **Backpressure**: bounded queues + HWM policy; recorder must not silently drop (`conflate=False` + monitor + drop counter).
6. **Process isolation**: one client/exchange/process; crash-only; systemd restart; loop crashes contained per symbol.
7. **Scalability levers**: add exchange = add process + PUB suffix; add pair = add symbol task; shard by symbol; no global blocking point.
8. **Time discipline**: everything UTC-ns, transport as ms-epoch UTC; no TZ anywhere.
9. **No silent failure**: every `except` either re-raises or records a **typed, distinguishable** outcome plus a counter/metric.

### How it is encoded so agents build consistently

`market-data-architecture` carries: the diagram above, the 9 invariants, code templates (per-exchange process skeleton, PUB envelope, recorder consumer, resync client), and an explicit "scalability checklist." `neo` reviews against it; `source` builds from it; `tank` audits it for invariant #4/#9. One skill, one shape.

**Plugin vs runtime (do not conflate):** the plugin injects knowledge and lints diffs; invariants #5/#6/#9 are **runtime properties of the built Python system**, verified by the scanner (#9), the monitor/`staleness-gap-checker` (#5), and systemd + health checks (#6). The plugin makes them unmissable; it does not enforce them at runtime.

---

## 8. Task F as a First-Class Capability

Task F = "an error caught, logged as a warning, then recorded as an outcome indistinguishable from a genuine one → silent permanent loss." This generalizes to: **a failure that produces a plausible-looking answer is worse than a crash.** Four mechanisms:

| Mechanism | Implementation | Where |
|-----------|----------------|-------|
| **Detect (static)** | `silent-failure-scanner` + ast-grep patterns (`bare except`, except-pass, except-log-warning-then-default, `gather` without return_exceptions, `createEmpty`/alert masking) → **CI gate**, non-zero exit | Tool + CI |
| **Detect (dynamic)** | Force **typed outcomes** (never a default that collides with success); **counters** for every error branch; **synthetic canary** (publish a known seq, verify end-to-end); **reconciliation** (source count vs recorded count); seq-gap/staleness flags | `data-quality-observability` skill + `staleness-gap-checker` tool |
| **Hunt (adversarial)** | `tank` agent + `silent-failure-detection` skill: for any diff, answer "what failure here would look like success?", require an explicit success/failure discriminator on every external call, forbid `logger.warning` as the *sole* handling | Agent + skill |
| **Gate + test** | `review-work`/`quality-gate` gains a "silent-failure" checklist item that routes to `tank`; `tdd-enforcer` gains a **failure-injection test pattern**: every ingestion/consumer task must ship a test that injects a failure (timeout, disconnect, malformed field) and asserts an **explicit** error outcome (not a default) **and** a counter increment | Skill extensions + hook |

**Definition of done for any finance task**: (a) scanner clean, (b) failure-injection test present and green, (c) `tank` review passes, (d) every external call has a typed failure path. This is the domain's "zero human intervention" analogue.

---

## 9. Rollout / Phasing (ordered backlog with exact files)

> Every skill/agent/tool/hook addition ends with: **add to the relevant Zod enum** → `bun run build:schema` → tests under `tests/**` → if any `mock.module()` is used, add to `script/mock-heavy-list.txt` → `bash script/run-ci.sh`.

### Phase 0 — Reuse (zero code, immediate value)
- Document the 7 `zeromq-*` skills as the domain's transport substrate in a finance AGENTS.md rule file.
- **Files**: `docs/` guide + finance rules file (see Phase 4 hook). No source changes.

### Phase 1 — Skills (highest ROI, no runtime risk) — **do this first**
For each: `src/features/builtin-skills/skills/<name>.ts` → export in `.../skills/index.ts` → `createBuiltinSkills()` → `BuiltinSkillNameSchema` (`src/config/schema/agent-names.ts`).

Ordered (the **MVP gate** = items 1–3 green in CI before anything else):
1. `resilience-error-taxonomy`, `silent-failure-detection` **(Task F core — MVP gate)**
2. `silent-failure-scanner` tool + failure-injection test pattern **(MVP gate; may be built here ahead of Phase 4)**
3. `data-quality-observability` + `market-data-architecture` **(MVP gate)**
4. `ccxt-rest`, `ccxt-pro-websockets`
5. `python-asyncio`
6. `influxdb-timeseries`, `grafana-dashboards`
7. `crypto-market-structure`, `market-data-bus`, `time-series-fundamentals`
8. `telegram-bot`
9. **Extend** `security-secrets` (exchange-key profile); **extend** `tdd-enforcer` (failure-injection pattern); **extend** `review-work`/`quality-gate` (silent-failure item)

*(deferred, not Phase 1)* `quant-backtesting`.

### Phase 2 — MCPs (docs + hardened presets; NO built-in)
- `docs/` guide + example config snippets for ccxt-mcp / InfluxDB / Grafana (+ optional research MCPs), each with least-privilege, read-only, default-off, config-file-only escalation.
- Optional scaffold command writing a hardened config block.
- **Files**: `docs/**` (+ optional small command under `src/features/builtin-commands/`). No changes to `src/mcp/`.

### Phase 3 — Agents
- `src/agents/neo.ts`, `src/agents/tank.ts` → add to `agentSources` (`src/agents/builtin-agents.ts`) → `BuiltinAgentNameSchema` (`src/config/schema/agent-names.ts`).
- Include `*_PROMPT_METADATA` per existing pattern; read-only tool sets.
- Update `src/agents/AGENTS.md` model/temp table.
- *(deferred)* `dozer`/`switch`/`apoc` only if a standing specialty emerges.

### Phase 4 — Tools + Hooks
- Tools: `src/tools/silent-failure-scanner/`, `src/tools/staleness-gap-checker/`, `src/tools/market-symbol-validator/`, `src/tools/dashboard-flux-validator/` → `src/plugin/tool-registry.ts` + `tool-gating.ts` + `src/create-tools.ts`.
- Hooks: `src/hooks/domain-keyword-detector/`, `src/hooks/silent-failure-guard/` → `HookNameSchema` (`src/config/schema/hooks.ts`) → `src/plugin/hooks/create-*-hooks.ts`.
- Finance rules file consumed by `rules-injector`.
- Tests: `tests/tools/silent-failure-scanner/`, `tests/tools/staleness-gap-checker/`, etc. (CI-discovered); add to `script/mock-heavy-list.txt` any that use `mock.module()`.

### Test / schema checklist (every item)
- [ ] Zod enum updated (skill/agent/hook name)
- [ ] `bun run build:schema` run; `assets/matrixx.schema.json` diff reviewed
- [ ] tests in `tests/**` (not `src/**` — those are CI-orphaned)
- [ ] `mock.module()` tests added to `script/mock-heavy-list.txt`
- [ ] `bash script/run-ci.sh` passes

---

## 10. Risks / Anti-Scope (keep the plugin disciplined)

**Explicitly DO NOT add:**
- ❌ **Trading / execution** — no order placement, no private/trade keys, no autonomous order flows. This domain plugin is *market-data engineering*, not trading.
- ❌ **Grafana alerting management** — ship alert **queries** and dashboard honesty; never manage alert rules/routing.
- ❌ **Agent sprawl** — cap at **+2** agents; every future agent must justify a distinct persona or be refused (cf. rejected `link`, `cypher`).
- ❌ **Heavy `PreToolUse` hooks** — they run on every tool call and would tax the whole plugin for a domain feature.
- ❌ **Built-in secret-bearing MCPs** — all MCPs user-configured, default-off, read-only.
- ❌ **A "trading bot" agent** — it would reintroduce exactly the "plausible-looking wrong answer" risk.

**Risks & mitigations:**
| Risk | Mitigation |
|------|------------|
| Python-runtime tools in a TS plugin (`exchange-probe`) | Defer; default to skill + script template; make the Python-runtime decision explicit before building such a tool |
| Skill bloat (13+ skills) | Strict merge rule (§3.3); `market-data-architecture` absorbs `market-data-pipelines`; reuse `zeromq-*` verbatim |
| Overfitting to ccxt | Keep the exchange layer behind the unified model; `crypto-market-structure` teaches model-agnostic fields |
| Silent-failure guard becoming a heavy hook | Scope to Python finance paths only; warn-first; scanner is the CI gate |
| MCP privilege creep | Config-file-only escalation; read-only; default-off categories; never echo secrets |

---

## Appendix A — Skill → Carrier Matrix

| Skill | `neo` | `tank` | `source` (impl) | Notes |
|-------|:----:|:-----:|:---------------:|-------|
| python-asyncio | · | · | ✔ | impl only |
| ccxt-rest | ✔ | ✔ | ✔ | error taxonomy shared with `tank` |
| ccxt-pro-websockets | ✔ | · | ✔ | |
| market-data-bus | ✔ | · | ✔ | over `zeromq-*` |
| influxdb-timeseries | · | · | ✔ | |
| grafana-dashboards | · | · | ✔ | |
| telegram-bot | · | · | ✔ | |
| resilience-error-taxonomy | ✔ | ✔ | ✔ | core doctrine |
| silent-failure-detection | · | ✔ | · | Task F |
| data-quality-observability | ✔ | ✔ | ✔ | |
| crypto-market-structure | ✔ | · | ✔ | |
| market-data-architecture | ✔ | · | ✔ | canonical spec |
| time-series-fundamentals | · | · | ✔ | |
| quant-backtesting | · | · | ✔ | deferred |
| zeromq-* (reuse) | ✔ | ✔ | ✔ | existing |

## Appendix B — One-Page Decision Summary

- **Add 2 agents** (`neo`, `tank`) — the only two competencies that need a persona.
- **Add 13 skills** (skills-first) — encode every invariant where agents can reach it.
- **Reuse 7 zeromq skills**, **extend** `security-secrets`/`tdd-enforcer`/`quality-gate`.
- **Add 4 tools** (all deterministic + CI-able), defer `exchange-probe`.
- **Add 0 built-in MCPs**; ship hardened, default-off, read-only, user-configured presets.
- **2 light hooks** (`domain-keyword-detector`, `silent-failure-guard`) + a finance rules file via `rules-injector`; no heavy `PreToolUse`.
- **Task F** = scanner (static) + typed-outcome invariants (dynamic) + `tank` (adversarial) + failure-injection tests (gate).
- **No trading, no alerting, no sprawl.**

---

## Appendix C — Requirement Coverage Matrix (DWF brief → mechanism)

| Brief requirement | Mechanism | Deliverable | Status |
|---|---|---|---|
| T1 · hourly broadcast (5 exchanges, spot+perp) | `ccxt-rest` + scheduler + `telegram-bot` | hourly-message spec in `market-data-architecture` | Design only |
| T1 · graceful per-exchange skip on failure | `resilience-error-taxonomy` | failure-injection test pattern | Design only |
| T1 · `/setalert` + list/remove | `telegram-bot` + alert model | alert-model section (incl. 100-cap) | **Add to doc** |
| T1 · persistent alert storage | `market-data-architecture` | persistence template | Design only |
| T2 · three processes over ZMQ | `market-data-bus` + `zeromq-*` | §7 diagram + templates | Covered |
| T2.A · WS + REST snapshot, quoted time | `ccxt-pro-websockets`, `ccxt-rest` | skill bodies | Covered |
| T2.A · dead exchange ≠ working | `data-quality-observability` + staleness tool | staleness thresholds (§7) | Covered |
| T2.B · commands from Telegram **and CLI** | `telegram-bot` + `zeromq-advanced-reqrep` | **CLI control plane** | **Gap — add** |
| T2.B · command survives restart | `market-data-architecture` | persistence template | **Gap — add** |
| T2.C · any symbol, only where listed | `crypto-market-structure` + `market-symbol-validator` | validator tool | Covered |
| T2.C · 100 alerts/user, 3 modes | `telegram-bot` | alert model | **Add to doc** |
| T2.D · recorder 1 pt/symbol/exch/min, runtime interval | `influxdb-timeseries` + control plane | recorder-interval command | **Gap — add** |
| T2.D · record alert events; 30 d retention | `influxdb-timeseries` | retention + alerts measurement | Covered |
| T2.E · Grafana dashboard JSON committed | `grafana-dashboards` + `dashboard-flux-validator` | dashboard spec | Covered |
| T2.F · swallowed failure | `silent-failure-detection` + scanner + `tank` | §8 four-part capability | Covered |
| T2 · deliverables (README, design note, logs, Grafana creds) | `broadcast`/docs | deliverable checklist | **Gap — add** |

Legend: **Covered** · **Design only** · **Gap/Add** = must be folded into the relevant skill body or the acceptance artifact before an implementer starts.

<!-- plan-persister: {"id":"dwfinance-crypto-market-data-extension-design","updatedAt":"2026-10-11T08:00:08.599Z","sessionId":"ses_ed60888a5ffeJYKcAqB9OrYmEe","todoTotal":5,"todoCompleted":0} -->
