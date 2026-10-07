import { IconChevronUpDown } from "~/components/icons/icon-chevron-up-down"
import type { ListBoxProps, PopoverProps, SelectProps as SelectPrimitiveProps } from "react-aria-components"
import { Button, ListBox, Select as SelectPrimitive, SelectValue } from "react-aria-components"
import { cx } from "~/lib/primitive"
import {
	DropdownDescription,
	DropdownItem,
	DropdownLabel,
	DropdownSection,
	DropdownSeparator,
} from "./dropdown"
import { fieldStyles } from "./field"
import { PopoverContent } from "./popover"
import {
	selectChevronClassName,
	selectListBoxBase,
	selectPopoverBase,
	selectTriggerBase,
	selectTriggerWrapperClassName,
	selectValueClassName,
} from "./select.styles"

interface SelectProps<
	T extends object,
	M extends "single" | "multiple" = "single",
> extends SelectPrimitiveProps<T, M> {
	items?: Iterable<T, M>
}

const Select = <T extends object, M extends "single" | "multiple" = "single">({
	className,
	...props
}: SelectProps<T, M>) => {
	return (
		<SelectPrimitive
			data-slot="control"
			className={cx(fieldStyles({ className: "group/select" }), className)}
			{...props}
		/>
	)
}

interface SelectListProps<T extends object> extends Omit<ListBoxProps<T>, "layout" | "orientation"> {
	items?: Iterable<T>
	popover?: Omit<PopoverProps, "children">
}

const SelectContent = <T extends object>({ items, className, popover, ...props }: SelectListProps<T>) => {
	return (
		<PopoverContent
			placement={popover?.placement ?? "bottom"}
			className={cx(selectPopoverBase, popover?.className)}
			{...popover}
		>
			<ListBox
				layout="stack"
				orientation="vertical"
				className={cx(selectListBoxBase, className)}
				items={items}
				{...props}
			/>
		</PopoverContent>
	)
}

interface SelectTriggerProps extends React.ComponentProps<typeof Button> {
	prefix?: React.ReactNode
	className?: string
}

const SelectTrigger = ({ children, className, ...props }: SelectTriggerProps) => {
	return (
		<span data-slot="control" className={selectTriggerWrapperClassName}>
			<Button className={cx(...selectTriggerBase, className)}>
				{(values) => (
					<>
						{props.prefix && <span className="text-muted-fg">{props.prefix}</span>}
						{typeof children === "function" ? children(values) : children}

						{!children && (
							<>
								<SelectValue data-slot="select-value" className={selectValueClassName} />
								<IconChevronUpDown data-slot="chevron" className={selectChevronClassName} />
							</>
						)}
					</>
				)}
			</Button>
		</span>
	)
}

const SelectSection = DropdownSection
const SelectSeparator = DropdownSeparator
const SelectLabel = DropdownLabel
const SelectDescription = DropdownDescription
const SelectItem = DropdownItem

export {
	Select,
	SelectDescription,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectSection,
	SelectTrigger,
	SelectContent,
}
export type { SelectProps, SelectTriggerProps }
