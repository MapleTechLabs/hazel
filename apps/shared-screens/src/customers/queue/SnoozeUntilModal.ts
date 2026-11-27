// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * "Pick date..." from the snooze menu (the deleted Foldkit `snoozeDateDialog`): the day the signal comes
 * back, at 9:00 local, or sooner if it gets worse. Optimistic, like the menu's own snoozes.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { CustomerSignalId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { Session } from "../../app/session"
import { errorToast, ModalEvents, toast } from "../../modals/feedback"
import { modalServices } from "../../modals/services"
import { makeCustomerActions } from "../data/actions"
import { failureCopy, failureOf } from "./actions"
import { localDateOf, pickedSnoozeMs } from "./menus"

export const SnoozeUntilProps = Schema.Struct({
	/** The page's session: the org and the user who acts. */
	session: Session,
	signalId: CustomerSignalId,
	title: Schema.String,
	nowMs: Schema.Finite,
})
export type SnoozeUntilProps = typeof SnoozeUntilProps.Type

export const SnoozeUntilModel = Schema.Struct({ date: Schema.NullOr(Schema.String) })
export type SnoozeUntilModel = typeof SnoozeUntilModel.Type

export const SnoozeUntilMessage = UiSchema.TaggedEnum({
	ChangedDate: { value: Schema.NullOr(Schema.String) },
	PressedCancel: {},
	DismissedDialog: {},
	PressedSnooze: {},
})
export type SnoozeUntilMessage = typeof SnoozeUntilMessage.Type

/** Snoozes the signal until `untilMs`; a failure toasts after the dialog closed. */
export class SnoozeSignalUntil extends Command.Service<SnoozeSignalUntil>()(
	"hazel/customers/SnoozeSignalUntil",
	{
		args: {
			organizationId: OrganizationId,
			userId: UserId,
			signalId: CustomerSignalId,
			untilMs: Schema.Finite,
		},
		success: Component.Noop,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { snoozeSignalAction } = makeCustomerActions(data)
			return ({ untilMs, ...args }) =>
				run(
					snoozeSignalAction({ ...args, until: new Date(untilMs) }).pipe(
						Effect.asVoid,
						// BOUNDARY: every failure reads as its named or common reason.
						Effect.catchCause((cause) =>
							toast(errorToast(failureCopy("snooze", failureOf(cause.reasons[0])))),
						),
						Effect.as(Component.noop),
					),
				)
		}),
	)
}

const close = ModalEvents.RequestedClose()

const untilOf = (model: SnoozeUntilModel, nowMs: number) =>
	model.date === null ? null : pickedSnoozeMs(model.date, nowMs)

export const SnoozeUntilModalNoDeps = Hazel.component({
	name: "SnoozeUntilModal",
	props: SnoozeUntilProps,
	model: SnoozeUntilModel,
	message: SnoozeUntilMessage,
	events: ModalEvents,
}).make({
	init: ({ props }) => ({ date: localDateOf(props.nowMs, 1) }),
	update: {
		ChangedDate: ($, { value }) => $.evolve({ date: value }),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		PressedSnooze: ($) => {
			const untilMs = untilOf($.model, $.props.nowMs)
			if (untilMs === null) return $.model
			const { session, signalId } = $.props
			if (session.organization === null || session.user === null) return $.emit(close)
			const organizationId = session.organization.id
			const userId = session.user.id
			return $.run(SnoozeSignalUntil.make({ organizationId, userId, signalId, untilMs })).emit(close)
		},
	},
	view: (h, model) => {
		const isValid = untilOf(model, h.props.nowMs) !== null
		return h.dialog
			.open(true)
			.title("Snooze until")
			.description(`${h.props.title}: back in the queue at 9:00 that day, or sooner if it gets worse.`)
			.on("dismiss", SnoozeUntilMessage.DismissedDialog())
			.actions(
				h.button.label("Cancel").variant("outline").on("press", SnoozeUntilMessage.PressedCancel()),
				h.button.label("Snooze").disabled(!isValid).on("press", SnoozeUntilMessage.PressedSnooze()),
			)
			.children(
				h.datePicker
					.label("Snooze until")
					.value(model.date ?? undefined)
					.min(localDateOf(h.props.nowMs, 1))
					.error(isValid ? undefined : "Pick a day after today.")
					.on("change", ({ value }) => SnoozeUntilMessage.ChangedDate({ value })),
			)
	},
})

export const SnoozeUntilModal = SnoozeUntilModalNoDeps.pipe(Component.provide(SnoozeSignalUntil.layer))
