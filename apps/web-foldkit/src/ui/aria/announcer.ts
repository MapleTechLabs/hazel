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
	node.append(assertiveLog, createLog("polite"))
	document.body.prepend(node)
	return { node, assertiveLog }
}

const append = (target: Announcer, message: string) => {
	const entry = document.createElement("div")
	entry.textContent = message
	target.assertiveLog.appendChild(entry)
	if (message !== "") setTimeout(() => entry.remove(), LIVE_REGION_TIMEOUT)
}

export const announce = (message: string): void => {
	if (announcer !== undefined) return append(announcer, message)
	const created = createAnnouncer()
	announcer = created
	setTimeout(() => {
		if (created.node.isConnected) append(created, message)
	}, FIRST_ANNOUNCEMENT_DELAY)
}

/** @react-aria/utils isAppleDevice: VoiceOver gets extra announcements on Apple platforms. */
export const isAppleDevice = (): boolean => {
	const platform =
		(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
		navigator.platform
	const isMac = /^Mac/i.test(platform)
	return isMac || /^iPhone/i.test(platform) || /^iPad/i.test(platform)
}
