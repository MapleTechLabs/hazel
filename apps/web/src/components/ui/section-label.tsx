import type { ComponentPropsWithRef, ReactNode } from "react"
import { cn } from "~/lib/utils"
import { sectionLabelStyles } from "./section-label.styles"

const styles = sectionLabelStyles.sizes

interface SectionLabelRootProps {
	title: ReactNode
	size?: "sm" | "md"
	isRequired?: boolean
	description?: ReactNode
	children?: ReactNode
	className?: string
}

export const SectionLabelRoot = ({
	size = "sm",
	isRequired,
	title,
	description,
	className,
	children,
}: SectionLabelRootProps) => {
	return (
		<div className={className}>
			<h3 className={cn(sectionLabelStyles.heading, styles[size].heading)}>
				{title}
				<span
					className={cn(
						sectionLabelStyles.required,
						isRequired && sectionLabelStyles.requiredShown,
					)}
				>
					*
				</span>
			</h3>

			{description && (
				<p className={cn(sectionLabelStyles.description, styles[size].subheading)}>{description}</p>
			)}
			{children}
		</div>
	)
}

const SectionLabelActions = ({ className, children, ...props }: ComponentPropsWithRef<"div">) => (
	<div {...props} className={cn(sectionLabelStyles.actions, className)}>
		{children}
	</div>
)

export const SectionLabel = {
	Root: SectionLabelRoot,
	Actions: SectionLabelActions,
}
