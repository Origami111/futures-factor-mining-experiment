"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowDownRight, ArrowUpRight, ChartCandlestick, Check, Flag, Pause, Play, RotateCcw, ShieldCheck, SkipForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PracticeChart } from "@/components/practice/practice-chart"
import {
  accountSnapshot, advancePractice, closePosition, createPractice,
  finishPractice, openPosition, visibleBars,
  type PracticeSession, type PracticeTrade, type Side,
} from "@/lib/manualReplayEngine"

const money = (value: number): string => value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (value: number): string => `${value > 0 ? "+" : ""}${money(value)}`
const tone = (value: number): string => value > 0 ? "text-red-400" : value < 0 ? "text-emerald-400" : "text-[var(--text-primary)]"
const fieldClass = "h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
const panelClass = "rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)]"
// 图表与成交记录统一显示北京时间。
const displayTime = (time: string): string => new Date(Date.parse(time) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ")
const actionLabel = (trade: PracticeTrade): string => trade.action === "open" ? (trade.side === "long" ? "做多" : "做空") : (trade.side === "long" ? "平多" : "平空")

/** 独立练习页不挂载登录、行情订阅或后端 API。 */
export function ManualPractice(): React.JSX.Element {
  const [session, setSession] = useState<PracticeSession | null>(null)
  const sessionRef = useRef<PracticeSession | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1000)
  const [quantity, setQuantity] = useState("1")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [confirmAction, setConfirmAction] = useState<"finish" | "restart" | null>(null)
  const [reviewAll, setReviewAll] = useState(false)

  function commit(next: PracticeSession): void {
    sessionRef.current = next
    setSession(next)
  }

  function start(): void {
    setPlaying(false)
    setConfirmAction(null)
    setReviewAll(false)
    setError(null)
    setNotice("练习已开始。先观察已显示的 60 根 K 线，再决定是否下单。")
    commit(createPractice({ seed: Math.floor(Math.random() * 0xffffffff) }))
  }

  function step(): void {
    const current = sessionRef.current
    if (!current || current.finished) return
    try {
      let next = advancePractice(current)
      if (next.index >= next.bars.length - 1 && !next.finished) next = finishPractice(next)
      commit(next)
      setError(null)
      if (next.trades.length > current.trades.length) {
        setPlaying(false)
        const latest = next.trades[next.trades.length - 1]
        setNotice(`${latest.reason}，成交 ${latest.quantity} 手，价格 ${money(latest.price)}。回放已暂停。`)
      }
      if (next.finished) {
        setPlaying(false)
        setNotice("行情已走完，练习结束。剩余持仓已按最后显示的收盘价平仓。")
      }
    } catch (err) {
      setPlaying(false)
      setError(err instanceof Error ? err.message : "无法推进回放")
    }
  }

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(step, speed)
    return () => window.clearInterval(timer)
  }, [playing, speed])

  function trade(action: Side | "close" | "close-all"): void {
    const current = sessionRef.current
    if (!current || current.finished) return
    setPlaying(false)
    setError(null)
    const lots = Number(quantity)
    if (action !== "close-all" && (!Number.isSafeInteger(lots) || lots < 1)) {
      setError("手数必须是大于 0 的整数。")
      return
    }
    try {
      const next = action === "close-all" ? closePosition(current) : action === "close" ? closePosition(current, lots) : openPosition(current, action, lots)
      commit(next)
      const latest = next.trades[next.trades.length - 1]
      setNotice(`${actionLabel(latest)} ${latest.quantity} 手，成交价 ${money(latest.price)}，手续费 ¥${money(latest.fee)}。回放已暂停。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "下单失败")
    }
  }

  function finish(): void {
    if (!sessionRef.current) return
    setPlaying(false)
    try {
      commit(finishPractice(sessionRef.current))
      setConfirmAction(null)
      setError(null)
      setNotice("练习已结束。剩余持仓已按当前显示的收盘价平仓，之后的走势可在复盘中查看。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法结束练习")
    }
  }

  const snapshot = session ? accountSnapshot(session) : null
  const bars = useMemo(() => session ? (session.finished && reviewAll ? session.bars : visibleBars(session)) : [], [session, reviewAll])
  const lots = Number(quantity)
  const validLots = Number.isSafeInteger(lots) && lots > 0
  const finished = session?.finished ?? false
  const position = session?.position
  const currentBar = session?.bars[session.index]
  const progress = session ? Math.round((session.index + 1) / session.bars.length * 100) : 0
  const closeTrades = session?.trades.filter((item) => item.action === "close") ?? []

  return (
    <main data-manual-practice="true" className="min-h-screen bg-[var(--bg-primary)] pb-10 text-[var(--text-primary)]">
      <header className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="返回首页" className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><ArrowLeft className="h-5 w-5" /></Link>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400"><ChartCandlestick className="h-6 w-6" /></span>
            <div><h1 className="text-lg font-semibold">手动交易练习</h1><p className="mt-0.5 text-xs text-[var(--text-secondary)]">模拟 K 线回放 · 自己看盘，自己决策</p></div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-300"><ShieldCheck className="h-4 w-4" />免登录 · 无需配置 AI</span>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-5 px-4 pt-5 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="text-xl font-semibold">{finished ? "本次练习复盘" : "把下一根 K 线，留给下一次判断"}</h2><p className="mt-1.5 text-sm text-[var(--text-secondary)]">{finished ? "成交位置、资金变化和交易记录已保留，可查看后续走势或开始新一轮。" : "先观察 → 选择手数并下单 → 推进一根 K 线 → 结束后复盘。"}</p></div>
          <div className="flex gap-2">
            {session && !finished && <Button variant="outline" onClick={() => { setPlaying(false); setConfirmAction("finish") }}><Flag className="h-4 w-4" />结束并复盘</Button>}
            <Button onClick={() => session && !finished ? (setPlaying(false), setConfirmAction("restart")) : start()}><RotateCcw className="h-4 w-4" />{session ? "新一轮练习" : "开始练习"}</Button>
          </div>
        </div>

        {confirmAction && <div role="alertdialog" aria-label={confirmAction === "finish" ? "确认结束练习" : "确认新一轮练习"} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><p>{confirmAction === "finish" ? "结束后，将按当前收盘价平掉全部持仓，并停止本轮交易。" : "开始新一轮将清空本轮交易记录和资金，重新生成行情。"}</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setConfirmAction(null)}>取消</Button><Button size="sm" onClick={confirmAction === "finish" ? finish : start}>确认{confirmAction === "finish" ? "结束" : "开始新一轮"}</Button></div></div>}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric label="账户权益" value={snapshot ? `¥${money(snapshot.equity)}` : "¥100,000.00"} hint={snapshot ? `净收益 ${signed(snapshot.equity - session!.config.initialCapital)} 元` : "每轮初始资金 10 万元"} />
          <Metric label="可用资金" value={snapshot ? `¥${money(snapshot.available)}` : "¥100,000.00"} hint={`占用保证金 ¥${money(snapshot?.margin ?? 0)}`} />
          <Metric label="浮动盈亏" value={signed(snapshot?.unrealizedPnl ?? 0)} valueClass={tone(snapshot?.unrealizedPnl ?? 0)} hint={position ? `${position.side === "long" ? "多" : "空"} ${position.quantity} 手 · 均价 ${money(position.averagePrice)}` : "当前空仓"} />
          <Metric label="已实现盈亏（未扣费）" value={signed(snapshot?.realizedPnl ?? 0)} valueClass={tone(snapshot?.realizedPnl ?? 0)} hint={`累计手续费 ¥${money(snapshot?.totalFees ?? 0)}`} />
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className={`${panelClass} min-w-0 p-4`} aria-label="K 线回放">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-400" /><h2 className="text-sm font-semibold">练习合约 · 5 分钟</h2><span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">随机模拟</span></div>
              <span className="text-xs text-[var(--text-secondary)]">{session ? `${session.index + 1} / ${session.bars.length} 根 · ${finished ? "已结束" : playing ? "播放中" : "已暂停"}` : "尚未开始"}</span>
            </div>
            {currentBar && <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]"><span>{displayTime(currentBar.time).slice(0, 16)}</span><span>开 {money(currentBar.open)}</span><span>高 {money(currentBar.high)}</span><span>低 {money(currentBar.low)}</span><span className={`font-semibold ${tone(currentBar.close - currentBar.open)}`}>收 {money(currentBar.close)}</span></div>}
            {session ? <PracticeChart bars={bars} trades={session.trades} /> : <div className="flex min-h-[430px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-primary)]/40 px-5 text-center"><ChartCandlestick className="mb-4 h-12 w-12 text-sky-400/70" /><h3 className="text-lg font-medium">从一段未知的行情开始</h3><p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">开始后先展示 60 根 K 线供你观察，后续走势逐根揭晓。可以空仓等待，也可以做多或做空。</p><Button className="mt-5" onClick={start}><Play className="h-4 w-4" />开始第一轮练习</Button></div>}
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"><div className="h-full bg-sky-500" style={{ width: `${progress}%` }} /></div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button disabled={!session || finished || !!confirmAction} onClick={() => { setPlaying(!playing); setError(null) }}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? "暂停" : "自动播放"}</Button>
              <Button variant="outline" disabled={!session || finished || !!confirmAction} onClick={() => { setPlaying(false); step() }}><SkipForward className="h-4 w-4" />下一根</Button>
              <label className="ml-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">速度<select aria-label="回放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 text-[var(--text-primary)]"><option value={2000}>慢速 · 2 秒/根</option><option value={1000}>标准 · 1 秒/根</option><option value={500}>快速 · 0.5 秒/根</option></select></label>
              <span className="text-xs text-[var(--text-secondary)]">{finished ? "复盘中可自由查看已结束的行情" : "未来 K 线隐藏 · 下单后自动暂停"}</span>
            </div>
            {finished && <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-sky-300"><input type="checkbox" checked={reviewAll} onChange={(event) => setReviewAll(event.target.checked)} className="h-4 w-4 accent-sky-500" />查看完整行情（含结束后的走势）</label>}
          </section>

          <aside className={`${panelClass} p-5`} aria-label="手动下单">
            <h2 className="flex items-center justify-between text-sm font-semibold">手动下单<span className={`rounded-full px-2 py-1 text-[10px] font-normal ${finished ? "bg-sky-500/10 text-sky-300" : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"}`}>{finished ? "本轮已结束" : "收盘价成交"}</span></h2>
            <div className="my-5"><p className="text-xs text-[var(--text-secondary)]">当前成交参考价</p><p className="mt-1 font-num text-3xl font-semibold tracking-tight">{snapshot ? money(snapshot.price) : "—"}</p></div>
            <label htmlFor="practice-quantity" className="mb-2 block text-xs text-[var(--text-secondary)]">下单 / 平仓手数</label>
            <div className="flex items-center gap-2"><Button variant="outline" aria-label="减少一手" disabled={!session || finished || !validLots || lots <= 1} onClick={() => setQuantity(String(lots - 1))}>−</Button><input id="practice-quantity" type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={!session || finished} className={`${fieldClass} text-center font-num`} /><Button variant="outline" aria-label="增加一手" disabled={!session || finished || !validLots} onClick={() => setQuantity(String(lots + 1))}>+</Button></div>
            <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="buy" className="h-11" disabled={!session || finished || !!confirmAction || !validLots || position?.side === "short"} onClick={() => trade("long")}><ArrowUpRight className="h-4 w-4" />做多</Button><Button variant="sell" className="h-11" disabled={!session || finished || !!confirmAction || !validLots || position?.side === "long"} onClick={() => trade("short")}><ArrowDownRight className="h-4 w-4" />做空</Button><Button variant="outline" disabled={!position || finished || !!confirmAction || !validLots || lots > (position?.quantity ?? 0)} onClick={() => trade("close")}>平仓 {validLots ? lots : "—"} 手</Button><Button variant="close" disabled={!position || finished || !!confirmAction} onClick={() => trade("close-all")}>全部平仓</Button></div>
            <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">{position ? `持有${position.side === "long" ? "多" : "空"}单 ${position.quantity} 手，可同向加仓；反向交易前请先平仓。` : "当前空仓。先选手数，再决定方向；也可以继续观察。"}</p>
            <div className="my-5 border-t border-[var(--border)]" />
            <dl className="space-y-3 text-xs"><Row label="练习合约乘数" value="10 元 / 点 / 手" /><Row label="保证金比例" value="10%" /><Row label="单边手续费" value="3 元 / 手" /><Row label="账户余额" value={`¥${money(snapshot?.balance ?? 100000)}`} /></dl>
            <p className="mt-4 rounded-lg bg-sky-500/8 p-3 text-xs leading-5 text-[var(--text-secondary)]">教学撮合：点击下单时，按已显示的当前 K 线收盘价立即成交，不含滑点。保证金不足时拒绝开仓；保证金不足以维持持仓时自动平仓。</p>
          </aside>
        </div>

        <div aria-live="polite" className="text-sm">{error ? <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">{error}</p> : notice ? <p className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-sky-200"><Check className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}</div>

        {finished && snapshot && <section className={`${panelClass} p-5`} aria-label="练习复盘"><div className="flex items-center gap-2"><Flag className="h-4 w-4 text-sky-400" /><h2 className="font-semibold">本轮结果</h2></div><div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-4"><Result label="净收益率" value={`${snapshot.returnPct > 0 ? "+" : ""}${snapshot.returnPct.toFixed(2)}%`} valueClass={tone(snapshot.returnPct)} /><Result label="扣费后净收益" value={`¥${signed(snapshot.equity - session!.config.initialCapital)}`} valueClass={tone(snapshot.equity - session!.config.initialCapital)} /><Result label="成交 / 平仓笔数" value={`${session!.trades.length} / ${closeTrades.length}`} /><Result label="累计手续费" value={`¥${money(snapshot.totalFees)}`} /></div><p className="mt-4 text-xs leading-5 text-[var(--text-secondary)]">练习推进到第 {session!.index + 1} 根，共 {closeTrades.length} 笔平仓。复盘时可对照图上的「多 / 空 / 平」标记，回看入场、等待和离场时机。每笔盈亏见下方记录。</p></section>}

        <section className={`${panelClass} overflow-hidden`} aria-label="交易记录"><div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4"><h2 className="text-sm font-semibold">交易记录</h2><span className="text-xs text-[var(--text-secondary)]">{session?.trades.length ?? 0} 笔成交 · 最新在前</span></div><div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-xs"><thead className="bg-[var(--bg-primary)]/40 text-[var(--text-secondary)]"><tr>{["K 线时间", "操作", "手数", "成交价", "手续费", "平仓盈亏（未扣费）", "原因"].map((title) => <th key={title} className="whitespace-nowrap px-5 py-3 font-medium">{title}</th>)}</tr></thead><tbody>{session?.trades.length ? [...session.trades].reverse().map((item) => <tr key={item.id} className="border-t border-[var(--border)]/60"><td className="whitespace-nowrap px-5 py-3 font-num">{displayTime(item.time).slice(0, 16)}</td><td className={`px-5 py-3 font-medium ${item.action === "close" ? "text-sky-400" : item.side === "long" ? "text-red-400" : "text-emerald-400"}`}>{actionLabel(item)}</td><td className="px-5 py-3 font-num">{item.quantity}</td><td className="px-5 py-3 font-num">{money(item.price)}</td><td className="px-5 py-3 font-num">{money(item.fee)}</td><td className={`px-5 py-3 font-num ${tone(item.pnl)}`}>{item.action === "close" ? signed(item.pnl) : "—"}</td><td className="px-5 py-3 text-[var(--text-secondary)]">{item.reason}</td></tr>) : <tr><td colSpan={7} className="px-5 py-10 text-center text-[var(--text-secondary)]">还没有成交。做出第一笔交易后，会在这里留下记录。</td></tr>}</tbody></table></div></section>

        <details className={`${panelClass} p-5 text-xs text-[var(--text-secondary)]`}><summary className="cursor-pointer font-medium text-[var(--text-primary)]">练习规则与资金计算</summary><div className="mt-3 space-y-2 leading-6"><p>模拟行情由本机随机生成，不对应真实品种，不使用后端行情服务。本轮共 360 根 K 线，最初展示 60 根；练习中图表和指标只接收已经揭晓的 K 线。结束后可主动查看完整走势。</p><p>浮动盈亏 =（当前价 − 开仓均价）× 方向 × 手数 × 10，其中多头方向为 +1，空头为 −1。</p><p>余额 = 初始资金 + 累计已实现盈亏 − 累计手续费；权益 = 余额 + 浮动盈亏；保证金 = 当前价 × 手数 × 10 × 10%；可用资金 = 权益 − 保证金。</p><p>每次开仓与平仓均收取每手 3 元手续费。结束练习会按当前已经显示的收盘价平仓；到达行情末尾自动结束。页面刷新会清空本轮练习。</p></div></details>
      </div>
    </main>
  )
}

function Metric({ label, value, hint, valueClass = "" }: { label: string; value: string; hint: string; valueClass?: string }): React.JSX.Element {
  return <div className={`${panelClass} min-w-0 px-4 py-4`}><p className="text-xs text-[var(--text-secondary)]">{label}</p><p className={`mt-2 break-all font-num text-xl font-semibold md:text-2xl ${valueClass}`}>{value}</p><p className="mt-2 text-[11px] text-[var(--text-secondary)]">{hint}</p></div>
}
function Row({ label, value }: { label: string; value: string }): React.JSX.Element { return <div className="flex justify-between gap-2"><dt className="text-[var(--text-secondary)]">{label}</dt><dd className="font-num">{value}</dd></div> }
function Result({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }): React.JSX.Element { return <div><p className="text-xs text-[var(--text-secondary)]">{label}</p><p className={`mt-2 font-num text-lg font-semibold ${valueClass}`}>{value}</p></div> }
