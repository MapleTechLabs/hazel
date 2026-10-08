"use client"

import { ChevronRightIcon } from "@heroicons/react/20/solid"
import type {
	TreeItemContentProps,
	TreeItemContentRenderProps,
	TreeItemProps,
	TreeProps,
} from "react-aria-components"
import {
	Button,
	TreeItemContent,
	TreeItem as TreeItemPrimitive,
	Tree as TreePrimitive,
} from "react-aria-components"
import { twJoin, twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { Checkbox } from "./checkbox"
import { treeStyles } from "./tree.styles"

const Tree = <T extends object>({ className, ...props }: TreeProps<T>) => {
	return <TreePrimitive className={cx(twJoin(...treeStyles.tree), className)} {...props} />
}

const TreeItem = <T extends object>({ className, ...props }: TreeItemProps<T>) => {
	return <TreeItemPrimitive className={cx(treeStyles.item("href" in props), className)} {...props} />
}

interface TreeContentProps extends TreeItemContentProps {
	className?: string
}

const TreeContent = ({ className, children, ...props }: TreeContentProps) => {
	return (
		<TreeItemContent {...props}>
			{(values) => (
				<div className={twMerge(treeStyles.content, className)}>
					{values.selectionMode === "multiple" && values.selectionBehavior === "toggle" && (
						<Checkbox className={treeStyles.selectionCheckbox} slot="selection" />
					)}
					<div className={twJoin(...treeStyles.levelGuide)} />
					{values.hasChildItems ? (
						<TreeIndicator
							values={{
								isDisabled: values.isDisabled,
								isExpanded: values.isExpanded,
							}}
						/>
					) : (
						<span aria-hidden className={treeStyles.leafSpacer} />
					)}
					{typeof children === "function" ? children(values) : children}
				</div>
			)}
		</TreeItemContent>
	)
}

const TreeIndicator = ({
	values,
}: {
	values: Pick<TreeItemContentRenderProps, "isDisabled" | "isExpanded">
}) => {
	return (
		<Button
			slot="chevron"
			isDisabled={values.isDisabled}
			className={twJoin(...treeStyles.indicator(values.isExpanded))}
		>
			<ChevronRightIcon
				data-slot="chevron"
				className={twJoin(...treeStyles.chevron(values.isExpanded))}
			/>
		</Button>
	)
}

export type { TreeProps, TreeItemProps }
export { Tree, TreeItem, TreeIndicator, TreeContent }
