import type { ToggleButtonProps } from "react-aria-components"
import { composeRenderProps, ToggleButton } from "react-aria-components"
import { twMerge } from "tailwind-merge"
import type { VariantProps } from "tailwind-variants"
import { toggleStyles } from "./toggle.styles"

export { toggleStyles }

export interface ToggleProps extends ToggleButtonProps, VariantProps<typeof toggleStyles> {
	ref?: React.Ref<HTMLButtonElement>
}
export function Toggle({ className, size, intent, isCircle, ref, ...props }: ToggleProps) {
	return (
		<ToggleButton
			ref={ref}
			className={composeRenderProps(className, (className, renderProps) =>
				twMerge(
					toggleStyles({
						...renderProps,
						isCircle,
						size,
						intent,
						className,
					}),
				),
			)}
			{...props}
		/>
	)
}
