/**
 * `hz:select`: a labelled native `select` (role `combobox`; arrows, type-ahead and the system list come
 * with it), options under `optgroup`s by `group`. With `searchable` it is today's combo box
 * (`ui/combo-box.ts`): focus stays in a text input, the list below it uses virtual focus
 * (`aria-activedescendant`), typing filters and raises `query`, and the `footer` slot sits under the list.
 */
// Owned by lane A2.
import { trackPlacement } from "../../focus/position.ts"
import {
	hidePanel,
	installOverlayStyles,
	isSpecimen,
	makePopoverPanel,
	showPanel,
} from "../../focus/surface.ts"
import { glyph } from "../../icons.ts"
import { play } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { fire, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

interface Choice {
	readonly value: string
	readonly label: string
	readonly description: string | undefined
	readonly group: string | undefined
	readonly disabled: boolean
}

const choicesOf = (value: unknown): ReadonlyArray<Choice> =>
	Array.isArray(value)
		? value.flatMap((each): ReadonlyArray<Choice> => {
				if (typeof each !== "object" || each === null) return []
				const { value, label, description, group, disabled } = each as Record<string, unknown>
				if (typeof value !== "string" || typeof label !== "string") return []
				return [
					{
						value,
						label,
						description: typeof description === "string" ? description : undefined,
						group: typeof group === "string" ? group : undefined,
						disabled: disabled === true,
					},
				]
			})
		: []

/** Options by `group`, groups in first-seen order; ungrouped options form an untitled group. */
export const grouped = (choices: ReadonlyArray<Choice>) => {
	const groups = new Map<string | undefined, Array<Choice>>()
	for (const choice of choices) {
		const list = groups.get(choice.group)
		if (list === undefined) groups.set(choice.group, [choice])
		else list.push(choice)
	}
	return [...groups].map(([title, options]) => ({ title, options }))
}

const normalized = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()

/** The combo box's filter: label or description contains the text, ignoring case and accents. */
export const matches = (choice: Choice, text: string) => {
	const search = normalized(text)
	return (
		normalized(choice.label).includes(search) ||
		(choice.description !== undefined && normalized(choice.description).includes(search))
	)
}

/** The next enabled option from `from` in `direction`, without wrapping (ListKeyboardDelegate). */
export const step = (choices: ReadonlyArray<Choice>, from: string | undefined, direction: 1 | -1) => {
	const keys = choices.filter((choice) => !choice.disabled).map((choice) => choice.value)
	const at = from === undefined ? -1 : keys.indexOf(from)
	if (at < 0) return direction === 1 ? keys[0] : keys[keys.length - 1]
	return keys[at + direction] ?? keys[at]
}

/** Gap between the field and the list, px (the kit's `OFFSET`). */
const OFFSET = 8

const announcement = (count: number) => `${count} ${count === 1 ? "option" : "options"} available.`

export const primitive = definePrimitive("select", ({ document, tag, outer }) => {
	ensureStyles(document)
	installOverlayStyles(document)
	const node = outer("div")
	const label = part(document, "label", "label") as HTMLLabelElement
	const caption = part(document, "span", "caption")
	caption.id = uniqueId("select-label")
	const control = part(document, "span", "control")
	const select = part(document, "select", "input") as HTMLSelectElement
	select.dataset.hzFocus = ""
	const chevron = part(document, "span", "icon")
	chevron.setAttribute("aria-hidden", "true")
	glyph(chevron, "chevron-down")
	control.append(select, chevron)
	label.append(caption, control)
	node.append(label)

	// The combo box's parts, built once and swapped in while `searchable` is on.
	const input = part(document, "input", "input") as HTMLInputElement
	input.id = uniqueId("combobox")
	input.type = "text"
	input.setAttribute("role", "combobox")
	input.setAttribute("aria-autocomplete", "list")
	input.setAttribute("aria-expanded", "false")
	input.setAttribute("aria-labelledby", caption.id)
	input.setAttribute("autocomplete", "off")
	input.setAttribute("autocorrect", "off")
	input.spellcheck = false
	const button = part(document, "button", "button") as HTMLButtonElement
	button.type = "button"
	button.tabIndex = -1
	button.id = uniqueId("combobox-button")
	button.setAttribute("aria-haspopup", "listbox")
	button.setAttribute("aria-expanded", "false")
	button.setAttribute("aria-label", "Show suggestions")
	button.setAttribute("aria-labelledby", `${button.id} ${caption.id}`)
	glyph(button, "chevron-up-down")
	button.firstElementChild?.setAttribute("aria-hidden", "true")
	const panel = makePopoverPanel(part(document, "div", "panel"))
	const listbox = part(document, "div", "listbox")
	listbox.id = uniqueId("listbox")
	listbox.setAttribute("role", "listbox")
	listbox.setAttribute("aria-labelledby", caption.id)
	// The footer slot's children (`Create #name`) mount here, under the list.
	const content = part(document, "div", "content")
	panel.append(listbox, content)
	const status = part(document, "span", "status")
	status.setAttribute("role", "status")
	status.setAttribute("aria-live", "polite")

	let choices: ReadonlyArray<Choice> = []
	let placeholder: string | undefined
	let value: string | undefined
	let searchable = false
	let open = false
	/** Opened from the button or the arrows: every option, not only the matching ones. */
	let showingAll = false
	let focused: string | undefined
	let stopPlacing: (() => void) | undefined
	let optionIds = new Map<string, string>()

	const labelOf = (key: string | undefined) => choices.find((choice) => choice.value === key)?.label ?? ""
	const visible = () => (showingAll ? choices : choices.filter((choice) => matches(choice, input.value)))
	const hasFooter = () => content.childElementCount > 0

	// Native select.
	const drawNative = () => {
		const optionOf = (choice: Choice) => {
			const each = document.createElement("option")
			each.value = choice.value
			each.textContent = choice.label
			each.disabled = choice.disabled
			return each
		}
		const options: Array<HTMLElement> = grouped(choices).flatMap(({ title, options }) => {
			if (title === undefined) return options.map(optionOf)
			const group = document.createElement("optgroup")
			group.label = title
			group.append(...options.map(optionOf))
			return [group]
		})
		const matched = choices.some((choice) => choice.value === value)
		if (!matched) {
			const empty = document.createElement("option")
			empty.value = ""
			empty.textContent = placeholder ?? ""
			empty.disabled = true
			empty.hidden = true
			options.unshift(empty)
		}
		select.replaceChildren(...options)
		select.value = matched && value !== undefined ? value : ""
		flag(node, "placeholder", !matched)
	}
	select.addEventListener("change", () => {
		fire(primitive.events, "change", { value: select.value })
	})

	// Combo box.
	const drawList = () => {
		optionIds = new Map()
		const shown = visible()
		const groups = grouped(shown).map(({ title, options }) => {
			const group = part(document, "div", "group")
			if (title === undefined) group.setAttribute("role", "presentation")
			else {
				const heading = part(document, "div", "groupTitle")
				heading.id = uniqueId("group")
				heading.textContent = title
				group.setAttribute("role", "group")
				group.setAttribute("aria-labelledby", heading.id)
				group.append(heading)
			}
			for (const choice of options) {
				const row = part(document, "div", "option")
				row.id = uniqueId("option")
				optionIds.set(choice.value, row.id)
				row.dataset.value = choice.value
				row.setAttribute("role", "option")
				const isSelected = choice.value === value
				row.setAttribute("aria-selected", String(isSelected))
				flag(row, "selected", isSelected)
				if (choice.disabled) row.setAttribute("aria-disabled", "true")
				flag(row, "disabled", choice.disabled)
				const check = part(document, "span", "optionCheck")
				check.setAttribute("aria-hidden", "true")
				if (isSelected) glyph(check, "check")
				const text = part(document, "span", "optionText")
				const name = part(document, "span", "optionLabel")
				name.id = uniqueId("option-label")
				name.textContent = choice.label
				row.setAttribute("aria-labelledby", name.id)
				text.append(name)
				if (choice.description !== undefined) {
					const line = part(document, "span", "optionDescription")
					line.id = uniqueId("option-description")
					line.textContent = choice.description
					row.setAttribute("aria-describedby", line.id)
					text.append(line)
				}
				row.append(check, text)
				group.append(row)
			}
			return group
		})
		listbox.replaceChildren(...groups)
		listbox.hidden = shown.length === 0
		if (focused !== undefined && !optionIds.has(focused)) focused = undefined
		drawFocus()
	}
	const drawFocus = () => {
		for (const row of listbox.querySelectorAll<HTMLElement>("[data-hz-part=option]"))
			flag(row, "highlighted", row.dataset.value === focused)
		const id = focused === undefined ? undefined : optionIds.get(focused)
		if (id === undefined) input.removeAttribute("aria-activedescendant")
		else {
			input.setAttribute("aria-activedescendant", id)
			document.getElementById(id)?.scrollIntoView?.({ block: "nearest" })
		}
	}
	const announce = (text: string) => {
		// A change of text is what a live region reads; the same count twice needs a reset.
		status.textContent = ""
		status.textContent = text
	}
	const setExpanded = (expanded: boolean) => {
		for (const each of [input, button]) {
			each.setAttribute("aria-expanded", String(expanded))
			if (expanded) each.setAttribute("aria-controls", listbox.id)
			else each.removeAttribute("aria-controls")
		}
		flag(node, "open", expanded)
		flag(button, "pressed", expanded)
	}
	const show = (all: boolean, focus: string | undefined) => {
		showingAll = all
		focused = focus
		const wasOpen = open
		const before = wasOpen ? listbox.querySelectorAll("[data-hz-part=option]").length : -1
		drawList()
		const count = visible().length
		if (count === 0 && !hasFooter()) {
			close()
			return
		}
		open = true
		setExpanded(true)
		if (!wasOpen) {
			const inPlace = isSpecimen(node)
			flag(node, "specimen", inPlace)
			panel.style.minWidth = `${control.getBoundingClientRect().width}px`
			showPanel(panel, { modal: false, inPlace })
			void play(panel, "enter")
			if (!inPlace)
				stopPlacing = trackPlacement(
					panel,
					() => {
						const box = control.getBoundingClientRect()
						return { x: box.left, y: box.top, width: box.width, height: box.height }
					},
					{ side: "bottom", align: "start", gap: OFFSET },
				)
		}
		if (count !== before) announce(announcement(count))
	}
	const close = () => {
		focused = undefined
		if (!open) return
		open = false
		setExpanded(false)
		input.removeAttribute("aria-activedescendant")
		stopPlacing?.()
		stopPlacing = undefined
		hidePanel(panel)
	}
	const revert = () => {
		close()
		input.value = labelOf(value)
	}
	const choose = (key: string) => {
		const choice = choices.find((each) => each.value === key)
		if (choice === undefined || choice.disabled) return
		value = key
		input.value = choice.label
		close()
		fire(primitive.events, "change", { value: key })
	}

	input.addEventListener("input", () => {
		fire(primitive.events, "query", { text: input.value })
		show(false, undefined)
	})
	input.addEventListener("blur", revert)
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return
		const key = event.key
		if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Escape" && key !== "Enter") return
		if (key === "Enter" && !open) return
		event.preventDefault()
		// Escape closes the list, not a dialog around the field.
		if (key === "Escape" && open) event.stopPropagation()
		if (!open) {
			if (key === "Escape") revert()
			else show(true, value ?? step(choices, undefined, key === "ArrowDown" ? 1 : -1))
			return
		}
		if (key === "Escape") revert()
		else if (key === "Enter") {
			if (focused === undefined) revert()
			else choose(focused)
		} else {
			focused = step(visible(), focused, key === "ArrowDown" ? 1 : -1)
			drawFocus()
		}
	})
	// The button and the list never take focus from the input (`preventFocusOnPress`).
	button.addEventListener("mousedown", (event) => event.preventDefault())
	panel.addEventListener("mousedown", (event) => event.preventDefault())
	button.addEventListener("pointerdown", (event) => {
		if (event.button !== 0 || event.pointerType === "touch") return
		if (open) revert()
		else show(true, value)
		input.focus({ preventScroll: true })
	})
	// A touch has no pointerdown toggle (it would fire before the tap settles); its click does.
	button.addEventListener("click", (event) => {
		if (!(event instanceof PointerEvent) || event.pointerType !== "touch") return
		if (open) revert()
		else show(true, value)
		input.focus({ preventScroll: true })
	})
	listbox.addEventListener("click", (event) => {
		const row =
			event.target instanceof Element ? event.target.closest<HTMLElement>("[role=option]") : null
		if (row?.dataset.value !== undefined) choose(row.dataset.value)
	})
	// A press in the footer (`Create #name`) is the screen's; the list closes after it.
	content.addEventListener("click", () => {
		close()
		input.value = labelOf(value)
	})

	const drawMode = () => {
		const field = searchable ? input : select
		const away = searchable ? select : input
		delete away.dataset.hzFocus
		field.dataset.hzFocus = ""
		if (searchable) {
			select.replaceWith(input)
			chevron.replaceWith(button)
			node.append(panel, status)
		} else {
			close()
			input.replaceWith(select)
			button.replaceWith(chevron)
			panel.remove()
			status.remove()
		}
		flag(node, "searchable", searchable)
	}
	const draw = () => {
		if (!searchable) {
			drawNative()
			return
		}
		// The input's own placeholder shows while it is empty; the flag would mute typed text.
		flag(node, "placeholder", false)
		input.placeholder = placeholder ?? ""
		if (document.activeElement !== input) input.value = labelOf(value)
		// Options the screen loaded for the typed text (`query`) open the list or redraw it.
		else if (open || input.value !== labelOf(value)) show(open && showingAll, focused)
	}

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, next) => {
			if (name === "label") caption.textContent = typeof next === "string" ? next : ""
			else if (name === "disabled") {
				select.disabled = input.disabled = button.disabled = next === true
				if (next === true) revert()
				flag(node, "disabled", next)
			} else if (name === "width") option(node, "width", next)
			else {
				if (name === "options") choices = choicesOf(next)
				else if (name === "placeholder") placeholder = typeof next === "string" ? next : undefined
				else if (name === "value") value = typeof next === "string" ? next : undefined
				else if (name === "searchable") {
					if (searchable === (next === true)) return
					searchable = next === true
					drawMode()
				} else return
				draw()
			}
		},
		events: undefined,
	}
	drawNative()
	return primitive
})
