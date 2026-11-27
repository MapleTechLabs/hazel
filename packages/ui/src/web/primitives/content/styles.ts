/**
 * What the layout and content renderers own and a recipe cannot say (C3 `rendererFeatures`): the
 * standalone icon size, the seeded dither under an initial, the kit's squircle corners, absolute
 * marks and the pair layout, outer cut-out rings and the surface they cut from, per-tile states of
 * the people strip, the grid's tracks, slot order and hover in banners and code blocks, and the
 * syntax inks. Tokens only, except the dither's white initial, which is today's literal.
 */
const css = `
/* A root primitive takes the page's ink, as the app's body gives every island. */
:where([data-hz]:not([data-hz] *)) { color: var(--hz-color-fg); }

:where(:not([data-hz-slot], [data-hz-part]) > [data-hz=icon]) {
	width: var(--hz-space-5);
	height: var(--hz-space-5);
	flex-shrink: 0;
}
@media (width >= 40rem) {
	:where(:not([data-hz-slot], [data-hz-part]) > [data-hz=icon]) {
		width: var(--hz-space-4);
		height: var(--hz-space-4);
	}
}

[data-hz=text][data-role=kbd] {
	min-width: var(--hz-space-5_5);
	border-bottom-color: var(--hz-color-border-hover);
	user-select: none;
}

/* The kit's status dot (\`statusLine\`): 6px, \`gap-1.5\`, in the tone's fill (\`status-dot.ts\` \`TONE\`). */
[data-hz=text][data-dot] { display: inline-flex; align-items: center; gap: var(--hz-space-1_5); white-space: nowrap; }
[data-hz=text][data-dot]::before {
	content: ""; flex-shrink: 0; width: var(--hz-space-1_5); height: var(--hz-space-1_5);
	border-radius: var(--hz-radius-full); background: var(--hz-color-muted-fg);
}
[data-hz=text][data-dot][data-tone=success]::before { background: var(--hz-color-success); }
[data-hz=text][data-dot][data-tone=warning]::before { background: var(--hz-color-warning); }
[data-hz=text][data-dot][data-tone=danger]::before { background: var(--hz-color-danger); }
[data-hz=text][data-dot][data-tone=info]::before { background: var(--hz-color-info-subtle-fg); }
[data-hz=text][data-dot][data-tone=accent]::before { background: var(--hz-color-primary); }

:where([data-hz=avatar]) { position: relative; }
[data-hz=avatar][data-seeded] { container-type: size; }
[data-hz=avatar]:is([data-size=medium], [data-size=large], [data-size=xlarge]):not([data-corners]),
[data-hz=avatar]:is([data-size=medium], [data-size=large], [data-size=xlarge]):not([data-corners]) > :is([data-hz-part=image], [data-hz-part=dither]),
[data-hz=avatarStack][data-layout=pair] > [data-hz=avatar],
[data-hz=avatarStack][data-layout=pair] > [data-hz=avatar] > :is([data-hz-part=image], [data-hz-part=dither]),
[data-hz=peopleStrip] [data-hz-part=avatar],
[data-hz=peopleStrip] [data-hz-part=avatar] > :is([data-hz-part=image], [data-hz-part=dither]) {
	corner-shape: squircle;
}
/* "Unassigned" (\`placeholder\`): a dashed ring around a 12px user glyph. */
[data-hz=avatar][data-placeholder] { border-style: dashed; }
[data-hz=avatar][data-placeholder] > [data-hz-part=initials] { width: var(--hz-space-3); height: var(--hz-space-3); }
/* A 40pt row avatar's dot is today's \`presenceDot\` \`xs\`: 10px, cut out by a 2px outer ring (\`ring-2 ring-bg\`). */
[data-hz=avatar][data-size=medium] > [data-hz-part=presence] {
	border-width: 0;
	box-shadow: 0 0 0 2px var(--hz-color-bg);
}
[data-hz=avatar][data-size=medium][data-presence=offline] > [data-hz-part=presence] {
	box-shadow: 0 0 0 2px var(--hz-color-bg), inset 0 0 0 2px var(--hz-color-presence-offline);
}
/* A loaded picture covers the avatar alone (\`showsPicture\`). */
[data-pictured] > :is([data-hz-part=dither], [data-hz-part=initials]) { visibility: hidden; }
[data-hz-part=dither] {
	position: absolute;
	inset: 0;
	overflow: hidden;
	border-radius: inherit;
}
[data-hz-part=dither] > [data-hz-part=ditherFill] { position: absolute; inset: 0; overflow: hidden; }
[data-hz-part=ditherFill] > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
[data-hz=avatar][data-seeded] > [data-hz-part=initials],
[data-hz=peopleStrip] [data-seeded] > [data-hz-part=initials] {
	position: relative;
	color: white;
	font-weight: var(--hz-weight-semibold);
	font-size: 46cqw;
	line-height: 1;
	text-box: trim-both cap alphabetic;
}

[data-hz=avatarStack][data-layout=pair] {
	position: relative;
	display: block;
	width: var(--hz-space-10);
	height: var(--hz-space-10);
}
[data-hz=avatarStack][data-layout=pair] > [data-hz=avatar] {
	position: absolute;
	width: var(--hz-space-7);
	height: var(--hz-space-7);
	margin: 0;
	border-radius: var(--hz-radius-xl);
	box-shadow: 0 0 0 2px var(--hz-color-bg);
}
[data-hz=avatarStack][data-layout=pair] > [data-hz=avatar] > [data-hz-part=image] {
	width: 100%;
	height: 100%;
	border-radius: inherit;
}
[data-hz=avatarStack][data-layout=pair] > [data-hz-part=overflow] + [data-hz=avatar] { top: 0; left: 0; }
[data-hz=avatarStack][data-layout=pair] > [data-hz-part=overflow] + [data-hz=avatar] + [data-hz=avatar] {
	right: 0;
	bottom: 0;
}
[data-hz=avatarStack][data-layout=pair] > [data-hz-part=overflow] { display: none; }

/* A banner's \`actions\` slot mounts before its children; it reads after them, as the kit's. */
[data-hz=banner] > [data-hz-part=content] > [data-hz-slot=actions] { order: 1; }
[data-hz=banner] > [data-hz-part=content] > [data-hz-slot=actions]:empty { display: none; }
[data-hz=banner] > [data-hz-part=dismiss] { cursor: pointer; }
[data-hz=banner] > [data-hz-part=dismiss]:hover { opacity: 1; }
[data-hz=banner] > [data-hz-part=dismiss]:focus-visible {
	opacity: 1;
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 1px;
}

/* \`hz:codeBlock\`: the code keeps the part's mono step, not the browser's; \`wrap\` breaks long lines. */
[data-hz=codeBlock] > [data-hz-part=code] > code { font: inherit; }
[data-hz=codeBlock] > [data-hz-part=code] { white-space: pre; }
[data-hz=codeBlock][data-wrap] > [data-hz-part=code] { white-space: pre-wrap; overflow-wrap: anywhere; }
[data-hz=codeBlock] > [data-hz-part=header] > [data-hz-part=copy] { cursor: pointer; }
[data-hz=codeBlock] > [data-hz-part=header] > [data-hz-part=copy]:hover {
	background-color: var(--hz-color-fg-tint-hover);
}
[data-hz=codeBlock] > [data-hz-part=header] > [data-hz-part=copy]:focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 1px;
}
[data-hz=codeBlock] [data-hz-part=copy][data-copied] > [data-hz-part=copyIcon] { color: var(--hz-color-success); }

/* A richText code block (\`markdown-view.ts\`): the tools over the well's corner, the copy chip shown
   while the block is hovered or focused; a right gutter for them from regular, the code under the
   language on compact (where no pointer hovers). */
[data-hz=richText] > [data-hz-part=codeFrame] { position: relative; }
[data-hz=richText] > [data-hz-part=codeFrame] > [data-hz-part=codeTools] {
	position: absolute;
	top: var(--hz-space-2);
	right: var(--hz-space-2);
	z-index: 1;
}
[data-hz=richText] [data-hz-part=codeBlock] { overflow-x: auto; white-space: pre-wrap; }
[data-hz=richText] [data-hz-part=codeBlock] > code { font: inherit; }
[data-hz=richText] [data-hz-part=codeBlock][data-named] { padding-top: var(--hz-space-10); }
[data-hz=richText] [data-hz-part=codeBlock][data-collapsed] { max-height: calc(4 * var(--hz-space-20)); overflow: hidden; }
@media (width >= 40rem) {
	[data-hz=richText] [data-hz-part=codeBlock],
	[data-hz=richText] [data-hz-part=codeBlock][data-named] {
		padding-top: var(--hz-space-4);
		padding-inline-end: var(--hz-space-24);
	}
}
[data-hz=richText] [data-hz-part=codeCopy] { cursor: pointer; transition-property: opacity, background-color; }
[data-hz=richText] [data-hz-part=codeFrame]:hover [data-hz-part=codeCopy],
[data-hz=richText] [data-hz-part=codeCopy]:focus-visible { opacity: 1; }
[data-hz=richText] [data-hz-part=codeCopy]:hover { background-color: var(--hz-color-fg-tint-hover); }
[data-hz=richText] [data-hz-part=codeCopy]:focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 1px;
}

/* Prism's ink groups (\`code.ts\`), from today's \`code-syntax.css\`. */
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=comment] { color: var(--hz-color-syntax-comment); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=punctuation] { color: var(--hz-color-syntax-punctuation); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=constant] { color: var(--hz-color-syntax-constant); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=string] { color: var(--hz-color-syntax-string); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=operator] { color: var(--hz-color-syntax-operator); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=keyword] { color: var(--hz-color-syntax-keyword); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=function] { color: var(--hz-color-syntax-function); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=variable] { color: var(--hz-color-syntax-variable); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=comment] { font-style: italic; }
:is([data-hz=codeBlock], [data-hz=richText]) [data-syntax=namespace] { opacity: 0.7; }
:is([data-hz=codeBlock], [data-hz=richText]) [data-bold] { font-weight: var(--hz-weight-bold); }
:is([data-hz=codeBlock], [data-hz=richText]) [data-italic] { font-style: italic; }

/* \`hz:grid\`: one column on compact; \`columns\` equal tracks from regular, \`auto\` as many 16rem as fit. */
[data-hz=grid] { display: grid; grid-template-columns: minmax(0, 1fr); }
@media (width >= 40rem) {
	[data-hz=grid] {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(4 * var(--hz-space-16))), 1fr));
	}
	[data-hz=grid][data-columns="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	[data-hz=grid][data-columns="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	[data-hz=grid][data-columns="4"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

[data-hz=channelIcon] > :is([data-hz-part=lock], [data-hz-part=partners], [data-hz-part=sync]) {
	position: absolute;
}
/* The marks are cut from the surface they sit on (\`channel-icon-surface\`): each painted surface
   sets \`--hz-cutout\`, so the nearest one wins; the page (\`bg\`) when none does. */
:where([data-hz=screen]) { --hz-cutout: var(--hz-color-sidebar); }
:where([data-hz=screen]:is([data-surface=page], [data-surface=centered]),
	[data-hz=frame]:is(:not([data-surface]), [data-surface=card], [data-surface=flush], [data-surface=overlay]),
	[data-hz=dialog], [data-hz=sheet], [data-hz=popover], [data-hz=menu], [data-hz=contextMenu],
	[data-hz=commandPalette]) { --hz-cutout: var(--hz-color-bg); }
:where([data-hz=frame][data-surface=muted]) { --hz-cutout: var(--hz-color-muted); }
:where([data-hz=channelIcon][data-tile]) { --hz-cutout: var(--hz-color-secondary); }
[data-hz=channelIcon] > :is([data-hz-part=lock], [data-hz-part=sync]) {
	background-color: var(--hz-cutout, var(--hz-color-bg));
}
[data-hz=channelIcon] > [data-hz-part=lock] {
	top: calc(-1 * var(--hz-space-1));
	left: calc(-1 * var(--hz-space-1));
}
[data-hz=channelIcon] > :is([data-hz-part=partners], [data-hz-part=sync]) {
	right: calc(-1 * var(--hz-space-1));
	bottom: calc(-1 * var(--hz-space-0_5));
}
[data-hz=channelIcon] > [data-hz-part=partners] > * + * { margin-inline-start: calc(-1 * var(--hz-space-1)); }
[data-hz=channelIcon] > [data-hz-part=partners] > * {
	box-shadow: 0 0 0 1.5px var(--hz-cutout, var(--hz-color-bg));
}
[data-hz=channelIcon][data-partnered] > [data-hz-part=sync] { top: calc(-1 * var(--hz-space-1)); bottom: auto; }
[data-hz=channelIcon] > [data-hz-part=sync][data-provider=discord] > [data-hz-part=syncLogo] {
	width: var(--hz-space-2_5);
	height: var(--hz-space-2_5);
}

[data-hz=peopleStrip] {
	scroll-snap-type: x;
	scrollbar-width: none;
	padding-top: var(--hz-space-4);
	padding-bottom: var(--hz-space-1);
}
[data-hz=peopleStrip] > [data-hz-part=tile] {
	width: var(--hz-space-14);
	scroll-snap-align: start;
	text-decoration: none;
	transition: opacity var(--hz-duration-micro) var(--hz-ease-out);
}
[data-hz=peopleStrip] > [data-hz-part=tile]:active { opacity: 0.6; }
[data-hz=peopleStrip] > [data-hz-part=tile]:focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 2px;
}
[data-hz=peopleStrip] [data-hz-part=avatar] { position: relative; }
[data-hz=peopleStrip] [data-seeded] { container-type: size; }
[data-hz=peopleStrip] [data-hz-part=avatar] > [data-hz-part=image] {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
	border-radius: inherit;
}
[data-hz=peopleStrip] [data-hz-part=presence] {
	position: absolute;
	right: 0;
	bottom: 0;
	transform: translate(25%, 25%);
	box-shadow: 0 0 0 2.5px var(--hz-color-bg);
}
[data-hz=peopleStrip] [data-hz-part=presence][data-presence=online] {
	background-color: var(--hz-color-presence-online);
}
[data-hz=peopleStrip] [data-hz-part=presence][data-presence=away] {
	background-color: var(--hz-color-presence-away);
}
[data-hz=peopleStrip] [data-hz-part=presence][data-presence=busy] {
	background-color: var(--hz-color-presence-busy);
}
[data-hz=peopleStrip] [data-hz-part=presence][data-presence=offline] {
	background-color: var(--hz-color-bg);
	box-shadow: 0 0 0 2.5px var(--hz-color-bg), inset 0 0 0 2px var(--hz-color-presence-offline);
}
[data-hz=peopleStrip] [data-emphasized] > [data-hz-part=label] {
	color: var(--hz-color-fg);
	font-weight: var(--hz-weight-semibold);
}
@media (prefers-reduced-motion: reduce) {
	[data-hz=peopleStrip] > [data-hz-part=tile] { transition: none; }
}
`

const installed = new WeakSet<Document>()

/** Adds the layout and content renderers' stylesheet to `document` once. */
export const ensureStyles = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzRenderer = "content"
	style.textContent = css
	;(document.head ?? document.documentElement).append(style)
}
