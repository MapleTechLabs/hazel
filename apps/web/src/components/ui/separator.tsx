import { Separator as Divider, type SeparatorProps } from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { separatorStyles } from "./separator.styles"

export function Separator({ orientation = "horizontal", className, ...props }: SeparatorProps) {
	return (
		<Divider
			className={twMerge(
				separatorStyles.base,
				orientation === "horizontal" ? separatorStyles.horizontal : separatorStyles.vertical,
				className,
			)}
			{...props}
		/>
	)
}
