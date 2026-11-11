export const loaderStyles = {
	svg: "size-4",
	loader: (variant: string) => [
		"size-4",
		["ring"].includes(variant) && "animate-spin",
		variant === "spin" && "stroke-current",
	],
}
