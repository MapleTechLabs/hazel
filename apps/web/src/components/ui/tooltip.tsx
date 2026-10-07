"use client"

import type { TooltipProps as TooltipPrimitiveProps } from "react-aria-components"
import {
	Button,
	composeRenderProps,
	OverlayArrow,
	Tooltip as TooltipPrimitive,
	TooltipTrigger as TooltipTriggerPrimitive,
} from "react-aria-components"
import { twJoin } from "tailwind-merge"
import type { VariantProps } from "tailwind-variants"
import { tooltipArrowBase, tooltipArrowDefault, tooltipArrowInverse, tooltipStyles } from "./tooltip.styles"

type TooltipProps = React.ComponentProps<typeof TooltipTriggerPrimitive>
const Tooltip = (props: TooltipProps) => <TooltipTriggerPrimitive {...props} />

interface TooltipContentProps
	extends Omit<TooltipPrimitiveProps, "children">, VariantProps<typeof tooltipStyles> {
	arrow?: boolean
	children?: React.ReactNode
}

const TooltipContent = ({ offset = 10, arrow = true, inverse, children, ...props }: TooltipContentProps) => {
	return (
		<TooltipPrimitive
			{...props}
			offset={offset}
			className={composeRenderProps(props.className, (className, renderProps) =>
				tooltipStyles({
					...renderProps,
					inverse,
					className,
				}),
			)}
		>
			{arrow && (
				<OverlayArrow className="group">
					<svg
						width={12}
						height={12}
						viewBox="0 0 12 12"
						// inverse
						className={twJoin(
							tooltipArrowBase,
							inverse ? tooltipArrowInverse : tooltipArrowDefault,
						)}
					>
						<path d="M0 0 L6 6 L12 0" />
					</svg>
				</OverlayArrow>
			)}
			{children}
		</TooltipPrimitive>
	)
}

const TooltipTrigger = Button

export type { TooltipProps, TooltipContentProps }
export { Tooltip, TooltipTrigger, TooltipContent }
