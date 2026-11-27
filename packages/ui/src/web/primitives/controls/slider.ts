/**
 * `hz:slider`: a label and value text over a track whose thumb is the `role=slider` (today's
 * `@foldkit/ui` Slider). Arrows step, Page Up and Down move ten steps, Home and End jump to the ends; a
 * press on the track jumps there and drags; Escape during a drag restores the value it started from.
 * Controlled: each new value raises `change {value}` and the thumb moves when the Model sends `value`.
 * Disabled, the thumb stays focusable and says `aria-disabled`, as today.
 */
// Owned by lane A2.
import { definePrimitive, flag, part, type Plain, type Primitive } from "../define.ts"
import { ensureChoiceStyles } from "./choice-styles.ts"
import { fire, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

const numberOf = (value: Plain, fallback: number) =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback

/** Today's `snapAndClamp`: onto the step grid from `min`, within the range, without float noise. */
export const snap = (value: number, min: number, max: number, step: number) => {
	const stepped = step > 0 ? min + Math.round((value - min) / step) * step : value
	const decimals = Math.max(0, ...[step, min].map((n) => (String(n).split(".")[1] ?? "").length))
	return Math.min(max, Math.max(min, Number(stepped.toFixed(decimals))))
}

const PAGE = 10

export const primitive = definePrimitive("slider", ({ document, tag, outer }) => {
	ensureStyles(document)
	ensureChoiceStyles(document)
	const node = outer("div")
	const header = part(document, "div", "header")
	const label = part(document, "span", "label")
	label.id = uniqueId("slider-label")
	const output = part(document, "span", "value")
	output.setAttribute("aria-hidden", "true")
	header.append(label, output)
	const track = part(document, "div", "track")
	const fill = part(document, "div", "fill")
	const thumb = part(document, "div", "thumb")
	thumb.dataset.hzFocus = ""
	thumb.setAttribute("role", "slider")
	thumb.setAttribute("aria-orientation", "horizontal")
	thumb.setAttribute("aria-labelledby", label.id)
	thumb.tabIndex = 0
	track.append(fill, thumb)
	node.append(header, track)

	let value = 0
	let min = 0
	let max = 100
	let step = 1
	let disabled = false
	let valueText: string | undefined
	// The value a drag started from (Escape puts it back) and the last value it sent.
	let drag: { readonly origin: number; last: number } | undefined

	const draw = () => {
		const shown = Math.min(max, Math.max(min, value))
		const at = max > min ? (shown - min) / (max - min) : 0
		node.style.setProperty("--hz-slider-at", `${at * 100}%`)
		thumb.setAttribute("aria-valuemin", String(min))
		thumb.setAttribute("aria-valuemax", String(max))
		thumb.setAttribute("aria-valuenow", String(shown))
		if (valueText === undefined) thumb.removeAttribute("aria-valuetext")
		else thumb.setAttribute("aria-valuetext", valueText)
		output.textContent = valueText ?? String(shown)
	}

	const send = (next: number) => {
		const snapped = snap(next, min, max, step)
		if (drag !== undefined) {
			if (snapped === drag.last) return
			drag.last = snapped
		} else if (snapped === value) return
		fire(primitive.events, "change", { value: snapped })
	}

	thumb.addEventListener("keydown", (event) => {
		if (disabled) return
		const target =
			event.key === "ArrowRight" || event.key === "ArrowUp"
				? value + step
				: event.key === "ArrowLeft" || event.key === "ArrowDown"
					? value - step
					: event.key === "PageUp"
						? value + step * PAGE
						: event.key === "PageDown"
							? value - step * PAGE
							: event.key === "Home"
								? min
								: event.key === "End"
									? max
									: undefined
		if (target === undefined) return
		event.preventDefault()
		send(target)
	})

	/** The value under the pointer: the thumb's centre travels the whole track (`Center` alignment). */
	const valueAt = (clientX: number) => {
		const rect = track.getBoundingClientRect()
		const rtl = document.defaultView?.getComputedStyle(track).direction === "rtl"
		const fraction = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0
		return min + (rtl ? 1 - fraction : fraction) * (max - min)
	}
	const end = (restore: boolean) => {
		if (drag === undefined) return
		const { origin, last } = drag
		drag = undefined
		flag(node, "dragging", false)
		if (restore && last !== origin) fire(primitive.events, "change", { value: origin })
	}
	track.addEventListener("pointerdown", (event) => {
		if (disabled || event.button !== 0) return
		event.preventDefault()
		drag = { origin: value, last: value }
		flag(node, "dragging", true)
		track.setPointerCapture?.(event.pointerId)
		thumb.focus()
		send(valueAt(event.clientX))
	})
	track.addEventListener("pointermove", (event) => {
		if (drag !== undefined) send(valueAt(event.clientX))
	})
	track.addEventListener("pointerup", () => end(false))
	track.addEventListener("pointercancel", () => end(false))
	thumb.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && drag !== undefined) {
			event.preventDefault()
			end(true)
		}
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, next) => {
			if (name === "label") label.textContent = typeof next === "string" ? next : ""
			else if (name === "disabled") {
				disabled = next === true
				flag(node, "disabled", next)
				if (disabled) thumb.setAttribute("aria-disabled", "true")
				else thumb.removeAttribute("aria-disabled")
				end(false)
			} else {
				if (name === "value") value = numberOf(next, 0)
				else if (name === "min") min = numberOf(next, 0)
				else if (name === "max") max = numberOf(next, 100)
				else if (name === "step") step = numberOf(next, 1)
				else if (name === "valueText") valueText = typeof next === "string" ? next : undefined
				else return
				draw()
			}
		},
		events: undefined,
	}
	draw()
	return primitive
})
