import { Duration, Effect, Queue, Schema, Stream } from "effect"
import { Command, Mount, Submodel, type Update } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twJoin } from "tailwind-merge"
import {
	tooltipArrowBase,
	tooltipArrowDefault,
	tooltipArrowInverse,
	tooltipStyles,
} from "~/components/ui/tooltip.styles"
import { currentGlobalModality, trackGlobalModality } from "./aria/interaction"
import { portalOverlay, positionOverlay } from "./aria/overlay"
import type { Placement } from "./aria/position"

/** Port of `components/ui/tooltip.tsx` (React Aria TooltipTrigger + Tooltip). */

// MODEL

export const Model = Schema.Struct({
	id: Schema.String,
	isOpen: Schema.Boolean,
	isHovered: Schema.Boolean,
	isFocused: Schema.Boolean,
	/** Bumped on every show or hide request, so a stale delay never acts. */
	version: Schema.Number,
})
export type Model = typeof Model.Type

export const init = (id: string): Model => ({
	id,
	isOpen: false,
	isHovered: false,
	isFocused: false,
	version: 0,
})

// MESSAGE

export const Message = defineMessageUnion({
	HoveredTrigger: { isPointerModality: Schema.Boolean },
	UnhoveredTrigger: {},
	FocusedTrigger: { isFocusVisible: Schema.Boolean },
	BlurredTrigger: {},
	PressedTrigger: {},
	PressedEscape: {},
	CompletedWaitForShowDelay: { version: Schema.Number },
	CompletedWaitForHideDelay: { version: Schema.Number },
	CompletedTrackTrigger: {},
	CompletedPortalTooltip: {},
})
export type Message = typeof Message.Type

export const triggerId = (id: string) => `${id}-trigger`
export const tooltipId = (id: string) => `${id}-tooltip`

// COMMAND

/** useTooltipTriggerState defaults. */
const SHOW_DELAY = Duration.millis(1500)
const HIDE_DELAY = Duration.millis(500)

const WaitForShowDelay = Command.define("WaitForShowDelay", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForShowDelay],
	execute: ({ version }) =>
		Effect.sleep(SHOW_DELAY).pipe(Effect.as(Message.CompletedWaitForShowDelay({ version }))),
})

const WaitForHideDelay = Command.define("WaitForHideDelay", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForHideDelay],
	execute: ({ version }) =>
		Effect.sleep(HIDE_DELAY).pipe(Effect.as(Message.CompletedWaitForHideDelay({ version }))),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const requestShow = (model: Model, isFocus: boolean): UpdateReturn => {
	const version = model.version + 1
	const next = modifyFields(model, { version: () => version })
	if (model.isOpen || isFocus) return { model: modifyFields(next, { isOpen: () => true }) }
	return { model: next, commands: [WaitForShowDelay({ version })] }
}

const requestHide = (model: Model, isImmediate: boolean): UpdateReturn => {
	if (model.isHovered || model.isFocused) return { model }
	const version = model.version + 1
	const next = modifyFields(model, { version: () => version })
	if (isImmediate || !model.isOpen) return { model: modifyFields(next, { isOpen: () => false }) }
	return { model: next, commands: [WaitForHideDelay({ version })] }
}

const released = (model: Model): Model =>
	modifyFields(model, { isHovered: () => false, isFocused: () => false })

export const update = (model: Model, message: Message): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		HoveredTrigger: ({ isPointerModality }) =>
			requestShow(modifyFields(model, { isHovered: () => isPointerModality }), false),
		UnhoveredTrigger: () => requestHide(released(model), false),
		FocusedTrigger: ({ isFocusVisible }) =>
			isFocusVisible ? requestShow(modifyFields(model, { isFocused: () => true }), true) : { model },
		BlurredTrigger: () => requestHide(released(model), true),
		PressedTrigger: () => requestHide(released(model), true),
		PressedEscape: () => ({ model: modifyFields(model, { isOpen: () => false }) }),
		CompletedWaitForShowDelay: ({ version }) =>
			version === model.version && (model.isHovered || model.isFocused)
				? { model: modifyFields(model, { isOpen: () => true }) }
				: { model },
		CompletedWaitForHideDelay: ({ version }) =>
			version === model.version ? { model: modifyFields(model, { isOpen: () => false }) } : { model },
		CompletedTrackTrigger: () => ({ model }),
		CompletedPortalTooltip: () => ({ model }),
	})

// MOUNT

type TrackTriggerMessage = Exclude<
	Message,
	{
		_tag:
			| "CompletedWaitForShowDelay"
			| "CompletedWaitForHideDelay"
			| "CompletedPortalTooltip"
			| "PressedEscape"
	}
>

const TrackTrigger = Mount.defineStream("TrackTooltipTrigger", {
	messages: [
		Message.CompletedTrackTrigger,
		Message.HoveredTrigger,
		Message.UnhoveredTrigger,
		Message.FocusedTrigger,
		Message.BlurredTrigger,
		Message.PressedTrigger,
	],
	execute: ({ element }) =>
		Stream.callback<TrackTriggerMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					trackGlobalModality()
					const emit = (message: TrackTriggerMessage) => Queue.offerUnsafe(queue, message)
					const listeners: ReadonlyArray<readonly [string, (event: Event) => void]> = [
						[
							"pointerenter",
							(event) => {
								if (event instanceof PointerEvent && event.pointerType !== "touch")
									emit(
										Message.HoveredTrigger({
											isPointerModality: currentGlobalModality() === "pointer",
										}),
									)
							},
						],
						[
							"pointerleave",
							(event) => {
								if (event instanceof PointerEvent && event.pointerType !== "touch")
									emit(Message.UnhoveredTrigger())
							},
						],
						[
							"focus",
							() =>
								emit(
									Message.FocusedTrigger({
										isFocusVisible: currentGlobalModality() !== "pointer",
									}),
								),
						],
						["blur", () => emit(Message.BlurredTrigger())],
						["pointerdown", () => emit(Message.PressedTrigger())],
						["keydown", () => emit(Message.PressedTrigger())],
					]
					for (const [type, listener] of listeners) element.addEventListener(type, listener)
					emit(Message.CompletedTrackTrigger())
					return () => {
						for (const [type, listener] of listeners) element.removeEventListener(type, listener)
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

type PortalTooltipMessage = Extract<Message, { _tag: "CompletedPortalTooltip" | "PressedEscape" }>

const PortalTooltip = Mount.defineStream("PortalTooltip", {
	args: { id: Schema.String, placement: Schema.String, offset: Schema.Number },
	messages: [Message.CompletedPortalTooltip, Message.PressedEscape],
	execute: ({ element, id, placement, offset }) =>
		Stream.callback<PortalTooltipMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const releasePortal = portalOverlay(element, { isModal: false })
					const tooltip = element.firstElementChild
					const releasePosition =
						tooltip instanceof HTMLElement
							? positionOverlay(tooltip, {
									triggerId: triggerId(id),
									placement: placement as Placement,
									offset,
									arrowSelector: ":scope > .group",
								})
							: () => undefined
					const onKeyDown = (event: KeyboardEvent) => {
						if (event.key === "Escape") Queue.offerUnsafe(queue, Message.PressedEscape())
					}
					document.addEventListener("keydown", onKeyDown, true)
					Queue.offerUnsafe(queue, Message.CompletedPortalTooltip())
					return () => {
						document.removeEventListener("keydown", onKeyDown, true)
						releasePosition()
						releasePortal()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// VIEW

export type ViewInputs = Readonly<{
	/** Renders the trigger (TooltipTrigger child). Spread `attributes` on it and put `overlay` last. */
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	content: ReadonlyArray<Html | string>
	placement?: Placement
	offset?: number
	arrow?: boolean
	inverse?: boolean
	className?: string
}>

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const triggerAttributes = childAttributes([
		h.Id(triggerId(model.id)),
		h.OnMount(TrackTrigger()),
		...(model.isOpen ? [h.Attribute("aria-describedby", tooltipId(model.id))] : []),
	])
	return viewInputs.toTrigger(
		triggerAttributes,
		model.isOpen ? tooltipOverlay(model, viewInputs, h) : h.empty,
	)
})

const TOOLTIP_OFFSET = 10

const tooltipOverlay = (model: Model, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
	const inverse = viewInputs.inverse
	const arrow = viewInputs.arrow ?? true
	return h.div(
		[
			h.Attribute("data-overlay-container", "true"),
			h.OnMount(
				PortalTooltip({
					id: model.id,
					placement: viewInputs.placement ?? "top",
					offset: viewInputs.offset ?? TOOLTIP_OFFSET,
				}),
			),
		],
		[
			h.div(
				[
					h.Class(
						tooltipStyles({
							isEntering: false,
							isExiting: false,
							inverse,
							className: viewInputs.className,
						}),
					),
					h.Attribute("data-rac", ""),
					h.Id(tooltipId(model.id)),
					h.Role("tooltip"),
				],
				[
					...(arrow
						? [
								h.div(
									[h.Class("group"), h.Attribute("data-rac", "")],
									[
										h.svg(
											[
												h.Attribute("width", "12"),
												h.Attribute("height", "12"),
												h.Attribute("viewBox", "0 0 12 12"),
												h.Class(
													twJoin(
														tooltipArrowBase,
														inverse ? tooltipArrowInverse : tooltipArrowDefault,
													),
												),
											],
											[h.path([h.Attribute("d", "M0 0 L6 6 L12 0")])],
										),
									],
								),
							]
						: []),
					...viewInputs.content,
				],
			),
		],
	)
}
