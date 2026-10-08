import { useRef } from "react"
import type { HeadingProps, TextProps } from "react-aria-components"
import { Heading, Button as PrimitiveButton, Dialog as PrimitiveDialog } from "react-aria-components"
import { twMerge } from "tailwind-merge"
import IconClose from "~/components/icons/icon-close"
import { useMountEffect } from "~/hooks/use-mount-effect"
import { cx } from "~/lib/primitive"
import { Button, type ButtonProps } from "./button"
import {
	dialogBase,
	dialogBodyBase,
	dialogCloseIconBase,
	dialogDescriptionBase,
	dialogFooterBase,
	dialogHeaderBase,
	dialogTitleBase,
	dialogTriggerBase,
} from "./dialog.styles"

const Dialog = ({ role = "dialog", className, ...props }: React.ComponentProps<typeof PrimitiveDialog>) => {
	return (
		<PrimitiveDialog
			data-slot="dialog"
			role={role}
			className={twMerge(dialogBase, className)}
			{...props}
		/>
	)
}

const DialogTrigger = ({ className, ...props }: ButtonProps) => (
	<PrimitiveButton className={cx(dialogTriggerBase, className)} {...props} />
)

interface DialogHeaderProps extends Omit<React.ComponentProps<"div">, "title"> {
	title?: string
	description?: string
}

const DialogHeader = ({ className, ...props }: DialogHeaderProps) => {
	const headerRef = useRef<HTMLHeadingElement>(null)

	useMountEffect(() => {
		const header = headerRef.current
		if (!header) {
			return
		}

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				header.parentElement?.style.setProperty(
					"--dialog-header-height",
					`${entry.target.clientHeight}px`,
				)
			}
		})

		observer.observe(header)
		return () => observer.unobserve(header)
	})

	return (
		<div data-slot="dialog-header" ref={headerRef} className={twMerge(dialogHeaderBase, className)}>
			{props.title && <DialogTitle>{props.title}</DialogTitle>}
			{props.description && <DialogDescription>{props.description}</DialogDescription>}
			{!props.title && typeof props.children === "string" ? <DialogTitle {...props} /> : props.children}
		</div>
	)
}

interface DialogTitleProps extends HeadingProps {
	ref?: React.Ref<HTMLHeadingElement>
}
const DialogTitle = ({ className, ref, ...props }: DialogTitleProps) => (
	<Heading slot="title" ref={ref} className={twMerge(dialogTitleBase, className)} {...props} />
)

interface DialogDescriptionProps extends TextProps {
	ref?: React.Ref<HTMLDivElement>
}
const DialogDescription = ({ className, ref, ...props }: DialogDescriptionProps) => (
	<p data-slot="description" className={twMerge(dialogDescriptionBase, className)} ref={ref} {...props} />
)

interface DialogBodyProps extends React.ComponentProps<"div"> {}
const DialogBody = ({ className, ref, ...props }: DialogBodyProps) => (
	<div data-slot="dialog-body" ref={ref} className={twMerge(...dialogBodyBase, className)} {...props} />
)

interface DialogFooterProps extends React.ComponentProps<"div"> {}
const DialogFooter = ({ className, ...props }: DialogFooterProps) => {
	const footerRef = useRef<HTMLDivElement>(null)

	useMountEffect(() => {
		const footer = footerRef.current

		if (!footer) {
			return
		}

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				footer.parentElement?.style.setProperty(
					"--dialog-footer-height",
					`${entry.target.clientHeight}px`,
				)
			}
		})

		observer.observe(footer)
		return () => {
			observer.unobserve(footer)
		}
	})
	return (
		<div
			ref={footerRef}
			data-slot="dialog-footer"
			className={twMerge(dialogFooterBase, className)}
			{...props}
		/>
	)
}

const DialogClose = ({ intent = "plain", ref, ...props }: ButtonProps) => {
	return <Button slot="close" ref={ref} intent={intent} {...props} />
}

interface CloseButtonIndicatorProps extends Omit<ButtonProps, "children"> {
	className?: string
	isDismissable?: boolean | undefined
}

const DialogCloseIcon = ({ className, ...props }: CloseButtonIndicatorProps) => {
	return props.isDismissable ? (
		<PrimitiveButton aria-label="Close" slot="close" className={cx(dialogCloseIconBase, className)}>
			<IconClose className="size-4" />
		</PrimitiveButton>
	) : null
}

export type {
	DialogHeaderProps,
	DialogTitleProps,
	DialogBodyProps,
	DialogFooterProps,
	DialogDescriptionProps,
	CloseButtonIndicatorProps,
}
export {
	Dialog,
	DialogClose,
	DialogTrigger,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogBody,
	DialogFooter,
	DialogCloseIcon,
}
