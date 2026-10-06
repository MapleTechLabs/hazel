/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const cardStyles = {
	card: "overflow-hidden rounded-xl border shadow-sm",
	cardDefault: "border-border bg-bg",
	cardDanger: "border-danger/20 bg-danger/5",
	cardHeader: "border-border border-b bg-bg-muted/30 px-4 py-5 md:px-6",
	cardHeaderGroup: "flex flex-col items-start gap-4 md:flex-row",
	cardBody: "p-4 md:p-6",
	cardTitle: "font-semibold text-2xl leading-none tracking-tight",
	cardDescription: "text-muted-fg text-sm",
} as const
