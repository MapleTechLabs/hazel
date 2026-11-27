/**
 * `hz:choiceGroup`: one choice (a `radiogroup` of `role=radio` buttons) or several (`multiple`, a
 * `group` of `role=checkbox` buttons), drawn as radio rows, cards, a segmented control, chips or
 * swatches. One option is in the tab order (roving tabindex); arrows move along the options (by
 * row in a card grid), Home and End jump. With one choice an arrow also selects, as native radios
 * do; with several, Space and Enter toggle. Controlled: every choice raises `change {selected}`.
 */
// Owned by lane A2.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option, part, type Plain, type Primitive } from "../define.ts"
import { ensureChoiceStyles } from "./choice-styles.ts"
import { fire, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

interface Choice {
	readonly value: string
	readonly label: string
	readonly description?: string
	readonly icon?: string
	readonly image?: string
	readonly swatch?: string
	readonly badge?: number
	readonly disabled?: boolean
}

// SAFETY: the host only passes `options` that decoded as `Content.ChoiceOption` arrays (`spec.ts`).
const choicesOf = (value: Plain): ReadonlyArray<Choice> => (Array.isArray(value) ? (value as never) : [])
const valuesOf = (value: Plain): ReadonlyArray<string> =>
	Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : []
const textOf = (value: Plain) => (typeof value === "string" ? value : undefined)

const iconNode = (document: Document, name: string, partName: string) => {
	const holder = part(document, "span", partName)
	holder.setAttribute("aria-hidden", "true")
	holder.innerHTML = svg(name)
	return holder
}

type Style = "list" | "cards" | "segmented" | "chips" | "swatches"
const stylesOf = (value: Plain): Style =>
	value === "cards" || value === "segmented" || value === "chips" || value === "swatches" ? value : "list"

export const primitive = definePrimitive("choiceGroup", ({ document, tag, outer }) => {
	ensureStyles(document)
	ensureChoiceStyles(document)
	const node = outer("div")
	const label = part(document, "span", "label")
	label.id = uniqueId("choice-label")
	label.hidden = true
	const description = part(document, "p", "description")
	description.id = uniqueId("choice-description")
	description.hidden = true
	const options = part(document, "div", "options")
	options.setAttribute("aria-labelledby", label.id)
	const error = part(document, "p", "error")
	error.id = uniqueId("choice-error")
	error.hidden = true
	node.append(label, description, options, error)

	let choices: ReadonlyArray<Choice> = []
	let selected: ReadonlyArray<string> = []
	let multiple = false
	let style: Style = "list"
	let disabled = false
	// The option that keeps the tab stop with several choices (the last one focused).
	let current: string | undefined

	const buttons = () => [...options.querySelectorAll<HTMLButtonElement>(":scope > [data-hz-part=option]")]
	const enabled = () => buttons().filter((button) => !button.disabled)

	const describe = () => {
		const ids = [description, error].filter((line) => !line.hidden).map((line) => line.id)
		if (ids.length > 0) options.setAttribute("aria-describedby", ids.join(" "))
		else options.removeAttribute("aria-describedby")
	}

	const choose = (value: string) => {
		if (multiple) {
			const on = new Set(selected)
			if (on.has(value)) on.delete(value)
			else on.add(value)
			// Options' order, so the Model's list is stable whatever was pressed first.
			fire(primitive.events, "change", {
				selected: choices.map((choice) => choice.value).filter((each) => on.has(each)),
			})
		} else if (!(selected.length === 1 && selected[0] === value)) {
			fire(primitive.events, "change", { selected: [value] })
		}
	}

	/** Checked state and the roving tab stop, from `selected` and the last focused option. */
	const mark = () => {
		const list = buttons()
		const on = new Set(selected)
		const usable = list.filter((button) => !button.disabled)
		const stop =
			(multiple ? usable.find((button) => button.dataset.value === current) : undefined) ??
			usable.find((button) => on.has(button.dataset.value ?? "")) ??
			usable[0]
		for (const button of list) {
			const checked = on.has(button.dataset.value ?? "")
			button.setAttribute("aria-checked", String(checked))
			flag(button, "selected", checked)
			button.tabIndex = button === stop ? 0 : -1
			const box = button.querySelector("[data-hz-part=box]")
			const markNode = box?.firstElementChild
			if (markNode instanceof HTMLElement)
				markNode.hidden = style === "swatches" || (multiple && !checked)
		}
	}

	const optionNode = (choice: Choice) => {
		const button = part(document, "button", "option") as HTMLButtonElement
		button.type = "button"
		button.dataset.value = choice.value
		button.dataset.hzFocus = ""
		button.setAttribute("role", multiple ? "checkbox" : "radio")
		button.disabled = disabled || choice.disabled === true
		flag(button, "disabled", button.disabled)

		const text = part(document, "span", "optionText")
		if (choice.image !== undefined) {
			const image = part(document, "img", "optionImage") as HTMLImageElement
			image.src = choice.image
			image.alt = ""
			text.append(image)
		}
		const name = part(document, "span", "optionLabel")
		name.id = uniqueId("choice-option")
		name.textContent = choice.label
		text.append(name)
		if (choice.description !== undefined && style !== "segmented" && style !== "chips") {
			const line = part(document, "span", "optionDescription")
			line.id = uniqueId("choice-option-description")
			line.textContent = choice.description
			text.append(line)
			button.setAttribute("aria-describedby", line.id)
		}

		const indicator = part(document, "span", "indicator")
		indicator.setAttribute("aria-hidden", "true")
		const box = part(document, "span", "box")
		const check = multiple ? iconNode(document, "check", "mark") : part(document, "span", "mark")
		box.append(check)
		indicator.append(box)

		const parts: Array<HTMLElement> = []
		if (style === "swatches") {
			// The colour is data (`ChoiceOption.swatch`): the user's brand colour they are choosing.
			if (choice.swatch !== undefined) box.style.backgroundColor = choice.swatch
			check.hidden = true
			text.hidden = true
			button.setAttribute("aria-label", choice.label)
			button.setAttribute("aria-roledescription", "color swatch")
			parts.push(indicator, text)
		} else {
			const icon = choice.icon === undefined ? [] : [iconNode(document, choice.icon, "optionIcon")]
			const badge: Array<HTMLElement> = []
			if (choice.badge !== undefined) {
				const count = part(document, "span", "optionBadge")
				count.textContent = String(choice.badge)
				badge.push(count)
			}
			// A card's check sits at its end; radio rows lead with the dot; chips and segments have none.
			if (style === "cards") parts.push(...icon, text, ...badge, ...(multiple ? [indicator] : []))
			else if (style === "list") parts.push(indicator, ...icon, text, ...badge)
			else parts.push(...icon, text, ...badge)
		}
		button.append(...parts)
		button.addEventListener("click", () => {
			current = choice.value
			choose(choice.value)
		})
		button.addEventListener("focus", () => {
			current = choice.value
		})
		return button
	}

	const draw = () => {
		options.setAttribute("role", multiple ? "group" : "radiogroup")
		options.replaceChildren(...choices.map(optionNode))
		mark()
	}

	/** How many options share a row right now (a card grid; one on the compact size class). */
	const columns = () => {
		if (style !== "cards") return 1
		const template = document.defaultView?.getComputedStyle(options).gridTemplateColumns ?? ""
		const count = template.split(" ").filter((track) => track !== "" && track !== "none").length
		return Math.max(1, count)
	}

	options.addEventListener("keydown", (event) => {
		const list = enabled()
		const at = list.indexOf(document.activeElement as HTMLButtonElement)
		if (at < 0 || event.altKey || event.ctrlKey || event.metaKey) return
		const across = columns()
		const step =
			event.key === "ArrowDown"
				? across
				: event.key === "ArrowUp"
					? -across
					: event.key === "ArrowRight"
						? 1
						: event.key === "ArrowLeft"
							? -1
							: undefined
		const rtl = document.defaultView?.getComputedStyle(options).direction === "rtl"
		const horizontal = event.key === "ArrowRight" || event.key === "ArrowLeft"
		// One choice wraps like native radios; a grid of several stops at its edges (React Aria's grid).
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? list.length - 1
					: step === undefined
						? undefined
						: multiple || across > 1
							? Math.min(list.length - 1, Math.max(0, at + (rtl && horizontal ? -step : step)))
							: (at + (rtl && horizontal ? -step : step) + list.length) % list.length
		if (next === undefined) return
		event.preventDefault()
		const target = list[next]
		if (target === undefined) return
		target.focus()
		const value = target.dataset.value
		if (!multiple && value !== undefined) choose(value)
	})

	let labelText: string | undefined
	let labelHidden = false
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "label") {
				labelText = textOf(value)
				label.hidden = labelText === undefined || labelHidden
				label.textContent = labelText ?? ""
			} else if (name === "labelHidden") {
				// Named for assistive tech only (`aria-labelledby` reads a hidden label).
				labelHidden = value === true
				label.hidden = labelText === undefined || labelHidden
			} else if (name === "description" || name === "error") {
				const line = name === "error" ? error : description
				line.hidden = textOf(value) === undefined
				line.textContent = textOf(value) ?? ""
				if (name === "error") {
					flag(node, "invalid", textOf(value) !== undefined)
					if (textOf(value) === undefined) options.removeAttribute("aria-invalid")
					else options.setAttribute("aria-invalid", "true")
				}
				describe()
			} else if (name === "selected") {
				selected = valuesOf(value)
				mark()
			} else if (name === "columns") option(node, "columns", value)
			else {
				if (name === "options") choices = choicesOf(value)
				else if (name === "multiple") {
					multiple = value === true
					flag(node, "multiple", value)
				} else if (name === "style") {
					style = stylesOf(value)
					option(node, "style", value)
				} else if (name === "disabled") {
					disabled = value === true
					flag(node, "disabled", value)
					if (disabled) options.setAttribute("aria-disabled", "true")
					else options.removeAttribute("aria-disabled")
				} else return
				draw()
			}
		},
		events: undefined,
	}
	return primitive
})
