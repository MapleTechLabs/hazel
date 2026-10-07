/** Tests run in node: the interaction Submodel names `document` as an event target at module load. */
if (typeof globalThis.document === "undefined") {
	Object.assign(globalThis, { document: new EventTarget() })
}
