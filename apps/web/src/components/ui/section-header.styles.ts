/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const sectionHeaderStyles = {
	root: "flex flex-col gap-5 border-border border-b pb-5",
	group: "relative flex flex-col items-start gap-4 md:flex-row",
	actions: "flex gap-3",
	heading: "font-semibold text-fg",
	headingXl: "text-2xl",
	headingLg: "text-lg",
	subheading: "text-muted-fg text-sm",
} as const
