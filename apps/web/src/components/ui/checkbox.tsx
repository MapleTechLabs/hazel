import { IconMinus } from "~/components/icons/icon-minus"
import type { CheckboxGroupProps, CheckboxProps } from "react-aria-components"
import {
	CheckboxGroup as CheckboxGroupPrimitive,
	Checkbox as CheckboxPrimitive,
	composeRenderProps,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import IconCheck from "../icons/icon-check"
import {
	checkboxGroupStyles,
	checkboxIndicatorStyles,
	checkboxLayoutStyles,
	checkboxStyles,
} from "./checkbox.styles"
import { Label } from "./field"

export function CheckboxGroup({ className, ...props }: CheckboxGroupProps) {
	return (
		<CheckboxGroupPrimitive
			{...props}
			data-slot="control"
			className={cx(checkboxGroupStyles, className)}
		/>
	)
}

export function Checkbox({ className, children, ...props }: CheckboxProps) {
	return (
		<CheckboxPrimitive data-slot="control" className={cx(checkboxStyles, className)} {...props}>
			{composeRenderProps(
				children,
				(children, { isSelected, isIndeterminate, isFocusVisible, isInvalid }) => {
					const isStringChild = typeof children === "string"
					const indicator = isIndeterminate ? (
						<IconMinus data-slot="check-indicator" />
					) : isSelected ? (
						<IconCheck data-slot="check-indicator" />
					) : null

					const content = isStringChild ? <CheckboxLabel>{children}</CheckboxLabel> : children

					return (
						<div className={twMerge(...checkboxLayoutStyles)}>
							<span
								data-slot="indicator"
								className={twMerge(
									checkboxIndicatorStyles({
										isSelected,
										isIndeterminate,
										isFocusVisible,
										isInvalid,
									}),
								)}
							>
								{indicator}
							</span>
							{content}
						</div>
					)
				},
			)}
		</CheckboxPrimitive>
	)
}

export function CheckboxLabel(props: React.ComponentProps<typeof Label>) {
	return <Label elementType="span" {...props} />
}
