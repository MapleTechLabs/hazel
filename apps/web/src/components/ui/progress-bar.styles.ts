/** Shared by the React and Foldkit apps: keep this file framework-free. */
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
	header: "flex items-center justify-between",
	value: "text-base/6 sm:text-sm/6",
	track: "relative block w-full",
	keyframes: `
        @keyframes progress-slide {
          0% { left: 0% }
          50% { left: 100% }
          100% { left: 0% }
        }
      `,
	trackInner: "flex w-full items-center gap-x-2",
	bar: "relative h-1.5 w-full min-w-52 overflow-hidden rounded-full bg-secondary outline-1 outline-transparent -outline-offset-1 will-change-transform",
	fill: "absolute top-0 left-0 h-full rounded-full bg-primary transition-[width] duration-200 ease-linear will-change-[width] motion-reduce:transition-none forced-colors:bg-[Highlight]",
	fillIndeterminate:
		"absolute top-0 h-full rounded-full bg-primary [animation:progress-slide_2000ms_ease-in-out_infinite] forced-colors:bg-[Highlight]",
} as const
