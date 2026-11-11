/** Tests run in node: the interaction Submodel and theme lookups touch `document` and `window`. */
if (typeof globalThis.document === "undefined") {
	Object.assign(globalThis, { document: new EventTarget() })
}
if (typeof globalThis.window === "undefined") {
	Object.assign(globalThis, { window: { matchMedia: () => ({ matches: false }) } })
}
