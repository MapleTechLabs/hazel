/** The web app's address, where links people share open. */
const WEB_APP_ORIGIN = "https://app.hazel.sh"

/**
 * The origin for links people share (workspace URL, invite links): the page's own on the web, the
 * web app's when the page is served from an app bundle (`hazel://app`, the desktop and iOS shells),
 * where its own would open nothing for anyone else.
 */
export const shareOrigin = (): string =>
	window.location.protocol === "http:" || window.location.protocol === "https:"
		? window.location.origin
		: WEB_APP_ORIGIN
