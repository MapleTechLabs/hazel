import type { RadioGroupProps, RadioProps } from "react-aria-components"
import {
	composeRenderProps,
	RadioGroup as RadioGroupPrimitive,
	Radio as RadioPrimitive,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { Label } from "./field"
import { radioGroupStyles, radioIndicatorStyles, radioLayoutStyles, radioStyles } from "./radio.styles"

export function RadioGroup({ className, ...props }: RadioGroupProps) {
	return (
		<RadioGroupPrimitive {...props} data-slot="control" className={cx(...radioGroupStyles, className)} />
	)
}

export function Radio({ className, children, ...props }: RadioProps) {
	return (
		<RadioPrimitive {...props} className={cx(radioStyles, className)}>
			{composeRenderProps(children, (children, { isSelected, isFocusVisible, isInvalid }) => {
				const isStringChild = typeof children === "string"
				const content = isStringChild ? <Label>{children}</Label> : children

				return (
					<div className={twMerge(...radioLayoutStyles)}>
						<span
							data-slot="indicator"
							className={twMerge(
								radioIndicatorStyles({ isSelected, isFocusVisible, isInvalid }),
							)}
						/>
						{content}
					</div>
				)
			})}
		</RadioPrimitive>
	)
}
