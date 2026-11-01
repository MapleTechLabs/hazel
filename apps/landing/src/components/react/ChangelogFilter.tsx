import { cn } from "@/lib/utils"
import type { ChangeType } from "@/content.config"
import { typeConfig } from "./CategoryBadge"

interface ChangelogFilterProps {
	availableTypes: ChangeType[]
	selectedTypes: ChangeType[]
	onFilterChange: (types: ChangeType[]) => void
}

export function ChangelogFilter({ availableTypes, selectedTypes, onFilterChange }: ChangelogFilterProps) {
	const toggleType = (type: ChangeType) => {
		if (selectedTypes.includes(type)) {
			onFilterChange(selectedTypes.filter((t) => t !== type))
		} else {
			onFilterChange([...selectedTypes, type])
		}
	}

	const clearFilters = () => {
		onFilterChange([])
	}

	return (
		<div className="flex flex-wrap items-center gap-2 mb-10">
			<span className="text-sm text-muted-foreground font-medium mr-1">Filter:</span>

			{availableTypes.map((type) => {
				const config = typeConfig[type]
				const isSelected = selectedTypes.includes(type)

				return (
					<button
						key={type}
						type="button"
						onClick={() => toggleType(type)}
						className={cn(
							"inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200",
							"hover:scale-[1.02] active:scale-[0.98]",
							isSelected
								? config.className
								: "bg-accent/50 text-muted-foreground border-border hover:bg-accent hover:text-primary",
						)}
					>
						{config.label}
					</button>
				)
			})}

			{selectedTypes.length > 0 && (
				<button
					type="button"
					onClick={clearFilters}
					className="text-xs text-muted-foreground hover:text-primary transition-colors ml-2 underline underline-offset-2"
				>
					Clear
				</button>
			)}
		</div>
	)
}
