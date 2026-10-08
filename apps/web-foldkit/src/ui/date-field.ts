import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin, twMerge } from "tailwind-merge"
import {
	dateFieldClassName,
	dateInputControlStyles,
	dateInputStyles,
	dateSegmentStyles,
} from "~/components/ui/date-field.styles"
import { fieldStyles } from "~/components/ui/field.styles"
import * as Interaction from "./aria/interaction"
import * as Segments from "./date-segments"
import * as Field from "./field"

/**
 * Port of `components/ui/date-field.tsx` (DateField, DateInput) and `time-field.tsx`. Segments are
 * contenteditable spinbuttons; their editing state is the `date-segments` Submodel. React Aria's
 * "Selected Date/Time" description is rendered as a hidden sibling instead of at the end of <body>.
 */
export interface DateFieldOptions<ParentMessage> {
	readonly model: Segments.Model
	readonly toParentMessage: (message: Segments.Message) => ParentMessage
	readonly className?: string
	readonly interaction?: Interaction.Wiring<ParentMessage>
}

export interface DateFieldParts {
	readonly label: (children: Array<Html | string>) => Html
	readonly description: (children: Array<Html | string>) => Html
	readonly fieldError: (children: Array<Html | string>) => Html
	readonly dateInput: (options?: { readonly className?: string }) => Html
}

export const hiddenInputStyle =
	"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: fixed; width: 1px; white-space: nowrap; top: 0px; left: 0px;"

const fieldName = (type: Segments.SegmentType) =>
	new Intl.DisplayNames(navigator.language, { type: "dateTimeField" }).of(
		type === "dayPeriod" ? "dayPeriod" : type,
	) ?? type

/** useDateSegment's name: the field's aria-label after a comma, a trailing comma when labelled by an element. */
const segmentName = (name: string, ariaLabel: string | undefined, labelledBy: string | undefined) =>
	`${name}${ariaLabel ? `, ${ariaLabel}` : ""}${labelledBy === undefined ? "" : ", "}`

/** useDatePickerGroup's description of the committed value. */
export const selectedDescription = (model: Segments.Model) => {
	if (model.committed === null) return null
	const date = Segments.dateValueOf(model)
	return model.kind === "date"
		? `Selected Date: ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "long", timeZone: "UTC" }).format(date)}`
		: `Selected Time: ${new Intl.DateTimeFormat(navigator.language, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(date)}`
}

/** The DateInput's segments: contenteditable spinbuttons plus aria-hidden literals. */
export const dateSegments = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: {
		readonly model: Segments.Model
		readonly toParentMessage: (message: Segments.Message) => ParentMessage
		readonly interaction?: Interaction.Wiring<ParentMessage> | undefined
		/** The field's label id; segments are then labelled by themselves and it. */
		readonly labelledBy?: string | undefined
		/** On the first editable segment only. */
		readonly describedBy?: string | undefined
		/** Appended to each segment's name (`"month, " + ariaLabel`), as an aria-label on the field does. */
		readonly ariaLabel?: string | undefined
	},
): Array<Html> => {
	const { model, interaction, describedBy } = options
	const send = options.toParentMessage
	const statusAttributes = [
		...(model.isDisabled ? [h.DataAttribute("disabled", "true")] : []),
		...(model.isInvalid ? [h.DataAttribute("invalid", "true")] : []),
	]
	const segment = (part: Segments.Segment, isFirstEditable: boolean) => {
		if (part.type === "literal")
			return h.span(
				[
					h.AriaHidden(true),
					h.Class(twJoin(...dateSegmentStyles)),
					h.DataAttribute("rac", ""),
					h.DataAttribute("type", "literal"),
					...statusAttributes,
				],
				[part.text],
			)
		const type = part.type
		const id = Segments.segmentId(model, type)
		const limits = Segments.segmentLimits(model, type)
		const state = interaction ? Interaction.stateOf(interaction.model, id) : Interaction.idleState
		return h.span(
			[
				h.Id(id),
				h.Class(twJoin(...dateSegmentStyles)),
				h.Role("spinbutton"),
				h.DataAttribute("rac", ""),
				h.DataAttribute("type", type),
				...statusAttributes,
				...(part.isPlaceholder ? [h.DataAttribute("placeholder", "true")] : []),
				h.AriaLabel(segmentName(fieldName(type), options.ariaLabel, options.labelledBy)),
				...(options.labelledBy === undefined
					? []
					: [h.AriaLabelledBy(`${id} ${options.labelledBy}`)]),
				...(isFirstEditable && describedBy !== undefined ? [h.AriaDescribedBy(describedBy)] : []),
				...(model.isInvalid ? [h.AriaInvalid(true)] : []),
				h.Attribute("aria-valuemin", String(limits.min)),
				h.Attribute("aria-valuemax", String(limits.max)),
				...(part.value === null ? [] : [h.Attribute("aria-valuenow", String(part.value))]),
				h.Attribute("aria-valuetext", part.valueText),
				h.Attribute("style", "caret-color: transparent;"),
				...(model.isDisabled
					? [h.AriaDisabled(true), h.Attribute("contenteditable", "false")]
					: [
							h.Attribute("contenteditable", "true"),
							h.Attribute("autocorrect", "off"),
							h.Attribute("spellcheck", "false"),
							h.Attribute("enterkeyhint", "next"),
							...(type === "dayPeriod" ? [] : [h.Attribute("inputmode", "numeric")]),
							h.Tabindex(0),
							h.OnKeyDownPreventDefault((key) =>
								Segments.isSegmentKey(key)
									? Option.some(
											send(Segments.Message.PressedSegmentKey({ segment: type, key })),
										)
									: Option.none(),
							),
							...(interaction
								? [
										...Interaction.handlers(h, interaction, id, {
											isPressDisabled: true,
											isTextInput: true,
										}),
										...Interaction.stateAttributes(h, state),
									]
								: []),
						]),
			],
			[part.text],
		)
	}
	const segments = Segments.segmentsOf(model)
	const firstEditable = segments.findIndex((part) => part.type !== "literal")
	return segments.map((part, index) => segment(part, index === firstEditable))
}

/** Returns the field plus React Aria's hidden siblings (the native date input, the description). */
export const dateField = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: DateFieldOptions<ParentMessage>,
	render: (parts: DateFieldParts) => Array<Html>,
): Array<Html> => {
	const model = options.model
	const send = options.toParentMessage
	const interaction = options.interaction
	const ids = {
		label: `${model.id}-label`,
		group: `${model.id}-group`,
		description: `${model.id}-description`,
		error: `${model.id}-error`,
		selected: `${model.id}-selected`,
	}
	const statusAttributes = [
		...(model.isDisabled ? [h.DataAttribute("disabled", "true")] : []),
		...(model.isInvalid ? [h.DataAttribute("invalid", "true")] : []),
	]
	const selected = selectedDescription(model)
	const used = new Set<"label" | "description">()

	const partsFor = (hasLabel: boolean, hasDescription: boolean): DateFieldParts => {
		const describedBy =
			[
				...(selected === null ? [] : [ids.selected]),
				...(hasDescription ? [ids.description] : []),
				...(model.isInvalid ? [ids.error] : []),
			].join(" ") || undefined
		const groupState = interaction
			? Interaction.stateOf(interaction.model, ids.group)
			: Interaction.idleState
		return {
			label: (children) => {
				used.add("label")
				return Field.label(h, { id: ids.label, elementType: "span" }, children)
			},
			description: (children) => {
				used.add("description")
				return Field.description(h, { id: ids.description }, children)
			},
			fieldError: (children) =>
				model.isInvalid ? Field.fieldError(h, { id: ids.error }, children) : null,
			dateInput: (part = {}) =>
				h.span(
					[h.DataAttribute("slot", "control"), h.Class(dateInputControlStyles)],
					[
						h.div(
							[
								h.Id(ids.group),
								h.Class(twMerge(twMerge(...dateInputStyles), part.className)),
								h.Role("group"),
								h.DataAttribute("rac", ""),
								h.DataAttribute("react-aria-pressable", "true"),
								h.Attribute("style", "unicode-bidi: isolate;"),
								...statusAttributes,
								...(model.isDisabled ? [h.AriaDisabled(true)] : []),
								...(hasLabel ? [h.AriaLabelledBy(ids.label)] : []),
								...(describedBy === undefined ? [] : [h.AriaDescribedBy(describedBy)]),
								...(interaction
									? [
											...Interaction.handlers(h, interaction, ids.group, {
												isHoverDisabled: model.isDisabled,
												isPressDisabled: true,
												isWithin: true,
											}),
											...Interaction.stateAttributes(h, groupState),
										]
									: []),
							],
							dateSegments(h, {
								model,
								toParentMessage: send,
								interaction,
								labelledBy: hasLabel ? ids.label : undefined,
								describedBy,
							}),
						),
						h.input([
							// React Aria's hidden Input renders an empty class attribute.
							h.Attribute("class", ""),
							h.DataAttribute("rac", ""),
							h.Hidden(true),
							h.Attribute("style", ""),
							h.Type("text"),
							h.Value(model.committed ?? ""),
							...(model.isDisabled
								? [h.Disabled(true), h.DataAttribute("disabled", "true")]
								: [h.Attribute("title", "")]),
						]),
					],
				),
		}
	}
	render(partsFor(true, true))
	const children = render(partsFor(used.has("label"), used.has("description")))

	return [
		h.div(
			[
				h.Class(twMerge(twMerge(fieldStyles({ className: dateFieldClassName })), options.className)),
				h.DataAttribute("rac", ""),
				h.DataAttribute("slot", "control"),
				...statusAttributes,
			],
			children,
		),
		...(model.kind === "date"
			? [
					h.div(
						[
							h.AriaHidden(true),
							h.DataAttribute("a11y-ignore", "aria-hidden-focus"),
							h.DataAttribute("react-aria-prevent-focus", "true"),
							h.DataAttribute("testid", "hidden-dateinput-container"),
							h.Attribute("style", hiddenInputStyle),
						],
						[
							h.input([
								h.Attribute("form", ""),
								h.Step("60"),
								h.Attribute("style", ""),
								h.Tabindex(-1),
								h.Type("date"),
								h.Value(model.committed ?? ""),
								...(model.isDisabled ? [h.Disabled(true)] : []),
							]),
						],
					),
				]
			: []),
		...(selected === null
			? []
			: [h.div([h.Id(ids.selected), h.Attribute("style", "display: none;")], [selected])]),
	]
}
