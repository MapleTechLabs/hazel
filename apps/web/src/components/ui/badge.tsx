import type { VariantProps } from "tailwind-variants"
import { badgeStyles } from "./badge.styles"

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeStyles> {
	className?: string
	children: React.ReactNode
}

const Badge = ({ children, intent, size, isPill = false, className, ...props }: BadgeProps) => {
	return (
		<span {...props} className={badgeStyles({ intent, size, isPill, className })}>
			{children}
		</span>
	)
}

export type { BadgeProps }
export { Badge, badgeStyles }
