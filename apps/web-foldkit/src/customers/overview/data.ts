import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Effect, Option, Result, Schema } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { catchCommon } from "../../data/actions"
import { HazelRpc } from "../../rpc"

/**
 * What a layout's widgets read for one customer (`docs/customers/overview-layouts.md`): every stat's
 * and table's metric windows in one `customers.account.metricWindows` call, and one
 * `customers.account.series` per chart at the range its viewer picked. The customer page and the
 * layout editor's canvas embed it (`GotOverviewDataMessage`) and call `load` whenever the widgets,
 * the metrics or the customer change: only what changed is asked again.
 */

// MODEL

export const ChartRange = Schema.Literals(["7d", "30d", "90d"])
export type ChartRange = typeof ChartRange.Type

export const Windows = AsyncData.Schema(Schema.Array(Customers.MetricWindow), CommonReason)
export const Series = AsyncData.Schema(Schema.Array(Customers.MetricSeries), CommonReason)

export const Chart = Schema.Struct({
	/** The range the viewer picked, else the widget's. */
	range: ChartRange,
	/** The keys and range asked for: an answer for others is dropped. */
	asked: Schema.String,
	series: Series.schema,
})
export type Chart = typeof Chart.Type

export const Model = Schema.Struct({
	accountId: Schema.NullOr(CustomerAccountId),
	/** The windows asked for (`windowsKey`): an answer for others is dropped. */
	windowsAsked: Schema.NullOr(Schema.String),
	windows: Windows.schema,
	/** By widget id. */
	charts: Schema.Record(Schema.String, Chart),
	hovered: Schema.NullOr(Schema.Struct({ widgetId: Schema.String, index: Schema.Int })),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	accountId: null,
	windowsAsked: null,
	windows: AsyncData.Idle(),
	charts: {},
	hovered: null,
})

// MESSAGE

export const Message = defineMessageUnion({
	SucceededFetchMetricWindows: {
		accountId: CustomerAccountId,
		asked: Schema.String,
		windows: Schema.Array(Customers.MetricWindow),
	},
	FailedFetchMetricWindows: { accountId: CustomerAccountId, asked: Schema.String, reason: CommonReason },
	SucceededFetchChartSeries: {
		accountId: CustomerAccountId,
		widgetId: Schema.String,
		asked: Schema.String,
		series: Schema.Array(Customers.MetricSeries),
	},
	FailedFetchChartSeries: {
		accountId: CustomerAccountId,
		widgetId: Schema.String,
		asked: Schema.String,
		reason: CommonReason,
	},
	ClickedChartRange: { widgetId: Schema.String, range: ChartRange },
	HoveredChart: { widgetId: Schema.String, index: Schema.NullOr(Schema.Int) },
	PressedRetry: {},
})
export type Message = typeof Message.Type

// WHAT THE WIDGETS READ

/** The RPC takes at most this many windows; a layout asking for more shows the rest as no data. */
const MAX_WINDOWS = 80

type WindowAsk = Readonly<{ metricKey: string; days: number }>

/** Every stat's and table's metric window, once each, in a stable order. */
export const windowsOf = (
	widgets: ReadonlyArray<Customers.OverviewWidget>,
	groupKeys: (group: string) => ReadonlyArray<string>,
): ReadonlyArray<WindowAsk> => {
	const asks = new Map<string, WindowAsk>()
	for (const widget of widgets) {
		if (widget._tag !== "stat" && widget._tag !== "metric_table") continue
		for (const metricKey of Customers.widgetMetricKeys(widget, groupKeys))
			asks.set(Customers.metricWindowKey(metricKey, widget.windowDays), {
				metricKey,
				days: widget.windowDays,
			})
	}
	return [...asks.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(0, MAX_WINDOWS)
		.map(([, ask]) => ask)
}

const windowsKey = (asks: ReadonlyArray<WindowAsk>) =>
	asks.map((ask) => Customers.metricWindowKey(ask.metricKey, ask.days)).join(",")

const chartKey = (widget: Customers.ChartWidget, range: ChartRange) =>
	`${widget.metricKeys.join(",")}@${range}`

/** The window a stat or table row reads, once the windows answered. */
export const windowOf = (model: Model, metricKey: string, days: number): Customers.MetricWindow | undefined =>
	Option.getOrUndefined(AsyncData.getData(model.windows))?.find(
		(window) => window.metricKey === metricKey && window.days === days,
	)

export const chartOf = (model: Model, widget: Customers.ChartWidget): Chart => {
	const chart = model.charts[widget.id]
	return chart ?? { range: widget.range, asked: "", series: AsyncData.Idle() }
}

// COMMANDS

const FetchOverviewMetricWindows = Command.define("FetchOverviewMetricWindows", {
	args: {
		organizationId: OrganizationId,
		accountId: CustomerAccountId,
		asked: Schema.String,
		windows: Schema.Array(Schema.Struct({ metricKey: Schema.String, days: Schema.Int })),
	},
	messages: [Message.SucceededFetchMetricWindows, Message.FailedFetchMetricWindows],
	execute: ({ asked, ...args }) => {
		const failed = (reason: CommonReason) =>
			Message.FailedFetchMetricWindows({ accountId: args.accountId, asked, reason })
		return HazelRpc.use((rpc) => rpc("customers.account.metricWindows", args)).pipe(
			Effect.map(({ windows }) =>
				Message.SucceededFetchMetricWindows({ accountId: args.accountId, asked, windows }),
			),
			// A deleted account shows its not-found state from the page; the widgets only retry.
			Effect.catchTag("CustomersNotFoundError", () => Effect.succeed(failed("Unexpected"))),
			catchCommon(failed),
		)
	},
})

const FetchOverviewChartSeries = Command.define("FetchOverviewChartSeries", {
	args: {
		organizationId: OrganizationId,
		accountId: CustomerAccountId,
		widgetId: Schema.String,
		asked: Schema.String,
		metricKeys: Schema.Array(Schema.String),
		range: ChartRange,
	},
	messages: [Message.SucceededFetchChartSeries, Message.FailedFetchChartSeries],
	execute: ({ widgetId, asked, ...args }) => {
		const failed = (reason: CommonReason) =>
			Message.FailedFetchChartSeries({ accountId: args.accountId, widgetId, asked, reason })
		return HazelRpc.use((rpc) => rpc("customers.account.series", args)).pipe(
			Effect.map(({ series }) =>
				Message.SucceededFetchChartSeries({ accountId: args.accountId, widgetId, asked, series }),
			),
			Effect.catchTag("CustomersNotFoundError", () => Effect.succeed(failed("Unexpected"))),
			catchCommon(failed),
		)
	},
})

// UPDATE

export type Inputs = Readonly<{
	organizationId: OrganizationId
	accountId: CustomerAccountId
	widgets: ReadonlyArray<Customers.OverviewWidget>
	groupKeys: (group: string) => ReadonlyArray<string>
}>

type OverviewCommand =
	| ReturnType<typeof FetchOverviewMetricWindows>
	| ReturnType<typeof FetchOverviewChartSeries>

export type Return = Readonly<{ model: Model; commands?: ReadonlyArray<OverviewCommand> }>

const reload = <A, E>(data: AsyncData.AsyncData<A, E>) =>
	Option.getOrElse(AsyncData.revalidateOrLoad(data), () => data)

/** Asks for what the widgets read and was not asked for yet (everything, for another customer). */
export const load = (current: Model, inputs: Inputs): Return => {
	const commands: Array<OverviewCommand> = []
	const { organizationId, accountId } = inputs
	let model = current.accountId === accountId ? current : { ...init(), accountId }
	const asks = windowsOf(inputs.widgets, inputs.groupKeys)
	const asked = windowsKey(asks)
	if (asked !== model.windowsAsked) {
		model = {
			...model,
			windowsAsked: asked,
			windows: asks.length === 0 ? AsyncData.succeed([]) : reload(model.windows),
		}
		if (asks.length > 0)
			commands.push(FetchOverviewMetricWindows({ organizationId, accountId, asked, windows: asks }))
	}
	for (const widget of inputs.widgets) {
		if (widget._tag !== "chart") continue
		const chart = chartOf(model, widget)
		const chartAsked = chartKey(widget, chart.range)
		if (chart.asked === chartAsked) continue
		model = {
			...model,
			charts: {
				...model.charts,
				[widget.id]: { ...chart, asked: chartAsked, series: reload(chart.series) },
			},
		}
		commands.push(
			FetchOverviewChartSeries({
				organizationId,
				accountId,
				widgetId: widget.id,
				asked: chartAsked,
				metricKeys: widget.metricKeys,
				range: chart.range,
			}),
		)
	}
	return { model, commands }
}

/** A chart's range set in the editor: the viewer's pick is dropped, so it opens at the new one. */
export const forgetChart = (model: Model, widgetId: string): Model => {
	const { [widgetId]: _forgotten, ...charts } = model.charts
	return { ...model, charts }
}

const withChart = (model: Model, widgetId: string, change: (chart: Chart) => Chart): Model => {
	const chart = model.charts[widgetId]
	return chart === undefined ? model : { ...model, charts: { ...model.charts, [widgetId]: change(chart) } }
}

export const update = (model: Model, message: Message, inputs: Inputs): Return => {
	const isOther = "accountId" in message && message.accountId !== model.accountId
	if (isOther) return { model }
	return Message.match<Return>(message, {
		SucceededFetchMetricWindows: ({ asked, windows }) => ({
			model:
				asked === model.windowsAsked
					? { ...model, windows: AsyncData.settle(model.windows, Result.succeed(windows)) }
					: model,
		}),
		FailedFetchMetricWindows: ({ asked, reason }) => ({
			model:
				asked === model.windowsAsked
					? { ...model, windows: AsyncData.settle(model.windows, Result.fail(reason)) }
					: model,
		}),
		SucceededFetchChartSeries: ({ widgetId, asked, series }) => ({
			model: withChart(model, widgetId, (chart) =>
				chart.asked === asked
					? { ...chart, series: AsyncData.settle(chart.series, Result.succeed(series)) }
					: chart,
			),
		}),
		FailedFetchChartSeries: ({ widgetId, asked, reason }) => ({
			model: withChart(model, widgetId, (chart) =>
				chart.asked === asked
					? { ...chart, series: AsyncData.settle(chart.series, Result.fail(reason)) }
					: chart,
			),
		}),
		ClickedChartRange: ({ widgetId, range }) => {
			const widget = inputs.widgets.find((each) => each.id === widgetId)
			if (widget?._tag !== "chart") return { model }
			const chart = chartOf(model, widget)
			return load(
				{ ...model, hovered: null, charts: { ...model.charts, [widgetId]: { ...chart, range } } },
				inputs,
			)
		},
		HoveredChart: ({ widgetId, index }) => ({
			model: { ...model, hovered: index === null ? null : { widgetId, index } },
		}),
		// What failed is asked again.
		PressedRetry: () =>
			load(
				{
					...model,
					windowsAsked: AsyncData.isFailure(model.windows) ? null : model.windowsAsked,
					charts: Object.fromEntries(
						Object.entries(model.charts).map(([id, chart]) => [
							id,
							AsyncData.isFailure(chart.series) ? { ...chart, asked: "" } : chart,
						]),
					),
				},
				inputs,
			),
	})
}
