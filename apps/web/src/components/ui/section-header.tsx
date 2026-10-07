import type { ComponentPropsWithRef } from "react"
import { cn } from "~/lib/utils"
import { sectionHeaderStyles } from "./section-header.styles"

const SectionHeaderRoot = ({ className, children, ...props }: ComponentPropsWithRef<"div">) => (
	<div {...props} className={cn(sectionHeaderStyles.root, className)}>
		{children}
	</div>
)

const SectionHeaderGroup = ({ className, children, ...props }: ComponentPropsWithRef<"div">) => (
	<div {...props} className={cn(sectionHeaderStyles.group, className)}>
		{children}
	</div>
)

const SectionHeaderActions = ({ className, children, ...props }: ComponentPropsWithRef<"div">) => (
	<div {...props} className={cn(sectionHeaderStyles.actions, className)}>
		{children}
	</div>
)

const SectionHeaderHeading = ({
	className,
	children,
	size = "lg",
	...props
}: ComponentPropsWithRef<"h2"> & { size?: "lg" | "xl" }) => (
	<h2
		{...props}
		className={cn(
			sectionHeaderStyles.heading,
			size === "xl" ? sectionHeaderStyles.headingXl : sectionHeaderStyles.headingLg,
			className,
		)}
	>
		{children}
	</h2>
)

const SectionHeaderSubheading = ({ className, children, ...props }: ComponentPropsWithRef<"p">) => (
	<p {...props} className={cn(sectionHeaderStyles.subheading, className)}>
		{children}
	</p>
)

export const SectionHeader = {
	Root: SectionHeaderRoot,
	Group: SectionHeaderGroup,
	Actions: SectionHeaderActions,
	Heading: SectionHeaderHeading,
	Subheading: SectionHeaderSubheading,
}
