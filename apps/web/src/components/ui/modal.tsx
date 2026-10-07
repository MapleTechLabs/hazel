import type { DialogProps, DialogTriggerProps, ModalOverlayProps } from "react-aria-components"
import {
	DialogTrigger as DialogTriggerPrimitive,
	ModalOverlay,
	Modal as ModalPrimitive,
} from "react-aria-components"
import { cx } from "~/lib/primitive"
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
import { type ModalSize, modalContentBase, modalOverlayClassName } from "./modal.styles"

interface ModalProps extends DialogTriggerProps {
	isOpen?: boolean
	onOpenChange?: (isOpen: boolean) => void
}

const Modal = ({ isOpen, onOpenChange, children, ...props }: ModalProps) => {
	// Controlled mode - when isOpen is explicitly provided
	if (isOpen !== undefined) {
		return (
			<ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
				{children}
			</ModalOverlay>
		)
	}
	// Uncontrolled mode - use DialogTrigger (requires trigger button as child)
	return <DialogTriggerPrimitive {...props}>{children}</DialogTriggerPrimitive>
}

interface ModalContentProps
	extends
		Omit<ModalOverlayProps, "className" | "children">,
		Pick<DialogProps, "aria-label" | "aria-labelledby" | "role" | "children"> {
	size?: ModalSize
	closeButton?: boolean
	isBlurred?: boolean
	className?: ModalOverlayProps["className"]
	overlay?: Omit<ModalOverlayProps, "children">
}

const ModalContent = ({
	className,
	isDismissable: isDismissableInternal,
	isBlurred = false,
	children,
	overlay,
	size = "lg",
	role = "dialog",
	closeButton = true,
	...props
}: ModalContentProps) => {
	const isDismissable = isDismissableInternal ?? role !== "alertdialog"

	return (
		<ModalOverlay
			data-slot="modal-overlay"
			isDismissable={isDismissable}
			className={modalOverlayClassName(size, isBlurred)}
			{...props}
		>
			<ModalPrimitive
				data-slot="modal-content"
				className={cx(...modalContentBase(size), className)}
				{...props}
			>
				<Dialog role={role}>
					{(values) => (
						<>
							{typeof children === "function" ? children(values) : children}
							{closeButton && <DialogCloseIcon isDismissable={isDismissable} />}
						</>
					)}
				</Dialog>
			</ModalPrimitive>
		</ModalOverlay>
	)
}

const ModalTrigger = DialogTrigger
const ModalHeader = DialogHeader
const ModalTitle = DialogTitle
const ModalDescription = DialogDescription
const ModalFooter = DialogFooter
const ModalBody = DialogBody
const ModalClose = DialogClose

export {
	Modal,
	ModalTrigger,
	ModalHeader,
	ModalTitle,
	ModalDescription,
	ModalFooter,
	ModalBody,
	ModalClose,
	ModalContent,
}
