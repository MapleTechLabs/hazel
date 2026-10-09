import { Effect, Number, Option, Schema, Stream } from "effect"
import { Command, Subscription, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import {
	sliderFillStyle,
	sliderFillStyles,
	sliderOutputStyles,
	sliderStyles,
	sliderThumbStyles,
	sliderTrackStyles,
} from "~/components/ui/slider.styles"
import * as Interaction from "./aria/interaction"
import * as Field from "./field"

/**
 * Port of `components/ui/slider.tsx` (React Aria Slider). Values and the dragged thumb live in this
 * Submodel; the view renders in the parent's builder. Like the legacy SliderTrack default, the track
 * renders one thumb (index 0) even when the value is a range.
 */

// MODEL

export const Orientation = Schema.Literals(["horizontal", "vertical"])
export type Orientation = typeof Orientation.Type

export const Model = Schema.Struct({
	id: Schema.String,
	values: Schema.Array(Schema.Number),
	minValue: Schema.Number,
	maxValue: Schema.Number,
	step: Schema.Number,
	orientation: Orientation,
	isDisabled: Schema.Boolean,
	dragging: Schema.NullOr(Schema.Number),
})
export type Model = typeof Model.Type

export const init = (options: {
	readonly id: string
	readonly values: ReadonlyArray<number>
	readonly minValue?: number
	readonly maxValue?: number
	readonly step?: number
	readonly orientation?: Orientation
	readonly isDisabled?: boolean
}): Model => ({
	id: options.id,
	values: options.values,
	minValue: options.minValue ?? 0,
	maxValue: options.maxValue ?? 100,
	step: options.step ?? 1,
	orientation: options.orientation ?? "horizontal",
	isDisabled: options.isDisabled ?? false,
	dragging: null,
})

// MESSAGE

export const Message = defineMessageUnion({
	ChangedThumbInput: { index: Schema.Number, value: Schema.String },
	PressedThumbKey: { index: Schema.Number, key: Schema.String },
	PressedTrack: { value: Schema.Number, inputPrefix: Schema.String },
	MovedDragPointer: { value: Schema.Number },
	ReleasedDragPointer: {},
	CompletedFocusThumb: {},
})
export type Message = typeof Message.Type

// UPDATE

export const thumbMin = (model: Model, index: number) => model.values[index - 1] ?? model.minValue
export const thumbMax = (model: Model, index: number) => model.values[index + 1] ?? model.maxValue
const pageSize = (model: Model) => Math.max((model.maxValue - model.minValue) / 10, model.step)

/** @react-stately/utils roundToStepPrecision: drop float noise below the step's precision. */
const roundToStepPrecision = (value: number, step: number) => {
	const stepString = step.toString()
	const eIndex = stepString.toLowerCase().indexOf("e-")
	const pointIndex = stepString.indexOf(".")
	const precision =
		eIndex > 0
			? Math.abs(Math.floor(Math.log10(Math.abs(step)))) + eIndex
			: pointIndex >= 0
				? stepString.length - pointIndex
				: 0
	const pow = 10 ** precision
	return precision > 0 ? Math.round(value * pow) / pow : value
}

/** useSliderState: clamp to the thumb's neighbours and snap to the step. */
const setThumbValue = (model: Model, index: number, value: number): Model => {
	const snapped = roundToStepPrecision(
		Math.round((value - model.minValue) / model.step) * model.step + model.minValue,
		model.step,
	)
	const next = Number.clamp(snapped, { minimum: thumbMin(model, index), maximum: thumbMax(model, index) })
	return modifyFields(model, {
		values: (values) => values.map((current, i) => (i === index ? next : current)),
	})
}

/** useSlider's onDownTrack: the closest thumb moves (ties go to the later one when it is ahead). */
const closestThumb = (model: Model, value: number) => {
	const index = model.values.findIndex((thumbValue) => value - thumbValue < 0)
	if (index === 0) return 0
	if (index === -1) return model.values.length - 1
	const before = model.values[index - 1] ?? 0
	const after = model.values[index] ?? 0
	return Math.abs(before - value) < Math.abs(after - value) ? index - 1 : index
}

// COMMAND

/** useSliderThumb focuses the thumb input when a track press selects it. */
export const FocusSliderThumb = Command.define("FocusSliderThumb", {
	args: { inputId: Schema.String },
	messages: [Message.CompletedFocusThumb],
	execute: ({ inputId }) =>
		Dom.focus(`#${CSS.escape(inputId)}`, { preventScroll: true }).pipe(
			Effect.ignore,
			Effect.as(Message.CompletedFocusThumb()),
		),
})

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		ChangedThumbInput: ({ index, value }) => ({
			model: setThumbValue(model, index, globalThis.Number.parseFloat(value)),
		}),
		PressedThumbKey: ({ index, key }) => {
			const current = model.values[index] ?? model.minValue
			const target =
				key === "PageUp"
					? current + pageSize(model)
					: key === "PageDown"
						? current - pageSize(model)
						: key === "Home"
							? thumbMin(model, index)
							: thumbMax(model, index)
			return { model: setThumbValue(model, index, target) }
		},
		PressedTrack: ({ value, inputPrefix }) => {
			const index = closestThumb(model, value)
			return {
				model: modifyFields(setThumbValue(model, index, value), { dragging: () => index }),
				commands: [FocusSliderThumb({ inputId: `${inputPrefix}-${index}` })],
			}
		},
		MovedDragPointer: ({ value }) => ({
			model: model.dragging === null ? model : setThumbValue(model, model.dragging, value),
		}),
		ReleasedDragPointer: () => ({ model: modifyFields(model, { dragging: () => null }) }),
		CompletedFocusThumb: () => ({ model }),
	})

// SUBSCRIPTION

const trackOf = (id: string) => Option.fromNullishOr(document.getElementById(`${id}-track`))

/** Pointer position to value along the track, read from the live track element. */
interface Axis {
	readonly orientation: Orientation
	readonly minValue: number
	readonly maxValue: number
}

export const valueFromPointer = (model: Axis, track: Element, clientX: number, clientY: number) => {
	const rect = track.getBoundingClientRect()
	const fraction =
		model.orientation === "horizontal"
			? (clientX - rect.left) / (rect.width || 1)
			: (rect.bottom - clientY) / (rect.height || 1)
	return (
		model.minValue + Number.clamp(fraction, { minimum: 0, maximum: 1 }) * (model.maxValue - model.minValue)
	)
}

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	drag: entry(
		{
			isDragging: Schema.Boolean,
			id: Schema.String,
			orientation: Orientation,
			minValue: Schema.Number,
			maxValue: Schema.Number,
		},
		{
			modelToDependencies: (model) => ({
				isDragging: model.dragging !== null,
				id: model.id,
				orientation: model.orientation,
				minValue: model.minValue,
				maxValue: model.maxValue,
			}),
			dependenciesToStream: (dependencies) =>
				dependencies.isDragging
					? Stream.merge(
							Dom.streamFromEventFilterMap({
								target: document,
								type: "pointermove",
								filterMapEvent: (event) =>
									Option.map(trackOf(dependencies.id), (track) =>
										Message.MovedDragPointer({
											value: valueFromPointer(
												dependencies,
												track,
												event.clientX,
												event.clientY,
											),
										}),
									),
							}),
							Dom.streamFromEvent({
								target: document,
								type: "pointerup",
								mapEvent: () => Message.ReleasedDragPointer(),
							}),
						)
					: Stream.empty,
		},
	),
}))

// VIEW

export interface SliderViewOptions<ParentMessage> {
	readonly model: Model
	readonly toParentMessage: (message: Message) => ParentMessage
	/** Without a visible Label, React Aria labels the group with this and the thumb by the group. */
	readonly ariaLabel?: string
	readonly className?: string
	readonly interaction?: Interaction.Wiring<ParentMessage>
}

export interface SliderParts {
	readonly label: (children: Array<Html | string>) => Html
	/** `className` is merged as `cx(sliderOutputStyles, className)`; `format` is the render-prop text. */
	readonly output: (options?: {
		readonly className?: string
		readonly format?: (values: ReadonlyArray<number>) => string
	}) => Html
	readonly track: () => Html
}

const percentOf = (model: Model, value: number) =>
	((value - model.minValue) / (model.maxValue - model.minValue)) * 100

export const slider = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: SliderViewOptions<ParentMessage>,
	render: (parts: SliderParts) => Array<Html>,
): Html => {
	const model = options.model
	const send = options.toParentMessage
	const interaction = options.interaction
	const ids = { group: model.id, label: `${model.id}-label`, track: `${model.id}-track` }
	// React Aria names thumb inputs after the label id (or the group id without a label).
	const labelledBy = options.ariaLabel === undefined ? ids.label : ids.group
	const thumbId = (index: number) => `${labelledBy}-${index}`
	// Set when `render` draws the Label. Without one React Aria leaves the group unnamed and names
	// the thumb after the group. `parts.label` comes before `parts.track` in every render.
	let hasLabel = false
	const thumbLabelledBy = () => (options.ariaLabel === undefined && hasLabel ? ids.label : ids.group)
	const orientationAttribute = h.DataAttribute("orientation", model.orientation)
	const disabledAttributes = model.isDisabled ? [h.DataAttribute("disabled", "true")] : []
	const target = (part: string) => `${model.id}-${part}`

	const thumb = (index: number) => {
		const value = model.values[index] ?? model.minValue
		const state = interaction
			? Interaction.stateOf(interaction.model, target(`thumb-${index}`))
			: Interaction.idleState
		const percent = percentOf(model, value)
		const position = model.orientation === "horizontal" ? `left: ${percent}%;` : `top: ${100 - percent}%;`
		return h.div(
			[
				h.Class(twMerge(twMerge(sliderThumbStyles))),
				h.DataAttribute("rac", ""),
				h.Attribute(
					"style",
					`position: absolute; ${position} transform: translate(-50%, -50%); touch-action: none;`,
				),
				...disabledAttributes,
				...(model.dragging === index ? [h.DataAttribute("dragging", "true")] : []),
				...(interaction
					? [
							...Interaction.handlers(h, interaction, target(`thumb-${index}`), {
								isHoverDisabled: model.isDisabled,
								isPressDisabled: true,
								isFocusDisabled: true,
							}),
							...Interaction.stateAttributes(h, state),
						]
					: []),
			],
			[
				h.div(
					[
						h.Attribute(
							"style",
							"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;",
						),
					],
					[
						h.input([
							h.Id(thumbId(index)),
							h.Type("range"),
							h.Attribute("aria-describedby", ""),
							h.Attribute("aria-details", ""),
							h.AriaLabelledBy(thumbLabelledBy()),
							h.AriaOrientation(model.orientation),
							h.Attribute("aria-valuetext", String(value)),
							h.Min(String(thumbMin(model, index))),
							h.Max(String(thumbMax(model, index))),
							h.Step(String(model.step)),
							h.Attribute("style", ""),
							h.Tabindex(0),
							...(model.isDisabled ? [h.Disabled(true)] : []),
							h.Value(String(value)),
							h.OnInput((next) => send(Message.ChangedThumbInput({ index, value: next }))),
							h.OnKeyDownPreventDefault((key) =>
								/^(PageUp|PageDown|Home|End)$/.test(key)
									? Option.some(send(Message.PressedThumbKey({ index, key })))
									: Option.none(),
							),
							...(interaction
								? Interaction.handlers(h, interaction, target(`thumb-${index}`), {
										isHoverDisabled: true,
										isPressDisabled: true,
										isFocusDisabled: model.isDisabled,
									})
								: []),
						]),
					],
				),
			],
		)
	}

	const parts: SliderParts = {
		label: (children) => {
			hasLabel = true
			return Field.label(h, { id: ids.label }, children)
		},
		output: (outputOptions = {}) =>
			h.output(
				[
					h.Class(twMerge(twMerge(sliderOutputStyles), outputOptions.className)),
					h.AriaLive("off"),
					h.DataAttribute("rac", ""),
					orientationAttribute,
					...disabledAttributes,
					h.For(model.values.map((_, index) => thumbId(index)).join(" ")),
				],
				[outputOptions.format ? outputOptions.format(model.values) : String(model.values[0] ?? "")],
			),
		track: () => {
			const state = interaction
				? Interaction.stateOf(interaction.model, target("track"))
				: Interaction.idleState
			return h.div(
				[
					h.Id(ids.track),
					h.Class(twMerge(twMerge(...sliderTrackStyles))),
					h.DataAttribute("rac", ""),
					orientationAttribute,
					...disabledAttributes,
					h.Attribute("style", "position: relative; touch-action: none;"),
					...(interaction
						? [
								...Interaction.handlers(h, interaction, target("track"), {
									isPressDisabled: true,
									isFocusDisabled: true,
								}),
								...Interaction.stateAttributes(h, state),
							]
						: []),
					...(model.isDisabled
						? []
						: [
								h.OnPointerDown(
									(
										_pointerType,
										button,
										_screenX,
										_screenY,
										_timeStamp,
										clientX,
										clientY,
									) =>
										button === 0
											? Option.map(trackOf(model.id), (track) =>
													send(
														Message.PressedTrack({
															value: valueFromPointer(
																model,
																track,
																clientX,
																clientY,
															),
															inputPrefix: labelledBy,
														}),
													),
												)
											: Option.none(),
								),
							]),
				],
				[
					h.div([
						h.Class(twMerge(sliderFillStyles)),
						h.Attribute(
							"style",
							Object.entries(
								sliderFillStyle(
									model.orientation,
									model.values.map((value) => percentOf(model, value)),
								),
							)
								.map(([property, value]) => `${property}: ${value};`)
								.join(" "),
						),
					]),
					thumb(0),
				],
			)
		},
	}

	const children = render(parts)
	return h.div(
		[
			h.Class(twMerge(twMerge(...sliderStyles), options.className)),
			h.DataAttribute("rac", ""),
			h.DataAttribute("slot", "control"),
			orientationAttribute,
			h.Role("group"),
			h.Id(ids.group),
			...(options.ariaLabel !== undefined
				? [h.AriaLabel(options.ariaLabel)]
				: hasLabel
					? [h.AriaLabelledBy(ids.label)]
					: []),
			...disabledAttributes,
		],
		children,
	)
}
