import { motion } from "motion/react"
import { cn } from "@/lib/utils"

interface BetaBadgeProps {
	className?: string
}

export function BetaBadge({ className }: BetaBadgeProps) {
	return (
		<motion.span
			initial={{ opacity: 0, scale: 0.9 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
			className={cn(
				"inline-flex items-center gap-2 px-4 py-1.5",
				"text-xs font-semibold uppercase tracking-widest",
				"bg-secondary/15 text-secondary",
				"border border-secondary/30 rounded-full",
				"shadow-[0_0_20px_rgba(215,140,80,0.15)]",
				className,
			)}
		>
			<span className="relative flex size-2">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75" />
				<span className="relative inline-flex size-2 rounded-full bg-secondary" />
			</span>
			Developer Preview
		</motion.span>
	)
}
