import rss from "@astrojs/rss"
import { getCollection, type CollectionEntry } from "astro:content"
import type { APIContext } from "astro"
import { siteConfig } from "@/lib/site"

export async function GET(context: APIContext) {
	const changelog = await getCollection(
		"changelog",
		({ data }: CollectionEntry<"changelog">) => !data.draft,
	)

	return rss({
		title: `${siteConfig.name} Changelog`,
		description: "New features, improvements, and fixes for Hazel",
		site: context.site!,
		items: changelog
			.sort(
				(a: CollectionEntry<"changelog">, b: CollectionEntry<"changelog">) =>
					b.data.date.getTime() - a.data.date.getTime(),
			)
			.map((entry: CollectionEntry<"changelog">) => ({
				title: entry.data.title || `Week of ${entry.data.week}`,
				pubDate: entry.data.date,
				description: entry.data.summary,
				link: `/changelog#week-${entry.id}`,
			})),
	})
}
