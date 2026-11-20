import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { kbd as keyCap } from "../../ui/kbd"

/** Keyboard hints: one key cap, and the queue's hint bar (`j k Navigate · a Assign · …`). */

export const kbd = <M>(h: HtmlBuilder<M>, key: string, className?: string): Html =>
	keyCap(h, { size: "sm", className: twMerge("max-md:hidden", className) }, key)

export type Shortcut = Readonly<{ keys: ReadonlyArray<string>; label: string }>

/** The queue's default keys (spec §2). */
export const QUEUE_SHORTCUTS: ReadonlyArray<Shortcut> = [
	{ keys: ["j", "k"], label: "Navigate" },
	{ keys: ["a"], label: "Assign" },
	{ keys: ["i"], label: "Assign to me" },
	{ keys: ["h"], label: "Snooze" },
	{ keys: ["d"], label: "Done" },
	{ keys: ["Enter"], label: "Open" },
]

export const shortcutBar = <M>(
	h: HtmlBuilder<M>,
	shortcuts: ReadonlyArray<Shortcut>,
	options: Readonly<{ className?: string }> = {},
): Html =>
	h.ul(
		[
			h.AriaLabel("Keyboard shortcuts"),
			h.Class(
				twMerge(
					"flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-fg text-xs max-md:hidden",
					options.className,
				),
			),
		],
		shortcuts.map((shortcut) =>
			h.li(
				[h.Class("inline-flex items-center gap-1.5")],
				[
					h.span(
						[h.Class("inline-flex gap-0.5")],
						shortcut.keys.map((key) => kbd(h, key)),
					),
					shortcut.label,
				],
			),
		),
	)
