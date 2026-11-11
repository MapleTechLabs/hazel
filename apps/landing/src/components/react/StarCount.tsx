import { Icons } from "@/components/react/Icons"
import { useGitHubStars } from "@/components/react/GitHubStarsProvider"
import { cn } from "@/lib/utils"
import NumberFlow from "@number-flow/react"

interface StarCountProps {
	className?: string
	variant?: "badge" | "inline"
	showIcon?: boolean
}

export function StarCount({ className, variant = "badge", showIcon = true }: StarCountProps) {
	const { stars, loading, error } = useGitHubStars()

	if (loading) {
		return (
			<span
				className={cn(
					"inline-flex items-center gap-1",
					variant === "badge" && "px-2 py-0.5 rounded-full bg-accent/60 border border-border",
					className,
				)}
			>
				{showIcon && <Icons.star className="size-3 text-secondary animate-pulse" />}
				<span className="w-[2.5ch] h-4 bg-muted/50 rounded animate-pulse text-xs" />
			</span>
		)
	}

	if (error || stars === null) {
		return null
	}

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1",
				variant === "badge" &&
					"px-2 py-0.5 rounded-full bg-accent/60 border border-border shadow-[0_0_10px_rgba(234,179,8,0.15)]",
				className,
			)}
		>
			{showIcon && <Icons.star className="size-3 text-secondary" />}
			<NumberFlow
				value={stars}
				format={{ notation: stars >= 10000 ? "compact" : "standard" }}
				className="text-xs font-medium text-primary tabular-nums"
				transformTiming={{ duration: 500, easing: "ease-out" }}
			/>
		</span>
	)
}
