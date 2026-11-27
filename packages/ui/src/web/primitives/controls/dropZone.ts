/**
 * `hz:dropZone`: today's dashed file target (`page/shared/drop-zone.ts`, `custom-emojis/view.ts`), a
 * native `button` (Enter and Space press it) holding an icon, a label and a description. A press raises
 * `press` (the screen opens `Files.pick`); dropped files that `accept` allows are held for
 * `Files.dropped` and raise `files {count}`. A file drag over it sets `data-over`.
 */
// Owned by lane A2.
import { glyph } from "../../icons.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { holdDropped } from "./dropped.ts"
import { fire, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

/** Whether `file` is one `accept` allows (the file input's rule: MIME types, `type/*`, `.ext`). */
export const accepts = (
	accept: string | undefined,
	file: { readonly name: string; readonly type: string },
) => {
	const rules = (accept ?? "")
		.split(",")
		.map((rule) => rule.trim().toLowerCase())
		.filter((rule) => rule !== "")
	if (rules.length === 0) return true
	const type = file.type.toLowerCase()
	const name = file.name.toLowerCase()
	return rules.some((rule) =>
		rule.startsWith(".")
			? name.endsWith(rule)
			: rule.endsWith("/*")
				? type.startsWith(rule.slice(0, -1))
				: type === rule,
	)
}

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true

export const primitive = definePrimitive("dropZone", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("button") as HTMLButtonElement
	node.type = "button"
	node.dataset.hzFocus = ""
	const icon = part(document, "span", "icon")
	icon.setAttribute("aria-hidden", "true")
	const label = part(document, "span", "label")
	label.id = uniqueId("drop-label")
	const description = part(document, "span", "description")
	description.id = uniqueId("drop-description")
	description.hidden = true
	const text = part(document, "span", "text")
	text.append(label, description)
	node.setAttribute("aria-labelledby", label.id)
	node.append(icon, text)

	let accept: string | undefined
	let iconName: string | undefined
	let multiple = false
	let disabled = false
	let loading = false
	// Nested dragenter and dragleave pairs: a drag over the label still counts as over the zone.
	let depth = 0

	// Its own `icon`, else `image` for an image-only target and `paperclip` for anything else.
	const drawIcon = () => {
		if (iconName !== undefined) return glyph(icon, iconName)
		const images = (accept ?? "")
			.split(",")
			.map((rule) => rule.trim())
			.filter((rule) => rule !== "")
		glyph(
			icon,
			images.length > 0 && images.every((rule) => rule.startsWith("image/")) ? "image" : "paperclip",
		)
	}
	drawIcon()

	const busy = () => disabled || loading
	const setOver = (over: boolean) => {
		if (!over) depth = 0
		flag(node, "over", over)
	}
	// A loading zone stays focusable (as a loading button) but presses do nothing.
	node.addEventListener("click", (event) => {
		if (!loading) return
		event.preventDefault()
		event.stopImmediatePropagation()
	})
	node.addEventListener("dragenter", (event) => {
		if (busy() || !hasFiles(event)) return
		event.preventDefault()
		depth += 1
		setOver(true)
	})
	node.addEventListener("dragover", (event) => {
		if (busy() || !hasFiles(event)) return
		event.preventDefault()
		if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy"
	})
	node.addEventListener("dragleave", () => {
		depth = Math.max(0, depth - 1)
		if (depth === 0) setOver(false)
	})
	node.addEventListener("drop", (event) => {
		setOver(false)
		if (busy() || !hasFiles(event)) return
		event.preventDefault()
		const allowed = [...(event.dataTransfer?.files ?? [])].filter((file) => accepts(accept, file))
		const taken = multiple ? allowed : allowed.slice(0, 1)
		if (taken.length === 0) return
		holdDropped(taken)
		fire(primitive.events, "files", { count: taken.length })
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "label") label.textContent = typeof value === "string" ? value : ""
			else if (name === "description") {
				description.hidden = typeof value !== "string"
				description.textContent = typeof value === "string" ? value : ""
				if (typeof value === "string") node.setAttribute("aria-describedby", description.id)
				else node.removeAttribute("aria-describedby")
			} else if (name === "accept") {
				accept = typeof value === "string" ? value : undefined
				drawIcon()
			} else if (name === "icon") {
				iconName = typeof value === "string" ? value : undefined
				drawIcon()
			} else if (name === "multiple") multiple = value === true
			else if (name === "disabled") {
				disabled = value === true
				node.disabled = disabled
				flag(node, "disabled", value)
				if (disabled) setOver(false)
			} else if (name === "loading") {
				loading = value === true
				flag(node, "loading", value)
				if (loading) {
					node.setAttribute("aria-disabled", "true")
					node.setAttribute("aria-busy", "true")
					setOver(false)
				} else {
					node.removeAttribute("aria-disabled")
					node.removeAttribute("aria-busy")
				}
			}
		},
		events: undefined,
	}
	return primitive
})
