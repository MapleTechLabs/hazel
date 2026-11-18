import { getPreferenceValues } from "@raycast/api"

interface HazelPreferences {
	readonly apiUrl?: string
	readonly appUrl?: string
}

const withoutTrailingSlash = (url: string) => url.trim().replace(/\/+$/, "")

/** Hazel's API (`https://api.hazel.sh`, or a local or preview stage's). */
export const apiUrl = () =>
	withoutTrailingSlash(getPreferenceValues<HazelPreferences>().apiUrl || "https://api.hazel.sh")

/** The web app links open in. */
export const appUrl = () =>
	withoutTrailingSlash(getPreferenceValues<HazelPreferences>().appUrl || "https://app.hazel.sh")
