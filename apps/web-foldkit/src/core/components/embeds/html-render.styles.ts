import { tv } from "tailwind-variants"

/** An HTML render embed: the bot's sandboxed page on the channel background. */
export const htmlRenderStyles = tv({
	slots: {
		root: "group/html-render relative w-full",
		viewport: "relative w-full overflow-hidden rounded-lg",
		frame: "block w-full border-0 bg-transparent",
		skeleton: "absolute inset-0 animate-pulse rounded-lg bg-muted",
		error: "flex size-full items-center justify-center rounded-lg border border-border/60 text-muted-fg text-xs",
		fade: "pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-bg to-transparent group-hover:from-secondary",
		fullscreen: [
			"absolute top-2 right-2 opacity-0 transition-opacity duration-150",
			"focus-visible:opacity-100 group-focus-within/html-render:opacity-100 group-hover/html-render:opacity-100 pointer-coarse:opacity-100",
			"bg-overlay/90 shadow-xs ring ring-fg/5 backdrop-blur-sm dark:ring-border",
		],
		toggle: "mt-1 text-muted-fg text-xs hover:text-fg",
	},
	variants: {
		isLoaded: {
			true: { frame: "" },
			false: { frame: "invisible" },
		},
	},
})

/** The fullscreen dialog around the page. */
export const htmlRenderDialogStyles = tv({
	slots: {
		// The modal's inner section must fill the panel, or the frame falls back to 150px.
		panel: "h-[90dvh] p-0! sm:h-[calc(100dvh-1.5rem)] [&>section]:min-h-0 [&>section]:flex-1",
		header: "flex shrink-0 items-center border-border border-b px-4 py-3 pr-12",
		title: "truncate font-medium text-fg text-sm",
		body: "relative min-h-0 flex-1",
		frame: "block size-full border-0 bg-transparent",
		status: "flex size-full items-center justify-center text-muted-fg text-sm",
	},
})
