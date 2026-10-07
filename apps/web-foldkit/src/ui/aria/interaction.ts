import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import type { Attribute, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"

/**
 * React Aria's useHover, usePress and useFocusRing/useFocusVisible, as one Submodel.
 * Components read a target's state with `stateOf` and render it with the same
 * `data-hovered`/`data-pressed`/`data-focused`/`data-focus-visible` attributes React Aria
 * emits, so the shared `tailwindcss-react-aria-components` variants style both apps alike.
 * One Model serves a whole page: at most one target is hovered, pressed or focused at a time.
 */

// MODEL

/** useFocusVisible's global modality. `null` until the first interaction (counts as visible). */
export const Modality = Schema.Literals(["keyboard", "pointer", "virtual"])
export type Modality = typeof Modality.Type

const Press = Schema.Struct({
	target: Schema.String,
	source: Schema.Literals(["pointer", "keyboard"]),
	isInside: Schema.Boolean,
})

export const Model = Schema.Struct({
	modality: Schema.NullOr(Modality),
	hovered: Schema.NullOr(Schema.String),
	focused: Schema.NullOr(Schema.String),
	press: Schema.NullOr(Press),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ modality: null, hovered: null, focused: null, press: null })

// MESSAGE

export const Message = defineMessageUnion({
	EnteredTarget: { target: Schema.String },
	LeftTarget: { target: Schema.String },
	PressedPointer: { target: Schema.String, pointerType: Schema.String, button: Schema.Number },
	ReleasedPointer: {},
	PressedKey: { target: Schema.String, key: Schema.String },
	ReleasedKey: { target: Schema.String, key: Schema.String },
	FocusedTarget: { target: Schema.String },
	BlurredTarget: { target: Schema.String },
	ChangedModality: { modality: Modality },
})
export type Message = typeof Message.Type

// UPDATE

/** usePress starts a keyboard press on Enter and Space only. */
const isPressKey = (key: string) => key === "Enter" || key === " "

export const update = (model: Model, message: Message): { model: Model } =>
	Message.match<{ model: Model }>(message, {
		EnteredTarget: ({ target }) => ({
			model: modifyFields(model, {
				hovered: () => target,
				press: (press) => (press?.target === target ? { ...press, isInside: true } : press),
			}),
		}),
		LeftTarget: ({ target }) => ({
			model: modifyFields(model, {
				hovered: (hovered) => (hovered === target ? null : hovered),
				press: (press) => (press?.target === target ? { ...press, isInside: false } : press),
			}),
		}),
		PressedPointer: ({ target, button }) => ({
			model:
				button === 0
					? modifyFields(model, {
							modality: () => "pointer",
							press: () => ({ target, source: "pointer", isInside: true }),
						})
					: model,
		}),
		ReleasedPointer: () => ({
			model: model.press?.source === "pointer" ? modifyFields(model, { press: () => null }) : model,
		}),
		PressedKey: ({ target, key }) => ({
			model:
				isPressKey(key) && model.press === null
					? modifyFields(model, { press: () => ({ target, source: "keyboard", isInside: true }) })
					: model,
		}),
		ReleasedKey: ({ target, key }) => ({
			model:
				isPressKey(key) && model.press?.target === target
					? modifyFields(model, { press: () => null })
					: model,
		}),
		FocusedTarget: ({ target }) => ({
			model: modifyFields(model, {
				focused: () => target,
				modality: (modality) => modality ?? "virtual",
			}),
		}),
		BlurredTarget: ({ target }) => ({
			model: modifyFields(model, { focused: (focused) => (focused === target ? null : focused) }),
		}),
		ChangedModality: ({ modality }) => ({
			model: model.modality === modality ? model : modifyFields(model, { modality: () => modality }),
		}),
	})

// SUBSCRIPTION

/** useFocusVisible's isValidKey: modifier chords and bare modifiers don't switch to keyboard. */
const isModalityKey = (event: KeyboardEvent) =>
	!(
		event.metaKey ||
		event.ctrlKey ||
		event.key === "Control" ||
		event.key === "Shift" ||
		event.key === "Meta"
	)

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	modality: Subscription.persistent(
		Stream.merge(
			Subscription.fromEventFilterMap({
				target: document,
				type: "keydown",
				filterMapEvent: (event) =>
					isModalityKey(event)
						? Option.some(Message.ChangedModality({ modality: "keyboard" }))
						: Option.none(),
				options: { capture: true },
			}),
			Subscription.fromEvent({
				target: document,
				type: "pointerdown",
				mapEvent: () => Message.ChangedModality({ modality: "pointer" }),
				options: { capture: true },
			}),
		),
	),
	// usePress ends a pointer press on pointerup anywhere in the document.
	pointerRelease: entry(
		{ isPointerPressed: Schema.Boolean },
		{
			modelToDependencies: (model) => ({ isPointerPressed: model.press?.source === "pointer" }),
			dependenciesToStream: ({ isPointerPressed }) =>
				isPointerPressed
					? Subscription.fromEvent({
							target: document,
							type: "pointerup",
							mapEvent: () => Message.ReleasedPointer(),
							options: { capture: true },
						})
					: Stream.empty,
		},
	),
}))

// VIEW

export interface State {
	readonly isHovered: boolean
	readonly isPressed: boolean
	readonly isFocused: boolean
	readonly isFocusVisible: boolean
}

export const idleState: State = {
	isHovered: false,
	isPressed: false,
	isFocused: false,
	isFocusVisible: false,
}

export const stateOf = (model: Model, target: string): State => {
	const isFocused = model.focused === target
	return {
		isHovered: model.hovered === target,
		isPressed: model.press?.target === target && model.press.isInside,
		isFocused,
		isFocusVisible: isFocused && model.modality !== "pointer",
	}
}

/** How a component reaches the page's interaction Submodel. */
export interface Wiring<ParentMessage> {
	readonly model: Model
	readonly toParentMessage: (message: Message) => ParentMessage
}

export interface TargetOptions {
	/** Turns hover and press off (React Aria: isDisabled, and isPending for Button). */
	readonly isHoverDisabled?: boolean
	readonly isPressDisabled?: boolean
	readonly isFocusDisabled?: boolean
}

/** Event handlers that feed one target's state into the Submodel. */
export const handlers = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	wiring: Wiring<ParentMessage>,
	target: string,
	options: TargetOptions = {},
): ReadonlyArray<Attribute<ParentMessage>> => {
	const send = wiring.toParentMessage
	const hover = options.isHoverDisabled
		? []
		: [
				h.OnMouseEnter(send(Message.EnteredTarget({ target }))),
				h.OnPointerLeave(() => Option.some(send(Message.LeftTarget({ target })))),
			]
	const press = options.isPressDisabled
		? []
		: [
				h.OnPointerDown((pointerType, button) =>
					Option.some(send(Message.PressedPointer({ target, pointerType, button }))),
				),
				h.OnKeyDown((key) => send(Message.PressedKey({ target, key }))),
				h.OnKeyUp((key) => send(Message.ReleasedKey({ target, key }))),
			]
	const focus = options.isFocusDisabled
		? []
		: [
				h.OnFocus(send(Message.FocusedTarget({ target }))),
				h.OnBlur(send(Message.BlurredTarget({ target }))),
			]
	return [...hover, ...press, ...focus]
}

/** The state attributes React Aria components write (`data-hovered="true"` etc.). */
export const stateAttributes = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	state: State,
	options: { readonly includePress?: boolean } = {},
): ReadonlyArray<Attribute<ParentMessage>> => [
	...(state.isHovered ? [h.DataAttribute("hovered", "true")] : []),
	...(state.isPressed && options.includePress !== false ? [h.DataAttribute("pressed", "true")] : []),
	...(state.isFocused ? [h.DataAttribute("focused", "true")] : []),
	...(state.isFocusVisible ? [h.DataAttribute("focus-visible", "true")] : []),
]

/** usePress disables text selection on the target while a pointer press is held. */
export const isPointerPressing = (model: Model, target: string) =>
	model.press?.target === target && model.press.source === "pointer"
