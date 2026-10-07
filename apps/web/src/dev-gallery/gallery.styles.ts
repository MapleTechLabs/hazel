/** Page chrome for `/dev/gallery/$component`, shared by both apps. Keep this file framework-free. */
export const galleryStyles = {
	page: "min-h-screen bg-bg p-8 text-fg",
	title: "mb-6 font-semibold text-lg",
	sections: "flex flex-col gap-8",
	section: "flex flex-col gap-3",
	sectionTitle: "font-medium text-muted-fg text-sm",
	row: "flex flex-wrap items-start gap-3",
} as const
