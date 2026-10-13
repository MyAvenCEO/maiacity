<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Figure 6: one HEART, invested into a COOP, converts into one MIND: 0.5 to the investor, 0.4 to the COOP's treasury
	// as working capital, 0.1 to the city's pools (the liquidity rule). Band widths are to scale.
</script>

<div class="scroll">
<svg viewBox="0 0 680 340" role="img" aria-label="One HEART invested into a COOP converts into one MIND and is gone. 0.5 goes to the investor's wallet, 0.4 to the COOP's treasury as working capital, and 0.1 to the city's pools, baskets of 4 to 8 MINDs whose LP tokens the City COOP holds.">
	<defs>
		<linearGradient id="split-heart" x1="0" x2="1">
			<stop offset="0" stop-color="#c8744f" stop-opacity="0.85" />
			<stop offset="1" stop-color="#c8744f" stop-opacity="0.55" />
		</linearGradient>
	</defs>

	<!-- the HEART flows into the COOP -->
	<path d="M128 110 H210 V190 H128 Z" fill="url(#split-heart)" />
	<!-- minted: 0.5 to the investor (top), 0.4 to the treasury (middle), 0.1 to the pools (bottom) -->
	<path d="M262 110 C340 110, 340 40, 420 40 L420 80 C360 80, 360 150, 262 150 Z" fill="#d9a520" opacity="0.75" />
	<path d="M262 150 C340 150, 340 166, 420 166 L420 198 C340 198, 340 182, 262 182 Z" fill="#26382c" opacity="0.7" />
	<path d="M262 182 C340 182, 340 280, 420 280 L420 288 C340 288, 340 190, 262 190 Z" fill="#5b8fa8" opacity="0.8" />
	<path d="M420 166 H512 V198 H420 Z" fill="#26382c" opacity="0.55" />
	<path d="M420 280 H512 V288 H420 Z" fill="#5b8fa8" opacity="0.65" />
	<path d="M420 40 H512 V80 H420 Z" fill="#d9a520" opacity="0.6" />

	<rect x="210" y="100" width="52" height="100" rx="8" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="236" y="146" text-anchor="middle" class="node">invest</text>
	<text x="236" y="162" text-anchor="middle" class="sub">HEART→MIND</text>

	<rect x="512" y="22" width="160" height="76" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="592" y="52" text-anchor="middle" class="node">Your wallet</text>
	<text x="592" y="70" text-anchor="middle" class="sub">ownership and a share</text>
	<text x="592" y="84" text-anchor="middle" class="sub">of what it makes</text>

	<rect x="512" y="146" width="160" height="72" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="592" y="176" text-anchor="middle" class="node">COOP treasury</text>
	<text x="592" y="194" text-anchor="middle" class="sub">working capital</text>

	<rect x="512" y="248" width="160" height="80" rx="10" fill="var(--paper)" stroke="#5b8fa8" stroke-width="1.5" />
	<text x="592" y="274" text-anchor="middle" class="node">The city's pools</text>
	<text x="592" y="292" text-anchor="middle" class="sub">baskets of 4 to 8 MINDs;</text>
	<text x="592" y="306" text-anchor="middle" class="sub">the City COOP holds</text>
	<text x="592" y="320" text-anchor="middle" class="sub">their LP tokens</text>

	<text x="12" y="146" class="node">1 HEART</text>
	<text x="12" y="164" class="sub">your daily intent</text>
	<text x="420" y="32" class="lab">0.5 MIND</text>
	<text x="420" y="158" class="lab">0.4 MIND</text>
	<text x="420" y="272" class="lab">0.1 MIND</text>
	<text x="236" y="222" text-anchor="middle" class="sub">the HEART is gone</text>
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
