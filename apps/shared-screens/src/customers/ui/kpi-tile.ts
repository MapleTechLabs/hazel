// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * KPI tiles (today's `web-foldkit/src/customers/ui/kpi-tile.ts`) on W2b's `statTile`: the delta's
 * direction and whether it is good become `trend` and `deltaTone`, so pages pass today's `Delta`.
 */
import type { Hazel, StatDeltaTone, StatTrend } from "@hazel/ui/vocabulary/index"
import { deltaTone } from "../data/format"

/** A change: its value (sign = direction), its text, and which direction is good for the metric. */
export type Delta = Readonly<{ value: number; text: string; goodWhen?: "up" | "down" }>

/** The tile's arrow and colour for a delta: green when good, red when bad, grey and arrowless when flat. */
export const deltaLook = (delta: Delta): Readonly<{ trend: StatTrend; tone: StatDeltaTone }> => {
	const tone = deltaTone(delta.value, delta.goodWhen ?? "up")
	return {
		trend: delta.value > 0 ? "up" : delta.value < 0 ? "down" : "none",
		tone: tone === "positive" ? "success" : tone === "negative" ? "danger" : "neutral",
	}
}

export type KpiTileOptions<Msg> = Readonly<{
	label: string
	/** What the number means and how it is computed (the label's hover card). */
	definition?: string
	/** `$48,210`; ignored while loading or empty. */
	value?: string
	/** Beside the value: `978 / 1,611` (ratio tiles). */
	detail?: string
	delta?: Delta | null
	/** `vs previous 30 days`. */
	comparison?: string
	/** A `chart` sparkline (`size("large")`), right of the value. */
	trend?: Hazel.NoTextInput<Msg>
	state?: "ready" | "loading" | "empty"
	/** Empty: the reason and the way out (`Connect billing to track revenue`, a link or button). */
	emptyAction?: Hazel.NoTextInput<Msg>
	/** The whole tile links here (the page behind the number). */
	href?: string
	onPress?: Msg
}>

export const kpiTile = <Msg>(h: Hazel.H<Msg>, options: KpiTileOptions<Msg>) => {
	const state = options.state ?? "ready"
	const tile = h.statTile
		.label(options.label)
		.definition(options.definition)
		.href(options.href)
		.loading(state === "loading")
	if (state === "empty") return options.emptyAction === undefined ? tile : tile.action(options.emptyAction)
	const look = options.delta == null ? undefined : deltaLook(options.delta)
	const ready = tile
		.value(options.value)
		.detail(options.detail)
		.delta(options.delta?.text)
		.trend(look?.trend ?? "none")
		.deltaTone(look?.tone ?? "neutral")
		.comparison(options.comparison)
	const withChart = options.trend === undefined ? ready : ready.chart(options.trend)
	return options.onPress === undefined ? withChart : withChart.on("press", options.onPress)
}
