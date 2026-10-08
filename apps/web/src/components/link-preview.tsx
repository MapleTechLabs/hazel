"use client"

import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import { useMemo } from "react"
import { LinkPreviewClient } from "~/lib/services/common/link-preview-client"

export * from "./link-preview.utils"

export function LinkPreview({ url }: { url: string }) {
	const previewResult = useAtomValue(LinkPreviewClient.query("linkPreview", "get", { payload: { url } }))
	const og = AsyncResult.getOrElse(previewResult, () => null)
	const isLoading = AsyncResult.isInitial(previewResult)

	const host = useMemo(() => {
		const resolvedUrl = og?.url || url
		try {
			return new URL(resolvedUrl).host
		} catch {
			return ""
		}
	}, [og, url])

	// Don't render anything if failed and no data
	if (!og && !isLoading) return null

	return (
		<a
			href={og?.url || url}
			target="_blank"
			rel="noopener noreferrer"
			className="mt-2 block max-w-sm overflow-hidden rounded-lg border pressed:border-fg/15 bg-muted/40 pressed:bg-muted hover:border-fg/15 hover:bg-muted"
		>
			{og?.image?.url && (
				<div className="aspect-video w-full overflow-hidden bg-muted">
					<img src={og.image.url} alt="" className="h-full w-full object-cover" />
				</div>
			)}
			<div className="flex items-start border-t p-3">
				<div className="min-w-0">
					<div className="truncate font-semibold text-sm">{og?.title || host || url}</div>
					{og?.description && (
						<div className="mt-0.5 line-clamp-2 text-[12px] text-fg/70">{og.description}</div>
					)}
					<div className="mt-1 text-[11px] text-primary-subtle-fg">{host}</div>
				</div>
			</div>
			{isLoading && <div className="px-3 pb-3 text-[11px] text-muted-fg">Loading preview…</div>}
		</a>
	)
}
