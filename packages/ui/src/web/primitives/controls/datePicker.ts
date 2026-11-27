/**
 * `hz:datePicker` on the web (lane A2): today's DatePicker and TimeField (`ui/date-picker.ts`,
 * `date-field.ts`). A group of contenteditable spinbutton segments, a clear button, and a calendar
 * trigger opening a non-modal popover with the month grid (not for `time`). The renderer owns the
 * editing state; a complete value, or an emptied field, raises `change {value}`.
 */
// Owned by lane A2.
import { measureNode } from "../../focus/measure.ts"
import { trackPlacement } from "../../focus/position.ts"
import { makePopoverPanel } from "../../focus/surface.ts"
import { svg } from "../../icons.ts"
import { onShow } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Plain, type Primitive } from "../define.ts"
import { controlledOverlay } from "../overlays/overlay.ts"
import { type CalendarDate, makeCalendar, partsOf, todayOf } from "./date-calendar.ts"
import * as Segments from "./date-segments.ts"
import { fire, uniqueId } from "./field.ts"

// HAZEL-GAP(date-calendar-icon): `IconName` has no calendar; this is the kit's Heroicons CalendarDaysIcon.
const calendarIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z"/></svg>`

// Renderer-owned CSS (C3 `rendererFeatures`): focus rings and the field's focus halo, per-segment and
// per-day states the recipe cannot address (focus, selected, today's dot), the panel's width bounds,
// icon fills and the visually hidden text. Tokens only.
const css = `
[data-hz=datePicker] [data-hz-visually-hidden] {
	position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
	overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
[data-hz=datePicker] :is([data-hz-part=clearIcon], [data-hz-part=triggerIcon], [data-hz-part=previousIcon],
	[data-hz-part=nextIcon]) > svg { display: block; width: 100%; height: 100%; }
[data-hz=datePicker] > [data-hz-part=field] { cursor: text; }
[data-hz=datePicker] > [data-hz-part=field]:has([data-hz-part=segments]:focus-within) {
	border-color: var(--hz-color-focus-ring);
	box-shadow: 0 0 0 3px var(--hz-color-focus-halo);
}
[data-hz=datePicker][data-open] > [data-hz-part=field] { box-shadow: 0 0 0 3px var(--hz-color-focus-halo); }
[data-hz=datePicker][data-invalid] > [data-hz-part=field]:has([data-hz-part=segments]:focus-within) {
	border-color: var(--hz-color-invalid-border);
	box-shadow: 0 0 0 3px var(--hz-color-invalid-halo);
}
/* HAZEL-GAP(date-segment-tracking): the kit's segments are \`tracking-wider\`; recipes have no tracking. */
[data-hz=datePicker] [data-hz-part=segments] > * { letter-spacing: 0.05em; }
[data-hz=datePicker] [data-hz-part=segment] { caret-color: transparent; outline: none; }
[data-hz=datePicker] [data-hz-part=segment][data-placeholder]:not(:focus) { color: var(--hz-color-muted-fg); }
[data-hz=datePicker] [data-hz-part=segment]:focus {
	background: var(--hz-color-primary-subtle);
	color: var(--hz-color-primary-subtle-fg);
}
[data-hz=datePicker][data-invalid] [data-hz-part=segment]:focus {
	background: var(--hz-color-danger-subtle);
	color: var(--hz-color-danger-subtle-fg);
}
[data-hz=datePicker] :is([data-hz-part=clear], [data-hz-part=trigger], [data-hz-part=day]) { cursor: default; outline: none; }
@media (hover: hover) {
	[data-hz=datePicker]:not([data-disabled]) :is([data-hz-part=clear], [data-hz-part=trigger]):hover { color: var(--hz-color-fg); }
	[data-hz=datePicker] :is([data-hz-part=previous], [data-hz-part=next]):not(:disabled):hover { background: var(--hz-color-secondary); }
	[data-hz=datePicker] [data-hz-part=day]:not([data-disabled]):not([data-selected]):hover { background: var(--hz-color-wash-strong); }
	[data-hz=datePicker] [data-hz-part=day][data-selected]:hover { background: var(--hz-color-primary-hover); }
}
[data-hz=datePicker][data-open] > [data-hz-part=field] > [data-hz-part=trigger],
[data-hz=datePicker] > [data-hz-part=field] > :is([data-hz-part=clear], [data-hz-part=trigger]):focus-visible {
	color: var(--hz-color-fg);
}
[data-hz=datePicker] :is([data-hz-part=previous], [data-hz-part=next], [data-hz-part=month], [data-hz-part=year]):focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 2px;
}
[data-hz=datePicker] :is([data-hz-part=previous], [data-hz-part=next]):disabled { opacity: 0.5; }
[data-hz=datePicker] [data-hz-part=day] { position: relative; color: var(--hz-color-fg); }
[data-hz=datePicker] [data-hz-part=day]:focus-visible { box-shadow: 0 0 0 2px var(--hz-color-focus-ring); }
[data-hz=datePicker] [data-hz-part=day][data-disabled] { color: var(--hz-color-muted-fg); }
[data-hz=datePicker] [data-hz-part=day][data-selected] { background: var(--hz-color-primary); color: var(--hz-color-primary-fg); }
[data-hz=datePicker] [data-hz-part=day][data-today]::after {
	content: ""; position: absolute; left: 50%; bottom: var(--hz-space-1); translate: -50% 0;
	width: 3px; height: 3px; border-radius: var(--hz-radius-full); background: var(--hz-color-primary); pointer-events: none;
}
[data-hz=datePicker] [data-hz-part=day][data-today]:is([data-selected], :focus-visible)::after { background: var(--hz-color-primary-fg); }
@media (width >= 40rem) {
	[data-hz=datePicker] > [data-hz-part=panel][data-open] { min-width: 16.5rem; max-width: 18rem; }
}
`

const installed = new WeakSet<Document>()

const ensureStyles = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzRenderer = "datePicker"
	style.textContent = css
	document.head.append(style)
}

const textOf = (value: Plain) => (typeof value === "string" ? value : undefined)

const granularityOf = (value: Plain): Segments.Granularity =>
	value === "time" || value === "dateTime" ? value : "date"

/** A bound's calendar day (`2026-11-26`, or the date of `2026-11-26T09:00`). */
const dayOf = (value: string | null): CalendarDate | null =>
	value !== null && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null

const todayNow = (): Segments.Day => partsOf(todayOf(new Date()))

const iconButton = (document: Document, name: "clear" | "trigger", label: string, icon: string) => {
	const button = part(document, "button", name) as HTMLButtonElement
	button.type = "button"
	button.setAttribute("aria-label", label)
	const glyph = part(document, "span", `${name}Icon`)
	glyph.setAttribute("aria-hidden", "true")
	glyph.innerHTML = icon
	button.append(glyph)
	return button
}

export const primitive = definePrimitive("datePicker", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const label = part(document, "span", "label")
	label.id = uniqueId("label")
	label.hidden = true
	const field = part(document, "div", "field")
	field.setAttribute("role", "group")
	const segmentsNode = part(document, "div", "segments")
	segmentsNode.setAttribute("role", "presentation")
	const clear = iconButton(document, "clear", "Clear", svg("close"))
	clear.hidden = true
	const trigger = iconButton(document, "trigger", "Calendar", calendarIcon)
	trigger.id = uniqueId("trigger")
	trigger.setAttribute("aria-haspopup", "dialog")
	trigger.setAttribute("aria-expanded", "false")
	field.append(segmentsNode, clear, trigger)
	const description = part(document, "p", "description")
	description.id = uniqueId("description")
	description.hidden = true
	const error = part(document, "p", "error")
	error.id = uniqueId("error")
	error.hidden = true
	onShow(error, "enter")
	// React Aria's "Selected Date" description; with no value, the placeholder.
	const selected = part(document, "span", "selected")
	selected.id = uniqueId("selected")
	selected.hidden = true
	const live = part(document, "span", "live")
	live.dataset.hzVisuallyHidden = ""
	live.setAttribute("aria-live", "assertive")
	const status = part(document, "span", "status")
	status.dataset.hzVisuallyHidden = ""
	status.setAttribute("aria-live", "polite")
	const panel = makePopoverPanel(part(document, "div", "panel"))
	panel.setAttribute("role", "dialog")
	node.append(label, field, description, error, selected, live, status, panel)

	let granularity: Segments.Granularity = "date"
	let state = Segments.make(granularity, null, todayNow())
	/** The value the view last set or was last told about. */
	let value: string | null = null
	let min: string | null = null
	let max: string | null = null
	let errorText: string | undefined
	let placeholder: string | undefined
	let disabled = false
	let clearable = false
	let open = false
	let spans: ReadonlyArray<HTMLElement> = []

	const say = (region: HTMLElement, message: string) => {
		region.textContent = ""
		region.textContent = message
	}

	const calendar = makeCalendar({
		document,
		label: () => (label.hidden ? undefined : (label.textContent ?? undefined)),
		onPick: (date) => pick(date),
		announce: (message) => say(live, message),
	})
	panel.append(calendar.node)

	const editable = () => spans.filter((span) => span.dataset.type !== undefined)
	const spanOf = (type: Segments.SegmentType) => editable().find((span) => span.dataset.type === type)

	const outOfRange = (text: string) => (min !== null && text < min) || (max !== null && text > max)
	const invalid = () => errorText !== undefined || (value !== null && outOfRange(value))

	/** Rebuilds the segment spans for the granularity; afterwards `render` only updates them. */
	const build = () => {
		spans = Segments.segments(state).map((segment) => {
			if (segment.type === "literal") {
				const span = part(document, "span", "literal")
				span.setAttribute("aria-hidden", "true")
				return span
			}
			const span = part(document, "span", "segment")
			span.id = uniqueId(`segment-${segment.type}`)
			span.dataset.type = segment.type
			span.setAttribute("role", "spinbutton")
			span.setAttribute("autocorrect", "off")
			span.setAttribute("spellcheck", "false")
			span.setAttribute("enterkeyhint", "next")
			if (segment.type !== "dayPeriod") span.setAttribute("inputmode", "numeric")
			return span
		})
		const first = editable()[0]
		if (first !== undefined) first.dataset.hzFocus = ""
		segmentsNode.replaceChildren(...spans)
		trigger.hidden = granularity === "time"
		option(node, "granularity", granularity)
	}

	const render = () => {
		const drawn = Segments.segments(state)
		if (drawn.length !== spans.length) build()
		const isInvalid = invalid()
		const named = !label.hidden
		const selectedText =
			Segments.selectedDescription(state) ?? (Segments.isEmpty(state) ? placeholder : undefined)
		selected.textContent = selectedText ?? ""
		const describedBy = [
			...(selectedText === undefined ? [] : [selected.id]),
			...(description.hidden ? [] : [description.id]),
			...(error.hidden ? [] : [error.id]),
		].join(" ")
		let firstEditable = true
		drawn.forEach((segment, index) => {
			const span = spans[index]
			if (span === undefined) return
			if (span.textContent !== segment.text) span.textContent = segment.text
			if (segment.type === "literal") return
			const { min: low, max: high } = Segments.limits(state, segment.type)
			span.setAttribute("aria-label", `${Segments.fieldName(segment.type)}, `)
			if (named) span.setAttribute("aria-labelledby", `${span.id} ${label.id}`)
			else span.removeAttribute("aria-labelledby")
			if (firstEditable && describedBy !== "") span.setAttribute("aria-describedby", describedBy)
			else span.removeAttribute("aria-describedby")
			firstEditable = false
			span.setAttribute("aria-valuemin", String(low))
			span.setAttribute("aria-valuemax", String(high))
			if (segment.value === null) span.removeAttribute("aria-valuenow")
			else span.setAttribute("aria-valuenow", String(segment.value))
			span.setAttribute("aria-valuetext", segment.valueText)
			flag(span, "placeholder", segment.isPlaceholder)
			if (isInvalid) span.setAttribute("aria-invalid", "true")
			else span.removeAttribute("aria-invalid")
			if (disabled) {
				span.setAttribute("contenteditable", "false")
				span.setAttribute("aria-disabled", "true")
				span.removeAttribute("tabindex")
			} else {
				span.setAttribute("contenteditable", "true")
				span.removeAttribute("aria-disabled")
				span.tabIndex = 0
			}
		})
		for (const target of [field, panel]) {
			if (named) target.setAttribute("aria-labelledby", label.id)
			else target.removeAttribute("aria-labelledby")
		}
		if (describedBy === "") field.removeAttribute("aria-describedby")
		else field.setAttribute("aria-describedby", describedBy)
		if (named) trigger.setAttribute("aria-labelledby", `${trigger.id} ${label.id}`)
		else trigger.removeAttribute("aria-labelledby")
		if (selectedText === undefined) trigger.removeAttribute("aria-describedby")
		else trigger.setAttribute("aria-describedby", selected.id)
		flag(node, "invalid", isInvalid)
		clear.hidden = !clearable || disabled || Segments.isEmpty(state)
		trigger.disabled = disabled
	}

	/** Raises `change` for a new complete value, or `null` once every segment is empty. */
	const commit = () => {
		const done = Segments.complete(state)
		const next = done ?? (Segments.isEmpty(state) ? null : undefined)
		if (next === undefined || next === value) return
		value = next
		render()
		fire(primitive.events, "change", { value: next })
	}

	const focusSegment = (span: HTMLElement | undefined) => span?.focus({ preventScroll: true })

	const onKey = (span: HTMLElement, key: string) => {
		const type = span.dataset.type as Segments.SegmentType
		const valueTextOf = (name: string | undefined) =>
			Segments.segments(state).find((segment) => segment.type === name)?.valueText
		const before = valueTextOf(type)
		const result = Segments.press(state, type, key)
		state = result.state
		render()
		const list = editable()
		const target = result.move === 0 ? undefined : list[list.indexOf(span) + result.move]
		focusSegment(target)
		// useSpinButton: the focused segment announces its new value.
		const focusedType = (target ?? span).dataset.type
		const after = valueTextOf(focusedType)
		if (after !== undefined && (focusedType !== type || after !== before)) say(live, after)
		commit()
	}

	segmentsNode.addEventListener("keydown", (event) => {
		const span = (event.target as Element | null)?.closest<HTMLElement>("[data-hz-part=segment]")
		if (span === null || span === undefined || disabled) return
		if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
		if (!Segments.isSegmentKey(event.key)) return
		event.preventDefault()
		onKey(span, event.key)
	})
	// Soft keyboards send no usable keydown: their text arrives here, and never edits the span itself.
	segmentsNode.addEventListener("beforeinput", (event) => {
		event.preventDefault()
		const span = (event.target as Element | null)?.closest<HTMLElement>("[data-hz-part=segment]")
		if (span === null || span === undefined || disabled) return
		if (event.inputType.startsWith("delete")) onKey(span, "Backspace")
		else for (const character of event.data ?? "") onKey(span, character)
	})
	segmentsNode.addEventListener("focusin", () => {
		state = Segments.focused(state)
	})
	segmentsNode.addEventListener("paste", (event) => event.preventDefault())
	// A press on the field's fill (not a segment or button) goes to the first empty segment.
	field.addEventListener("mousedown", (event) => {
		if (disabled || (event.target !== field && event.target !== segmentsNode)) return
		event.preventDefault()
		const list = editable()
		focusSegment(list.find((span) => span.hasAttribute("data-placeholder")) ?? list.at(-1))
	})

	const overlay = controlledOverlay({
		outer: node,
		panel,
		modal: false,
		layer: () => ({
			dismissOnOutside: true,
			returnFocus: trigger,
			inside: () => [field],
			initialFocus: () => calendar.focusTarget(),
		}),
		place: () => {
			// `isTriggerWidthSet`: the panel is at least as wide as the field.
			panel.style.minWidth = `${Math.round(measureNode(field).width)}px`
			return trackPlacement(panel, () => measureNode(field), { side: "bottom", align: "start", gap: 8 })
		},
		onDismiss: () => setOpen(false),
	})

	function setOpen(next: boolean) {
		if (next && (disabled || granularity === "time")) return
		open = next
		trigger.setAttribute("aria-expanded", String(next))
		flag(node, "open", next)
		if (next)
			calendar.show({
				today: todayOf(new Date()),
				value: dayOf(Segments.complete(state)),
				min: dayOf(min),
				max: dayOf(max),
			})
		overlay.setOpen(next)
	}

	function pick(date: CalendarDate) {
		state = Segments.setDay(state, partsOf(date))
		setOpen(false)
		render()
		say(status, Segments.selectedDescription(state) ?? "")
		commit()
		// A date and time still missing its time goes on to the hour.
		if (Segments.complete(state) === null) {
			const hour = spanOf("hour")
			document.defaultView?.requestAnimationFrame(() => focusSegment(hour))
		}
	}

	trigger.addEventListener("click", () => setOpen(!open))
	clear.addEventListener("click", () => {
		state = Segments.make(granularity, null, todayNow())
		render()
		commit()
		focusSegment(editable()[0])
	})

	const line = (target: HTMLElement, text: string | undefined) => {
		target.hidden = text === undefined
		target.textContent = text ?? ""
	}

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, next) => {
			if (name === "label") {
				label.textContent = textOf(next) ?? ""
				label.hidden = textOf(next) === undefined
			} else if (name === "description") line(description, textOf(next))
			else if (name === "error") {
				errorText = textOf(next)
				line(error, errorText)
			} else if (name === "placeholder") placeholder = textOf(next)
			else if (name === "value") {
				const incoming = textOf(next) ?? null
				if (incoming === value) return
				value = incoming
				state = Segments.make(granularity, incoming, todayNow())
			} else if (name === "min") min = textOf(next) ?? null
			else if (name === "max") max = textOf(next) ?? null
			else if (name === "granularity") {
				granularity = granularityOf(next)
				state = Segments.make(granularity, value, todayNow())
				build()
				if (granularity === "time" && open) setOpen(false)
			} else if (name === "clearable") clearable = next === true
			else if (name === "disabled") {
				disabled = next === true
				flag(node, "disabled", disabled)
				if (disabled) field.setAttribute("aria-disabled", "true")
				else field.removeAttribute("aria-disabled")
				if (disabled && open) setOpen(false)
			} else return
			render()
		},
		events: undefined,
	}
	build()
	render()
	return primitive
})
