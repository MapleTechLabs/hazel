import { motion } from "motion/react"
import { useMemo, useState } from "react"
import type { ChangeType } from "@/content.config"
import { ChangelogEntry } from "./ChangelogEntry"
import { ChangelogFilter } from "./ChangelogFilter"

interface ChangeItem {
	type: ChangeType
	title: string
	description?: string
	link?: string
	code?: string
}

interface TimelineEntry {
	slug: string
	week: string
	date: string
	title?: string
	summary: string
	isMajor: boolean
	changes: ChangeItem[]
	content?: string
}

interface ChangelogTimelineProps {
	entries: TimelineEntry[]
	availableTypes: ChangeType[]
}

export function ChangelogTimeline({ entries, availableTypes }: ChangelogTimelineProps) {
	const [selectedTypes, setSelectedTypes] = useState<ChangeType[]>([])

	const entriesByYear = useMemo(() => {
		const grouped: Record<string, TimelineEntry[]> = {}

		entries.forEach((entry) => {
			if (selectedTypes.length > 0) {
				const hasMatchingChange = entry.changes.some((change) => selectedTypes.includes(change.type))
				if (!hasMatchingChange) return
			}

			const year = new Date(entry.date).getFullYear().toString()
			if (!grouped[year]) {
				grouped[year] = []
			}
			grouped[year].push(entry)
		})

		return grouped
	}, [entries, selectedTypes])

	const years = Object.keys(entriesByYear).sort((a, b) => Number(b) - Number(a))

	return (
		<div>
			<ChangelogFilter
				availableTypes={availableTypes}
				selectedTypes={selectedTypes}
				onFilterChange={setSelectedTypes}
			/>

			{years.length === 0 ? (
				<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
					<div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/50 mb-4">
						<svg
							className="w-8 h-8 text-muted-foreground"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={1.5}
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
							/>
						</svg>
					</div>
					<p className="text-muted-foreground font-medium">
						No changelog entries match your filters.
					</p>
					<button
						type="button"
						onClick={() => setSelectedTypes([])}
						className="mt-3 text-sm text-primary hover:underline underline-offset-2"
					>
						Clear filters
					</button>
				</motion.div>
			) : (
				years.map((year) => (
					<div key={year} className="mb-8">
						<motion.h2
							initial={{ opacity: 0, x: -12 }}
							whileInView={{ opacity: 1, x: 0 }}
							viewport={{ once: true }}
							transition={{ duration: 0.4 }}
							className="font-mono text-4xl font-bold text-primary/10 mb-8 sticky top-20 bg-background/95 backdrop-blur-sm py-3 z-10 -mx-2 px-2"
						>
							{year}
						</motion.h2>
						<div>
							{entriesByYear[year].map((entry) => (
								<ChangelogEntry
									key={entry.slug}
									week={entry.week}
									date={entry.date}
									title={entry.title}
									summary={entry.summary}
									isMajor={entry.isMajor}
									changes={entry.changes}
									content={entry.content}
									selectedTypes={selectedTypes}
								/>
							))}
						</div>
					</div>
				))
			)}
		</div>
	)
}
