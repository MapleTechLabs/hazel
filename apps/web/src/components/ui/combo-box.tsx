"use client"

import { IconChevronUpDown } from "~/components/icons/icon-chevron-up-down"
import type {
	ComboBoxProps as ComboboxPrimitiveProps,
	InputProps,
	ListBoxProps,
	PopoverProps,
} from "react-aria-components"
import {
	Button,
	ComboBoxContext,
	ComboBox as ComboboxPrimitive,
	ListBox,
	useSlottedContext,
} from "react-aria-components"
import { fieldStyles } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { cx } from "~/lib/primitive"
import { DropdownDescription, DropdownItem, DropdownLabel, DropdownSection } from "./dropdown"
import {
	comboBoxButtonClassName,
	comboBoxChevronClassName,
	comboBoxInputWrapperClassName,
	comboBoxListBoxBase,
	comboBoxPopoverBase,
} from "./combo-box.styles"
import { PopoverContent } from "./popover"

interface ComboBoxProps<T extends object> extends Omit<ComboboxPrimitiveProps<T>, "children"> {
	children: React.ReactNode
}

const ComboBox = <T extends object>({ className, ...props }: ComboBoxProps<T>) => {
	return <ComboboxPrimitive data-slot="control" className={cx(fieldStyles(), className)} {...props} />
}

interface ComboBoxListProps<T extends object>
	extends Omit<ListBoxProps<T>, "layout" | "orientation">, Pick<PopoverProps, "placement"> {
	popover?: Omit<PopoverProps, "children">
}

const ComboBoxContent = <T extends object>({
	children,
	items,
	className,
	popover,
	...props
}: ComboBoxListProps<T>) => {
	return (
		<PopoverContent
			placement={popover?.placement ?? "bottom"}
			className={cx(comboBoxPopoverBase, popover?.className)}
			{...popover}
		>
			<ListBox
				layout="stack"
				orientation="vertical"
				className={cx(comboBoxListBoxBase, className)}
				items={items}
				{...props}
			>
				{children}
			</ListBox>
		</PopoverContent>
	)
}

const ComboBoxInput = (props: InputProps) => {
	const context = useSlottedContext(ComboBoxContext)!
	return (
		<span data-slot="control" className={comboBoxInputWrapperClassName}>
			<Input {...props} placeholder={props?.placeholder} />
			<Button className={comboBoxButtonClassName}>
				{!context?.inputValue && (
					<IconChevronUpDown data-slot="chevron" className={comboBoxChevronClassName} />
				)}
			</Button>
		</span>
	)
}

const ComboBoxSection = DropdownSection
const ComboBoxItem = DropdownItem
const ComboBoxLabel = DropdownLabel
const ComboBoxDescription = DropdownDescription

export type { ComboBoxProps, ComboBoxListProps }
export {
	ComboBox,
	ComboBoxInput,
	ComboBoxContent,
	ComboBoxItem,
	ComboBoxLabel,
	ComboBoxDescription,
	ComboBoxSection,
}
