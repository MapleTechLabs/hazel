import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { heading, type HeadingVariant } from "../../ui/heading"
import { group, kitSection, specimen } from "./chrome"

// Foundations: the tokens (`core/styles/styles.css`), drawn. Class names are written out in full so
// Tailwind's scan finds them.

type Swatch = Readonly<{ name: string; fill: string; role: string; sample?: string }>

const SURFACES: ReadonlyArray<Swatch> = [
	{ name: "bg", fill: "bg-bg", role: "The page" },
	{ name: "sidebar", fill: "bg-sidebar", role: "Sidebars" },
	{ name: "navbar", fill: "bg-navbar", role: "Top bars" },
	{ name: "overlay", fill: "bg-overlay", role: "Menus, dialogs, toasts" },
	{ name: "secondary", fill: "bg-secondary", role: "Quiet fills" },
	{ name: "muted", fill: "bg-muted", role: "Disabled fills" },
	{ name: "wash", fill: "bg-wash", role: "A hovered row" },
	{ name: "wash-strong", fill: "bg-wash-strong", role: "The current row" },
	{ name: "field", fill: "bg-field", role: "A field at rest" },
	{ name: "field-hover", fill: "bg-field-hover", role: "A hovered field" },
]

const INTENTS: ReadonlyArray<Swatch> = [
	{ name: "primary", fill: "bg-primary", role: "The one main action", sample: "text-primary-fg" },
	{
		name: "primary-subtle",
		fill: "bg-primary-subtle",
		role: "Selected, current",
		sample: "text-primary-subtle-fg",
	},
	{ name: "success", fill: "bg-success", role: "Done, online", sample: "text-success-fg" },
	{
		name: "success-subtle",
		fill: "bg-success-subtle",
		role: "Success badges",
		sample: "text-success-subtle-fg",
	},
	{ name: "warning", fill: "bg-warning", role: "Needs a look", sample: "text-warning-fg" },
	{
		name: "warning-subtle",
		fill: "bg-warning-subtle",
		role: "Warning badges",
		sample: "text-warning-subtle-fg",
	},
	{ name: "danger", fill: "bg-danger", role: "Destructive", sample: "text-danger-fg" },
	{
		name: "danger-subtle",
		fill: "bg-danger-subtle",
		role: "Errors, danger rows",
		sample: "text-danger-subtle-fg",
	},
	{ name: "info-subtle", fill: "bg-info-subtle", role: "Neutral notices", sample: "text-info-subtle-fg" },
]

const swatch = <M>(h: HtmlBuilder<M>, entry: Swatch): Html =>
	h.div(
		[h.Class("flex w-36 flex-col gap-1.5")],
		[
			h.div(
				[
					h.Class(
						twMerge(
							"flex h-12 items-center justify-center rounded-lg border border-border",
							entry.fill,
						),
					),
				],
				entry.sample === undefined
					? []
					: [h.span([h.Class(twMerge("font-medium text-sm", entry.sample))], ["Aa"])],
			),
			h.div(
				[h.Class("flex flex-col")],
				[
					h.span([h.Class("font-medium text-fg text-xs")], [entry.name]),
					h.span([h.Class("text-2xs text-fg-2")], [entry.role]),
				],
			),
		],
	)

const TEXT_LADDER = [
	{ name: "fg", color: "text-fg", role: "Titles, values, typed text" },
	{ name: "fg-3", color: "text-fg-3", role: "Body and rows at rest" },
	{ name: "fg-2", color: "text-fg-2", role: "Meta, hints, placeholders" },
	{ name: "fg-1", color: "text-fg-1", role: "Dividers and disabled marks, never text to read" },
] as const

const HEADINGS: ReadonlyArray<Readonly<{ variant: HeadingVariant; spec: string }>> = [
	{ variant: "display", spec: "24 / 32 semibold · a page's title" },
	{ variant: "title", spec: "18 / 28 semibold · a panel's or modal's title" },
	{ variant: "section", spec: "16 / 24 semibold · a section in a page" },
	{ variant: "subsection", spec: "14 / 20 semibold · a group in a section" },
	{ variant: "label", spec: "12 medium uppercase · an eyebrow over rows" },
]

const BODY = [
	{ size: "text-base", name: "base", spec: "16 · touch inputs" },
	{ size: "text-sm", name: "sm", spec: "14 · body, controls" },
	{ size: "text-xs", name: "xs", spec: "12 · meta, badges" },
	{ size: "text-2xs", name: "2xs", spec: "11 · counters" },
	{ size: "text-3xs", name: "3xs", spec: "10 · the smallest label" },
] as const

const RADII = [
	{ name: "xs", radius: "rounded-xs" },
	{ name: "sm", radius: "rounded-sm" },
	{ name: "md", radius: "rounded-md" },
	{ name: "lg", radius: "rounded-lg" },
	{ name: "xl", radius: "rounded-xl" },
	{ name: "2xl", radius: "rounded-2xl" },
	{ name: "3xl", radius: "rounded-3xl" },
	{ name: "full", radius: "rounded-full" },
] as const

const ELEVATIONS = [
	{ name: "xs", shadow: "shadow-xs", role: "Cards, outline buttons" },
	{ name: "sm", shadow: "shadow-sm", role: "The composer" },
	{ name: "md", shadow: "shadow-md", role: "Tooltips, hover cards" },
	{ name: "lg", shadow: "shadow-lg", role: "Menus, popovers, toasts" },
	{ name: "xl", shadow: "shadow-xl", role: "Modals, the command menu" },
] as const

const specRow = <M>(h: HtmlBuilder<M>, key: string, sample: Html, spec: string): Html =>
	h.keyed("div")(
		key,
		[h.Class("flex items-baseline justify-between gap-6 border-border border-b py-2.5 last:border-b-0")],
		[sample, h.span([h.Class("shrink-0 text-fg-2 text-xs tabular-nums")], [spec])],
	)

export const foundations = <M>(h: HtmlBuilder<M>): Html =>
	kitSection(h, "foundations", [
		specimen(
			h,
			{
				name: "Surfaces",
				file: "core/styles/styles.css",
				note: "Washes and field fills are alpha, so they read the same on the page, a sidebar or an overlay.",
				className: "items-start",
			},
			SURFACES.map((entry) => h.keyed("div")(entry.name, [], [swatch(h, entry)])),
		),
		specimen(
			h,
			{
				name: "Intent",
				file: "core/styles/styles.css",
				note: "Each intent has a solid pair for a filled control and a subtle pair for a badge or a row.",
				className: "items-start",
			},
			INTENTS.map((entry) => h.keyed("div")(entry.name, [], [swatch(h, entry)])),
		),
		specimen(
			h,
			{
				name: "Text",
				file: "core/styles/styles.css",
				note: "Four steps mixed from the foreground, so every gray palette gets its own ladder.",
				className: "flex-col items-stretch gap-0",
			},
			TEXT_LADDER.map((entry) =>
				specRow(
					h,
					entry.name,
					h.span(
						[h.Class(twMerge("text-sm", entry.color))],
						[`${entry.name} · The quick brown fox jumps over the lazy dog`],
					),
					entry.role,
				),
			),
		),
		specimen(
			h,
			{
				name: "Headings",
				file: "ui/heading.ts",
				note: "Every heading is one of these five. The level sets the outline, the variant sets the look.",
				className: "flex-col items-stretch gap-0",
			},
			HEADINGS.map((entry) =>
				specRow(
					h,
					entry.variant,
					heading(h, { variant: entry.variant, level: 4 }, [
						entry.variant.charAt(0).toUpperCase() + entry.variant.slice(1),
					]),
					entry.spec,
				),
			),
		),
		specimen(
			h,
			{
				name: "Body scale",
				file: "core/styles/styles.css",
				note: "Inter throughout. Counters, timestamps and prices use tabular numbers.",
				className: "flex-col items-stretch gap-0",
			},
			[
				...BODY.map((entry) =>
					specRow(
						h,
						entry.name,
						h.span([h.Class(twMerge("text-fg", entry.size))], ["Calm, polished, reliable"]),
						`${entry.name} · ${entry.spec}`,
					),
				),
				specRow(
					h,
					"tabular",
					h.span([h.Class("text-fg text-sm tabular-nums")], ["1,204 · 11:08 · $48,210"]),
					"tabular-nums",
				),
				specRow(
					h,
					"mono",
					h.code([h.Class("font-mono text-fg text-sm")], ["hzl_live_4f9a2c · 0O1lI"]),
					"font-mono",
				),
			],
		),
		specimen(
			h,
			{
				name: "Radius",
				file: "core/styles/styles.css",
				note: "Every step follows the user's radius preset. Controls use lg, cards and overlays xl.",
				className: "items-end gap-5",
			},
			RADII.map((entry) =>
				h.keyed("div")(
					entry.name,
					[h.Class("flex flex-col items-center gap-2")],
					[
						h.div([
							h.Class(twMerge("size-14 border border-border-hover bg-secondary", entry.radius)),
						]),
						h.span([h.Class("text-2xs text-fg-2")], [entry.name]),
					],
				),
			),
		),
		specimen(
			h,
			{
				name: "Elevation",
				file: "core/styles/styles.css",
				note: "A tight contact shadow under a soft ambient one. Dark mode deepens both and adds a top highlight.",
				className: "items-start gap-6 bg-muted/40 p-8",
			},
			[
				...ELEVATIONS.map((entry) =>
					h.keyed("div")(
						entry.name,
						[h.Class("flex w-32 flex-col gap-3")],
						[
							h.div([
								h.Class(
									twMerge("h-16 rounded-xl border border-fg/10 bg-overlay", entry.shadow),
								),
							]),
							h.div(
								[h.Class("flex flex-col")],
								[
									h.span([h.Class("font-medium text-fg text-xs")], [entry.name]),
									h.span([h.Class("text-2xs text-fg-2")], [entry.role]),
								],
							),
						],
					),
				),
			],
		),
		specimen(
			h,
			{
				name: "Motion",
				file: "core/styles/styles.css",
				note: "One strong ease-out for everything that enters. prefers-reduced-motion collapses all of it.",
			},
			[
				group(h, "Durations", [
					h.span([h.Class("text-fg-3 text-sm")], ["100ms press"]),
					h.span([h.Class("text-fg-1")], ["·"]),
					h.span([h.Class("text-fg-3 text-sm")], ["150ms hover, popovers"]),
					h.span([h.Class("text-fg-1")], ["·"]),
					h.span([h.Class("text-fg-3 text-sm")], ["200ms dialogs, sheets"]),
				]),
			],
		),
	])
