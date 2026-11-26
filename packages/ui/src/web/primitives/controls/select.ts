/**
 * `hz:select`: a labelled native `select` (role `combobox`; arrows, type-ahead and the system list come
 * with it). `placeholder` is a disabled first option shown while `value` matches none. A choice raises
 * `change {value}`; the shown value follows the Model's `value` whenever it arrives.
 */
// Owned by lane A2.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { fire } from "./field.ts"
import { ensureStyles } from "./styles.ts"

interface Choice {
	readonly value: string
	readonly label: string
}

const choicesOf = (value: unknown): ReadonlyArray<Choice> =>
	Array.isArray(value)
		? value.filter(
				(each): each is Choice =>
					typeof each === "object" &&
					each !== null &&
					typeof each.value === "string" &&
					typeof each.label === "string",
			)
		: []

export const primitive = definePrimitive("select", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const label = part(document, "label", "label")
	const caption = part(document, "span", "caption")
	const control = part(document, "span", "control")
	const select = part(document, "select", "input") as HTMLSelectElement
	select.dataset.hzFocus = ""
	const chevron = part(document, "span", "icon")
	chevron.setAttribute("aria-hidden", "true")
	chevron.innerHTML = svg("chevron-down")
	control.append(select, chevron)
	label.append(caption, control)
	node.append(label)

	let choices: ReadonlyArray<Choice> = []
	let placeholder: string | undefined
	let value: string | undefined

	const draw = () => {
		const options = choices.map((choice) => {
			const each = document.createElement("option")
			each.value = choice.value
			each.textContent = choice.label
			return each
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

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, next) => {
			if (name === "label") caption.textContent = typeof next === "string" ? next : ""
			else if (name === "disabled") {
				select.disabled = next === true
				flag(node, "disabled", next)
			} else {
				if (name === "options") choices = choicesOf(next)
				else if (name === "placeholder") placeholder = typeof next === "string" ? next : undefined
				else if (name === "value") value = typeof next === "string" ? next : undefined
				else return
				draw()
			}
		},
		events: undefined,
	}
	return primitive
})
