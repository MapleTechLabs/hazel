import { ExternalLink } from "lucide-react"
import { motion } from "motion/react"
import { Markdown } from "@/components/ui/markdown"
import type { ChangeType } from "@/content.config"
import { cn } from "@/lib/utils"
import { CategoryBadge } from "./CategoryBadge"

interface ChangeItem {
	type: ChangeType
	title: string
	description?: string
	link?: string
	code?: string
}

interface ChangelogEntryProps {
	week: string
	date: string
	title?: string
	summary: string
	isMajor: boolean
	changes: ChangeItem[]
	content?: string
	selectedTypes?: ChangeType[]
}

export function ChangelogEntry({
	week,
	date,
	title,
	summary,
	isMajor,
	changes,
	content,
	selectedTypes = [],
}: ChangelogEntryProps) {
	const filteredChanges =
		selectedTypes.length > 0 ? changes.filter((change) => selectedTypes.includes(change.type)) : changes

	const formattedDate = new Date(date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	})

	return (
		<motion.article
			initial={{ opacity: 0, y: 24 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-80px" }}
			transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
			className={cn(
				"relative pl-8 pb-14",
				"before:absolute before:left-0 before:top-2 before:bottom-0 before:w-px before:bg-gradient-to-b before:from-border before:to-transparent",
			)}
		>
			{/* Timeline dot */}
			<div
				className={cn(
					"absolute left-0 top-1.5 -translate-x-1/2 rounded-full border-[3px] border-background transition-all",
					isMajor
						? "size-4 bg-secondary shadow-[0_0_12px_rgba(var(--secondary),0.5)]"
						: "size-3 bg-muted-foreground/60",
				)}
			/>

			{/* Header */}
			<header className="mb-6">
				<div className="flex items-center gap-3 mb-2 flex-wrap">
					<span className="font-mono text-xl font-semibold text-primary tracking-tight">
						Week of {week}
					</span>
					{isMajor && (
						<span className="px-2.5 py-0.5 bg-secondary/20 text-secondary text-[11px] font-semibold rounded-full uppercase tracking-wide">
							Highlight
						</span>
					)}
				</div>

				<time className="font-mono text-sm text-muted-foreground">{formattedDate}</time>

				{title && (
					<h2 className="text-2xl font-semibold tracking-tight text-primary mt-3">{title}</h2>
				)}

				<p className="text-muted-foreground mt-2 leading-relaxed text-[15px]">{summary}</p>
			</header>

			{/* Changes List */}
			<div className="space-y-3">
				{filteredChanges.map((change, index) => (
					<motion.div
						key={index}
						initial={{ opacity: 0, x: -8 }}
						whileInView={{ opacity: 1, x: 0 }}
						viewport={{ once: true }}
						transition={{ duration: 0.3, delay: index * 0.05 }}
						className="group flex gap-3 p-4 rounded-xl bg-accent/40 border border-border/50 hover:border-border hover:bg-accent/60 transition-all duration-200"
					>
						<CategoryBadge type={change.type} className="shrink-0 mt-0.5" />
						<div className="flex-1 min-w-0">
							<div className="flex items-start justify-between gap-2">
								<h3 className="font-medium text-primary text-[15px]">{change.title}</h3>
								{change.link && (
									<a
										href={change.link}
										target="_blank"
										rel="noopener noreferrer"
										className="shrink-0 text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
									>
										<ExternalLink className="size-4" />
									</a>
								)}
							</div>
							{change.description && (
								<p className="text-sm text-muted-foreground mt-1 leading-relaxed">
									{change.description}
								</p>
							)}
							{change.code && (
								<div className="mt-3 text-sm">
									<Markdown className="[&_pre]:!bg-background/80 [&_pre]:!border [&_pre]:!border-border [&_pre]:rounded-lg">
										{"```\n" + change.code + "```"}
									</Markdown>
								</div>
							)}
						</div>
					</motion.div>
				))}
			</div>

			{/* Additional Markdown Content */}
			{content && (
				<div className="mt-6 prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-primary prose-code:bg-accent prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none">
					<Markdown>{content}</Markdown>
				</div>
			)}
		</motion.article>
	)
}
