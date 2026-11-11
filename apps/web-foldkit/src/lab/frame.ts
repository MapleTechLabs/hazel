import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { LAB_ROOT } from "./registry"

/**
 * The lab's page chrome: a header with the page's switches (`?state=`, `?range=`, …) and the
 * light/dark toggle, then sections. Switches are plain links (a full reload into the new flags),
 * so a lab program reads them once through Flags (`queryParam`).
 *
 * Reads `window.location` while rendering: lab-only tooling, never app views.
 */

/** The current URL with `name=value` set. */
const hrefWith = (name: string, value: string): string => {
	const params = new URLSearchParams(window.location.search)
	params.set(name, value)
	return `${window.location.pathname}?${params.toString()}`
}

export type LabSwitch = Readonly<{
	name: string
	label?: string
	values: ReadonlyArray<string>
	current: string
}>

const switchLinks = <M>(h: HtmlBuilder<M>, entry: LabSwitch): Html =>
	h.div(
		[h.Class("flex items-center gap-2")],
		[
			h.span([h.Class("text-muted-fg text-xs")], [entry.label ?? entry.name]),
			h.nav(
				[
					h.AriaLabel(entry.label ?? entry.name),
					h.Class("inline-flex flex-wrap gap-0.5 rounded-lg border border-border p-0.5"),
				],
				entry.values.map((value) =>
					h.a(
						[
							h.Href(hrefWith(entry.name, value)),
							...(value === entry.current ? [h.AriaCurrent("page")] : []),
							h.Class(
								twMerge(
									"rounded-md px-2 py-0.5 font-medium text-xs",
									value === entry.current
										? "bg-primary text-primary-fg"
										: "text-fg-3 hover:bg-secondary hover:text-fg",
								),
							),
						],
						[value],
					),
				),
			),
		],
	)

export const labPage = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title: string
		description?: string
		switches?: ReadonlyArray<LabSwitch>
		className?: string
	}>,
	children: ReadonlyArray<Html>,
): Html => {
	const isDark = document.documentElement.classList.contains("dark")
	return h.div(
		[h.Class("min-h-dvh bg-bg font-sans text-fg antialiased")],
		[
			h.header(
				[
					h.Class(
						"sticky top-0 z-30 flex flex-wrap items-center gap-x-6 gap-y-2 border-border border-b bg-bg/90 px-6 py-3 backdrop-blur",
					),
				],
				[
					h.div(
						[h.Class("flex min-w-0 flex-col")],
						[
							h.div(
								[h.Class("flex items-center gap-2 text-sm")],
								[
									h.a([h.Href(LAB_ROOT), h.Class("text-muted-fg hover:text-fg")], ["Lab"]),
									h.span([h.Class("text-muted-fg")], ["/"]),
									h.h1([h.Class("font-semibold")], [options.title]),
								],
							),
							...(options.description
								? [h.p([h.Class("text-muted-fg text-xs")], [options.description])]
								: []),
						],
					),
					h.div(
						[h.Class("ml-auto flex flex-wrap items-center gap-4")],
						[
							...(options.switches ?? []).map((entry) => switchLinks(h, entry)),
							h.a(
								[
									h.Href(hrefWith("theme", isDark ? "light" : "dark")),
									h.Class(
										"rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary",
									),
								],
								[isDark ? "Light" : "Dark"],
							),
						],
					),
				],
			),
			h.main(
				[h.Class(twMerge("mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8", options.className))],
				[...children],
			),
		],
	)
}

/** A titled block of the page, like a Foundations artboard. */
export const labSection = <M>(
	h: HtmlBuilder<M>,
	title: string,
	children: ReadonlyArray<Html>,
	className?: string,
): Html =>
	h.section(
		[h.Class("flex flex-col gap-3")],
		[
			h.h2([h.Class("font-medium text-muted-fg text-xs uppercase tracking-wider")], [title]),
			h.div([h.Class(twMerge("flex flex-col gap-4", className))], [...children]),
		],
	)

/** A row of variants with a caption. */
export const labRow = <M>(h: HtmlBuilder<M>, children: ReadonlyArray<Html>, note?: string): Html =>
	h.div(
		[h.Class("flex flex-wrap items-center gap-3")],
		[...children, ...(note ? [h.span([h.Class("text-muted-fg text-xs")], [note])] : [])],
	)
