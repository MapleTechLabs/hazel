import { tv, type VariantProps } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */

// ============================================================================
// Shared Embed Styles
// ============================================================================

/**
 * Container styles for embed components (Embed, EmbedError, EmbedSkeleton)
 */
export const embedContainerStyles = tv({
	base: ["mt-2 flex max-w-md overflow-hidden", "border border-border/60 bg-muted"],
	variants: {
		variant: {
			default: "flex-col rounded-r-lg border-l-2! transition-all duration-200",
			error: "items-center gap-3 rounded-r-lg border-l-2! p-3",
			skeleton: "flex-col rounded-lg border-l-4",
		},
	},
	defaultVariants: {
		variant: "default",
	},
})

/**
 * Section styles for embed internal sections (Author, Footer, Fields, Image)
 */
export const embedSectionStyles = tv({
	base: "border-border",
	variants: {
		position: {
			top: "border-b",
			bottom: "border-t",
		},
		padding: {
			default: "px-3 py-2",
			compact: "px-3 py-1.5",
			none: "",
		},
	},
	defaultVariants: {
		padding: "default",
	},
})

export type EmbedContainerVariants = VariantProps<typeof embedContainerStyles>
export type EmbedSectionVariants = VariantProps<typeof embedSectionStyles>
