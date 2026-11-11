import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

interface GitHubStarsContextType {
	stars: number | null
	loading: boolean
	error: string | null
}

const GitHubStarsContext = createContext<GitHubStarsContextType>({
	stars: null,
	loading: true,
	error: null,
})

const CACHE_KEY = "hazel-github-stars"
const CACHE_DURATION = 1000 * 60 * 5 // 5 minutes

interface CacheData {
	stars: number
	timestamp: number
}

export function GitHubStarsProvider({ children }: { children: ReactNode }) {
	const [stars, setStars] = useState<number | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const fetchStars = async () => {
			// Check localStorage cache first
			try {
				const cached = localStorage.getItem(CACHE_KEY)
				if (cached) {
					const { stars: cachedStars, timestamp }: CacheData = JSON.parse(cached)
					if (Date.now() - timestamp < CACHE_DURATION) {
						setStars(cachedStars)
						setLoading(false)
						return
					}
				}
			} catch {
				// Cache read failed, continue to fetch
			}

			try {
				const response = await fetch("https://api.github.com/repos/hazelchat/hazel")
				if (!response.ok) {
					throw new Error("Failed to fetch")
				}
				const data = await response.json()
				const starCount = data.stargazers_count

				// Update cache
				try {
					localStorage.setItem(
						CACHE_KEY,
						JSON.stringify({ stars: starCount, timestamp: Date.now() }),
					)
				} catch {
					// Cache write failed, ignore
				}

				setStars(starCount)
				setError(null)
			} catch {
				setError("Failed to load stars")
				// On error, try to use stale cache
				try {
					const cached = localStorage.getItem(CACHE_KEY)
					if (cached) {
						const { stars: cachedStars }: CacheData = JSON.parse(cached)
						setStars(cachedStars)
					}
				} catch {
					// No cache available
				}
			} finally {
				setLoading(false)
			}
		}

		fetchStars()
	}, [])

	return (
		<GitHubStarsContext.Provider value={{ stars, loading, error }}>
			{children}
		</GitHubStarsContext.Provider>
	)
}

export function useGitHubStars() {
	return useContext(GitHubStarsContext)
}
