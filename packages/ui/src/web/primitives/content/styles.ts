/**
 * What the layout and content renderers own and a recipe cannot say (C3 `rendererFeatures`): the
 * standalone icon size, the seeded dither under an initial, the kit's squircle corners, absolute
 * marks and the pair layout, outer cut-out rings, and per-tile states of the people strip. Tokens
 * only, except the dither's white initial, which is today's literal.
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

:where([data-hz=avatar]) { position: relative; }
[data-hz=avatar][data-seeded] { container-type: size; }
[data-hz=avatar]:is([data-size=medium], [data-size=large]),
[data-hz=avatar]:is([data-size=medium], [data-size=large]) > :is([data-hz-part=image], [data-hz-part=dither]),
[data-hz=avatarStack][data-layout=pair] > [data-hz=avatar],
[data-hz=avatarStack][data-layout=pair] > [data-hz=avatar] > :is([data-hz-part=image], [data-hz-part=dither]),
[data-hz=peopleStrip] [data-hz-part=avatar],
[data-hz=peopleStrip] [data-hz-part=avatar] > :is([data-hz-part=image], [data-hz-part=dither]) {
	corner-shape: squircle;
}
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

[data-hz=channelIcon] > :is([data-hz-part=lock], [data-hz-part=partners], [data-hz-part=sync]) {
	position: absolute;
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
[data-hz=channelIcon] > [data-hz-part=partners] > * { box-shadow: 0 0 0 1.5px var(--hz-color-bg); }
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
