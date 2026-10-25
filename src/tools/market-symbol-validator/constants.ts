import type { SymbolSeverity } from "./types"

export const MARKET_SYMBOL_VALIDATE_DESCRIPTION = `Deterministic, read-only validator for market symbols used in code or config. Enforces the CCXT unified convention. Returns a JSON report with a status exit code (0=clean, 1=warnings, 2=errors).

Rules:
- MS001 perpetual symbol missing the \`:settle\` suffix (use \`BTC/USDT:USDT\`).
- MS002 hardcoded exchange id or exchange-native symbol (e.g. \`binance\`, \`BTCUSDT\`) instead of a unified symbol.
- MS003 symbol not present in the provided \`exchangeMarkets\` allowlist.
- MS004 a capability method (fetchOHLCV, createOrder, ...) called without an \`exchange.has[...]\` guard.

Provide \`source\` (inline text), \`path\` (file or directory), and/or \`symbols\` (a list to validate directly). Providing none fails closed with status 2.`

export const EXCHANGE_IDS = new Set([
  "binance",
  "binanceusdm",
  "binancecoinm",
  "binanceus",
  "bybit",
  "okx",
  "kraken",
  "coinbase",
  "coinbasepro",
  "kucoin",
  "bitget",
  "gate",
  "gateio",
  "mexc",
  "htx",
  "huobi",
  "bitmex",
  "deribit",
  "bitfinex",
  "gemini",
  "upbit",
])

export interface Capability {
  call: string
  key: string
}

export const CAPABILITIES: Capability[] = [
  { call: "fetchOHLCV", key: "fetchOHLCV" },
  { call: "fetch_ohlcv", key: "fetchOHLCV" },
  { call: "fetchTicker", key: "fetchTicker" },
  { call: "fetch_ticker", key: "fetchTicker" },
  { call: "fetchOrderBook", key: "fetchOrderBook" },
  { call: "fetch_order_book", key: "fetchOrderBook" },
  { call: "fetchBalance", key: "fetchBalance" },
  { call: "fetch_balance", key: "fetchBalance" },
  { call: "fetchPositions", key: "fetchPositions" },
  { call: "fetch_positions", key: "fetchPositions" },
  { call: "fetchFundingRate", key: "fetchFundingRate" },
  { call: "fetch_funding_rate", key: "fetchFundingRate" },
  { call: "createOrder", key: "createOrder" },
  { call: "create_order", key: "createOrder" },
  { call: "fetchTrades", key: "fetchTrades" },
  { call: "fetch_trades", key: "fetchTrades" },
]

export const SYMBOL_EXTENSIONS = [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".toml", ".env"]

export const RULE_CATALOG: Record<string, { severity: SymbolSeverity; issue: string; fix: string }> = {
  MS001: {
    severity: "warn",
    issue: "Perpetual symbol is missing the :settle suffix, so the contract being traded is ambiguous.",
    fix: "Use the unified CCXT symbol with an explicit settle currency: BASE/QUOTE:SETTLE (e.g. BTC/USDT:USDT).",
  },
  MS002: {
    severity: "warn",
    issue: "Hardcoded exchange id or exchange-native symbol instead of a unified symbol; the code is coupled to one venue's naming.",
    fix: "Use unified symbols (BASE/QUOTE[:SETTLE]) and configure the exchange id outside the symbol.",
  },
  MS003: {
    severity: "warn",
    issue: "Symbol is not present in the provided exchangeMarkets allowlist.",
    fix: "Add the symbol to exchangeMarkets or correct the symbol.",
  },
  MS004: {
    severity: "error",
    issue: "Capability method called without checking exchange.has[...]; the venue may not support it, producing a misleading failure.",
    fix: "Guard the call with `if (exchange.has['METHOD'])` (or equivalent) before invoking it.",
  },
}
