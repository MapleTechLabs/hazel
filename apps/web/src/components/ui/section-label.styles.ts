/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const sectionLabelStyles = {
	sizes: {
		sm: {
			heading: "gap-0.5 text-sm font-semibold",
			subheading: "text-sm",
		},
		md: {
			heading: "gap-1 text-base font-semibold",
			subheading: "text-base",
		},
	},
	heading: "flex items-center text-fg",
	required: "hidden text-primary",
	requiredShown: "block",
	description: "text-muted-fg",
	actions: "mt-3 flex gap-2",
} as const
