import { Switch as SwitchPrimitive, type SwitchProps } from "react-aria-components"
import { twJoin, twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { Label } from "./field"
import { switchIndicatorStyles, switchStyles, switchThumbStyles } from "./switch.styles"

export function Switch({ children, className, ...props }: SwitchProps) {
	return (
		<SwitchPrimitive
			{...props}
			data-slot="control"
			className={cx(switchStyles, className)}
			style={({ defaultStyle }) => ({
				...defaultStyle,
				WebkitTapHighlightColor: "transparent",
			})}
		>
			{(values) => (
				<>
					<span data-slot="indicator" className={twMerge(...switchIndicatorStyles(values))}>
						<span aria-hidden="true" className={twJoin(...switchThumbStyles(values))} />
					</span>
					{typeof children === "function" ? (
						children(values)
					) : typeof children === "string" ? (
						<SwitchLabel>{children}</SwitchLabel>
					) : (
						children
					)}
				</>
			)}
		</SwitchPrimitive>
	)
}

export function SwitchLabel(props: React.ComponentProps<typeof Label>) {
	return <Label elementType="span" {...props} />
}
