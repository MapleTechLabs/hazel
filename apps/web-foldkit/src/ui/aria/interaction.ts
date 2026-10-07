import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import type { HtmlBuilder, TextareaAttribute } from "foldkit/html"
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

const Focus = Schema.Struct({ target: Schema.String, isTextInput: Schema.Boolean })

export const Model = Schema.Struct({
	modality: Schema.NullOr(Modality),
	/** Nested targets hover together (an input inside a hovered group). */
	hovered: Schema.Array(Schema.String),
	focused: Schema.NullOr(Focus),
	/** Targets with focus inside them (useFocusWithin). */
	focusWithin: Schema.Array(Schema.String),
	/**
	 * useFocusVisibleListener's flag (modality is not pointer). Keyboard events while a text input
	 * is focused leave it alone unless the key is Tab or Escape (isKeyboardFocusEvent).
	 */
	isFocusVisible: Schema.Boolean,
	/** A key or pointer event happened since the last focus; otherwise a focus is virtual. */
	hasEventBeforeFocus: Schema.Boolean,
	press: Schema.NullOr(Press),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	modality: null,
	hovered: [],
	focused: null,
	focusWithin: [],
	isFocusVisible: true,
	hasEventBeforeFocus: false,
	press: null,
})

// MESSAGE

export const Message = defineMessageUnion({
	EnteredTarget: { target: Schema.String },
	LeftTarget: { target: Schema.String },
	PressedPointer: { target: Schema.String, pointerType: Schema.String, button: Schema.Number },
	ReleasedPointer: {},
	PressedKey: { target: Schema.String, key: Schema.String },
	ReleasedKey: { target: Schema.String, key: Schema.String },
	FocusedTarget: { target: Schema.String, isTextInput: Schema.Boolean },
	EnteredFocusWithin: { target: Schema.String },
	LeftFocusWithin: { target: Schema.String },
	BlurredTarget: { target: Schema.String },
	PressedDocumentKey: { key: Schema.String },
	ReleasedDocumentKey: { key: Schema.String },
	PressedDocumentPointer: {},
})
export type Message = typeof Message.Type

// UPDATE

/** usePress starts a keyboard press on Enter and Space only. */
const isPressKey = (key: string) => key === "Enter" || key === " "

/** handleKeyboardEvent: keyboard modality; the flag follows unless typing inside a text input. */
const receivedKey = (model: Model, key: string): Model =>
	modifyFields(model, {
		modality: () => "keyboard",
		hasEventBeforeFocus: () => true,
		isFocusVisible: (isFocusVisible) =>
			model.focused?.isTextInput && key !== "Tab" && key !== "Escape" ? isFocusVisible : true,
	})

export const update = (model: Model, message: Message): { model: Model } =>
	Message.match<{ model: Model }>(message, {
		EnteredTarget: ({ target }) => ({
			model: modifyFields(model, {
				hovered: (hovered) => (hovered.includes(target) ? hovered : [...hovered, target]),
				press: (press) => (press?.target === target ? { ...press, isInside: true } : press),
			}),
		}),
		LeftTarget: ({ target }) => ({
			model: modifyFields(model, {
				hovered: (hovered) => hovered.filter((hoveredTarget) => hoveredTarget !== target),
				press: (press) => (press?.target === target ? { ...press, isInside: false } : press),
			}),
		}),
		PressedPointer: ({ target, button }) => ({
			model:
				button === 0
					? modifyFields(model, {
							modality: () => "pointer",
							isFocusVisible: () => false,
							hasEventBeforeFocus: () => true,
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
		// Programmatic focus (no key or pointer event first) switches to virtual modality.
		FocusedTarget: ({ target, isTextInput }) => ({
			model: modifyFields(model, {
				focused: () => ({ target, isTextInput }),
				modality: (modality) => (model.hasEventBeforeFocus ? modality : "virtual"),
				isFocusVisible: (isFocusVisible) => (model.hasEventBeforeFocus ? isFocusVisible : true),
				hasEventBeforeFocus: () => false,
			}),
		}),
		EnteredFocusWithin: ({ target }) => ({
			model: modifyFields(model, {
				focusWithin: (focusWithin) =>
					focusWithin.includes(target) ? focusWithin : [...focusWithin, target],
			}),
		}),
		LeftFocusWithin: ({ target }) => ({
			model: modifyFields(model, {
				focusWithin: (focusWithin) => focusWithin.filter((withinTarget) => withinTarget !== target),
			}),
		}),
		BlurredTarget: ({ target }) => ({
			model: model.focused?.target === target ? modifyFields(model, { focused: () => null }) : model,
		}),
		PressedDocumentKey: ({ key }) => ({ model: receivedKey(model, key) }),
		// usePress ends a keyboard press on keyup anywhere, so a press survives focus moving away.
		ReleasedDocumentKey: ({ key }) => ({
			model: modifyFields(receivedKey(model, key), {
				press: (press) => (press?.source === "keyboard" && isPressKey(key) ? null : press),
			}),
		}),
		PressedDocumentPointer: () => ({
			model: modifyFields(model, {
				modality: () => "pointer",
				isFocusVisible: () => false,
				hasEventBeforeFocus: () => true,
			}),
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
		Stream.mergeAll(
			[
				Subscription.fromEventFilterMap({
					target: document,
					type: "keydown",
					filterMapEvent: (event) =>
						isModalityKey(event)
							? Option.some(Message.PressedDocumentKey({ key: event.key }))
							: Option.none(),
					options: { capture: true },
				}),
				Subscription.fromEventFilterMap({
					target: document,
					type: "keyup",
					filterMapEvent: (event) =>
						isModalityKey(event)
							? Option.some(Message.ReleasedDocumentKey({ key: event.key }))
							: Option.none(),
					options: { capture: true },
				}),
				Subscription.fromEvent({
					target: document,
					type: "pointerdown",
					mapEvent: () => Message.PressedDocumentPointer(),
					options: { capture: true },
				}),
			],
			{ concurrency: "unbounded" },
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

// GLOBAL MODALITY

/**
 * React Aria's module-level modality (useFocusVisible's `currentModality`), for code that reads it
 * synchronously at event time, such as Mounts. Views read the Submodel's `modality` instead.
 */
let globalModality: Modality | null = null
let isGlobalModalityTracked = false

export const trackGlobalModality = () => {
	if (isGlobalModalityTracked) return
	isGlobalModalityTracked = true
	const toKeyboard = (event: KeyboardEvent) => {
		if (isModalityKey(event) && !event.altKey) globalModality = "keyboard"
	}
	const toPointer = () => {
		globalModality = "pointer"
	}
	document.addEventListener("keydown", toKeyboard, true)
	document.addEventListener("keyup", toKeyboard, true)
	document.addEventListener("pointerdown", toPointer, true)
	document.addEventListener("pointerup", toPointer, true)
}

export const currentGlobalModality = (): Modality | null => globalModality

// VIEW

/** Every attribute here is valid on any element, textarea included (no innerHTML). */
type Attribute<Message> = TextareaAttribute<Message>

export interface State {
	readonly isHovered: boolean
	readonly isFocusWithin: boolean
	readonly isPressed: boolean
	readonly isFocused: boolean
	readonly isFocusVisible: boolean
}

export const idleState: State = {
	isHovered: false,
	isFocusWithin: false,
	isPressed: false,
	isFocused: false,
	isFocusVisible: false,
}

export const stateOf = (model: Model, target: string): State => {
	const isFocused = model.focused?.target === target
	const isFocusWithin = model.focusWithin.includes(target)
	return {
		isHovered: model.hovered.includes(target),
		isFocusWithin,
		isPressed: model.press?.target === target && model.press.isInside,
		isFocused,
		isFocusVisible: (isFocused || isFocusWithin) && model.isFocusVisible,
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
	/** useFocusWithin instead of useFocus (React Aria Group, CheckboxGroup, RadioGroup). */
	readonly isWithin?: boolean
	/** useFocusRing({ isTextInput }): typing in the field does not switch it to focus-visible. */
	readonly isTextInput?: boolean
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
		: options.isWithin
			? [
					h.OnFocusEnter(send(Message.EnteredFocusWithin({ target }))),
					h.OnFocusLeave(send(Message.LeftFocusWithin({ target }))),
				]
			: [
					h.OnFocus(
						send(Message.FocusedTarget({ target, isTextInput: options.isTextInput ?? false })),
					),
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
	...(state.isFocusWithin ? [h.DataAttribute("focus-within", "true")] : []),
	...(state.isFocused ? [h.DataAttribute("focused", "true")] : []),
	...(state.isFocusVisible ? [h.DataAttribute("focus-visible", "true")] : []),
]

/** usePress disables text selection on the target while a pointer press is held (`style="user-select: none;"`). */
export const pressStyleAttributes = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	target: string,
): ReadonlyArray<Attribute<ParentMessage>> =>
	model.press?.target === target && model.press.source === "pointer"
		? [h.Attribute("style", "user-select: none;")]
		: []

/** Everything a React Aria pressable writes for one target: `data-rac`, handlers and state. */
export const targetAttributes = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	wiring: Wiring<ParentMessage>,
	target: string,
	options: TargetOptions = {},
): ReadonlyArray<Attribute<ParentMessage>> => [
	h.DataAttribute("rac", ""),
	...handlers(h, wiring, target, options),
	...stateAttributes(h, stateOf(wiring.model, target)),
	...pressStyleAttributes(h, wiring.model, target),
]
