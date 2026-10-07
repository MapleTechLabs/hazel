import type { DialogProps, DialogTriggerProps, ModalOverlayProps } from "react-aria-components"
import {
	composeRenderProps,
	DialogTrigger as DialogTriggerPrimitive,
	Modal,
	ModalOverlay,
} from "react-aria-components"
import {
	Dialog,
	DialogBody,
	DialogClose,
	DialogCloseIcon,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./dialog"
import {
	type Sides,
	sheetCloseIconClassName,
	sheetContentStyles,
	sheetOverlayClassName,
} from "./sheet.styles"

type SheetProps = DialogTriggerProps
const Sheet = (props: SheetProps) => {
	return <DialogTriggerPrimitive {...props} />
}

interface SheetContentProps
	extends
		Omit<ModalOverlayProps, "children">,
		Pick<DialogProps, "aria-label" | "role" | "aria-labelledby" | "children"> {
	closeButton?: boolean
	isBlurred?: boolean
	isFloat?: boolean
	side?: Sides
	overlay?: Omit<ModalOverlayProps, "children">
}

const SheetContent = ({
	className,
	isBlurred = false,
	isDismissable: isDismissableInternal,
	side = "right",
	role = "dialog",
	closeButton = true,
	isFloat = true,
	overlay,
	children,
	...props
}: SheetContentProps) => {
	const isDismissable = isDismissableInternal ?? role !== "alertdialog"
	return (
		<ModalOverlay
			isDismissable={isDismissable}
			className={({ isExiting, isEntering }) => sheetOverlayClassName(isEntering, isExiting, isBlurred)}
			{...props}
		>
			<Modal
				className={composeRenderProps(className, (className, renderProps) =>
					sheetContentStyles({
						...renderProps,
						side,
						isFloat,
						className,
					}),
				)}
			>
				<Dialog aria-label={props["aria-label"]} role={role}>
					{(values) => (
						<>
							{typeof children === "function" ? children(values) : children}
							{closeButton && (
								<DialogCloseIcon
									className={sheetCloseIconClassName}
									isDismissable={isDismissable}
								/>
							)}
						</>
					)}
				</Dialog>
			</Modal>
		</ModalOverlay>
	)
}

const SheetTrigger = DialogTrigger
const SheetFooter = DialogFooter
const SheetHeader = DialogHeader
const SheetTitle = DialogTitle
const SheetDescription = DialogDescription
const SheetBody = DialogBody
const SheetClose = DialogClose

export type { SheetProps, SheetContentProps, Sides }
export {
	Sheet,
	SheetTrigger,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetDescription,
	SheetBody,
	SheetClose,
	SheetContent,
}
