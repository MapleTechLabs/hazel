// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * "Mark signal as done" (the deleted Foldkit `attention/done-dialog.ts`, Wonder: Queue Mark Done
 * Dialog): an outcome and an optional note. The write is optimistic, so the row leaves the queue at
 * once; a failure toasts after the dialog has closed.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { SignalOutcome, SignalSeverity } from "@hazel/domain/customers"
import { CustomerSignalId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { Session } from "../../app/session"
import { errorToast, ModalEvents, toast } from "../../modals/feedback"
import { modalServices } from "../../modals/services"
import { makeCustomerActions } from "../data/actions"
import { severityChip } from "../ui/badges"
import { companyLogo } from "../ui/identity"
import { failureCopy, failureOf } from "./actions"

export const MarkSignalDoneProps = Schema.Struct({
	/** The page's session: the org and the user who acts. */
	session: Session,
	signalId: CustomerSignalId,
	accountName: Schema.String,
	accountLogoUrl: Schema.NullOr(Schema.String),
	title: Schema.String,
	reason: Schema.String,
	severity: SignalSeverity,
})
export type MarkSignalDoneProps = typeof MarkSignalDoneProps.Type

export const MarkSignalDoneModel = Schema.Struct({ outcome: SignalOutcome, note: TextField.State })
export type MarkSignalDoneModel = typeof MarkSignalDoneModel.Type

export const MarkSignalDoneMessage = UiSchema.TaggedEnum({
	PickedOutcome: { selected: Schema.Array(Schema.String) },
	ChangedNote: { payload: TextField.ChangePayload },
	PressedCancel: {},
	DismissedDialog: {},
	PressedMarkDone: {},
})
export type MarkSignalDoneMessage = typeof MarkSignalDoneMessage.Type

const OUTCOMES = {
	contacted: ["Contacted", "Reached out to the account"],
	fixed: ["Fixed", "Root cause is resolved"],
	not_an_issue: ["Not an issue", "Expected or a false alarm"],
	other: ["Other", "Explain in the note"],
} as const satisfies Record<SignalOutcome, readonly [string, string]>

/** Marks the signal done; its failure toast is the Command's, so it outlives the closed dialog. */
export class MarkSignalDone extends Command.Service<MarkSignalDone>()("hazel/customers/MarkSignalDone", {
	args: {
		organizationId: OrganizationId,
		userId: UserId,
		signalId: CustomerSignalId,
		outcome: SignalOutcome,
		note: Schema.String,
	},
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { markSignalDoneAction } = makeCustomerActions(data)
			return ({ note, ...args }) =>
				run(
					markSignalDoneAction({
						...args,
						note: note.trim() === "" ? undefined : note.trim(),
					}).pipe(
						Effect.asVoid,
						// BOUNDARY: every failure reads as its named or common reason.
						Effect.catchCause((cause) =>
							toast(errorToast(failureCopy("done", failureOf(cause.reasons[0])))),
						),
						Effect.as(Component.noop),
					),
				)
		}),
	)
}

const close = ModalEvents.RequestedClose()
const isOutcome = Schema.is(SignalOutcome)

export const MarkSignalDoneModalNoDeps = Hazel.component({
	name: "MarkSignalDoneModal",
	props: MarkSignalDoneProps,
	model: MarkSignalDoneModel,
	message: MarkSignalDoneMessage,
	events: ModalEvents,
}).make({
	init: () => ({ outcome: "contacted" as const, note: TextField.empty }),
	update: {
		PickedOutcome: ($, { selected }) => {
			const [outcome] = selected
			return isOutcome(outcome) ? $.evolve({ outcome }) : $.model
		},
		ChangedNote: ($, { payload }) => $.evolve({ note: (note) => TextField.changed(note, payload) }),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		PressedMarkDone: ($) => {
			const { session, signalId } = $.props
			if (session.organization === null || session.user === null) return $.emit(close)
			const organizationId = session.organization.id
			const userId = session.user.id
			return $.run(
				MarkSignalDone.make({
					organizationId,
					userId,
					signalId,
					outcome: $.model.outcome,
					note: $.model.note.text,
				}),
			).emit(close)
		},
	},
	view: (h, model) =>
		h.dialog
			.open(true)
			.title("Mark signal as done")
			.description("What happened? Outcomes feed signal quality reports.")
			.on("dismiss", MarkSignalDoneMessage.DismissedDialog())
			.actions(
				h.button
					.label("Cancel")
					.variant("outline")
					.on("press", MarkSignalDoneMessage.PressedCancel()),
				h.button
					.label("Mark done")
					.icon("check")
					.on("press", MarkSignalDoneMessage.PressedMarkDone()),
			)
			.children(
				h.frame.surface("muted").children(
					h.stack
						.axis("horizontal")
						.density("compact")
						.align("center")
						.children(
							companyLogo(h, {
								name: h.props.accountName,
								logoUrl: h.props.accountLogoUrl,
								size: "sm",
							}),
							h.stack
								.density("none")
								.children(
									h.text
										.strong()
										.truncate()
										.children(`${h.props.accountName} · ${h.props.title}`),
									h.text.role("caption").tone("muted").truncate().children(h.props.reason),
								),
							h.spacer,
							severityChip(h, h.props.severity),
						),
				),
				h.choiceGroup
					.label("Outcome")
					.style("cards")
					.columns("2")
					.options(
						SignalOutcome.literals.map((outcome) => ({
							value: outcome,
							label: OUTCOMES[outcome][0],
							description: OUTCOMES[outcome][1],
						})),
					)
					.selected([model.outcome])
					.on("change", ({ selected }) => MarkSignalDoneMessage.PickedOutcome({ selected })),
				h.textArea
					.label("Note")
					.description("Optional · saved to the customer timeline")
					.placeholder("What did you do?")
					.value(model.note)
					.on("change", (payload) => MarkSignalDoneMessage.ChangedNote({ payload })),
				h.banner
					.tone("info")
					.icon("refresh")
					.description(
						"Stays off the queue while this is true. If it clears and happens again, a new signal opens.",
					),
			),
})

export const MarkSignalDoneModal = MarkSignalDoneModalNoDeps.pipe(Component.provide(MarkSignalDone.layer))
