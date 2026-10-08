/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const loaderStyles = {
	svg: "size-4",
	loader: (variant: string) => [
		"size-4",
		["ring"].includes(variant) && "animate-spin",
		variant === "spin" && "stroke-current",
	],
}
