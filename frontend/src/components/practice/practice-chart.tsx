"use client"

import { useEffect, useRef } from "react"
import {
  CandlestickSeries, HistogramSeries, ColorType, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp,
} from "lightweight-charts"
import type { Candle, PracticeTrade } from "@/lib/manualReplayEngine"

function timeLabel(time: Time): string {
  if (typeof time !== "number") return String(time)
  return new Date(time * 1000 + 8 * 3600000).toISOString().slice(5, 16).replace("T", " ")
}

/** 回放只传入可见数据。保持图表实例，避免每根重建丢失视图或触发旧画布渲染。 */
export function PracticeChart({ bars, trades }: { bars: Candle[]; trades: PracticeTrade[] }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const previousLength = useRef(0)

  useEffect(() => {
    if (!container.current) return
    const chart = createChart(container.current, {
      height: 400,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "#2e2e33" }, horzLines: { color: "#2e2e33" } },
      rightPriceScale: { borderColor: "#3a3a40" },
      timeScale: { borderColor: "#3a3a40", timeVisible: true, secondsVisible: false, rightOffset: 3, tickMarkFormatter: timeLabel },
      localization: { timeFormatter: timeLabel },
    })
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#ef4444", downColor: "#22c55e", borderVisible: false,
      wickUpColor: "#ef4444", wickDownColor: "#22c55e",
    })
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } })
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 }, visible: false })
    chartRef.current = chart
    candlesRef.current = candles
    volumeRef.current = volume
    markersRef.current = createSeriesMarkers(candles, [])
    const observer = new ResizeObserver(() => {
      if (container.current) chart.applyOptions({ width: container.current.clientWidth })
    })
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      markersRef.current = null
      candlesRef.current = null
      volumeRef.current = null
      chartRef.current = null
      previousLength.current = 0
      chart.remove()
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const candles = candlesRef.current
    if (!chart || !candles || !volumeRef.current || !markersRef.current) return
    candles.setData(bars.map((bar) => ({ ...bar, time: Math.floor(Date.parse(bar.time) / 1000) as UTCTimestamp })))
    volumeRef.current.setData(bars.map((bar) => ({ time: Math.floor(Date.parse(bar.time) / 1000) as UTCTimestamp, value: bar.volume, color: bar.close >= bar.open ? "#ef444440" : "#22c55e40" })))
    markersRef.current.setMarkers(trades.map((trade) => ({
      time: Math.floor(Date.parse(trade.time) / 1000) as UTCTimestamp,
      position: "belowBar" as const,
      shape: trade.action === "close" ? "circle" as const : trade.side === "long" ? "arrowUp" as const : "arrowDown" as const,
      color: trade.action === "close" ? "#60a5fa" : trade.side === "long" ? "#ef4444" : "#22c55e",
      text: trade.action === "close" ? "平" : trade.side === "long" ? "多" : "空",
    })))
    if (!previousLength.current || bars.length < previousLength.current || bars.length - previousLength.current > 1) chart.timeScale().fitContent()
    else if (bars.length > previousLength.current) chart.timeScale().scrollToRealTime()
    previousLength.current = bars.length
  }, [bars, trades])

  return <div><div ref={container} className="w-full" /><p className="mt-3 flex flex-wrap gap-4 text-[11px] text-[var(--text-secondary)]"><span className="text-red-400">↑ 多：做多</span><span className="text-emerald-400">↓ 空：做空</span><span className="text-blue-400">● 平：平仓</span><span>下方柱形：成交量 · 时间为北京时间</span></p></div>
}
