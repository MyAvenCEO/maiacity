<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Figure 6: one HEART, invested into a COOP: the MIND it creates goes half to the investor, half to the treasury. Band widths are to scale.
</script>

<div class="scroll">
<svg viewBox="0 0 680 300" role="img" aria-label="One HEART invested in a COOP is minted into two MIND halves: half to the investor's wallet, half to the COOP treasury, which pairs it with the HEART in its own AMM pool.">
	<defs>
		<linearGradient id="split-heart" x1="0" x2="1">
			<stop offset="0" stop-color="#c8744f" stop-opacity="0.85" />
			<stop offset="1" stop-color="#c8744f" stop-opacity="0.55" />
		</linearGradient>
	</defs>

	<!-- the HEART flows into the COOP -->
	<path d="M128 110 H210 V190 H128 Z" fill="url(#split-heart)" />
	<!-- minted: upper half to the investor, lower half to the treasury -->
	<path d="M262 110 C340 110, 340 40, 420 40 L420 80 C360 80, 360 150, 262 150 Z" fill="#d9a520" opacity="0.75" />
	<path d="M262 150 C360 150, 360 200, 420 200 L420 240 C340 240, 340 190, 262 190 Z" fill="#26382c" opacity="0.7" />
	<!-- the treasury's half and the HEART meet in the COOP's own pool -->
	<path d="M210 190 C240 270, 470 286, 512 262 L512 246 C470 268, 250 258, 222 190 Z" fill="#c8744f" opacity="0.35" />
	<path d="M420 200 H512 V240 H420 Z" fill="#26382c" opacity="0.55" />

	<rect x="210" y="100" width="52" height="100" rx="8" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="236" y="146" text-anchor="middle" class="node">COOP</text>
	<text x="236" y="162" text-anchor="middle" class="sub">mint</text>

	<rect x="512" y="196" width="160" height="80" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="592" y="226" text-anchor="middle" class="node">AMM pool</text>
	<text x="592" y="244" text-anchor="middle" class="sub">HEARTS × TREASURYmind</text>
	<text x="592" y="260" text-anchor="middle" class="sub">= k, owned by the COOP</text>

	<rect x="512" y="22" width="160" height="76" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="592" y="52" text-anchor="middle" class="node">Your wallet</text>
	<text x="592" y="70" text-anchor="middle" class="sub">equity and the right</text>
	<text x="592" y="84" text-anchor="middle" class="sub">to use what it makes</text>
	<path d="M420 40 H512 V80 H420 Z" fill="#d9a520" opacity="0.6" />

	<text x="12" y="146" class="node">1 HEART</text>
	<text x="12" y="164" class="sub">your daily intent</text>
	<text x="420" y="32" class="lab">½ INVESTORmind</text>
	<text x="420" y="192" class="lab">½ TREASURYmind</text>
	<text x="300" y="292" class="sub">the HEART itself becomes the pool's other side</text>
</svg>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}

	svg {
		min-width: 540px;
		display: block;
		width: 100%;
		height: auto;
		font-family: var(--font-body);
	}

	.node {
		font-size: 14px;
		font-weight: 600;
		fill: var(--ink);
	}

	.sub {
		font-size: 11.5px;
		fill: var(--ink-soft);
	}

	.lab {
		font-size: 12px;
		font-weight: 500;
		fill: var(--ink);
	}
</style>
