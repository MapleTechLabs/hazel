/**
 * Browser-side determinism, installed with `page.addInitScript` before any app code.
 * Serialized via `toString`, so it must be self-contained.
 *
 * - Math.random is seeded (generated avatars, IDs, jitter all repeat exactly)
 * - CSS animations/transitions are frozen at their end state, carets hidden
 * - scrollbars hidden (their rendering differs between headless runs)
 */
export const installDeterminism = (seed: number) => {
	let state = seed >>> 0
	Math.random = () => {
		// mulberry32
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}

	const css = `
		*, *::before, *::after {
			animation-delay: -1ms !important;
			animation-duration: 1ms !important;
			animation-iteration-count: 1 !important;
			animation-play-state: paused !important;
			transition-duration: 0s !important;
			transition-delay: 0s !important;
			caret-color: transparent !important;
			scroll-behavior: auto !important;
		}
		::-webkit-scrollbar { display: none !important; }
		* { scrollbar-width: none !important; }
	`
	const install = () => {
		const style = document.createElement("style")
		style.setAttribute("data-parity", "stabilize")
		style.textContent = css
		document.head.appendChild(style)
	}
	if (document.head) install()
	else document.addEventListener("DOMContentLoaded", install, { once: true })
}

/**
 * Resolves once the page has visually settled: fonts loaded, images decoded, and
 * no DOM mutations for `quietMs`. Runs inside the page via `page.evaluate`.
 */
export const waitForVisualQuiet = async ({ quietMs, timeoutMs }: { quietMs: number; timeoutMs: number }) => {
	const deadline = performance.now() + timeoutMs
	await document.fonts.ready
	await Promise.all(
		[...document.images].map((image) =>
			image.complete ? undefined : image.decode().catch(() => undefined),
		),
	)
	await new Promise<void>((resolve) => {
		let timer = setTimeout(done, quietMs)
		const observer = new MutationObserver(() => {
			clearTimeout(timer)
			if (performance.now() > deadline) return done()
			timer = setTimeout(done, quietMs)
		})
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
		function done() {
			observer.disconnect()
			resolve()
		}
	})
	// Two frames so the last mutation is painted.
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}
