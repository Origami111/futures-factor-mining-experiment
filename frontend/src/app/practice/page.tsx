import type { Metadata } from "next"
import { ManualPractice } from "@/components/practice/manual-practice"

export const metadata: Metadata = {
  title: "手动交易练习 · K 线回放",
  description: "无需登录，逐根回放模拟 K 线，练习主观交易并复盘。",
}

export default function PracticePage(): React.JSX.Element {
  return <ManualPractice />
}
