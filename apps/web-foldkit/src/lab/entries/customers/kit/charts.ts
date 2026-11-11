import { CustomersRange } from "@hazel/domain/customers"
import { Effect, Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import type { Html, HtmlBuilder } from "foldkit/html"
import { healthDistribution } from "../../../../customers/charts/distribution"
import { chartCard, chartLegend } from "../../../../customers/charts/frame"
import { ACTIVE_USERS_LEGEND, activeUsersChart } from "../../../../customers/charts/line-chart"
import { mrrLegend, mrrMovementChart } from "../../../../customers/charts/stacked-bar-chart"
import { noSourcesState } from "../../../../customers/ui/empty-states"
import { rangePicker } from "../../../../customers/ui/filter-bar"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { SETTINGS, overviewFixture } from "../../../fixtures/customers"

// `/lab/customers/kit/charts`: Foundations › Line Chart Active Users, Stacked Bar Chart MRR Movement,
// Distribution Bar Health. Hover for tooltips; `?state=default|partial|empty`.

const STATES = ["default", "partial", "empty"] as const
const State = Schema.Literals(STATES)

const Model = Schema.Struct({
	state: State,
	range: CustomersRange,
	usersHover: Schema.NullOr(Schema.Number),
	mrrHover: Schema.NullOr(Schema.Number),
	healthMetric: Schema.Literals(["customers", "mrr"]),
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	HoveredUsers: { index: Schema.NullOr(Schema.Number) },
	HoveredMrr: { index: Schema.NullOr(Schema.Number) },
	ChoseRange: { range: CustomersRange },
	ChoseHealthMetric: { metric: Schema.Literals(["customers", "mrr"]) },
})
type Message = typeof Message.Type

const Flags = Schema.Struct({ state: State, range: CustomersRange })

const update = (model: Model, message: Message): { model: Model } => ({
	model: Message.match(message, {
		HoveredUsers: ({ index }) => ({ ...model, usersHover: index }),
		HoveredMrr: ({ index }) => ({ ...model, mrrHover: index }),
		ChoseRange: ({ range }) => ({ ...model, range, usersHover: null, mrrHover: null }),
		ChoseHealthMetric: ({ metric }) => ({ ...model, healthMetric: metric }),
	}),
})

const RANGE_DESCRIPTION = {
	"7d": "last 7 days",
	"30d": "last 30 days",
	"90d": "last 90 days, by week",
	"12m": "last 12 months",
} as const

const view = (model: Model, h: HtmlBuilder<Message>): Html => {
	const overview = overviewFixture(model.range, { partial: model.state === "partial" })
	const body =
		model.state === "empty"
			? [noSourcesState(h, { onConnect: Message.ChoseRange({ range: model.range }) })]
			: [
					rangePicker(h, {
						selected: model.range,
						onSelect: (range) => Message.ChoseRange({ range }),
					}),
					chartCard(
						h,
						{
							title: "Active users",
							description: `Distinct users across all customers, ${RANGE_DESCRIPTION[model.range]}`,
							aside: chartLegend(h, ACTIVE_USERS_LEGEND),
						},
						[
							activeUsersChart(h, {
								points: overview.activeUsers,
								bucket: overview.bucket,
								hoveredIndex: model.usersHover,
								onHover: (index) => Message.HoveredUsers({ index }),
							}),
						],
					),
					chartCard(
						h,
						{
							title: "MRR movement",
							description: `Change by type, ${RANGE_DESCRIPTION[model.range]}`,
							aside: chartLegend(h, mrrLegend(overview.mrrMovements)),
						},
						overview.hasData.billing
							? [
									mrrMovementChart(h, {
										buckets: overview.mrrMovements,
										bucket: overview.bucket,
										currency: overview.currency,
										hoveredIndex: model.mrrHover,
										onHover: (index) => Message.HoveredMrr({ index }),
									}),
								]
							: [
									h.p(
										[h.Class("py-16 text-center text-muted-fg text-sm")],
										["Connect Stripe or Autumn to see MRR movement."],
									),
								],
					),
					healthDistribution(h, {
						rows: overview.healthDistribution,
						bands: SETTINGS.health.bands,
						currency: overview.currency,
						metric: model.healthMetric,
						onMetric: (metric) => Message.ChoseHealthMetric({ metric }),
						className: "max-w-lg",
					}),
				]
	return labPage(
		h,
		{ title: "Charts", switches: [{ name: "state", values: STATES, current: model.state }] },
		[labSection(h, "Overview charts", body)],
	)
}

export const lab = defineLabWithFlags("Charts", {
	Model,
	Flags,
	flags: Effect.all({
		state: queryParam("state", STATES, "default"),
		range: queryParam("range", CustomersRange.literals, "30d"),
	}),
	init: (flags) => ({
		model: { ...flags, usersHover: null, mrrHover: null, healthMetric: "customers" as const },
	}),
	update,
	view,
})
