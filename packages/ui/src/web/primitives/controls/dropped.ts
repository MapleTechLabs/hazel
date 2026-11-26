/**
 * The files of the last `files` event a control raised (the composer's drop or paste, a drop zone's
 * drop or pick), held for the web's `Files.dropped` (lane F). No `primitive` export, so the registry
 * glob skips this file.
 */
let held: ReadonlyArray<File> = []

/** Keeps `files` until `takeDropped` reads them; a newer event replaces them. */
export const holdDropped = (files: Iterable<File>) => {
	held = [...files]
}

/** The held files; taking clears them. */
export const takeDropped = (): ReadonlyArray<File> => {
	const files = held
	held = []
	return files
}
