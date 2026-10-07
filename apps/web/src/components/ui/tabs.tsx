"use client"

import type {
	TabListProps as TabListPrimitiveProps,
	TabPanelProps as TabPanelPrimitiveProps,
	TabProps as TabPrimitiveProps,
	TabsProps as TabsPrimitiveProps,
} from "react-aria-components"

import {
	composeRenderProps,
	SelectionIndicator,
	TabList as TabListPrimitive,
	TabPanel as TabPanelPrimitive,
	Tab as TabPrimitive,
	TabsContext,
	Tabs as TabsPrimitive,
	useSlottedContext,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { tabsStyles } from "./tabs.styles"

interface TabsProps extends TabsPrimitiveProps {
	ref?: React.RefObject<HTMLDivElement>
}
const Tabs = ({ className, ref, orientation = "horizontal", ...props }: TabsProps) => {
	return (
		<TabsContext value={{ orientation: orientation }}>
			<TabsPrimitive
				orientation={orientation}
				className={cx(...tabsStyles.tabs(orientation), className)}
				ref={ref}
				{...props}
			/>
		</TabsContext>
	)
}

interface TabListProps<T extends object> extends TabListPrimitiveProps<T> {
	ref?: React.RefObject<HTMLDivElement>
}
const TabList = <T extends object>({ className, ref, ...props }: TabListProps<T>) => {
	return (
		<TabListPrimitive
			ref={ref}
			data-slot="tab-list"
			{...props}
			className={composeRenderProps(className, (className, { orientation }) =>
				twMerge([...tabsStyles.tabList(orientation), className]),
			)}
		/>
	)
}

interface TabProps extends TabPrimitiveProps {
	ref?: React.RefObject<HTMLDivElement>
}
const Tab = ({ children, className, ref, ...props }: TabProps) => {
	const { orientation } = useSlottedContext(TabsContext)!
	return (
		<TabPrimitive
			{...props}
			data-slot="tab"
			ref={ref}
			className={cx(...tabsStyles.tab(orientation, "href" in props), className)}
		>
			{(values) => (
				<>
					{typeof children === "function" ? children(values) : children}
					<SelectionIndicator
						data-slot="selected-indicator"
						className={twMerge(tabsStyles.selectionIndicator(orientation))}
					/>
				</>
			)}
		</TabPrimitive>
	)
}

interface TabPanelProps extends TabPanelPrimitiveProps {
	ref?: React.RefObject<HTMLDivElement>
}
const TabPanel = ({ className, ref, ...props }: TabPanelProps) => {
	return (
		<TabPanelPrimitive
			{...props}
			ref={ref}
			data-slot="tab-panel"
			className={cx(tabsStyles.tabPanel, className)}
		/>
	)
}

export type { TabsProps, TabListProps, TabProps, TabPanelProps }
export { Tabs, TabList, Tab, TabPanel }
