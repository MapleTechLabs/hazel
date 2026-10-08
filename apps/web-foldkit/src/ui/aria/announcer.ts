/**
 * React Aria's LiveAnnouncer: visually hidden assertive and polite logs prepended to the body.
 * The first announcement waits 100 ms for the regions to attach (Safari), later ones are
 * immediate, and each message is removed after 7 seconds.
 */

const LIVE_REGION_TIMEOUT = 7000
const FIRST_ANNOUNCEMENT_DELAY = 100

interface Announcer {
	readonly node: HTMLElement
	readonly assertiveLog: HTMLElement
	readonly politeLog: HTMLElement
}

let announcer: Announcer | undefined

const createLog = (ariaLive: string) => {
	const log = document.createElement("div")
	log.setAttribute("role", "log")
	log.setAttribute("aria-live", ariaLive)
	log.setAttribute("aria-relevant", "additions")
	return log
}

const createAnnouncer = (): Announcer => {
	const node = document.createElement("div")
	node.dataset.liveAnnouncer = "true"
	Object.assign(node.style, {
		border: "0",
		clip: "rect(0 0 0 0)",
		clipPath: "inset(50%)",
		height: "1px",
		margin: "-1px",
		overflow: "hidden",
		padding: "0",
		position: "absolute",
		width: "1px",
		whiteSpace: "nowrap",
	})
	const assertiveLog = createLog("assertive")
	const politeLog = createLog("polite")
	node.append(assertiveLog, politeLog)
	document.body.prepend(node)
	return { node, assertiveLog, politeLog }
}

/** A string, or `{ labelledBy }`, which React Aria announces as an `img` named by those ids. */
export type Announcement = string | { readonly labelledBy: string }

export type Assertiveness = "assertive" | "polite"

const append = (target: Announcer, message: Announcement, timeout: number, assertiveness: Assertiveness) => {
	const entry = document.createElement("div")
	if (typeof message === "string") entry.textContent = message
	else {
		entry.setAttribute("role", "img")
		entry.setAttribute("aria-labelledby", message.labelledBy)
	}
	const log = assertiveness === "assertive" ? target.assertiveLog : target.politeLog
	log.appendChild(entry)
	if (message !== "") setTimeout(() => entry.remove(), timeout)
}

/** `announce(message, timeout, assertiveness)`; `timeout` is how long the message stays in the log. */
export const announce = (
	message: Announcement,
	timeout: number = LIVE_REGION_TIMEOUT,
	assertiveness: Assertiveness = "assertive",
): void => {
	if (announcer !== undefined) return append(announcer, message, timeout, assertiveness)
	const created = createAnnouncer()
	announcer = created
	setTimeout(() => {
		if (created.node.isConnected) append(created, message, timeout, assertiveness)
	}, FIRST_ANNOUNCEMENT_DELAY)
}

/** clearAnnouncer("assertive"): drops every message still in the assertive log. */
export const clearAssertive = (): void => {
	if (announcer !== undefined) announcer.assertiveLog.innerHTML = ""
}

export type Selection = ReadonlyArray<string> | "all"

const added = (a: Selection, b: Selection): ReadonlyArray<string> =>
	a === "all" || b === "all" ? [] : a.filter((key) => !b.includes(key))

const sizeOf = (selection: Selection) => (selection === "all" ? Infinity : selection.length)

/**
 * useGridSelectionAnnouncement's message for a selection change, or "" when it stays silent.
 * `rowText` returns "" for rows without a text value.
 */
export const gridSelectionMessage = (options: {
	readonly previous: Selection
	readonly next: Selection
	readonly isReplace: boolean
	readonly isMultiple: boolean
	readonly rowText: (key: string) => string
}): string => {
	const { previous, next, rowText } = options
	const addedKeys = added(next, previous)
	const removedKeys = added(previous, next)
	const single = (key: string | undefined, format: (text: string) => string) => {
		const text = key === undefined ? "" : rowText(key)
		return text === "" ? [] : [format(text)]
	}
	const messages =
		next !== "all" && next.length === 1 && options.isReplace
			? single(next[0], (text) => `${text} selected.`)
			: addedKeys.length === 1 && removedKeys.length === 0
				? single(addedKeys[0], (text) => `${text} selected.`)
				: removedKeys.length === 1 && addedKeys.length === 0
					? single(removedKeys[0], (text) => `${text} not selected.`)
					: []
	const announcesCount =
		options.isMultiple && (messages.length === 0 || sizeOf(next) > 1 || sizeOf(previous) > 1)
	const count =
		next === "all"
			? "All items selected."
			: next.length === 0
				? "No items selected."
				: `${next.length} ${next.length === 1 ? "item" : "items"} selected.`
	return [...messages, ...(announcesCount ? [count] : [])].join(" ")
}

/** @react-aria/utils isAppleDevice: VoiceOver gets extra announcements on Apple platforms. */
export const isAppleDevice = (): boolean => {
	const userAgentData: unknown = Reflect.get(navigator, "userAgentData")
	const platform =
		typeof userAgentData === "object" &&
		userAgentData !== null &&
		"platform" in userAgentData &&
		typeof userAgentData.platform === "string"
			? userAgentData.platform
			: navigator.platform
	const isMac = /^Mac/i.test(platform)
	return isMac || /^iPhone/i.test(platform) || /^iPad/i.test(platform)
}
