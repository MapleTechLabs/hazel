// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { loop } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"

/** The kit loader's `spin` strokes (`ui/loader.ts`): twelve lines fading round a 2400 box. */
const strokes: ReadonlyArray<readonly [opacity: string, x1: string, y1: string, x2: string, y2: string]> = [
	["1", "1200", "600", "1200", "100"],
	["0.5", "1200", "2300", "1200", "1800"],
	["0.917", "900", "680.4", "650", "247.4"],
	["0.417", "1750", "2152.6", "1500", "1719.6"],
	["0.833", "680.4", "900", "247.4", "650"],
	["0.333", "2152.6", "1750", "1719.6", "1500"],
	["0.75", "600", "1200", "100", "1200"],
	["0.25", "2300", "1200", "1800", "1200"],
	["0.667", "680.4", "1500", "247.4", "1750"],
	["0.167", "2152.6", "650", "1719.6", "900"],
	["0.583", "900", "1719.6", "650", "2152.6"],
	["0.083", "1750", "247.4", "1500", "680.4"],
]

const times = "0;0.08333;0.16667;0.25;0.33333;0.41667;0.5;0.58333;0.66667;0.75;0.83333;0.91667"
const angles = Array.from({ length: 12 }, (_, step) => `${step * 30} 1199 1199`).join(";")
const lines = strokes
	.map(([opacity, x1, y1, x2, y2]) => {
		const faded = opacity === "1" ? "" : ` opacity="${opacity}"`
		return `<line${faded} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
	})
	.join("")

// Renderer-owned geometry, as an icon's: the strokes step round in twelve discrete turns (SMIL, as the kit).
const spinnerSvg =
	`<svg viewBox="0 0 2400 2400" aria-hidden="true" style="display:block;width:100%;height:100%;stroke:currentColor">` +
	`<g stroke-width="200" stroke-linecap="round" fill="none">${lines}` +
	`<animateTransform attributeName="transform" attributeType="XML" type="rotate" keyTimes="${times}" ` +
	`values="${angles}" dur="0.83333s" begin="0.08333s" repeatCount="indefinite" calcMode="discrete"/></g></svg>`

export const primitive = definePrimitive("progress", ({ document, tag, outer }) => {
	const node = outer("div")
	node.setAttribute("role", "progressbar")
	node.setAttribute("aria-valuemin", "0")
	node.setAttribute("aria-valuemax", "100")
	const label = part(document, "span", "label")
	label.hidden = true
	const track = part(document, "span", "track")
	const fill = part(document, "span", "fill")
	const spinner = part(document, "span", "spinner")
	spinner.hidden = true
	// Renderer-owned: the fill's width is the value, and the slide clips at the track's ends.
	track.style.position = "relative"
	track.style.overflow = "hidden"
	fill.style.position = "absolute"
	fill.style.insetBlock = "0"
	fill.style.insetInlineStart = "0"
	fill.style.width = "0%"
	track.append(fill)
	node.append(spinner, label, track)
	let value = 0
	let indeterminate = false
	let style = "bar"
	const draw = () => {
		const spinning = style === "spinner"
		spinner.hidden = !spinning
		track.hidden = spinning
		if (spinning && spinner.firstChild === null) spinner.innerHTML = spinnerSvg
		else if (!spinning) spinner.replaceChildren()
		// A spinner is always a wait of unknown length; no fill moves under it.
		loop(fill, indeterminate && !spinning)
		if (spinning || indeterminate) {
			node.removeAttribute("aria-valuenow")
			if (spinning) return
			fill.style.transition = "none"
			fill.style.width = "40%"
			return
		}
		// The kit's `w-2/5 animate-progress-slide` (`recipe.motion` loop), or the value's width easing
		// over 200ms (`transition-[width] duration-200 ease-linear`).
		const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
		node.setAttribute("aria-valuenow", String(percent))
		fill.style.transition = "width var(--hz-duration-normal) var(--hz-ease-linear)"
		fill.style.width = `${percent}%`
	}
	draw()
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, next) => {
			if (name === "value") value = typeof next === "number" ? next : 0
			else if (name === "style") {
				option(node, "style", next)
				style = typeof next === "string" ? next : "bar"
			} else if (name === "indeterminate") {
				indeterminate = next === true
				flag(node, "indeterminate", next)
			} else if (name === "label") {
				const text = typeof next === "string" ? next : ""
				label.textContent = text
				label.hidden = text === ""
				if (text === "") node.removeAttribute("aria-label")
				else node.setAttribute("aria-label", text)
				return
			} else return
			draw()
		},
		events: undefined,
	}
	return primitive
})
