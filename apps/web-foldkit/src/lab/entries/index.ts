import type { Html, HtmlBuilder } from "foldkit/html"
import { labEntryPaths } from "../boot"
import { defineStaticLab } from "../define"
import { labPage, labSection } from "../frame"
import { LAB_DESCRIPTIONS, labGroupOf, labNameOf } from "../registry"

// `/lab`: every lab page, grouped by folder, read from the entry files.

const groups = (): ReadonlyArray<readonly [string, ReadonlyArray<string>]> => {
	const byGroup = new Map<string, Array<string>>()
	for (const path of [...labEntryPaths()].sort()) {
		if (path === "/lab/index") continue
		const group = labGroupOf(path)
		byGroup.set(group, [...(byGroup.get(group) ?? []), path])
	}
	return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const card = <M>(h: HtmlBuilder<M>, path: string): Html =>
	h.li(
		[],
		[
			h.a(
				[
					h.Href(path),
					h.Class("flex h-full flex-col gap-1 rounded-lg border border-border p-3 hover:bg-wash"),
				],
				[
					h.span(
						[h.Class("flex items-baseline justify-between gap-2")],
						[
							h.span([h.Class("font-medium text-sm")], [labNameOf(path)]),
							h.span([h.Class("truncate font-mono text-[10px] text-muted-fg")], [path]),
						],
					),
					...[LAB_DESCRIPTIONS.get(path)].flatMap((description) =>
						description === undefined
							? []
							: [h.span([h.Class("text-muted-fg text-xs")], [description])],
					),
				],
			),
		],
	)

export const lab = defineStaticLab("Lab", (h) =>
	labPage(
		h,
		{
			title: "Index",
			description:
				"Dev-only: UI pieces and pages over fixture data, no backend. Add a file under src/lab/entries/ to add a page.",
		},
		groups().map(([group, paths]) =>
			labSection(h, group === "" ? "Lab" : group, [
				h.ul(
					[h.Class("grid gap-2 sm:grid-cols-2 lg:grid-cols-3")],
					paths.map((path) => card(h, path)),
				),
			]),
		),
	),
)
