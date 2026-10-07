import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Command, Mount, Subscription, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { portalOverlay, positionOverlay, restoreFocusTo, watchInteractOutside } from "./aria/overlay"
import * as Calendar from "./calendar"
import * as D from "./calendar-date"
import * as Segments from "./date-segments"

/**
 * Port of `components/ui/date-picker.tsx` (React Aria DatePicker with DatePickerTrigger and the
 * desktop popover overlay). The calendar's interaction Submodel also serves the trigger, the group
 * and the segments, so the whole picker shares one hover/press/focus state. View: `date-picker-view.ts`.
 */

// MODEL

export const Model = Schema.Struct({
	id: Schema.String,
	segments: Segments.Model,
	calendar: Calendar.Model,
	isOpen: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (config: {
	readonly id: string
	readonly today: D.CalendarDate
	readonly value?: D.CalendarDate
}): Model => ({
	id: config.id,
	segments: Segments.init({
		id: `${config.id}-input`,
		kind: "date",
		...(config.value === undefined ? {} : { value: config.value }),
	}),
	calendar: Calendar.init({
		id: `${config.id}-calendar`,
		today: config.today,
		...(config.value === undefined ? {} : { value: config.value }),
	}),
	isOpen: false,
})

// IDS

export const groupId = (id: string) => `${id}-group`
export const triggerId = (id: string) => `${id}-trigger`
export const labelId = (id: string) => `${id}-label`
export const descriptionId = (id: string) => `${id}-description`
export const popoverId = (id: string) => `${id}-popover`

// MESSAGE

export const Message = defineMessageUnion({
	ClickedTrigger: {},
	PressedEscape: {},
	PressedOutside: {},
	ClickedDismiss: {},
	GotSegmentsMessage: { message: Segments.Message },
	GotCalendarMessage: { message: Calendar.Message },
	CompletedPortalPicker: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	ChangedValue: { date: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// MOUNT

type PortalMessage = Extract<Message, { _tag: "CompletedPortalPicker" | "PressedOutside" }>

/** The modal popover, anchored to the group; focus goes to the calendar's focused day. */
export const PortalPicker = Mount.defineStream("PortalDatePicker", {
	args: { id: Schema.String },
	messages: [Message.CompletedPortalPicker, Message.PressedOutside],
	execute: ({ element, id }) =>
		Stream.callback<PortalMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const restoreFocus = restoreFocusTo(triggerId(id), element)
					const releasePortal = portalOverlay(element, { isModal: true })
					const popover = element.querySelector<HTMLElement>("[data-popover]")
					const releasePosition = popover
						? positionOverlay(popover, {
								triggerId: groupId(id),
								placement: "bottom",
								offset: 8,
								isTriggerWidthSet: true,
							})
						: () => undefined
					element
						.querySelector<HTMLElement>('[role=grid] [role=button][tabindex="0"]')
						?.focus({ preventScroll: true })
					const releaseOutside = watchInteractOutside(`#${CSS.escape(popoverId(id))}`, () =>
						Queue.offerUnsafe(queue, Message.PressedOutside()),
					)
					Queue.offerUnsafe(queue, Message.CompletedPortalPicker())
					return () => {
						releaseOutside()
						releasePosition()
						releasePortal()
						restoreFocus()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const closed = (model: Model): Model => modifyFields(model, { isOpen: () => false })

const value = (model: Model): Option.Option<D.CalendarDate> => Option.fromNullishOr(model.segments.committed)

export const update = (model: Model, message: Message): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		ClickedTrigger: () =>
			model.isOpen
				? { model: closed(model) }
				: {
						model: modifyFields(model, {
							isOpen: () => true,
							calendar: (calendar) => Calendar.showValue(calendar, value(model)),
						}),
					},
		PressedEscape: () => ({ model: closed(model) }),
		PressedOutside: () => ({ model: closed(model) }),
		ClickedDismiss: () => ({ model: closed(model) }),
		GotSegmentsMessage: ({ message }) => {
			const result = Segments.update(model.segments, message)
			const next = modifyFields(model, { segments: () => result.model })
			return {
				model: next,
				commands: Command.mapMessages(result.commands, (child) =>
					Message.GotSegmentsMessage({ message: child }),
				),
			}
		},
		GotCalendarMessage: ({ message }) => {
			const result = Calendar.update(model.calendar, message)
			const commands = Command.mapMessages(result.commands, (child) =>
				Message.GotCalendarMessage({ message: child }),
			)
			const next = modifyFields(model, { calendar: () => result.model })
			if (result.outMessage?._tag !== "ChangedValue") return { model: next, commands }
			const date = result.outMessage.date
			return {
				model: modifyFields(closed(next), {
					segments: (segments) => Segments.init({ id: segments.id, kind: "date", value: date }),
				}),
				commands,
				outMessage: OutMessage.ChangedValue({ date }),
			}
		},
		CompletedPortalPicker: () => ({ model }),
	})

// SUBSCRIPTION

export const subscriptions = Subscription.lift(Calendar.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.calendar),
	toParentMessage: (message) => Message.GotCalendarMessage({ message }),
})
