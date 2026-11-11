import { cn } from "@/lib/utils"
import type { ChangeType } from "@/content.config"

const typeConfig: Record<ChangeType, { label: string; className: string }> = {
	feature: {
		label: "Feature",
		className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
	},
	fix: {
		label: "Fix",
		className: "bg-sky-500/15 text-sky-400 border-sky-500/25",
	},
	improvement: {
		label: "Improvement",
		className: "bg-violet-500/15 text-violet-400 border-violet-500/25",
	},
	breaking: {
		label: "Breaking",
		className: "bg-rose-500/15 text-rose-400 border-rose-500/25",
	},
	security: {
		label: "Security",
		className: "bg-amber-500/15 text-amber-400 border-amber-500/25",
	},
	deprecated: {
		label: "Deprecated",
		className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
	},
	performance: {
		label: "Performance",
		className: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
	},
}

interface CategoryBadgeProps {
	type: ChangeType
	className?: string
}

export function CategoryBadge({ type, className }: CategoryBadgeProps) {
	const config = typeConfig[type]

	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border font-mono uppercase tracking-wide",
				config.className,
				className,
			)}
		>
			{config.label}
		</span>
	)
}

export { typeConfig }
