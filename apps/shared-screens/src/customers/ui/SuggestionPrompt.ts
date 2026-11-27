// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The one-channel suggestion prompt (today's `web-foldkit/src/customers/suggestion-prompt.ts`):
 * "Looks like Acme" with the strongest reason, Link and Dismiss. Mount it while the channel has no
 * customer; asking re-scores the channel first. An accepted link arrives through the org source.
 */
import { Command, Component, Query, UiSchema, View } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { ChannelId, OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Option, Schema } from "effect"
import { ShowToast } from "../../app/requests"
import { copyOf, errorToast, reasonOf, successToast } from "../../modals/feedback"
import { fetchSuggestions, reasonSummary, SuggestionRow } from "../data/suggestions"

export const SuggestionPromptProps = Schema.Struct({
	organizationId: OrganizationId,
	channelId: ChannelId,
	/** "#general looks like Acme" after a share; channel settings says only "Looks like Acme". */
	subject: Schema.optional(Schema.String),
})
export type SuggestionPromptProps = typeof SuggestionPromptProps.Type

export const SuggestionAction = Schema.Literals(["accept", "dismiss"])
export type SuggestionAction = typeof SuggestionAction.Type

export const SuggestionFailure = Schema.Literals(["NotFound", "Invalid", "Other"])
export type SuggestionFailure = typeof SuggestionFailure.Type

export const SuggestionPromptMessage = UiSchema.TaggedEnum({
	PressedLink: {},
	PressedDismiss: {},
	SucceededAccept: { accountName: Schema.String },
	SucceededDismiss: {},
	FailedAction: { action: SuggestionAction, reason: SuggestionFailure, title: Schema.String },
})
export type SuggestionPromptMessage = typeof SuggestionPromptMessage.Type

export const SuggestionPromptModel = Schema.Struct({
	/** Bumped after a dismiss or a failure: the suggestions are asked for again. */
	attempt: Schema.Finite,
	status: Schema.Literals(["Ready", "Linking", "Dismissing"]),
})
export type SuggestionPromptModel = typeof SuggestionPromptModel.Type

/** The channel's open suggestions, best first (a failed ask shows nothing, as today). */
export class GetChannelSuggestions extends Query.Service<GetChannelSuggestions>()(
	"hazel/customers/GetChannelSuggestions",
	{
		args: { organizationId: OrganizationId, channelId: ChannelId, attempt: Schema.Finite },
		success: Schema.Array(SuggestionRow),
		error: Schema.Literal("Failed"),
		// Asked again on each mount and after each action (`attempt`).
		staleTime: "0 millis",
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ organizationId, channelId }) =>
					fetchSuggestions(organizationId, { channelId }).pipe(
						Effect.provideService(HazelRpc, rpc),
						// BOUNDARY: any failure reads as "nothing to suggest" until the next ask.
						Effect.catchCause(() => Effect.fail("Failed" as const)),
					),
		),
	)
}

const failedWith = (action: SuggestionAction) => (error: unknown) => {
	const tag = typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined
	const reason: SuggestionFailure =
		tag === "CustomersNotFoundError"
			? "NotFound"
			: tag === "CustomersInvalidRequestError"
				? "Invalid"
				: "Other"
	return SuggestionPromptMessage.FailedAction({
		action,
		reason,
		title: copyOf(reasonOf(error), {}).title,
	})
}

/** Links the suggested channel; the link then shows through the org source. */
export class AcceptSuggestion extends Command.Service<AcceptSuggestion>()(
	"hazel/customers/AcceptSuggestion",
	{
		args: { organizationId: OrganizationId, suggestion: SuggestionRow },
		success: SuggestionPromptMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ organizationId, suggestion }) =>
					rpc("customers.channel.suggestion.accept", {
						organizationId,
						suggestionId: suggestion.id,
					}).pipe(
						Effect.as(
							SuggestionPromptMessage.SucceededAccept({ accountName: suggestion.accountName }),
						),
						Effect.catchCause((cause) =>
							Effect.succeed(
								failedWith("accept")(Option.getOrUndefined(Cause.findErrorOption(cause))),
							),
						),
					),
		),
	)
}

/** That account is never suggested for that channel again; one already gone counts as dismissed. */
export class DismissSuggestion extends Command.Service<DismissSuggestion>()(
	"hazel/customers/DismissSuggestion",
	{
		args: { organizationId: OrganizationId, suggestion: SuggestionRow },
		success: SuggestionPromptMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ organizationId, suggestion }) =>
					rpc("customers.channel.suggestion.dismiss", {
						organizationId,
						suggestionId: suggestion.id,
					}).pipe(
						Effect.as(SuggestionPromptMessage.SucceededDismiss()),
						Effect.catchTag("CustomersNotFoundError", () =>
							Effect.succeed(SuggestionPromptMessage.SucceededDismiss()),
						),
						Effect.catchCause((cause) =>
							Effect.succeed(
								failedWith("dismiss")(Option.getOrUndefined(Cause.findErrorOption(cause))),
							),
						),
					),
		),
	)
}

/** Today's copy for a refused accept or dismiss (`suggestionFailureToast`). */
const failureCopy = (action: SuggestionAction, reason: SuggestionFailure, common: string) =>
	reason === "NotFound"
		? {
				title: action === "accept" ? "Couldn't link the channel" : "Couldn't dismiss the suggestion",
				description: "The suggestion or channel is no longer available.",
			}
		: reason === "Invalid"
			? {
					title: "Couldn't link the channel",
					description: "Threads and direct messages can't be linked to a customer.",
				}
			: { title: common }

const SuggestionPromptDef = Hazel.component({
	name: "SuggestionPrompt",
	props: SuggestionPromptProps,
	model: SuggestionPromptModel,
	message: SuggestionPromptMessage,
	queries: {
		suggestions: {
			query: GetChannelSuggestions,
			args: ({ props, model }) => ({
				organizationId: props.organizationId,
				channelId: props.channelId,
				attempt: model.attempt,
			}),
		},
	},
	restore: (model) => ({ ...model, status: "Ready" as const }),
})

type H = Parameters<Parameters<typeof SuggestionPromptDef.make>[0]["view"]>[0]

/** The suggestion shown: the first while ready or linking, none while a dismiss runs. */
const shownOf = (h: H, model: SuggestionPromptModel): SuggestionRow | null => {
	const result = h.queries.suggestions
	if (result._tag !== "Success" || model.status === "Dismissing") return null
	return result.value[0] ?? null
}

export const SuggestionPromptNoDeps = SuggestionPromptDef.make({
	init: () => ({ attempt: 0, status: "Ready" as const }),
	update: {
		PressedLink: ($) => {
			const result = $.queries.suggestions
			const suggestion = result._tag === "Success" ? result.value[0] : undefined
			if (suggestion === undefined || $.model.status !== "Ready") return $.model
			return $.evolve({ status: () => "Linking" as const }).run(
				AcceptSuggestion.make({ organizationId: $.props.organizationId, suggestion }),
			)
		},
		PressedDismiss: ($) => {
			const result = $.queries.suggestions
			const suggestion = result._tag === "Success" ? result.value[0] : undefined
			if (suggestion === undefined || $.model.status !== "Ready") return $.model
			// Hidden at once; the next suggestion, if any, shows after the ask.
			return $.evolve({ status: () => "Dismissing" as const }).run(
				DismissSuggestion.make({ organizationId: $.props.organizationId, suggestion }),
			)
		},
		// The parent unmounts the prompt once the channel's customer lands.
		SucceededAccept: ($, { accountName }) =>
			$.evolve({ status: () => "Ready" as const }).run(
				ShowToast.make({ toast: successToast(`Linked to ${accountName}`) }),
			),
		SucceededDismiss: ($) =>
			$.evolve({ status: () => "Ready" as const, attempt: (attempt) => attempt + 1 }),
		FailedAction: ($, { action, reason, title }) =>
			$.evolve({ status: () => "Ready" as const, attempt: (attempt) => attempt + 1 }).run(
				ShowToast.make({ toast: errorToast(failureCopy(action, reason, title)) }),
			),
	},
	view: (h, model) => {
		const suggestion = shownOf(h, model)
		// Nothing at all, so the parent's gap does not count it.
		if (suggestion === null) return View.text("")
		const isLinking = model.status === "Linking"
		const summary = reasonSummary(suggestion)
		const subject = h.props.subject
		// HAZEL-GAP(p4-suggestion-box): today's box is `bg-secondary/30` with a ring; `inset` has the ring only.
		return h.frame.surface("inset").children(
			h.stack
				.axis("horizontal")
				.density("cozy")
				.align("center")
				.wrap()
				.children(
					h.icon.name("office"),
					h.stack.density("tight").children(
						h.stack
							.axis("horizontal")
							.density("compact")
							.children(
								h.text
									.role("label")
									.children(
										subject === undefined ? "Looks like " : `${subject} looks like `,
										h.text.strong().children(suggestion.accountName),
									),
								suggestion.strength === "strong"
									? h.text.role("caption").tone("success").strong().children("Strong match")
									: null,
							),
						// HAZEL-GAP(p4-suggestion-reasons): today a "+N" disclosure lists every reason; the strongest shows alone.
						summary === null ? null : h.text.role("caption").tone("muted").children(summary.top),
					),
					h.spacer,
					h.stack
						.axis("horizontal")
						.density("tight")
						.children(
							h.button
								.label(isLinking ? "Linking…" : "Link")
								.variant("outline")
								.size("xsmall")
								.disabled(isLinking)
								.on("press", SuggestionPromptMessage.PressedLink()),
							h.button
								.label("Dismiss")
								.variant("ghost")
								.size("xsmall")
								.disabled(isLinking)
								.on("press", SuggestionPromptMessage.PressedDismiss()),
						),
				),
		)
	},
})

export const suggestionPromptLayer = Layer.mergeAll(
	GetChannelSuggestions.layer,
	AcceptSuggestion.layer,
	DismissSuggestion.layer,
)

/** The prompt on the host's `HazelRpc`. */
export const SuggestionPrompt = SuggestionPromptNoDeps.pipe(Component.provide(suggestionPromptLayer))
