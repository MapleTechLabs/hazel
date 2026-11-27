// Owned by lane A4 (phase 4, W9). `hz:stepper`: where a wizard is, "Step 2 of 6" over one segment
// per step (onboarding's `stepCounter`). A progress bar to assistive tech; the segments are hidden.
import { definePrimitive, part, type Plain, type Primitive } from "../define.ts"
import { ensureSheet, textOf } from "../list/runtime.ts"

// Segments up to the current one are done (today's step number is 1-based).
const css = `
[data-hz="stepper"] > [data-hz-part="track"] > [data-hz-part="step"][data-done] { background: var(--hz-color-primary); }
[data-hz="stepper"] > [data-hz-part="label"]:empty { display: none; }
`

const countOf = (value: Plain) =>
	typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

export const primitive = definePrimitive("stepper", ({ document, tag, outer }) => {
	ensureSheet(document, "stepper", css)
	const node = outer("div")
	node.setAttribute("role", "progressbar")
	node.setAttribute("aria-valuemin", "1")
	const label = part(document, "span", "label")
	const track = part(document, "div", "track")
	track.setAttribute("aria-hidden", "true")
	node.append(label, track)

	let steps = 0
	let current = 0
	let text = ""

	const draw = () => {
		const at = Math.min(current, steps)
		const shown = text
		label.textContent = shown
		node.setAttribute("aria-valuemax", String(Math.max(steps, 1)))
		node.setAttribute("aria-valuenow", String(Math.max(at, 1)))
		if (shown === "") node.removeAttribute("aria-valuetext")
		else node.setAttribute("aria-valuetext", shown)
		while (track.children.length > steps) track.lastElementChild?.remove()
		while (track.children.length < steps) track.append(part(document, "span", "step"))
		;[...track.children].forEach((step, index) => {
			if (!(step instanceof HTMLElement)) return
			if (index < at) step.dataset.done = ""
			else delete step.dataset.done
			if (index === at - 1) step.dataset.current = ""
			else delete step.dataset.current
		})
	}

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "steps") steps = countOf(value)
			else if (name === "current") current = countOf(value)
			else if (name === "label") text = textOf(value)
			else return
			draw()
		},
		events: undefined,
	}
	return primitive
})
