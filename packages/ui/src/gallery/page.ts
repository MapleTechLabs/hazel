/** `?theme=dark|light` as the `<html>` class both sides' stylesheets switch on (as the app's lab does). */
export const applyTheme = (): void => {
	const theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light"
	document.documentElement.classList.remove("light", "dark")
	document.documentElement.classList.add(theme)
}
