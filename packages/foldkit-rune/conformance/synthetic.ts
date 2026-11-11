/**
 * One element (or a small tree) per Tailwind utility family the resolver supports, rendered in
 * Chromium with Hazel's compiled stylesheet by `extract.ts --synthetic`. Hover-only variants are
 * left out: they need a pointer, and the native host applies them itself.
 */
export type Case = {
	readonly tag?: string
	readonly cls: string
	readonly attrs?: Readonly<Record<string, string>>
	readonly style?: string
	readonly text?: string
	readonly children?: ReadonlyArray<Case>
}

const leaf = (cls: string, extra: Omit<Case, "cls"> = {}): Case => ({ cls, text: "x", ...extra })

const row = (cls: string, children: ReadonlyArray<Case>): Case => ({ cls, children })

export const syntheticCases: ReadonlyArray<Case> = [
	// Spacing.
	leaf("p-3 px-4 pt-1 pb-[7px]"),
	leaf("m-2 mx-auto my-1 w-20"),
	leaf("ml-auto w-10"),
	leaf("-mt-2 mr-[3px] ms-4 me-1"),
	row("flex gap-x-3 gap-y-1.5 flex-wrap", [leaf("w-8"), leaf("w-8")]),
	row("space-y-2", [leaf(""), leaf(""), leaf("")]),
	row("flex space-x-3", [leaf(""), leaf("")]),
	// Sizing: fractions, viewport units, min/max, size, aspect.
	leaf("w-1/2 h-12"),
	leaf("w-[calc(100%-2rem)] h-[3.5rem]"),
	leaf("h-dvh w-screen max-w-sm"),
	leaf("size-6 min-w-0 min-h-10 max-h-40"),
	leaf("w-full max-w-[420px] min-w-[120px]"),
	leaf("aspect-square w-16"),
	leaf("aspect-video w-32"),
	leaf("aspect-[4/3] w-24"),
	leaf("w-[50vw] h-[10vh] max-h-[50dvh]"),
	leaf("min-w-full max-w-full min-h-full"),
	leaf("text-sm leading-[150%]"),
	leaf("max-lg:hidden max-md:text-danger max-xl:text-xs"),
	// The dithered avatar: a sized box, a size container, letters in container units.
	{
		cls: "relative size-8",
		children: [
			{
				cls: "relative flex size-full items-center justify-center overflow-hidden [container-type:size]",
				children: [
					{
						tag: "svg",
						cls: "absolute inset-0 size-full",
						attrs: { viewBox: "0 0 8 8", preserveAspectRatio: "none" },
					},
					{
						tag: "span",
						cls: "relative font-semibold leading-none",
						style: "font-size: 46cqw",
						text: "A",
					},
				],
			},
		],
	},
	// Colours: palette, theme tokens, opacity modifiers, color-mix, arbitrary.
	leaf("bg-red-500 text-white"),
	leaf("bg-primary text-primary-fg"),
	leaf("bg-primary/20 text-fg/70"),
	leaf("bg-muted text-muted-fg"),
	leaf("bg-fg-1 text-fg-3"),
	leaf("bg-[#ff000080] text-[rgb(10_20_30)]"),
	leaf("bg-[oklch(0.7_0.1_200)] text-[hsl(120_50%_40%)]"),
	leaf("bg-[color-mix(in_oklab,red_30%,blue)]"),
	leaf("bg-primary-subtle text-primary-subtle-fg"),
	leaf("bg-sidebar-primary text-sidebar-primary-fg"),
	leaf("bg-wash border border-current text-danger"),
	leaf("bg-transparent text-inherit"),
	// Radius: all, per side and per corner.
	leaf("rounded-lg"),
	leaf("rounded-full size-8"),
	leaf("rounded-t-md rounded-br-xl"),
	leaf("rounded-[5px] rounded-bl-none"),
	leaf("rounded-s-lg rounded-e-sm"),
	// Borders per side.
	leaf("border"),
	leaf("border-2 border-red-500"),
	leaf("border-t border-b-4 border-l-2 border-primary"),
	leaf("border-x border-y-2 border-dashed border-muted-fg"),
	leaf("border-b border-border"),
	leaf("divide-y"),
	// Rings, shadows, outlines.
	leaf("ring"),
	leaf("ring-2 ring-primary"),
	leaf("ring-1 ring-inset ring-fg/10"),
	leaf("shadow-sm"),
	leaf("shadow-lg shadow-red-500/30"),
	leaf("shadow-xs ring-1 ring-border"),
	leaf("shadow-control"),
	leaf("inset-shadow-sm"),
	leaf("shadow-[0_2px_4px_rgba(0,0,0,0.2)]"),
	leaf("outline-2 outline-offset-2 outline-primary"),
	leaf("outline outline-red-500"),
	leaf("outline-hidden"),
	leaf("ring-2 ring-offset-2 ring-primary"),
	// Typography.
	leaf("text-xs font-medium"),
	leaf("text-2xl font-bold leading-tight tracking-tight"),
	leaf("text-[13px] leading-5"),
	leaf("text-sm/6 font-light"),
	leaf("font-mono text-sm"),
	leaf("italic uppercase tracking-wide"),
	leaf("lowercase underline"),
	leaf("capitalize line-through not-italic"),
	leaf("whitespace-pre-wrap"),
	leaf("whitespace-nowrap truncate w-20"),
	leaf("text-center text-balance"),
	leaf("leading-none text-base"),
	row("text-lg font-semibold text-primary", [leaf(""), leaf("text-xs")]),
	// Flex and grid.
	row("flex flex-col items-center justify-between", [leaf("self-end grow"), leaf("shrink-0 basis-4")]),
	row("inline-flex items-start justify-end", [leaf("flex-1"), leaf("flex-none")]),
	row("flex flex-row-reverse items-baseline", [leaf("order-first"), leaf("")]),
	row("grid grid-cols-3 gap-2", [leaf("col-span-full"), leaf(""), leaf("")]),
	row("grid grid-cols-[auto_1fr] gap-x-4", [leaf(""), leaf("")]),
	row("flex", [leaf("flex-auto"), leaf("flex-initial"), leaf("flex-[2_0_10px]")]),
	leaf("inline-block"),
	leaf("hidden"),
	leaf("contents"),
	// Positioning.
	row("relative h-20", [
		leaf("absolute inset-0"),
		leaf("absolute top-1 right-2"),
		leaf("absolute -bottom-1 left-1/2 -translate-x-1/2"),
		leaf("absolute top-1/2 -translate-y-1/2"),
		leaf("fixed inset-x-0 bottom-0 z-50"),
		leaf("sticky top-0 z-10"),
		leaf("absolute translate-x-2 translate-y-[3px] -z-1"),
	]),
	// Visibility, opacity, overflow, object fit, images.
	leaf("invisible"),
	leaf("opacity-50"),
	leaf("overflow-hidden rounded-xl"),
	leaf("overflow-y-auto overflow-x-hidden"),
	leaf("sr-only"),
	{ tag: "img", cls: "size-10 object-cover rounded-full", attrs: { src: "/icon.svg", alt: "" } },
	{ tag: "img", cls: "size-10 object-contain", attrs: { src: "/icon.svg", alt: "" } },
	leaf("bg-[url(/icon.svg)] bg-cover size-8"),
	leaf("bg-linear-to-r from-red-500 to-blue-500 h-4"),
	leaf("bg-linear-to-b from-primary via-transparent to-fg h-4"),
	leaf("bg-linear-45 from-white to-black h-4"),
	// Variants: dark, data-, aria-, group-, has-, *:, **:, [&_x], not-, structural.
	leaf("bg-white dark:bg-black text-black dark:text-white"),
	leaf("data-[state=open]:bg-red-500 data-active:font-bold", {
		attrs: { "data-state": "open", "data-active": "" },
	}),
	leaf("aria-selected:bg-primary aria-[current=page]:text-danger", {
		attrs: { "aria-selected": "true", "aria-current": "page" },
	}),
	leaf("aria-disabled:opacity-50", { attrs: { "aria-disabled": "false" } }),
	row("group", [leaf("group-data-[open=true]:text-danger"), leaf("group-aria-expanded:font-bold")]),
	{
		cls: "group",
		attrs: { "data-open": "true", "aria-expanded": "true" },
		children: [leaf("group-data-[open=true]:text-danger"), leaf("group-aria-expanded:font-bold")],
	},
	{
		cls: "group/item",
		attrs: { "data-current": "true" },
		children: [leaf("group-data-current/item:bg-muted")],
	},
	{
		cls: "",
		attrs: { "data-selected": "true" },
		children: [{ cls: "", children: [leaf("in-data-selected:text-danger")] }],
	},
	row("has-[[data-slot=icon]]:gap-5 flex", [leaf("", { attrs: { "data-slot": "icon" } }), leaf("")]),
	row("has-data-[slot=badge]:pr-1 has-[img]:pl-3 flex", [leaf("", { attrs: { "data-slot": "badge" } })]),
	row("*:data-[slot=icon]:size-4 *:data-[slot=icon]:text-muted-fg flex", [
		leaf("", { attrs: { "data-slot": "icon" } }),
		leaf(""),
	]),
	row("**:data-[slot=avatar]:rounded-sm", [
		{ cls: "", children: [leaf("size-4", { attrs: { "data-slot": "avatar" } })] },
	]),
	row("*:px-2 *:text-sm", [leaf(""), leaf("")]),
	row("[&_.label]:font-bold [&_svg]:size-3 [&>span]:text-danger", [
		{ tag: "span", cls: "label", text: "x" },
		{ cls: "", children: [{ tag: "span", cls: "label", text: "y" }] },
	]),
	row("[&>[data-slot=a]+[data-slot=b]]:mt-3", [
		leaf("", { attrs: { "data-slot": "a" } }),
		leaf("", { attrs: { "data-slot": "b" } }),
	]),
	row("", [
		leaf("not-first:mt-2 first:pt-1 last:pb-1"),
		leaf("not-first:mt-2 first:pt-1 last:pb-1"),
		leaf("odd:bg-muted even:bg-wash"),
	]),
	row("", [leaf("odd:bg-muted even:bg-wash"), leaf("odd:bg-muted even:bg-wash"), leaf("only:text-danger")]),
	row("", [leaf("only:text-danger")]),
	leaf("not-data-active:bg-muted not-aria-selected:text-danger"),
	leaf("not-data-active:bg-muted", { attrs: { "data-active": "" } }),
	leaf("md:px-6 lg:flex xl:hidden sm:text-lg max-md:hidden"),
	leaf("[--size:20px] size-(--size) [--c:red] bg-(--c)"),
	leaf("p-[var(--missing,6px)] rounded-[calc(var(--radius-lg)-2px)]"),
	leaf("", { style: "padding: 4px 8px; color: rgb(1 2 3); --x: 5px; margin-left: var(--x)" }),
	row("text-danger", [
		{ tag: "svg", cls: "size-4", attrs: { viewBox: "0 0 24 24" } },
		leaf("text-current"),
	]),
	{ tag: "button", cls: "px-2", text: "b" },
	{ tag: "a", cls: "underline", attrs: { href: "#" }, text: "a" },
	{ tag: "strong", cls: "", text: "s" },
	{ tag: "code", cls: "", text: "c" },
	{ tag: "small", cls: "", text: "s" },
	{ tag: "h2", cls: "text-xl", text: "h" },
	{ tag: "input", cls: "w-full px-2", attrs: { type: "text" } },
]

const escape = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const VOID = new Set(["img", "input", "br", "hr"])

const render = (c: Case): string => {
	const tag = c.tag ?? "div"
	const attrs = Object.entries(c.attrs ?? {})
		.map(([name, value]) => ` ${name}="${escape(value)}"`)
		.join("")
	const cls = c.cls === "" ? "" : ` class="${escape(c.cls)}"`
	const style = c.style === undefined ? "" : ` style="${escape(c.style)}"`
	const open = `<${tag}${cls}${attrs}${style}>`
	if (VOID.has(tag)) return open
	return `${open}${escape(c.text ?? "")}${(c.children ?? []).map(render).join("")}</${tag}>`
}

/** Every class the cases use, for the stylesheet build. */
export const syntheticClasses = (): Array<string> => {
	const out = new Set<string>()
	const walk = (c: Case) => {
		for (const name of c.cls.split(/\s+/)) if (name !== "") out.add(name)
		for (const child of c.children ?? []) walk(child)
	}
	for (const c of syntheticCases) walk(c)
	return [...out].sort()
}

/** The page: the compiled sheet inline, each case in its own box under `#app`. */
export const syntheticHtml = (css: string, dark: boolean): string =>
	`<!doctype html><html lang="en" class="${dark ? "dark" : "light"}"><head><meta charset="utf-8"><style>${css}</style></head><body class="bg-bg text-fg"><div id="app">${syntheticCases
		.map((c) => `<section class="p-1">${render(c)}</section>`)
		.join("")}</div></body></html>`
