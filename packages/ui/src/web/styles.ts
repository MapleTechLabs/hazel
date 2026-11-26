/**
 * G1's stand-in CSS for the `hz:*` structure, in the spike's measured sidebar look (`Theme.swift`).
 * G6's generated `tokens.css` and recipes replace it; it only targets `data-hz` attributes.
 */
export const structureCss = `
:root {
	--hz-bg: #fafafa; --hz-band: #09090b12; --hz-wash: #00000009;
	--hz-label: #424245; --hz-label-strong: #09090b; --hz-icon: #68686a; --hz-section: #52525c;
	--hz-selected-bg: #9e77ed26; --hz-selected-fg: #6941c6; --hz-brand: #6938ef; --hz-muted: #71717a;
}
@media (prefers-color-scheme: dark) {
	:root {
		--hz-bg: #111114; --hz-band: #ffffff12; --hz-wash: #ffffff0b;
		--hz-label: #b2b2b3; --hz-label-strong: #fafafa; --hz-icon: #8a8a8c; --hz-section: #9f9fa9;
		--hz-selected-bg: #9e77ed33; --hz-selected-fg: #d6bbfb; --hz-muted: #a1a1aa;
	}
}
[data-hz] { box-sizing: border-box; font-family: Inter, system-ui, sans-serif; }
[data-hz-part=content] { display: contents; }
[data-hz=screen] { display: flex; flex-direction: column; background: var(--hz-bg); min-height: 100%; padding: 0 16px 16px; }
[data-hz=screen] > header { margin: 0 -16px; padding: 0 24px; height: 56px; display: flex; align-items: center; border-bottom: 1px solid var(--hz-band); }
[data-hz=screen] > header > h1 { margin: 0; font-size: 14px; font-weight: 500; color: var(--hz-label-strong); opacity: .8; }
[data-hz=section] { display: grid; grid-template-columns: 1fr auto; row-gap: 2px; padding: 16px 0; }
[data-hz=section] > h2 { grid-column: 1; grid-row: 1; margin: 0; padding-left: 10px; height: 32px; display: flex; align-items: center; font-size: 12px; font-weight: 500; color: var(--hz-section); }
[data-hz=section] > [data-hz-part=content] > * { grid-column: 1 / -1; }
[data-hz=section] > [data-hz-part=content] > [data-hz=action] { grid-column: 2; grid-row: 1; }
[data-hz=action] { all: unset; width: 32px; height: 32px; display: grid; place-items: center; color: var(--hz-section); cursor: pointer; border-radius: 8px; }
[data-hz=action]:hover { background: var(--hz-wash); }
[data-hz=action] [data-hz=icon] { width: 14px; height: 14px; }
[data-hz=item] > [data-hz-part=control] { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 6px 0 8px; border-radius: 8px; cursor: pointer; color: var(--hz-label); font-size: 16px; font-weight: 500; }
[data-hz=item] > [data-hz-part=control]:hover { background: var(--hz-wash); }
[data-hz=item] > [data-hz-part=control]:focus-visible { outline: 2px solid var(--hz-brand); outline-offset: 1px; }
[data-hz=item][data-emphasized] > [data-hz-part=control] { color: var(--hz-label-strong); }
[data-hz=item][data-selected] > [data-hz-part=control] { background: var(--hz-selected-bg); color: var(--hz-selected-fg); }
[data-hz=item] [data-hz-part=title] { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-hz=item] [data-hz-part=badge] { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--hz-brand); color: #fff; font-size: 11px; display: inline-grid; place-items: center; font-variant-numeric: tabular-nums; }
[data-hz=item] [data-hz-part=badge][hidden] { display: none; }
[data-hz=item] [data-hz=slot][data-name=leading] { display: inline-flex; color: var(--hz-icon); }
[data-hz=item][data-selected] [data-hz=slot][data-name=leading] { color: var(--hz-selected-fg); }
[data-hz=icon] { display: inline-block; width: 20px; height: 20px; }
[data-hz=icon] > svg { width: 100%; height: 100%; }
[data-hz=avatar] { width: 24px; height: 24px; border-radius: 50%; background: #7d2800; color: #fff; font-size: 10px; font-weight: 600; display: inline-grid; place-items: center; }
[data-hz=text] { font-size: 14px; color: var(--hz-label-strong); }
[data-hz=text][data-role=caption] { font-size: 12px; }
[data-hz=text][data-tone=muted] { color: var(--hz-muted); }
[data-hz=text][data-strong] { font-weight: 600; }
[data-hz=ext] { margin-top: 12px; }
[data-hz=ext] > [data-hz-part=surface]:empty { display: none; }
[data-hz=ext][data-drawn] > [data-hz-part=content] { display: none; }
[data-hz=ext]:not([data-drawn]) { padding: 10px 12px; border: 1px dashed var(--hz-band); border-radius: 8px; }
[data-hz=ext] canvas { width: 100%; height: 48px; display: block; }
`

export const installStyles = (document: Document) => {
	const style = document.createElement("style")
	style.dataset.hzStyles = ""
	style.textContent = structureCss
	document.head.append(style)
}
