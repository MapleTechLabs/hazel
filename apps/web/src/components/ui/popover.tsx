import type { DialogTriggerProps, PopoverProps as PopoverPrimitiveProps } from "react-aria-components"
import {
	DialogTrigger as DialogTriggerPrimitive,
	OverlayArrow,
	Popover as PopoverPrimitive,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import {
	DialogBody,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./dialog"
import {
	popoverArrowClassName,
	popoverContentBase,
	popoverFooterBase,
	popoverInnerClassName,
} from "./popover.styles"

type PopoverProps = DialogTriggerProps
const Popover = (props: PopoverProps) => {
	return <DialogTriggerPrimitive {...props} />
}

const PopoverTitle = DialogTitle
const PopoverHeader = DialogHeader
const PopoverBody = DialogBody
const PopoverFooter = ({ className, ...props }: React.ComponentProps<typeof DialogFooter>) => (
	<DialogFooter className={twMerge(popoverFooterBase, className)} {...props} />
)

interface PopoverContentProps extends PopoverPrimitiveProps {
	arrow?: boolean
	ref?: React.Ref<HTMLDivElement>
}

const PopoverContent = ({ children, arrow = false, className, ref, ...props }: PopoverContentProps) => {
	const offset = props.offset ?? (arrow ? 12 : 8)
	return (
		<PopoverPrimitive
			ref={ref}
			offset={offset}
			className={cx(...popoverContentBase, className)}
			{...props}
		>
			{(values) => (
				<>
					{arrow && (
						<OverlayArrow className="group">
							<svg width={12} height={12} viewBox="0 0 12 12" className={popoverArrowClassName}>
								<path d="M0 0 L6 6 L12 0" />
							</svg>
						</OverlayArrow>
					)}
					<div data-slot="popover-inner" className={popoverInnerClassName}>
						{typeof children === "function" ? children(values) : children}
					</div>
				</>
			)}
		</PopoverPrimitive>
	)
}

const PopoverTrigger = DialogTrigger
const PopoverClose = DialogClose
const PopoverDescription = DialogDescription

export type { PopoverProps, PopoverContentProps }
export {
	Popover,
	PopoverTrigger,
	PopoverClose,
	PopoverDescription,
	PopoverContent,
	PopoverBody,
	PopoverFooter,
	PopoverHeader,
	PopoverTitle,
}
