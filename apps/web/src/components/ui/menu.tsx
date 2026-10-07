"use client"

import { IconChevronRight } from "~/components/icons/icon-chevron-right"
import { createLink } from "@tanstack/react-router"
import type {
	ButtonProps,
	MenuItemProps as MenuItemPrimitiveProps,
	MenuProps as MenuPrimitiveProps,
	MenuSectionProps as MenuSectionPrimitiveProps,
	MenuTriggerProps as MenuTriggerPrimitiveProps,
} from "react-aria-components"
import {
	Button,
	Collection,
	composeRenderProps,
	Header,
	MenuItem as MenuItemPrimitive,
	Menu as MenuPrimitive,
	MenuSection as MenuSectionPrimitive,
	MenuTrigger as MenuTriggerPrimitive,
	SubmenuTrigger as SubmenuTriggerPrimitive,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import type { VariantProps } from "tailwind-variants"
import IconCheck from "~/components/icons/icon-check"
import { cx } from "~/lib/primitive"
import {
	DropdownDescription,
	DropdownKeyboard,
	DropdownLabel,
	DropdownSeparator,
	dropdownItemStyles,
	dropdownSectionStyles,
} from "./dropdown"
import { dropdownCheckIndicatorClassName } from "./dropdown.styles"
import {
	menuChevronClassName,
	menuContentStyles,
	menuHeaderBase,
	menuHeaderSeparator,
	menuItemSubmenuOpen,
	menuPopoverBase,
	menuTriggerBase,
} from "./menu.styles"
import { PopoverContent, type PopoverContentProps } from "./popover"

const Menu = (props: MenuTriggerPrimitiveProps) => <MenuTriggerPrimitive {...props} />

const MenuSubMenu = ({ delay = 0, ...props }) => (
	<SubmenuTriggerPrimitive {...props} delay={delay}>
		{props.children}
	</SubmenuTriggerPrimitive>
)

interface MenuTriggerProps extends ButtonProps {
	ref?: React.Ref<HTMLButtonElement>
}

const MenuTrigger = ({ className, ref, ...props }: MenuTriggerProps) => (
	<Button ref={ref} data-slot="menu-trigger" className={cx(...menuTriggerBase, className)} {...props} />
)

interface MenuContentProps<T> extends MenuPrimitiveProps<T>, Pick<PopoverContentProps, "placement"> {
	className?: string
	popover?: Pick<
		PopoverContentProps,
		| "arrow"
		| "className"
		| "placement"
		| "offset"
		| "crossOffset"
		| "arrowBoundaryOffset"
		| "triggerRef"
		| "isOpen"
		| "onOpenChange"
		| "shouldFlip"
	>
}

const MenuContent = <T extends object>({ className, placement, popover, ...props }: MenuContentProps<T>) => {
	return (
		<PopoverContent
			className={cx(menuPopoverBase, popover?.className)}
			placement={placement}
			{...popover}
		>
			<MenuPrimitive data-slot="menu-content" className={menuContentStyles({ className })} {...props} />
		</PopoverContent>
	)
}

interface MenuItemProps extends MenuItemPrimitiveProps, VariantProps<typeof dropdownItemStyles> {}

const MenuItem = ({ className, intent, children, ...props }: MenuItemProps) => {
	const textValue = props.textValue || (typeof children === "string" ? children : undefined)
	return (
		<MenuItemPrimitive
			data-slot="menu-item"
			className={composeRenderProps(className, (className, { hasSubmenu, ...renderProps }) =>
				dropdownItemStyles({
					...renderProps,
					intent,
					className: hasSubmenu
						? twMerge(
								intent === "danger" && menuItemSubmenuOpen.danger,
								intent === "warning" && menuItemSubmenuOpen.warning,
								intent === undefined && menuItemSubmenuOpen.none,
								className,
							)
						: className,
				}),
			)}
			textValue={textValue}
			{...props}
		>
			{(values) => (
				<>
					{values.isSelected && (
						<IconCheck className={dropdownCheckIndicatorClassName} data-slot="check-indicator" />
					)}

					{typeof children === "function" ? children(values) : children}

					{values.hasSubmenu && (
						<IconChevronRight data-slot="chevron" className={menuChevronClassName} />
					)}
				</>
			)}
		</MenuItemPrimitive>
	)
}
const MenuItemLink = createLink(MenuItem)

export interface MenuHeaderProps extends React.ComponentProps<typeof Header> {
	separator?: boolean
}

const MenuHeader = ({ className, separator = false, ...props }: MenuHeaderProps) => (
	<Header className={twMerge(menuHeaderBase, separator && menuHeaderSeparator, className)} {...props} />
)

const { section, header } = dropdownSectionStyles()

interface MenuSectionProps<T> extends MenuSectionPrimitiveProps<T> {
	ref?: React.Ref<HTMLDivElement>
	label?: string
}

const MenuSection = <T extends object>({ className, ref, ...props }: MenuSectionProps<T>) => {
	return (
		<MenuSectionPrimitive ref={ref} className={section({ className })} {...props}>
			{"label" in props && <Header className={header()}>{props.label}</Header>}
			<Collection items={props.items}>{props.children}</Collection>
		</MenuSectionPrimitive>
	)
}

const MenuSeparator = DropdownSeparator
const MenuShortcut = DropdownKeyboard
const MenuLabel = DropdownLabel
const MenuDescription = DropdownDescription

export type { MenuContentProps, MenuTriggerProps, MenuItemProps, MenuSectionProps }
export {
	menuContentStyles,
	Menu,
	MenuShortcut,
	MenuContent,
	MenuHeader,
	MenuItem,
	MenuItemLink,
	MenuSection,
	MenuSeparator,
	MenuLabel,
	MenuDescription,
	MenuTrigger,
	MenuSubMenu,
}
