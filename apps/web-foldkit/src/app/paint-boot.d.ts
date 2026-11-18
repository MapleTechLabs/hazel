/** `./paint-boot.js`: the last screen's paint as `index.html` draws it, before the app's script. */
export interface PaintBoot {
	/** Reads the paint this page may show; on `/`, moves to the painted page first. */
	readonly read: () => void
	/** Draws the paint over the page. */
	readonly show: () => void
	/** Runs the app's script `src`: behind a paint, after the paint's first frame. */
	readonly start: (src: string) => void
	/** Removes from `root` whatever could run, load a document, or be found by id. */
	readonly sanitize: (root: ParentNode) => void
}

export declare function hazelPaintBoot(win: Window): PaintBoot
