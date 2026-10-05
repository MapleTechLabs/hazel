import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { KlipyCategory, KlipyGif, KlipySearchResponse } from "@hazel/domain/http"
import { Exit } from "effect"
import { useCallback, useMemo, useRef, useState } from "react"
import { HazelApiClient } from "~/lib/services/common/atom-client"

interface UseKlipyOptions {
	perPage?: number
}

interface UseKlipyReturn {
	gifs: KlipyGif[]
	categories: KlipyCategory[]
	isLoading: boolean
	isLoadingMore: boolean
	hasMore: boolean
	loadMore: () => void
	search: (query: string) => void
	searchQuery: string
}

export function useKlipy({ perPage = 25 }: UseKlipyOptions = {}): UseKlipyReturn {
	// === Auto-fetching query atoms (no useEffect needed) ===
	const trendingResult = useAtomValue(
		HazelApiClient.query("klipy", "trending", { query: { page: 1, per_page: perPage } }),
	)
	const categoriesResult = useAtomValue(HazelApiClient.query("klipy", "categories", {}))

	// === Mutation atoms for user-triggered fetches ===
	const searchAtom = useMemo(() => HazelApiClient.mutation("klipy", "search"), [])
	const trendingMutAtom = useMemo(() => HazelApiClient.mutation("klipy", "trending"), [])
	const searchMutation = useAtomSet(searchAtom, { mode: "promiseExit" })
	const trendingMutation = useAtomSet(trendingMutAtom, { mode: "promiseExit" })

	const searchRef = useRef(searchMutation)
	searchRef.current = searchMutation
	const trendingMutRef = useRef(trendingMutation)
	trendingMutRef.current = trendingMutation

	// === User interaction state ===
	// null = showing trending query result; non-null = user has searched or loaded more
	const [overrideGifs, setOverrideGifs] = useState<KlipyGif[] | null>(null)
	const [isMutating, setIsMutating] = useState(false)
	const [isLoadingMore, setIsLoadingMore] = useState(false)
	const [hasMore, setHasMore] = useState(true)
	const [searchQuery, setSearchQuery] = useState("")

	const pageRef = useRef(1)
	const currentQueryRef = useRef("")
	const isMutatingRef = useRef(false)
	const hasMoreRef = useRef(true)
	const requestIdRef = useRef(0)

	// Initialize pagination from trending query result
	const trendingInitRef = useRef(false)
	if (!trendingInitRef.current && AsyncResult.isSuccess(trendingResult) && overrideGifs === null) {
		trendingInitRef.current = true
		pageRef.current = trendingResult.value.current_page
		const more = trendingResult.value.has_next
		hasMoreRef.current = more
		setHasMore(more)
	}

	// === Derived display values ===
	const categories = AsyncResult.isSuccess(categoriesResult) ? [...categoriesResult.value.categories] : []

	let gifs: KlipyGif[]
	let isLoading: boolean

	if (overrideGifs !== null) {
		gifs = overrideGifs
		isLoading = isMutating
	} else if (AsyncResult.isSuccess(trendingResult)) {
		gifs = [...trendingResult.value.data]
		isLoading = false
	} else {
		gifs = []
		isLoading = true
	}

	// Keep a ref to current gifs for loadMore's append base
	const gifsRef = useRef(gifs)
	gifsRef.current = gifs

	// === Fetch function for search & load-more ===
	const fetchGifs = useCallback(
		async (query: string, page: number, append: boolean) => {
			const id = ++requestIdRef.current
			isMutatingRef.current = true
			setIsMutating(true)
			setIsLoadingMore(append)
			try {
				let exit: Exit.Exit<KlipySearchResponse, unknown>
				if (query) {
					exit = await searchRef.current({ query: { q: query, page, per_page: perPage } })
				} else {
					exit = await trendingMutRef.current({ query: { page, per_page: perPage } })
				}

				if (requestIdRef.current !== id) return

				if (Exit.isSuccess(exit)) {
					const data = exit.value
					if (append) {
						setOverrideGifs((prev) => [...(prev ?? gifsRef.current), ...data.data])
					} else {
						setOverrideGifs([...data.data])
					}
					const newHasMore = data.has_next
					hasMoreRef.current = newHasMore
					setHasMore(newHasMore)
					pageRef.current = data.current_page
				} else {
					console.error("[GifPicker] Fetch failed:", Exit.isFailure(exit) ? exit.cause : exit)
				}
			} catch (error) {
				if (requestIdRef.current !== id) return
				console.error("[GifPicker] Fetch error:", error)
			} finally {
				isMutatingRef.current = false
				setIsMutating(false)
				setIsLoadingMore(false)
			}
		},
		[perPage],
	)

	const search = useCallback(
		(query: string) => {
			setSearchQuery(query)
			currentQueryRef.current = query
			pageRef.current = 1
			hasMoreRef.current = true
			setHasMore(true)
			if (query === "") {
				// Reset to trending query result
				setOverrideGifs(null)
				trendingInitRef.current = false
				return
			}
			setOverrideGifs([])
			fetchGifs(query, 1, false)
		},
		[fetchGifs],
	)

	const loadMore = useCallback(() => {
		if (isMutatingRef.current || !hasMoreRef.current) return
		fetchGifs(currentQueryRef.current, pageRef.current + 1, true)
	}, [fetchGifs])

	return {
		gifs,
		categories,
		isLoading,
		isLoadingMore,
		hasMore,
		loadMore,
		search,
		searchQuery,
	}
}
