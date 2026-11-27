// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The overview's props, Model, messages and queries (today's `overview/model.ts` and `message.ts`). */
import { UiSchema } from "@effect/ui"
import * as Customers from "@hazel/domain/customers"
import { CustomerChannelSuggestionId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Session } from "../../../app/session"
import { ChannelOption } from "../../data/channels"
import { AccountRow, SettingsSummary, SignalRow } from "../../data/queries"
import { GetSupportReport } from "../support/report"
import { GetOverview, GetSuggestions, SuggestionIds, SuggestionOutcome } from "./data"

export const OverviewMessage = UiSchema.TaggedEnum({
	ClickedRange: { range: Customers.CustomersRange },
	ToggledCompare: { isComparing: Schema.Boolean },
	ToggledTrends: { open: Schema.Boolean },
	PressedRetry: {},
	PressedRetrySupport: {},
	PressedConnect: { provider: Customers.CustomerProvider },
	PressedAcceptSuggestion: { suggestionId: CustomerChannelSuggestionId },
	PressedDismissSuggestion: { suggestionId: CustomerChannelSuggestionId },
	CompletedSuggestion: { outcome: SuggestionOutcome },
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedSettings: { settings: Schema.NullOr(SettingsSummary) },
	UpdatedChannels: { channels: Schema.Array(ChannelOption) },
})
export type OverviewMessage = typeof OverviewMessage.Type

export const OverviewProps = Schema.Struct({
	session: Session,
	/** The shell's phone layout: the header gives way to the top bar with nothing connected. */
	isMobile: Schema.Boolean,
	nowMs: Schema.Finite,
})
export type OverviewProps = typeof OverviewProps.Type

export const OverviewModel = Schema.Struct({
	range: Customers.CustomersRange,
	/** Show each KPI's change against the previous period of the same length. */
	isComparing: Schema.Boolean,
	/** The folded charts, opened. */
	trendsOpen: Schema.Boolean,
	/** "Try again" counts: a failed query is fetched again under a new key. */
	attempt: Schema.Finite,
	supportAttempt: Schema.Finite,
	/** Asks for the suggestions again after each accept or dismiss settles. */
	suggestionsRevision: Schema.Finite,
	/** Accepted or dismissed here and not yet failed: kept out of later answers too. */
	hiddenSuggestions: SuggestionIds,
	/** Live rows; null until each query answers. */
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	providers: Schema.NullOr(Schema.Array(Customers.CustomerProvider)),
	settings: Schema.NullOr(SettingsSummary),
	/** The org's channels the user sees: a suggestion's name and mark come from here. */
	channels: Schema.Array(ChannelOption),
})
export type OverviewModel = typeof OverviewModel.Type

export const OverviewDef = Hazel.component({
	name: "OverviewPage",
	props: OverviewProps,
	model: OverviewModel,
	message: OverviewMessage,
	queries: {
		overview: {
			query: GetOverview,
			args: ({ props, model }) =>
				props.session.organization === null
					? undefined
					: {
							organizationId: props.session.organization.id,
							range: model.range,
							attempt: model.attempt,
						},
		},
		support: {
			query: GetSupportReport,
			args: ({ props, model }) =>
				props.session.organization === null
					? undefined
					: {
							organizationId: props.session.organization.id,
							range: model.range,
							attempt: model.supportAttempt,
						},
		},
		suggestions: {
			query: GetSuggestions,
			args: ({ props, model }) =>
				props.session.organization === null
					? undefined
					: { organizationId: props.session.organization.id, revision: model.suggestionsRevision },
		},
	},
})

/** The view's builder: the vocabulary's, with the props and the query results. */
export type OverviewH = Parameters<Parameters<typeof OverviewDef.make>[0]["view"]>[0]
