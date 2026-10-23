import assert from "node:assert/strict"
import test from "node:test"
import {
  accountSnapshot,
  advancePractice,
  closePosition,
  createPractice,
  finishPractice,
  generateCandles,
  openPosition,
  visibleBars,
} from "../frontend/src/lib/manualReplayEngine.ts"

function fixture() {
  const session = createPractice({ startPrice: 100, initialVisibleBars: 1, barCount: 4 })
  session.bars = [100, 110, 90, 120].map((close, i) => ({
    time: new Date(Date.UTC(2026, 0, 5, 1, i * 5)).toISOString(),
    open: close, high: close, low: close, close, volume: 1000,
  }))
  return session
}

test("seeded OHLC is reproducible, continuous, finite and ordered", () => {
  const bars = generateCandles({ seed: 123 })
  assert.deepEqual(bars, generateCandles({ seed: 123 }))
  assert.notDeepEqual(bars, generateCandles({ seed: 124 }))
  bars.forEach((bar, i) => {
    for (const key of ["open", "high", "low", "close", "volume"]) {
      assert.ok(Number.isFinite(bar[key]) && bar[key] > 0)
    }
    assert.ok(bar.high >= Math.max(bar.open, bar.close))
    assert.ok(bar.low <= Math.min(bar.open, bar.close))
    if (i) {
      assert.equal(bar.open, bars[i - 1].close)
      assert.equal(Date.parse(bar.time) - Date.parse(bars[i - 1].time), 300000)
    }
  })
})

test("orders use only visible close and do not mutate the input", () => {
  const original = fixture()
  const opened = openPosition(original, "long", 2)
  assert.equal(original.position, null)
  assert.equal(original.trades.length, 0)
  assert.equal(opened.position.averagePrice, 100)
  assert.equal(opened.balance, 99994)
  assert.equal(visibleBars(opened).length, 1)
  const altered = { ...original, bars: original.bars.map((bar, i) => i ? { ...bar, close: 9999 } : bar) }
  assert.deepEqual(openPosition(altered, "long", 2).trades, opened.trades)
})

test("long partial close reconciles gross P&L, both fees, margin and equity", () => {
  let session = openPosition(fixture(), "long", 2)
  session = advancePractice(session)
  assert.equal(accountSnapshot(session).unrealizedPnl, 200)
  session = closePosition(session, 1)
  const account = accountSnapshot(session)
  assert.equal(session.position.quantity, 1)
  assert.equal(session.position.averagePrice, 100)
  assert.equal(account.balance, 100091)
  assert.equal(account.realizedPnl, 100)
  assert.equal(account.totalFees, 9)
  assert.equal(account.unrealizedPnl, 100)
  assert.equal(account.equity, 100191)
  assert.equal(account.margin, 110)
  assert.equal(account.available, 100081)
})

test("short P&L has correct direction and weighted additions settle correctly", () => {
  let session = openPosition(fixture(), "short", 1)
  session = advancePractice(session)
  session = openPosition(session, "short", 1)
  assert.equal(session.position.averagePrice, 105)
  session = advancePractice(session)
  assert.equal(accountSnapshot(session).unrealizedPnl, 300)
  session = closePosition(session)
  assert.equal(session.balance, 100288)
  assert.equal(session.position, null)
  assert.equal(session.realizedPnl, 300)
  assert.equal(session.totalFees, 12)
})

test("opening rejects insufficient margin including fees and opposite positions", () => {
  const session = { ...fixture(), balance: 102 }
  assert.throws(() => openPosition(session, "long", 1), /资金不足/)
  const opened = openPosition(fixture(), "long", 1)
  assert.throws(() => openPosition(opened, "short", 1), /反向持仓/)
  assert.throws(() => closePosition(opened, 2), /超过/)
})

test("invalid config, quantities, prices and step counts are rejected", () => {
  for (const value of [NaN, Infinity, -1, 0]) {
    assert.throws(() => createPractice({ initialCapital: value }))
    assert.throws(() => openPosition(fixture(), "long", value))
    assert.throws(() => advancePractice(fixture(), value))
  }
  assert.throws(() => openPosition(fixture(), "long", 1.5))
  assert.throws(() => createPractice({ feePerLot: NaN }))
  assert.throws(() => createPractice({ marginRate: 1.1 }))
  assert.throws(() => createPractice({ seed: -1 }))
  assert.throws(() => createPractice({ initialVisibleBars: 360 }))
  const session = fixture()
  session.bars[0].close = NaN
  assert.throws(() => openPosition(session, "long", 1))
})

test("manual finish settles at current close without revealing future", () => {
  const session = finishPractice(openPosition(fixture(), "long", 1))
  assert.equal(session.finished, true)
  assert.equal(session.index, 0)
  assert.equal(session.position, null)
  assert.equal(session.balance, 99994)
  assert.equal(session.trades.at(-1).reason, "练习结束平仓")
  assert.equal(advancePractice(session), session)
  assert.equal(finishPractice(session), session)
  assert.throws(() => openPosition(session, "long", 1), /已经结束/)
})

test("end of replay settles positions exactly once", () => {
  let session = openPosition(fixture(), "long", 1)
  session = advancePractice(session, 999)
  assert.equal(session.index, 3)
  assert.equal(session.finished, true)
  assert.equal(session.position, null)
  assert.equal(session.balance, 100194)
  assert.equal(session.trades.length, 2)
  assert.equal(advancePractice(session).trades.length, 2)
})

test("multi-bar advance checks margin on each intermediate bar", () => {
  let session = { ...fixture(), balance: 200 }
  session = openPosition(session, "short", 1)
  session = advancePractice(session, 2)
  assert.equal(session.position, null)
  assert.equal(session.trades.at(-1).barIndex, 1)
  assert.equal(session.trades.at(-1).reason, "保证金不足自动平仓")
  assert.equal(session.balance, 94)
})
