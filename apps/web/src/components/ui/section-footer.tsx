import type { ComponentPropsWithRef } from "react"
import { cn } from "~/lib/utils"
import { sectionFooterStyles } from "./section-footer.styles"

const SectionFooterRoot = ({
	isCard,
	className,
	children,
	...props
}: ComponentPropsWithRef<"div"> & { isCard?: boolean }) => (
	<div
		{...props}
		className={cn(
			sectionFooterStyles.root,
			isCard ? sectionFooterStyles.rootCard : sectionFooterStyles.rootPlain,
			className,
		)}
	>
		{children}
	</div>
)

const SectionFooterActions = ({ className, children, ...props }: ComponentPropsWithRef<"div">) => (
	<div {...props} className={cn(sectionFooterStyles.actions, className)}>
		{children}
	</div>
)

export const SectionFooter = {
	Root: SectionFooterRoot,
	Actions: SectionFooterActions,
}
