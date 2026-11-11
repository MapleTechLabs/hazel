import { tv } from "tailwind-variants"

/**
 * An HTML render embed: the bot's sandboxed page on the channel background. The page keeps 8px
 * around its content for focus rings and shadows (`BASE_CSS`, `@hazel/domain/html-render`), so the
 * frame is 8px wider on each side: the content lines up with the message text. The controls sit
 * under the frame, never over the page, whose own controls are often in its corners. A collapsed
 * page fades out through a mask, so it fades into whatever is behind it (the row's hover
 * background included) with no colour to keep in step.
 */
export const htmlRenderStyles = tv({
	slots: {
		root: "-mx-2",
		viewport: "relative overflow-hidden",
		frame: "block w-full border-0 bg-transparent",
		skeleton: "absolute inset-2 animate-pulse rounded-lg bg-muted",
		error: "absolute inset-2 flex items-center justify-center rounded-lg border border-border/60 text-muted-fg text-xs",
		controls: "flex items-center gap-3 px-2",
		control: [
			"inline-flex items-center gap-1 rounded-sm py-1 text-muted-fg text-xs outline-hidden transition-colors duration-150",
			"hover:text-fg focus-visible:text-fg focus-visible:ring-1 focus-visible:ring-primary",
			"*:data-[slot=icon]:size-3 *:data-[slot=icon]:shrink-0",
		],
	},
	variants: {
		isLoaded: {
			true: { frame: "" },
			false: { frame: "invisible" },
		},
		isCollapsed: {
			true: { viewport: "mask-b-from-[calc(100%-4rem)]" },
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
