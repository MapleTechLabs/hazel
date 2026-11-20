import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { heading } from "../../ui/heading"

/**
 * The kit page's own chrome: the section list, a section, and a specimen (one component: its name,
 * when to reach for it, and its variants on a stage). Static, so every section draws the same frame.
 */

export type KitSection = Readonly<{ id: string; title: string; description: string }>

export const SECTIONS = [
	{
		id: "foundations",
		title: "Foundations",
		description: "The tokens every component is drawn from: color, type, radius and elevation.",
	},
	{
		id: "actions",
		title: "Actions",
		description: "What a person presses: buttons, chips and links, and the marks that label them.",
	},
	{
		id: "fields",
		title: "Fields",
		description: "Where a person types or picks a value. Fields are filled, never outlined.",
	},
	{
		id: "selection",
		title: "Selection",
		description: "Choosing among options: checks, radios, switches, sliders, choice boxes and dates.",
	},
	{
		id: "navigation",
		title: "Navigation",
		description: "Moving between views inside a page.",
	},
	{
		id: "feedback",
		title: "Feedback",
		description: "What the app says back: progress, results and nothing-here-yet.",
	},
	{
		id: "overlays",
		title: "Overlays",
		description: "Surfaces above the page: menus, popovers, dialogs and the command menu.",
	},
	{
		id: "display",
		title: "Display",
		description: "People, groups and structure: avatars, cards, headers and separators.",
	},
] as const satisfies ReadonlyArray<KitSection>

export type SectionId = (typeof SECTIONS)[number]["id"]

const sectionOf = (id: SectionId): KitSection => SECTIONS.find((section) => section.id === id) ?? SECTIONS[0]

/** The jump list beside the page; it stays in view while the sections scroll. */
export const sectionNav = <M>(h: HtmlBuilder<M>): Html =>
	h.nav(
		[
			h.AriaLabel("Sections"),
			h.Class("sticky top-24 hidden w-40 shrink-0 flex-col gap-px self-start lg:flex"),
		],
		SECTIONS.map((section) =>
			h.keyed("a")(
				section.id,
				[
					h.Href(`#${section.id}`),
					h.Class(
						"rounded-md px-2 py-1 text-fg-3 text-sm outline-hidden transition-colors duration-150 ease-out hover:bg-wash hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
					),
				],
				[section.title],
			),
		),
	)

export const kitSection = <M>(h: HtmlBuilder<M>, id: SectionId, children: ReadonlyArray<Html>): Html => {
	const section = sectionOf(id)
	return h.section(
		[h.Id(section.id), h.Class("flex scroll-mt-24 flex-col gap-8")],
		[
			h.div(
				[h.Class("flex flex-col gap-1 border-border border-b pb-4")],
				[
					heading(h, { variant: "title", level: 2 }, [section.title]),
					h.p([h.Class("max-w-prose text-fg-2 text-sm")], [section.description]),
				],
			),
			...children,
		],
	)
}

/**
 * One component: its name, the file it lives in, a line on when to use it, and its variants on a
 * stage. `className` lays the stage out (it is a wrapping row by default).
 */
export const specimen = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ name: string; file: string; note?: string; className?: string }>,
	children: ReadonlyArray<Html>,
): Html =>
	h.article(
		[h.Class("flex min-w-0 flex-col gap-3")],
		[
			h.div(
				[h.Class("flex flex-col gap-0.5")],
				[
					h.div(
						[h.Class("flex items-baseline justify-between gap-3")],
						[
							heading(h, { variant: "subsection", level: 3 }, [options.name]),
							h.code([h.Class("truncate font-mono text-2xs text-fg-2")], [options.file]),
						],
					),
					...(options.note === undefined
						? []
						: [h.p([h.Class("max-w-prose text-fg-2 text-sm")], [options.note])]),
				],
			),
			h.div(
				[
					h.Class(
						twMerge(
							"flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border bg-bg p-5",
							options.className,
						),
					),
				],
				[...children],
			),
		],
	)

/** A captioned group inside a stage: "Sizes", "States". */
export const group = <M>(
	h: HtmlBuilder<M>,
	caption: string,
	children: ReadonlyArray<Html>,
	className?: string,
): Html =>
	h.div(
		[h.Class("flex min-w-0 flex-col gap-2")],
		[
			h.span([h.Class("font-medium text-2xs text-fg-2 uppercase tracking-wider")], [caption]),
			h.div([h.Class(twMerge("flex flex-wrap items-center gap-2", className))], [...children]),
		],
	)

/** Two specimens side by side from `lg` up. */
export const pair = <M>(h: HtmlBuilder<M>, children: ReadonlyArray<Html>): Html =>
	h.div([h.Class("grid gap-8 lg:grid-cols-2")], [...children])
