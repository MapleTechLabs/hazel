import { Duration, Effect, Equivalence, Option, Schema, Stream } from "effect"
import { Command, Dom, Subscription, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import { fieldStyles } from "~/components/ui/field.styles"
import { inputOtpStyles } from "~/components/ui/input-otp.styles"
import { IconMinus } from "../icons"

/**
 * Port of `components/ui/input-otp.tsx` and the `input-otp` library it wraps: a transparent input
 * over rendered slots. The library's selection tracking, focus-time selection, password manager badge
 * check and measured `--root-height` are reproduced so slots, caret and attributes match.
 */

// MODEL

const Selection = Schema.Struct({ start: Schema.Number, end: Schema.Number })

export const Model = Schema.Struct({
	id: Schema.String,
	maxLength: Schema.Number,
	value: Schema.String,
	isDisabled: Schema.Boolean,
	isFocused: Schema.Boolean,
	selection: Schema.NullOr(Selection),
	rootHeight: Schema.NullOr(Schema.Number),
	hasBadgeSpace: Schema.Boolean,
	hasPasswordBadge: Schema.Boolean,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	ChangedValue: { value: Schema.String },
	FocusedInput: {},
	BlurredInput: {},
	ChangedSelection: { selection: Schema.NullOr(Selection) },
	CompletedMeasureInput: { rootHeight: Schema.Number, hasBadgeSpace: Schema.Boolean },
	CompletedCheckPasswordBadge: { hasBadge: Schema.Boolean },
	CompletedInstallInputOtpStyle: {},
	CompletedSetSelection: {},
})
export type Message = typeof Message.Type

// COMMAND

const inputOf = (id: string) => Option.fromNullishOr(document.getElementById(id))
const containerOf = (input: Element) => Option.fromNullishOr(input.closest("[data-input-otp-container]"))

/** The library's injected stylesheet: transparent selection and autofill on the overlay input. */
const InstallInputOtpStyle = Command.define("InstallInputOtpStyle", {
	messages: [Message.CompletedInstallInputOtpStyle],
	execute: Effect.sync(() => {
		if (document.getElementById("input-otp-style") === null) {
			const style = document.createElement("style")
			style.id = "input-otp-style"
			document.head.appendChild(style)
			const hidden =
				"background: transparent !important; color: transparent !important; border-color: transparent !important; opacity: 0 !important; box-shadow: none !important; -webkit-box-shadow: none !important; -webkit-text-fill-color: transparent !important;"
			for (const rule of [
				"[data-input-otp]::selection { background: transparent !important; color: transparent !important; }",
				`[data-input-otp]:autofill { ${hidden} }`,
				`[data-input-otp]:-webkit-autofill { ${hidden} }`,
				"@supports (-webkit-touch-callout: none) { [data-input-otp] { letter-spacing: -.6em !important; font-weight: 100 !important; font-stretch: ultra-condensed; font-optical-sizing: none !important; left: -1px !important; right: 1px !important; } }",
				"[data-input-otp] + * { pointer-events: all !important; }",
			])
				style.sheet?.insertRule(rule)
		}
		return Message.CompletedInstallInputOtpStyle()
	}),
})

/** The mount-time measurements: the input's height (`--root-height`) and room for a badge. */
const MeasureInputOtp = Command.define("MeasureInputOtp", {
	args: { id: Schema.String },
	messages: [Message.CompletedMeasureInput],
	execute: ({ id }) =>
		Effect.promise(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		).pipe(
			Effect.map(() =>
				Option.match(inputOf(id), {
					onNone: () => Message.CompletedMeasureInput({ rootHeight: 0, hasBadgeSpace: false }),
					onSome: (input) =>
						Message.CompletedMeasureInput({
							rootHeight: input.clientHeight,
							hasBadgeSpace: Option.match(containerOf(input), {
								onNone: () => false,
								onSome: (container) =>
									window.innerWidth - container.getBoundingClientRect().right >= 40,
							}),
						}),
				}),
			),
		),
})

const passwordManagerSelectors = [
	"[data-lastpass-icon-root]",
	"com-1password-button",
	"[data-dashlanecreated]",
	'[style$="2147483647 !important;"]',
].join(",")

/** usePasswordManagerBadge: something other than the container at its right edge is a badge. */
export const CheckInputOtpPasswordBadge = Command.define("CheckInputOtpPasswordBadge", {
	args: { id: Schema.String, delayMillis: Schema.Number },
	messages: [Message.CompletedCheckPasswordBadge],
	execute: ({ id, delayMillis }) =>
		Effect.sleep(Duration.millis(delayMillis)).pipe(
			Effect.map(() =>
				Message.CompletedCheckPasswordBadge({
					hasBadge: Option.match(Option.flatMap(inputOf(id), containerOf), {
						onNone: () => false,
						onSome: (container) => {
							const rect = container.getBoundingClientRect()
							const right =
								rect.left +
								(container instanceof HTMLElement ? container.offsetWidth : rect.width)
							const middle =
								rect.top +
								(container instanceof HTMLElement ? container.offsetHeight : rect.height) / 2
							return !(
								document.querySelectorAll(passwordManagerSelectors).length === 0 &&
								document.elementFromPoint(right - 18, middle) === container
							)
						},
					}),
				}),
			),
		),
})

/** On focus the library selects from the last character (or the end). */
export const SetSelection = Command.define("SetSelection", {
	args: { id: Schema.String, start: Schema.Number, end: Schema.Number },
	messages: [Message.CompletedSetSelection],
	execute: ({ id, start, end }) =>
		Effect.sync(() => {
			const input = document.getElementById(id)
			if (input instanceof HTMLInputElement) input.setSelectionRange(start, end)
			return Message.CompletedSetSelection()
		}),
})

/** After a value or focus change the library re-reads the input's selection (its 0/10/50ms timers). */
export const ReadSelection = Command.define("ReadSelection", {
	args: { id: Schema.String },
	messages: [Message.ChangedSelection],
	execute: ({ id }) =>
		Effect.sleep(Duration.millis(50)).pipe(
			Effect.map(() => {
				const input = document.getElementById(id)
				return Message.ChangedSelection({
					selection:
						input instanceof HTMLInputElement &&
						input.selectionStart !== null &&
						input.selectionEnd !== null
							? { start: input.selectionStart, end: input.selectionEnd }
							: null,
				})
			}),
		),
})

// INIT

export const init = (options: {
	readonly id: string
	readonly maxLength: number
	readonly value?: string
	readonly isDisabled?: boolean
}): Update.Return<Model, Message> => ({
	model: {
		id: options.id,
		maxLength: options.maxLength,
		value: options.value ?? "",
		isDisabled: options.isDisabled ?? false,
		isFocused: false,
		selection: null,
		rootHeight: null,
		hasBadgeSpace: false,
		hasPasswordBadge: false,
	},
	commands: [
		InstallInputOtpStyle(),
		MeasureInputOtp({ id: options.id }),
		ReadSelection({ id: options.id }),
	],
})

// UPDATE

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		ChangedValue: ({ value }) => ({
			model: modifyFields(model, { value: () => value.slice(0, model.maxLength) }),
			commands: [ReadSelection({ id: model.id })],
		}),
		FocusedInput: () => {
			const start = Math.min(model.value.length, model.maxLength - 1)
			const end = model.value.length
			return {
				model: modifyFields(model, { isFocused: () => true, selection: () => ({ start, end }) }),
				commands: [
					SetSelection({ id: model.id, start, end }),
					ReadSelection({ id: model.id }),
					...[0, 2000, 5000].map((delayMillis) =>
						CheckInputOtpPasswordBadge({ id: model.id, delayMillis }),
					),
				],
			}
		},
		BlurredInput: () => ({
			model: modifyFields(model, { isFocused: () => false }),
			commands: [ReadSelection({ id: model.id })],
		}),
		ChangedSelection: ({ selection }) => ({ model: modifyFields(model, { selection: () => selection }) }),
		CompletedMeasureInput: ({ rootHeight, hasBadgeSpace }) => ({
			model: modifyFields(model, { rootHeight: () => rootHeight, hasBadgeSpace: () => hasBadgeSpace }),
		}),
		CompletedCheckPasswordBadge: ({ hasBadge }) => ({
			model: modifyFields(model, { hasPasswordBadge: (current) => current || hasBadge }),
		}),
		CompletedInstallInputOtpStyle: () => ({ model }),
		CompletedSetSelection: () => ({ model }),
	})

// SUBSCRIPTION

/**
 * The library's selectionchange handler: a collapsed caret inside the value becomes a one-character
 * selection (so typing replaces it), and any other focused element clears the selection.
 */
const selectionAfterChange = (
	id: string,
	maxLength: number,
	previous: { start: number; end: number } | null,
) => {
	const input = document.getElementById(id)
	if (!(input instanceof HTMLInputElement) || document.activeElement !== input) return null
	const start = input.selectionStart
	const end = input.selectionEnd
	const value = input.value
	let nextStart = -1
	let nextEnd = -1
	let direction: "forward" | "backward" | undefined
	if (value.length !== 0 && start !== null && end !== null) {
		const isCollapsed = start === end
		const isAtTypingEnd = start === value.length && value.length < maxLength
		if (isCollapsed && !isAtTypingEnd) {
			if (start === 0) {
				nextStart = 0
				nextEnd = 1
				direction = "forward"
			} else if (start === maxLength) {
				nextStart = start - 1
				nextEnd = start
				direction = "backward"
			} else if (maxLength > 1 && value.length > 1) {
				let offset = 0
				if (previous !== null) {
					direction = start < previous.end ? "backward" : "forward"
					const wasCollapsed = previous.start === previous.end && previous.start < maxLength
					if (direction === "backward" && !wasCollapsed) offset = -1
				}
				nextStart = offset + start
				nextEnd = offset + start + 1
			}
		}
		if (nextStart !== -1 && nextEnd !== -1 && nextStart !== nextEnd)
			input.setSelectionRange(nextStart, nextEnd, direction)
	}
	return {
		start: nextStart !== -1 ? nextStart : (start ?? 0),
		end: nextEnd !== -1 ? nextEnd : (end ?? 0),
	}
}

/**
 * Listens while focused, or until a selectionchange clears a selection left after blur, so the
 * rendered `data-input-otp-mss/mse` still match the library's always-on listener.
 */
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	selection: entry(
		{
			id: Schema.String,
			maxLength: Schema.Number,
			selection: Schema.NullOr(Selection),
			isTracking: Schema.Boolean,
		},
		{
			modelToDependencies: (model) => ({
				id: model.id,
				maxLength: model.maxLength,
				selection: model.selection,
				isTracking: model.isFocused || model.selection !== null,
			}),
			keepAliveEquivalence: Equivalence.make(
				(a, b) => a.id === b.id && a.maxLength === b.maxLength && a.isTracking === b.isTracking,
			),
			dependenciesToStream: ({ isTracking }, readDependencies) =>
				!isTracking
					? Stream.empty
					: Dom.streamFromEvent({
							target: document,
							type: "selectionchange",
							mapEvent: () => {
								const { id, maxLength, selection } = readDependencies()
								return Message.ChangedSelection({
									selection: selectionAfterChange(id, maxLength, selection),
								})
							},
							options: { capture: true },
						}),
		},
	),
}))

// VIEW

export interface InputOtpParts {
	readonly group: (children: Array<Html>, options?: { readonly className?: string }) => Html
	readonly slot: (index: number, options?: { readonly className?: string }) => Html
	readonly separator: () => Html
}

const inputStyle = (pushesBadge: boolean) =>
	[
		"position: absolute;",
		"inset: 0px;",
		pushesBadge ? "width: calc(100% + 40px);" : "width: 100%;",
		"height: 100%;",
		"display: flex;",
		"text-align: left;",
		"opacity: 1;",
		"color: transparent;",
		"pointer-events: all;",
		"background: transparent;",
		"caret-color: transparent;",
		"border: 0px solid transparent;",
		"outline: transparent solid 0px;",
		"box-shadow: none;",
		"line-height: 1;",
		"letter-spacing: -0.5em;",
		"font-size: var(--root-height);",
		"font-family: monospace;",
		"font-variant-numeric: tabular-nums;",
		...(pushesBadge ? ["clip-path: inset(0px 40px 0px 0px);"] : []),
	].join(" ")

export const inputOtp = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: {
		readonly model: Model
		readonly toParentMessage: (message: Message) => ParentMessage
		readonly ariaLabel?: string
		readonly className?: string
		readonly containerClassName?: string
	},
	render: (parts: InputOtpParts) => Array<Html>,
): Html => {
	const model = options.model
	const send = options.toParentMessage
	const selection = model.selection
	const parts: InputOtpParts = {
		group: (children, part = {}) =>
			h.span(
				[
					h.DataAttribute("slot", "input-otp-group"),
					h.Class(twMerge(inputOtpStyles.group, part.className)),
				],
				children,
			),
		slot: (index, part = {}) => {
			const char = model.value[index] ?? null
			const isActive =
				model.isFocused &&
				selection !== null &&
				((selection.start === selection.end && index === selection.start) ||
					(index >= selection.start && index < selection.end))
			return h.div(
				[
					h.DataAttribute("slot", "input-otp-slot"),
					h.DataAttribute("active", String(isActive)),
					h.Class(twMerge(inputOtpStyles.slot, part.className)),
				],
				[
					...(char === null ? [] : [char]),
					...(isActive && char === null
						? [
								h.div(
									[h.Class(inputOtpStyles.caret)],
									[h.div([h.Class(inputOtpStyles.caretBar)])],
								),
							]
						: []),
				],
			)
		},
		separator: () =>
			h.div(
				[h.DataAttribute("slot", "input-otp-separator")],
				[IconMinus(h, { className: inputOtpStyles.separatorIcon })],
			),
	}
	const containerStyle = `position: relative; cursor: ${model.isDisabled ? "default" : "text"}; user-select: none; pointer-events: none;${model.rootHeight === null ? "" : ` --root-height: ${model.rootHeight}px;`}`
	return h.span(
		[h.DataAttribute("slot", "control"), h.Class(inputOtpStyles.wrapper)],
		[
			h.div(
				[
					h.Class(twMerge(fieldStyles(), options.containerClassName)),
					h.DataAttribute("input-otp-container", "true"),
					h.Attribute("style", containerStyle),
				],
				[
					...render(parts),
					h.div(
						[h.Attribute("style", "position: absolute; inset: 0px; pointer-events: none;")],
						[
							h.input([
								h.Id(model.id),
								h.Class(twMerge(inputOtpStyles.input, options.className)),
								h.Attribute("autocomplete", "one-time-code"),
								h.DataAttribute("input-otp", "true"),
								h.DataAttribute("slot", "input-otp"),
								...(model.value.length === 0
									? [h.DataAttribute("input-otp-placeholder-shown", "true")]
									: []),
								...(selection === null
									? []
									: [
											h.DataAttribute("input-otp-mss", String(selection.start)),
											h.DataAttribute("input-otp-mse", String(selection.end)),
										]),
								...(options.ariaLabel === undefined ? [] : [h.AriaLabel(options.ariaLabel)]),
								h.Attribute("inputmode", "numeric"),
								h.Attribute("maxlength", String(model.maxLength)),
								// willPushPWMBadge: a detected badge keeps the overlay widened after blur too.
								h.Attribute(
									"style",
									inputStyle(model.hasPasswordBadge && model.hasBadgeSpace),
								),
								h.Value(model.value),
								...(model.isDisabled ? [h.Disabled(true)] : []),
								h.OnInput((value) => send(Message.ChangedValue({ value }))),
								h.OnFocus(send(Message.FocusedInput())),
								h.OnBlur(send(Message.BlurredInput())),
							]),
						],
					),
				],
			),
		],
	)
}
