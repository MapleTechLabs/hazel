import { MessageId } from "@hazel/schema"
import { Duration, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import type { Placement } from "../ui/aria/placement"
import * as Tooltip from "../ui/tooltip"

/**
 * One tooltip shared by many triggers (reactions, status emoji, toolbar buttons). Only one can be
 * open, so the host keeps a single kit Tooltip Model whose id is the trigger's key.
 */

export const Model = Schema.NullOr(Tooltip.Model)
export type Model = typeof Model.Type

export const Message = Schema.Struct({
	key: Schema.String,
	/** The message the trigger renders in (which row owns the open tooltip). */
	messageId: MessageId,
	delayMs: Schema.Number,
	message: Tooltip.Message,
})
export type Message = typeof Message.Type

/**
 * Messages that move the host to a new trigger; the rest only apply to the current one. A press
 * moves it too, so the focus that follows a mouse press finds the press and keeps the tooltip shut.
 */
const isActivating = (message: Tooltip.Message) =>
	message._tag === "EnteredTrigger" ||
	message._tag === "FocusedTrigger" ||
	message._tag === "PressedPointerOnTrigger"

export const update = <Wrapped>(
	model: Model,
	{ key, messageId, delayMs, message }: Message,
	wrap: (message: Message) => Wrapped,
): Update.Return<Model, Wrapped> => {
	const current =
		model !== null && model.id === key ? model : isActivating(message) ? Tooltip.init(key, delayMs) : null
	if (current === null) return { model }
	const result = Tooltip.update(current, message)
	return {
		model: result.model,
		commands: Command.mapMessages(
			Command.mapMessages(result.commands ?? [], (inner): Message => ({
				key,
				messageId,
				delayMs,
				message: inner,
			})),
			wrap,
		),
	}
}

const closedModels = new Map<string, Tooltip.Model>()
const closedModel = (key: string, delayMs: number) => {
	let model = closedModels.get(key)
	if (model === undefined || Duration.toMillis(model.showDelay) !== delayMs)
		closedModels.set(key, (model = Tooltip.init(key, delayMs)))
	return model
}

export interface TriggerOptions<M> {
	readonly key: string
	readonly messageId: MessageId
	readonly active: Model
	/** The trigger under the pointer: React Aria's `data-hovered` on the TooltipTrigger. */
	readonly hoveredKey?: string | null
	readonly delayMs?: number
	readonly toMessage: (message: Message) => M
	readonly toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	readonly content: ReadonlyArray<Html | string>
	readonly placement?: Placement
	readonly className?: string
}

/** A kit tooltip trigger whose Model is the host's when it is the active key, closed otherwise. */
export const tooltipTrigger = <M>(h: HtmlBuilder<M>, options: TriggerOptions<M>): Html => {
	const delayMs = options.delayMs ?? 1500
	const model =
		options.active !== null && options.active.id === options.key
			? options.active
			: closedModel(options.key, delayMs)
	return h.submodel({
		slotId: `tooltip-${options.key}`,
		model,
		view: Tooltip.view,
		viewInputs: {
			toTrigger:
				options.hoveredKey === options.key
					? (attributes, overlay) =>
							options.toTrigger(
								[...attributes, ...childAttributes([h.Attribute("data-hovered", "true")])],
								overlay,
							)
					: options.toTrigger,
			content: model.isOpen ? options.content : [],
			placement: options.placement,
			className: options.className,
		},
		toParentMessage: (message: Tooltip.Message) =>
			options.toMessage({ key: options.key, messageId: options.messageId, delayMs, message }),
	})
}
