"use client"

import { use } from "react"
import type { InputProps } from "react-aria-components"
import {
	Button,
	Input as InputPrimitive,
	OverlayTriggerStateContext,
	Radio,
	RadioGroup,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import {
	commandMenuFormBackClassName,
	commandMenuFormBackIconClassName,
	commandMenuFormBodyBase,
	commandMenuFormContainerBase,
	commandMenuFormErrorClassName,
	commandMenuFormEscapeClassName,
	commandMenuFormFieldBase,
	commandMenuFormFooterBase,
	commandMenuFormHeaderBase,
	commandMenuFormLabelClassName,
	commandMenuFormSubtitleClassName,
	commandMenuFormTitleClassName,
	commandMenuFormTitlesClassName,
	commandMenuInputBase,
	commandMenuInputIconClassName,
	commandMenuInputWrapperClassName,
	commandMenuToggleBase,
	commandMenuToggleOptionClassName,
} from "./command-menu-form.styles"

function ChevronLeftIcon({ className }: { className?: string }) {
	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={className}>
			<path
				fillRule="evenodd"
				d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
				clipRule="evenodd"
			/>
		</svg>
	)
}

/**
 * Container for form content in command palette
 */
export function CommandMenuFormContainer({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return <div className={twMerge(commandMenuFormContainerBase, className)}>{children}</div>
}

/**
 * Header for form pages in command palette
 * Replaces the search input for form pages
 */
export function CommandMenuFormHeader({
	title,
	subtitle,
	onBack,
	className,
}: {
	title: string
	subtitle?: string
	onBack?: () => void
	className?: string
}) {
	const state = use(OverlayTriggerStateContext)!

	return (
		<div className={twMerge(commandMenuFormHeaderBase, className)}>
			{onBack && (
				<Button onPress={onBack} className={commandMenuFormBackClassName}>
					<ChevronLeftIcon className={commandMenuFormBackIconClassName} />
				</Button>
			)}
			<div className={commandMenuFormTitlesClassName}>
				<h2 className={commandMenuFormTitleClassName}>{title}</h2>
				{subtitle && <p className={commandMenuFormSubtitleClassName}>{subtitle}</p>}
			</div>
			<Button onPress={() => state?.close()} className={commandMenuFormEscapeClassName}>
				Esc
			</Button>
		</div>
	)
}

/**
 * Body section for form content
 */
export function CommandMenuFormBody({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return <div className={twMerge(commandMenuFormBodyBase, className)}>{children}</div>
}

/**
 * Footer with keyboard hints and submit button
 */
export function CommandMenuFormFooter({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return <div className={twMerge(...commandMenuFormFooterBase, className)}>{children}</div>
}

/**
 * Form field wrapper with label
 */
export function CommandMenuFormField({
	label,
	error,
	children,
	className,
}: {
	label?: string
	error?: string
	children: React.ReactNode
	className?: string
}) {
	return (
		<div className={twMerge(commandMenuFormFieldBase, className)}>
			{label && <label className={commandMenuFormLabelClassName}>{label}</label>}
			{children}
			{error && (
				<p className={commandMenuFormErrorClassName} role="alert">
					{error}
				</p>
			)}
		</div>
	)
}

interface CommandMenuInputProps extends Omit<InputProps, "className"> {
	className?: string
	icon?: React.ReactNode
}

/**
 * Simplified input for command palette forms
 */
export function CommandMenuInput({ className, icon, ...props }: CommandMenuInputProps) {
	return (
		<div className={commandMenuInputWrapperClassName}>
			{icon && <div className={commandMenuInputIconClassName}>{icon}</div>}
			<InputPrimitive className={cx(...commandMenuInputBase(!!icon), className)} {...props} />
		</div>
	)
}

/**
 * Inline toggle group for binary choices (e.g., public/private)
 */
export function CommandMenuToggle({
	value,
	onChange,
	options,
	className,
}: {
	value: string
	onChange: (value: string) => void
	options: { value: string; label: string; icon?: React.ReactNode }[]
	className?: string
}) {
	return (
		<RadioGroup
			value={value}
			onChange={onChange}
			orientation="horizontal"
			className={twMerge(commandMenuToggleBase, className)}
		>
			{options.map((option) => (
				<Radio
					key={option.value}
					value={option.value}
					className={({ isSelected }) => commandMenuToggleOptionClassName(isSelected)}
				>
					{option.icon}
					{option.label}
				</Radio>
			))}
		</RadioGroup>
	)
}
