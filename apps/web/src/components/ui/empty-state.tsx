import type { ComponentType, ReactNode } from "react"
import { cn } from "~/lib/utils"
import { emptyStateStyles } from "./empty-state.styles"

interface EmptyStateProps {
	icon?: ComponentType<{ className?: string }>
	title: string
	description?: string
	action?: ReactNode
	className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
	return (
		<div className={cn(emptyStateStyles.root, className)}>
			{Icon && (
				<div className={emptyStateStyles.iconWrapper}>
					<Icon className={emptyStateStyles.icon} />
				</div>
			)}
			<h3 className={emptyStateStyles.title}>{title}</h3>
			{description && <p className={emptyStateStyles.description}>{description}</p>}
			{action && <div className={emptyStateStyles.action}>{action}</div>}
		</div>
	)
}
