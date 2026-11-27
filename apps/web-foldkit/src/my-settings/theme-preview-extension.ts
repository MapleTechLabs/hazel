// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The `ThemePreview` extension on the web (lane PS6): today's appearance cards (`cards.ts`): preset
 * mockups, radius samples and remix cards, each in its own theme's colour and radius. Presets and
 * radius are native radios in one named group (arrows move and pick); a remix card is a button.
 */
import type { Theme } from "@hazel/domain/models"
import { RADIUS_LABELS } from "@hazel/shared-screens/lib/theme/presets"
import {
	type ThemeCustomization,
	type ThemePreviewItem,
	ThemePreviewExtension,
} from "@hazel/shared-screens/my-settings/ThemePreview"
import { registerWebExtension } from "@hazel/ui/web/extensions"
import { twMerge } from "tailwind-merge"

type Props = typeof ThemePreviewExtension.props.Type

/** `ThemePresetCard`'s preview radius. */
const presetPreviewRadius: Readonly<Record<Theme.RadiusPreset, string>> = {
	tight: "2px",
	normal: "4px",
	round: "6px",
	full: "8px",
}

/** `RadiusSelector`'s sample radius. */
const radiusSampleRadius: Readonly<Record<Theme.RadiusPreset, string>> = {
	tight: "4px",
	normal: "8px",
	round: "12px",
	full: "16px",
}

/** `RemixOptionCard`'s dot radius. */
const remixDotRadius: Readonly<Record<Theme.RadiusPreset, string>> = {
	tight: "2px",
	normal: "4px",
	round: "6px",
	full: "999px",
}

const el = <K extends keyof HTMLElementTagNameMap>(
	document: Document,
	tag: K,
	className: string,
	...children: ReadonlyArray<Node | string>
) => {
	const node = document.createElement(tag)
	if (className !== "") node.className = className
	node.append(...children)
	return node
}

const centred = (node: HTMLElement) => {
	node.style.display = "flex"
	node.style.alignItems = "center"
	node.style.justifyContent = "center"
	return node
}

/** `ThemePreview`: a navbar, sidebar and button mockup in the theme's colours. */
const mockup = (document: Document, customization: ThemeCustomization) => {
	const radius = presetPreviewRadius[customization.radius]
	const bar = (className: string) => el(document, "div", className)
	const accent = bar("h-1.5 w-full")
	accent.style.backgroundColor = customization.primary
	accent.style.borderRadius = radius
	accent.style.opacity = "0.9"
	const save = centred(el(document, "div", "h-3 w-8 font-medium text-white", "Save"))
	save.style.backgroundColor = customization.primary
	save.style.borderRadius = radius
	save.style.fontSize = "4px"
	const no = centred(el(document, "div", "h-3 w-6 border bg-secondary text-muted-fg", "No"))
	no.style.borderRadius = radius
	no.style.fontSize = "4px"
	return el(
		document,
		"div",
		"flex h-full w-full flex-col",
		el(
			document,
			"div",
			"flex h-3 w-full items-center gap-1 border-b border-border/50 bg-bg px-1.5",
			...[1, 2, 3].map(() => bar("size-1 rounded-full bg-muted-fg/30")),
		),
		el(
			document,
			"div",
			"flex flex-1",
			el(
				document,
				"div",
				"flex w-5 flex-col gap-1 border-r border-border/50 bg-bg p-1",
				bar("h-1.5 w-full rounded-sm bg-muted-fg/20"),
				accent,
				bar("h-1.5 w-full rounded-sm bg-muted-fg/20"),
			),
			el(
				document,
				"div",
				"flex flex-1 flex-col gap-1.5 p-2",
				bar("h-1.5 w-3/4 rounded-sm bg-muted-fg/20"),
				bar("h-1.5 w-1/2 rounded-sm bg-muted-fg/15"),
				el(document, "div", "mt-auto flex gap-1", save, no),
			),
		),
	)
}

/** React Aria's visually hidden radio input. */
const hiddenRadio = (document: Document, name: string, item: ThemePreviewItem, checked: boolean) => {
	const input = document.createElement("input")
	input.type = "radio"
	input.name = name
	input.value = item.value
	input.checked = checked
	input.setAttribute("aria-label", item.label)
	input.className = "sr-only"
	return input
}

let groups = 0

const presetCard = (document: Document, name: string, item: ThemePreviewItem, isSelected: boolean) =>
	el(
		document,
		"label",
		"group flex cursor-pointer flex-col gap-2",
		hiddenRadio(document, name, item, isSelected),
		el(
			document,
			"div",
			twMerge(
				"relative flex h-20 w-28 flex-col overflow-hidden rounded-lg border-2 bg-secondary transition-colors",
				isSelected ? "border-ring ring-2 ring-ring/20" : "border-border hover:border-muted-fg/50",
				"group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-ring/40",
			),
			mockup(document, item.customization),
		),
		el(
			document,
			"div",
			"flex flex-col",
			el(
				document,
				"span",
				twMerge("font-medium text-sm", isSelected ? "text-fg" : "text-muted-fg"),
				item.label,
			),
		),
	)

const radiusOption = (document: Document, name: string, item: ThemePreviewItem, isSelected: boolean) => {
	const sample = el(
		document,
		"div",
		twMerge(
			"size-6 border-2",
			isSelected ? "border-primary bg-primary-subtle/50" : "border-muted-fg/30 bg-muted",
		),
	)
	sample.style.borderRadius = radiusSampleRadius[item.customization.radius]
	return el(
		document,
		"label",
		"group cursor-pointer",
		hiddenRadio(document, name, item, isSelected),
		el(
			document,
			"div",
			twMerge(
				"flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
				isSelected
					? "border-ring bg-primary-subtle/10 ring-2 ring-ring/20"
					: "border-border hover:border-muted-fg/50 hover:bg-secondary/50",
				"group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-ring/40",
			),
			sample,
			el(
				document,
				"span",
				twMerge("text-sm", isSelected ? "font-medium text-fg" : "text-muted-fg"),
				RADIUS_LABELS[item.customization.radius],
			),
		),
	)
}

/** `RemixOptionCard.getGrayLabel` */
const remixGrayLabel = (gray: Theme.GrayPalette) =>
	gray
		.replace("gray-", "")
		.replace(/^./, (c) => c.toUpperCase())
		.replace("gray", "Default")

const remixCard = (document: Document, item: ThemePreviewItem, onSelect: () => void) => {
	const { customization } = item
	const swatch = el(document, "div", "size-8 rounded-md shadow-sm")
	swatch.style.backgroundColor = customization.primary
	const dots = [1, 2, 3].map((i) => {
		const dot = el(document, "div", "size-2")
		dot.style.backgroundColor = customization.primary
		dot.style.borderRadius = remixDotRadius[customization.radius]
		dot.style.opacity = String(0.3 + i * 0.2)
		return dot
	})
	const button = el(
		document,
		"button",
		twMerge(
			"group flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition-colors",
			"hover:border-muted-fg/50 hover:bg-secondary/50",
			"focus:outline-none focus:ring-2 focus:ring-ring/40",
		),
		el(
			document,
			"div",
			"flex items-center gap-2",
			swatch,
			el(
				document,
				"div",
				"flex flex-col",
				el(document, "span", "font-mono text-xs text-fg", customization.primary.toUpperCase()),
				el(document, "span", "text-muted-fg text-xs", remixGrayLabel(customization.grayPalette)),
			),
		),
		el(
			document,
			"div",
			"flex items-center gap-2",
			el(document, "div", "flex gap-0.5", ...dots),
			el(document, "span", "text-muted-fg text-xs", RADIUS_LABELS[customization.radius]),
		),
		el(
			document,
			"div",
			"mt-1",
			el(document, "span", "font-medium text-primary text-xs group-hover:underline", "Apply theme"),
		),
	)
	button.type = "button"
	button.addEventListener("click", onSelect)
	return button
}

registerWebExtension(ThemePreviewExtension, (container, initial, send) => {
	const document = container.ownerDocument
	const name = `theme-preview-${++groups}`
	let props: Props = initial

	const draw = () => {
		const { kind, items, selected } = props
		if (kind === "remix") {
			container.replaceChildren(
				el(
					document,
					"div",
					"grid grid-cols-2 gap-3 sm:grid-cols-4",
					...items.map((item) => remixCard(document, item, () => send("select", { value: item.value }))),
				),
			)
			return
		}
		const group = el(
			document,
			"div",
			kind === "presets" ? "flex flex-wrap gap-4" : "flex flex-wrap gap-2",
			...items.map((item) =>
				kind === "presets"
					? presetCard(document, name, item, item.value === selected)
					: radiusOption(document, name, item, item.value === selected),
			),
		)
		group.setAttribute("role", "radiogroup")
		group.setAttribute("aria-label", props.label)
		group.addEventListener("change", (event) => {
			const target = event.target
			if (target instanceof HTMLInputElement && target.checked) send("select", { value: target.value })
		})
		// The cards wrap instead of scrolling, so nothing clips the picked card's ring (today's `p-1`).
		container.replaceChildren(kind === "presets" ? el(document, "div", "p-1", group) : group)
	}

	draw()
	return {
		update: (next) => {
			const focused = container.contains(document.activeElement)
				? (document.activeElement as HTMLInputElement | null)?.value
				: undefined
			props = next
			draw()
			// Keyboard focus stays on the radio it was on across a redraw.
			if (focused !== undefined)
				container.querySelector<HTMLInputElement>(`input[value="${CSS.escape(focused)}"]`)?.focus()
		},
	}
})
