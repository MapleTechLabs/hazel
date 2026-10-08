"use client"

import { createContext, use } from "react"
import type {
	AutocompleteProps,
	CollectionRenderer,
	MenuProps,
	MenuTriggerProps,
	SearchFieldProps,
} from "react-aria-components"
import {
	Autocomplete,
	Button,
	Collection,
	CollectionRendererContext,
	DefaultCollectionRenderer,
	Dialog,
	Header,
	Input,
	Menu as MenuPrimitive,
	MenuSection,
	Modal,
	ModalContext,
	ModalOverlay,
	OverlayTriggerStateContext,
	SearchField,
	useFilter,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import IconMagnifier from "~/components/icons/icon-magnifier-3"
import { cx } from "~/lib/primitive"
import {
	type CommandMenuSize,
	commandMenuContentsClassName,
	commandMenuDescriptionBase,
	commandMenuDialogClassName,
	commandMenuEmptyClassName,
	commandMenuEscapeClassName,
	commandMenuFooterBase,
	commandMenuInputClassName,
	commandMenuItemBase,
	commandMenuListBase,
	commandMenuLoaderClassName,
	commandMenuModalBase,
	commandMenuOverlayClassName,
	commandMenuSearchBase,
	commandMenuSearchIconClassName,
	commandMenuSectionBase,
	commandMenuSectionHeaderClassName,
	commandMenuSeparatorBase,
	commandMenuShortcutBase,
} from "./command-menu.styles"
import { DropdownKeyboard } from "./dropdown"
import { Loader } from "./loader"
import { MenuDescription, MenuItem, MenuLabel, type MenuSectionProps, MenuSeparator } from "./menu"

interface CommandMenuProviderProps {
	isPending?: boolean
	escapeButton?: boolean
	isFormPage?: boolean
}

const CommandMenuContext = createContext<CommandMenuProviderProps | undefined>(undefined)

const useCommandMenu = () => {
	const context = use(CommandMenuContext)

	if (!context) {
		throw new Error("useCommandMenu must be used within a <CommandMenuProvider />")
	}

	return context
}

interface CommandMenuProps extends AutocompleteProps, MenuTriggerProps, CommandMenuProviderProps {
	isDismissable?: boolean
	"aria-label"?: string
	isBlurred?: boolean
	className?: string
	size?: CommandMenuSize
	/** When true, renders children directly without Autocomplete wrapper (for form pages) */
	isFormPage?: boolean
	/** When true, prevents ESC from dismissing the modal (useful for custom ESC handling) */
	isKeyboardDismissDisabled?: boolean
	/** Custom keyboard handler for the modal overlay */
	onKeyDown?: (e: React.KeyboardEvent) => void
}

const CommandMenu = ({
	onOpenChange,
	className,
	isDismissable = true,
	escapeButton = true,
	isPending,
	size = "lg",
	isBlurred,
	isFormPage = false,
	isKeyboardDismissDisabled = false,
	onKeyDown,
	...props
}: CommandMenuProps) => {
	const { contains } = useFilter({ sensitivity: "base" })
	const filter = (textValue: string, inputValue: string) => contains(textValue, inputValue)

	return (
		<CommandMenuContext value={{ isPending: isPending, escapeButton: escapeButton, isFormPage }}>
			<ModalContext value={{ isOpen: props.isOpen, onOpenChange: onOpenChange }}>
				<ModalOverlay
					isDismissable={isDismissable}
					isKeyboardDismissDisabled={isKeyboardDismissDisabled}
					className={commandMenuOverlayClassName(isBlurred ?? false)}
					{...props}
				>
					<Modal className={cx(...commandMenuModalBase(size), className)}>
						<Dialog
							aria-label={props["aria-label"] ?? "Command Menu"}
							className={commandMenuDialogClassName}
						>
							<div onKeyDown={onKeyDown} className={commandMenuContentsClassName}>
								{isFormPage ? (
									// For form pages, render children directly without Autocomplete wrapper
									props.children
								) : (
									// For list pages, use Autocomplete for search/filter functionality
									<Autocomplete filter={filter} {...props} />
								)}
							</div>
						</Dialog>
					</Modal>
				</ModalOverlay>
			</ModalContext>
		</CommandMenuContext>
	)
}

interface CommandMenuSearchProps extends SearchFieldProps {
	placeholder?: string
	className?: string
}

const CommandMenuSearch = ({ className, placeholder, ...props }: CommandMenuSearchProps) => {
	const state = use(OverlayTriggerStateContext)!
	const { isPending, escapeButton } = useCommandMenu()
	return (
		<SearchField
			aria-label="Quick search"
			autoFocus
			className={cx(commandMenuSearchBase, className)}
			{...props}
		>
			{isPending ? (
				<Loader className={commandMenuLoaderClassName} variant="spin" />
			) : (
				<IconMagnifier
					data-slot="command-menu-search-icon"
					className={commandMenuSearchIconClassName}
				/>
			)}
			<Input placeholder={placeholder ?? "Search..."} className={commandMenuInputClassName} />
			{escapeButton && (
				<Button onPress={() => state?.close()} className={commandMenuEscapeClassName}>
					Esc
				</Button>
			)}
		</SearchField>
	)
}

const CommandMenuList = <T extends object>({ className, ...props }: MenuProps<T>) => {
	return (
		<CollectionRendererContext.Provider value={renderer}>
			<MenuPrimitive className={cx(commandMenuListBase, className)} {...props} />
		</CollectionRendererContext.Provider>
	)
}

const CommandMenuSection = <T extends object>({ className, ref, ...props }: MenuSectionProps<T>) => {
	return (
		<MenuSection ref={ref} className={twMerge(commandMenuSectionBase, className)} {...props}>
			{"label" in props && <Header className={commandMenuSectionHeaderClassName}>{props.label}</Header>}
			<Collection items={props.items}>{props.children}</Collection>
		</MenuSection>
	)
}

const CommandMenuItem = ({ className, ...props }: React.ComponentProps<typeof MenuItem>) => {
	const textValue = props.textValue || (typeof props.children === "string" ? props.children : undefined)
	return <MenuItem {...props} textValue={textValue} className={cx(commandMenuItemBase, className)} />
}

interface CommandMenuDescriptionProps extends React.ComponentProps<typeof MenuDescription> {}

const CommandMenuDescription = ({ className, ...props }: CommandMenuDescriptionProps) => {
	return <MenuDescription className={twMerge(commandMenuDescriptionBase, className)} {...props} />
}

const renderer: CollectionRenderer = {
	CollectionRoot(props) {
		if (props.collection.size === 0) {
			return <div className={commandMenuEmptyClassName}>No results found.</div>
		}
		return <DefaultCollectionRenderer.CollectionRoot {...props} />
	},
	CollectionBranch: DefaultCollectionRenderer.CollectionBranch,
}

const CommandMenuSeparator = ({ className, ...props }: React.ComponentProps<typeof MenuSeparator>) => (
	<MenuSeparator className={twMerge(commandMenuSeparatorBase, className)} {...props} />
)

const CommandMenuFooter = ({ className, ...props }: React.ComponentProps<"div">) => {
	return <div className={twMerge(...commandMenuFooterBase, className)} {...props} />
}

const CommandMenuLabel = MenuLabel
const CommandMenuShortcut = ({ className, ...props }: React.ComponentProps<typeof DropdownKeyboard>) => (
	<DropdownKeyboard className={twMerge(commandMenuShortcutBase, className)} {...props} />
)

export type { CommandMenuProps, CommandMenuSearchProps, CommandMenuDescriptionProps }
export {
	CommandMenu,
	CommandMenuSearch,
	CommandMenuList,
	CommandMenuItem,
	CommandMenuLabel,
	CommandMenuSection,
	CommandMenuDescription,
	CommandMenuShortcut,
	CommandMenuSeparator,
	CommandMenuFooter,
}
