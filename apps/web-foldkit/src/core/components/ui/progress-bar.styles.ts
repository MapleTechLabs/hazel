export const progressBarStyles = {
	root: [
		"w-full",
		"[&>[data-slot=progress-bar-header]+[data-slot=progress-bar-track]]:mt-2",
		"[&>[data-slot=progress-bar-header]+[data-slot=progress-bar-track]]:mt-2",
		"[&>[data-slot=progress-bar-header]+[slot='description']]:mt-1",
		"[&>[slot='description']+[data-slot=progress-bar-track]]:mt-2",
		"[&>[data-slot=progress-bar-track]+[slot=description]]:mt-2",
		"[&>[data-slot=progress-bar-track]+[slot=errorMessage]]:mt-2",
		"*:data-[slot=progress-bar-header]:font-medium",
	],
	track: "relative block w-full",
	trackInner: "flex w-full items-center gap-x-2",
	bar: "relative h-1.5 w-full min-w-52 overflow-hidden rounded-full bg-secondary outline-1 outline-transparent -outline-offset-1 will-change-transform",
	fill: "absolute top-0 left-0 h-full rounded-full bg-primary transition-[width] duration-200 ease-linear will-change-[width] motion-reduce:transition-none forced-colors:bg-[Highlight]",
	fillIndeterminate:
		"absolute top-0 left-0 h-full w-2/5 animate-progress-slide rounded-full bg-primary forced-colors:bg-[Highlight]",
} as const
