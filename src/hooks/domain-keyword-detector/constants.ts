/**
 * Finance-domain keyword routing table.
 *
 * Each route maps a keyword pattern to the finance-domain skill(s) that should
 * be surfaced to the model when that keyword appears in a user message. The
 * detector is pure routing — it never touches the filesystem or the network.
 */
export interface DomainSkillRoute {
  /** Keyword pattern (no `g` flag — the same RegExp is reused across calls). */
  pattern: RegExp
  /** Skill names surfaced when the pattern matches. */
  skills: string[]
}

/** Marker used to make injection idempotent across repeated transform passes. */
export const DOMAIN_HINT_MARKER = "[domain-skills]"

/** Hard cap on the injected hint so a detection can never bloat context. */
export const MAX_DOMAIN_HINT_CHARS = 400

export const DOMAIN_SKILL_ROUTES: DomainSkillRoute[] = [
  {
    // ccxt.pro streaming API (watch* methods) takes priority over the REST route.
    pattern: /\bccxt\.pro\b|watch_[a-z]+|pro\s*websocket/i,
    skills: ["ccxt-pro-websockets"],
  },
  {
    pattern: /\bccxt\b/i,
    skills: ["ccxt-rest"],
  },
  {
    pattern: /\bzeromq\b|\bzmq\b/i,
    skills: ["zeromq-core"],
  },
  {
    pattern: /\binfluxdb\b|\binflux\b/i,
    skills: ["influxdb-timeseries"],
  },
  {
    pattern: /\bgrafana\b/i,
    skills: ["grafana-dashboards"],
  },
  {
    pattern: /\btelegram\b/i,
    skills: ["telegram-bot"],
  },
  {
    pattern: /\bwebsocket\b/i,
    skills: ["ccxt-pro-websockets"],
  },
  {
    pattern: /\bperpetual\b|\bperp\b|\bbasis\b/i,
    skills: ["crypto-market-structure"],
  },
  {
    // Unified CCXT symbol, e.g. BTC/USDT or BTC/USDT:USDT.
    pattern: /\b[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}(?::[A-Z0-9]{2,10})?\b/,
    skills: ["market-data-architecture"],
  },
  {
    pattern: /\basyncio\b/i,
    skills: ["python-asyncio"],
  },
  {
    pattern: /\bmarket\s*data\b/i,
    skills: ["market-data-bus"],
  },
  {
    pattern: /\bsilent\s*failure\b/i,
    skills: ["silent-failure-detection"],
  },
]
