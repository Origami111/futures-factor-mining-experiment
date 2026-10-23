/** Local-only futures practice. Orders execute at the visible bar's close. */
export type Side = "long" | "short"

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface PracticeConfig {
  initialCapital: number
  multiplier: number
  marginRate: number
  feePerLot: number
  seed: number
  barCount: number
  initialVisibleBars: number
  startPrice: number
}

export interface PracticePosition {
  side: Side
  quantity: number
  averagePrice: number
}

export interface PracticeTrade {
  id: number
  barIndex: number
  time: string
  action: "open" | "close"
  side: Side
  price: number
  quantity: number
  fee: number
  /** Gross realized P&L; fees are recorded separately. */
  pnl: number
  reason: string
}

export interface PracticeSession {
  config: PracticeConfig
  bars: Candle[]
  /** Index of the last visible bar, starting at zero. */
  index: number
  trades: PracticeTrade[]
  position: PracticePosition | null
  balance: number
  realizedPnl: number
  totalFees: number
  finished: boolean
}

export interface AccountSnapshot {
  price: number
  balance: number
  equity: number
  unrealizedPnl: number
  realizedPnl: number
  totalFees: number
  margin: number
  available: number
  returnPct: number
}

export const DEFAULT_PRACTICE_CONFIG: Readonly<PracticeConfig> = Object.freeze({
  initialCapital: 100000,
  multiplier: 10,
  marginRate: 0.1,
  feePerLot: 3,
  seed: 20261022,
  barCount: 360,
  initialVisibleBars: 60,
  startPrice: 3500,
})

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须是大于 0 的有限数值`)
}

function integer(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须是正整数`)
}

function configuration(options: Partial<PracticeConfig>): PracticeConfig {
  const config = { ...DEFAULT_PRACTICE_CONFIG, ...options }
  positive(config.initialCapital, "初始资金")
  positive(config.multiplier, "合约乘数")
  positive(config.marginRate, "保证金比例")
  if (config.marginRate > 1) throw new Error("保证金比例不能超过 100%")
  if (!Number.isFinite(config.feePerLot) || config.feePerLot < 0) throw new Error("手续费必须是非负有限数值")
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) throw new Error("随机种子必须为 0 至 4294967295 的整数")
  integer(config.barCount, "K 线数量")
  integer(config.initialVisibleBars, "初始显示数量")
  if (config.barCount > 10000 || config.initialVisibleBars >= config.barCount) throw new Error("K 线总数最多 10000 根，且必须大于初始显示数量")
  positive(config.startPrice, "初始价格")
  if (config.startPrice < 1 || config.startPrice > 100000000) throw new Error("初始价格必须在 1 至 100000000 之间")
  return config
}

function roundPrice(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100)
}

/** Seeded synthetic OHLC. No external data, account, API or AI service is used. */
export function generateCandles(options: Partial<PracticeConfig> = {}): Candle[] {
  const config = configuration(options)
  let seed = config.seed >>> 0
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const bars: Candle[] = []
  let price = roundPrice(config.startPrice)
  let drift = 0
  const startTime = Date.UTC(2026, 0, 5, 1, 0)
  for (let i = 0; i < config.barCount; i++) {
    if (i % 35 === 0) drift = (random() - 0.5) * 0.0024
    const open = price
    const shock = (random() + random() + random() - 1.5) * 0.0055
    const close = roundPrice(open * Math.exp(drift + shock))
    const wick = Math.max(open * 0.0002, open * random() * 0.003)
    bars.push({
      time: new Date(startTime + i * 300000).toISOString(),
      open,
      high: roundPrice(Math.max(open, close) + wick * (0.3 + random())),
      low: roundPrice(Math.min(open, close) - wick * (0.3 + random())),
      close,
      volume: Math.round(500 + random() * 4500 + Math.abs(shock) * 500000),
    })
    price = close
  }
  return bars
}

export function createPractice(options: Partial<PracticeConfig> = {}): PracticeSession {
  const config = configuration(options)
  return {
    config,
    bars: generateCandles(config),
    index: config.initialVisibleBars - 1,
    trades: [],
    position: null,
    balance: config.initialCapital,
    realizedPnl: 0,
    totalFees: 0,
    finished: false,
  }
}

function currentBar(session: PracticeSession): Candle {
  if (!Number.isInteger(session.index) || session.index < 0 || session.index >= session.bars.length) throw new Error("当前回放位置无效")
  const bar = session.bars[session.index]
  positive(bar.close, "当前价格")
  if (!Number.isFinite(session.balance)) throw new Error("账户资金无效")
  return bar
}

export function visibleBars(session: PracticeSession): Candle[] {
  currentBar(session)
  return session.bars.slice(0, session.index + 1)
}

export function accountSnapshot(session: PracticeSession): AccountSnapshot {
  const price = currentBar(session).close
  const { position, config } = session
  const unrealizedPnl = position
    ? (price - position.averagePrice) * position.quantity * config.multiplier * (position.side === "long" ? 1 : -1)
    : 0
  const equity = session.balance + unrealizedPnl
  const margin = position ? price * position.quantity * config.multiplier * config.marginRate : 0
  return {
    price,
    balance: session.balance,
    equity,
    unrealizedPnl,
    realizedPnl: session.realizedPnl,
    totalFees: session.totalFees,
    margin,
    available: equity - margin,
    returnPct: (equity / config.initialCapital - 1) * 100,
  }
}

function assertActive(session: PracticeSession): void {
  currentBar(session)
  if (session.finished) throw new Error("本次练习已经结束，请开始新练习")
}

export function openPosition(session: PracticeSession, side: Side, quantity: number): PracticeSession {
  assertActive(session)
  if (side !== "long" && side !== "short") throw new Error("交易方向无效")
  integer(quantity, "交易手数")
  if (session.position && session.position.side !== side) throw new Error("请先平掉反向持仓，再开新仓")
  const bar = currentBar(session)
  const fee = quantity * session.config.feePerLot
  const required = quantity * bar.close * session.config.multiplier * session.config.marginRate + fee
  if (!Number.isFinite(required) || required > accountSnapshot(session).available + 1e-8) throw new Error("可用资金不足以支付保证金和手续费")
  const previousQuantity = session.position?.quantity ?? 0
  const totalQuantity = previousQuantity + quantity
  if (!Number.isSafeInteger(totalQuantity)) throw new Error("总持仓手数过大")
  const averagePrice = ((session.position?.averagePrice ?? 0) * previousQuantity + bar.close * quantity) / totalQuantity
  return {
    ...session,
    balance: session.balance - fee,
    totalFees: session.totalFees + fee,
    position: { side, quantity: totalQuantity, averagePrice },
    trades: [...session.trades, { id: session.trades.length + 1, barIndex: session.index, time: bar.time, action: "open", side, price: bar.close, quantity, fee, pnl: 0, reason: "手动开仓" }],
  }
}

function settlePosition(session: PracticeSession, quantity: number, reason: string): PracticeSession {
  const position = session.position
  if (!position) throw new Error("当前没有持仓")
  integer(quantity, "平仓手数")
  if (quantity > position.quantity) throw new Error("平仓手数不能超过持仓手数")
  const bar = currentBar(session)
  const pnl = (bar.close - position.averagePrice) * quantity * session.config.multiplier * (position.side === "long" ? 1 : -1)
  const fee = quantity * session.config.feePerLot
  return {
    ...session,
    balance: session.balance + pnl - fee,
    realizedPnl: session.realizedPnl + pnl,
    totalFees: session.totalFees + fee,
    position: quantity === position.quantity ? null : { ...position, quantity: position.quantity - quantity },
    trades: [...session.trades, { id: session.trades.length + 1, barIndex: session.index, time: bar.time, action: "close", side: position.side, price: bar.close, quantity, fee, pnl, reason }],
  }
}

export function closePosition(session: PracticeSession, quantity?: number): PracticeSession {
  assertActive(session)
  return settlePosition(session, quantity ?? session.position?.quantity ?? 0, "手动平仓")
}

/** Finish immediately at the currently visible close, without revealing future bars. */
export function finishPractice(session: PracticeSession): PracticeSession {
  if (session.finished) return session
  currentBar(session)
  const settled = session.position ? settlePosition(session, session.position.quantity, "练习结束平仓") : session
  return { ...settled, finished: true }
}

export function advancePractice(session: PracticeSession, steps = 1): PracticeSession {
  integer(steps, "前进根数")
  if (session.finished) return session
  let next = session
  const last = Math.min(session.index + steps, session.bars.length - 1)
  for (let index = session.index + 1; index <= last; index++) {
    next = { ...next, index }
    const account = accountSnapshot(next)
    if (next.position && account.equity < account.margin) {
      next = settlePosition(next, next.position.quantity, "保证金不足自动平仓")
    }
  }
  return next.index === next.bars.length - 1 ? finishPractice(next) : next
}
