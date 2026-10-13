<script>
	import { base } from '$app/paths';
	import Sequence from '$lib/docs/Sequence.svelte';
	import { CHANGES, TRIPS } from '$lib/docs/avendb.js';

	const PR = 'https://github.com/MyAvenCEO/maiacity/pull/';

	const answers = [
		{
			q: 'Is it one backend for data and blobs?',
			a: 'Yes. An edit is a small blob and a film is a big one. Both are named by their BLAKE3 hash, kept in the same iroh store, moved by the same protocol and backed up to the same bucket.'
		},
		{
			q: 'Is the server only relay, sync and backup?',
			a: 'Yes. Every write is signed and stored on a device first and counts from that moment. The server never orders or approves writes, so it needs no fast write path: what it needs is upload bandwidth for big files, and durable storage.'
		},
		{
			q: 'Can it stream terabytes and replace Studio’s backend?',
			a: 'Yes. Files are cut into 1 GiB pieces that are verified every 16 KiB, resume where they stopped and seek to any byte. Studio moves over later. The legacy media vault stays untouched.'
		},
		{
			q: 'Is OPFS the browser’s one source of truth?',
			a: 'Yes, built. Edits and keys live in OPFS, in a Web Worker where it has fast file access, and file pieces will join them. IndexedDB’s data moved over once and IndexedDB is gone. Of a big film, a browser keeps only what you watched or pinned.'
		},
		{
			q: 'Is the bucket the server’s truth, its disk only a cache?',
			a: 'Yes, and only the bucket counts. The server announces an edit, or says it keeps a file, only once the bucket holds it. Until then the device that wrote it sees the server lacks it, keeps it, and announces it again. Wipe the disk and the server rebuilds from the bucket.'
		},
		{
			q: 'Are caps and sync rules one concept?',
			a: 'Yes, built. A cap says which vault may have what. A sync rule says what one of its devices wants of that, by the same selector, for any kind of data: kept whole, or fetched as it is read. A rule grants nothing. Proxies and originals are just the types or tags your app gives them: your phone keeps proxies, the SSD Mac keeps originals, the server keeps all.'
		},
		{
			q: 'What if every passkey is lost?',
			a: 'The master recovery key is among the owners of every human vault from its founding. Its secret is kept offline by its person, and it adds a new device or passkey like any owner would. It is added and removed in Settings like any owner.'
		}
	];
</script>

<svelte:head>
	<title>avenDB architecture · Docs · maiaCITY</title>
	<meta
		name="description"
		content="avenDB's storage architecture: one content-addressed backend for database edits and terabytes of media, synced device to device, backed up to a sealed bucket."
	/>
</svelte:head>

<main class="wrap">
	<a class="back" href="{base}/docs">← Docs</a>

	<header class="intro">
		<p class="eyebrow">avenDB&ensp;·&ensp;architecture&ensp;·&ensp;updated 13 October 2026</p>
		<h1>avenDB Storage Architecture</h1>
		<p class="lede">
			One content-addressed backend for database edits and multi-terabyte media, built the way iroh intends it. Every
			write happens on a device first. The server relays, stays online for sync and keeps an encrypted backup on object
			storage, without ever holding a key.
		</p>
		<p class="status">
			<span>B1 and B2 built</span><span>B3 under way: the bucket is made</span><span>B4 and B5 next</span>
		</p>
	</header>

	<section>
		<p class="eyebrow">Latest</p>
		<h2>What changed lately</h2>
		<ol class="changes">
			{#each CHANGES as c, i (i)}
				<li>
					<span class="when">{c.when}</span>
					<p>
						{c.what}
						<span class="prs"
							>{#each c.prs as n, j (n)}{j ? ', ' : ''}<a href="{PR}{n}" target="_blank" rel="noopener noreferrer">#{n}</a
								>{/each}</span
						>
					</p>
				</li>
			{/each}
		</ol>
	</section>

	<section>
		<p class="eyebrow">Short answers</p>
		<h2>Your questions</h2>
		<div class="answers">
			{#each answers as x (x.q)}
				<div>
					<span class="yes">Yes</span>
					<b>{x.q}</b>
					<p>{x.a}</p>
				</div>
			{/each}
		</div>
	</section>

	<section>
		<p class="eyebrow">The whole system</p>
		<h2>Four kinds of place, one protocol stack</h2>
		<p class="prose-col">
			Every device is a full avenDB node with its own store; in a browser it is kept in OPFS. The server is the same kind
			of node, its bucket its source of truth and its disk only a cache. Devices talk to each other directly whenever the
			network allows it, and through the relay when it does not. Browsers always go through the relay.
		</p>
		<figure>
			<div class="frame">
				<svg class="fig" viewBox="0 0 960 560" role="img" aria-label="System map">
					<rect class="node" x="20" y="30" width="290" height="180" rx="16" />
					<text class="h" x="40" y="62">Mac · maiaCITY Studio</text>
					<text class="s" x="40" y="88">avenDB device, native</text>
					<text class="s" x="40" y="110">iroh FsStore on disk:</text>
					<text class="s" x="40" y="130">edits in its store,</text>
					<text class="s" x="40" y="150">file pieces as files</text>
					<text class="s" x="40" y="180">keeps what its sync rules want</text>
					<rect class="node" x="20" y="350" width="290" height="180" rx="16" />
					<text class="h" x="40" y="382">Phone or browser</text>
					<text class="s" x="40" y="408">avenDB device in the page (wasm)</text>
					<text class="s" x="40" y="430">one store in OPFS, in a worker:</text>
					<text class="s" x="40" y="450">its source of truth</text>
					<text class="s" x="40" y="480">streams files when they play,</text>
					<text class="s" x="40" y="500">keeps what you pin</text>
					<rect class="srv" x="390" y="150" width="300" height="250" rx="16" />
					<text class="h" x="410" y="182">avenDB server · Hetzner</text>
					<text class="s" x="410" y="212">relay: connects devices to each other</text>
					<text class="s" x="410" y="234">sync peer: always online</text>
					<text class="s" x="410" y="256">backup: ciphertext only, no keys</text>
					<line class="thin" x1="410" y1="276" x2="670" y2="276" />
					<text class="s" x="410" y="300">disk, a cache it can lose:</text>
					<text class="s" x="410" y="322">recent pieces and outboards,</text>
					<text class="s" x="410" y="344">what the bucket also holds</text>
					<text class="m" x="410" y="380">avenCEO acts for it</text>
					<path class="bkt" d="M770 170 v210 a80 18 0 0 0 160 0 v-210" />
					<ellipse class="bkt" cx="850" cy="170" rx="80" ry="18" />
					<text class="h" x="850" y="214" text-anchor="middle">Object storage</text>
					<text class="s" x="850" y="236" text-anchor="middle">maiacity-avendb, hel1</text>
					<text class="m" x="850" y="272" text-anchor="middle">edits/</text>
					<text class="m" x="850" y="294" text-anchor="middle">keys/</text>
					<text class="m" x="850" y="316" text-anchor="middle">pieces/ (B3b)</text>
					<text class="s" x="850" y="348" text-anchor="middle">sealed, locked 7 days</text>
					<text class="s" x="850" y="370" text-anchor="middle">the server's truth</text>
					<line class="ctl" x1="120" y1="210" x2="120" y2="350" />
					<path class="bytes" d="M175 214 V346" />
					<text class="s" x="190" y="268">direct QUIC,</text>
					<text class="s" x="190" y="288">hole punched</text>
					<line class="ctl" x1="310" y1="110" x2="390" y2="190" />
					<path class="bytes" d="M310 150 L388 228" />
					<line class="relay" x1="310" y1="420" x2="390" y2="350" />
					<path class="bytes" d="M310 470 L388 380" stroke-dasharray="2 9" />
					<path class="bytes" d="M692 260 H758" />
					<polygon class="bc" points="756,252 770,260 756,268" />
					<path class="bytes" d="M766 300 H704" />
					<polygon class="bc" points="706,292 692,300 706,308" />
					<text class="s" x="700" y="246">up</text>
					<text class="s" x="700" y="326">ranges</text>
					<g transform="translate(410 440)">
						<line class="ctl" x1="0" y1="10" x2="34" y2="10" />
						<text class="s" x="44" y="14">edits and control (avendb/sync/1)</text>
						<path class="bytes" d="M0 40 H34" />
						<text class="s" x="44" y="44">file bytes (iroh-blobs, BLAKE3 verified)</text>
						<line class="relay" x1="0" y1="70" x2="34" y2="70" />
						<text class="s" x="44" y="74">through the relay: browsers always, others when no direct path</text>
					</g>
				</svg>
			</div>
			<figcaption>
				Every arrow carries ciphertext only. Keys never leave the devices of people the vault shares with, and the server
				seals every object again before it goes to the bucket.
			</figcaption>
		</figure>
	</section>

	<section>
		<p class="eyebrow">Inside one node</p>
		<h2>The layering n0 intends, and what avenDB adds</h2>
		<p class="prose-col">
			iroh's own guidance: an endpoint, a router that hands each connection to a protocol by its ALPN, the app's own
			protocol for app logic, and iroh-blobs for every byte. avenDB has all four: iroh-blobs carries McEliece keys and
			files today, and will carry edits too.
		</p>
		<figure>
			<div class="frame">
				<svg class="fig" viewBox="0 0 960 360" role="img" aria-label="The five layers of an avenDB node">
					<rect class="band-av" x="20" y="20" width="760" height="56" rx="10" />
					<text class="h" x="40" y="45">Lab: vaults, caps, sync rules, keys, Loro documents, JSON ops</text>
					<text class="s" x="40" y="65">decides what counts, decrypts what this device may read, names the blobs each edit needs</text>
					<rect class="band-n0" x="20" y="86" width="372" height="56" rx="10" />
					<text class="h" x="40" y="111">Store: one iroh-blobs store per node</text>
					<text class="s" x="40" y="131">FsStore on Mac and server, memory in browsers</text>
					<rect class="band-av" x="408" y="86" width="372" height="56" rx="10" />
					<text class="h" x="428" y="111">Around it</text>
					<text class="s" x="428" y="131">OPFS in browsers, the sealed bucket on the server</text>
					<rect class="band-av" x="20" y="152" width="372" height="66" rx="10" />
					<text class="h" x="40" y="178">avendb/sync/1</text>
					<text class="s" x="40" y="200">hellos, frontiers, announcements, holdings</text>
					<rect class="band-n0" x="408" y="152" width="372" height="66" rx="10" />
					<text class="h" x="428" y="178">/iroh-bytes/4 (iroh-blobs)</text>
					<text class="s" x="428" y="200">verified streaming, ranges, resume, GetMany</text>
					<rect class="band-n0" x="20" y="228" width="760" height="56" rx="10" />
					<text class="h" x="40" y="253">Endpoint and router (iroh 1.3)</text>
					<text class="s" x="40" y="273">one id per device · QUIC · TLS 1.3 with X25519MLKEM768 only · hole punching</text>
					<rect class="band-n0" x="20" y="294" width="760" height="50" rx="10" />
					<text class="h" x="40" y="317">Transport</text>
					<text class="s" x="140" y="317">UDP when direct, avenDB's own relay otherwise (WebSocket for browsers)</text>
					<rect class="band-av" x="800" y="28" width="16" height="16" rx="4" />
					<text class="s" x="824" y="41">avenDB's own code</text>
					<rect class="band-n0" x="800" y="56" width="16" height="16" rx="4" />
					<text class="s" x="824" y="69">n0's crates</text>
				</svg>
			</div>
			<figcaption>
				The sync protocol carries small things and decisions (what changed, who holds what). iroh-blobs carries bytes.
				Both share one endpoint, one identity and one post-quantum TLS setup.
			</figcaption>
		</figure>
	</section>

	<section>
		<p class="eyebrow">What a blob is</p>
		<h2>An edit is a small blob, a file is a list of big ones</h2>
		<div class="table">
			<table>
				<thead>
					<tr><th>Thing</th><th>As a blob</th><th>Typical size</th><th>Where a device keeps it</th></tr>
				</thead>
				<tbody>
					<tr>
						<td>An edit (a note change, a todo, a cap)</td>
						<td>Its signed wire bytes. The body is already encrypted.</td>
						<td class="num">0.2 to 16 KiB</td>
						<td>In the device's store, no file of its own</td>
					</tr>
					<tr>
						<td>A page of a vault's log</td>
						<td>A HashSeq: the list of its edits' hashes</td>
						<td class="num">32 B per edit</td>
						<td>In the store</td>
					</tr>
					<tr>
						<td>A photo, a document</td>
						<td>One encrypted blob</td>
						<td class="num">up to 1 GiB</td>
						<td>A file plus its outboard</td>
					</tr>
					<tr>
						<td>A film or a camera card</td>
						<td>A HashSeq of encrypted 1 GiB pieces</td>
						<td class="num">1 GiB to many TB</td>
						<td>Pieces as files, kept or streamed by need</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p class="prose-col">
			Each edit keeps two names. Its id is a SHA-3 hash, and that is what signatures sign. Its BLAKE3 hash is what iroh
			stores, moves and verifies. The edit that brings a file lists the file's root hash in the clear, because the server
			and other devices need it to back the file up and to know who may fetch it. The file's key sits inside the edit's
			encrypted body.
		</p>
		<figure>
			<div class="frame">
				<svg class="fig" viewBox="0 0 960 470" role="img" aria-label="How a file becomes blobs">
					<text class="h" x="20" y="30">1 · The file, in plaintext</text>
					<rect class="plain" x="20" y="44" width="110" height="34" rx="6" />
					<rect class="plain" x="134" y="44" width="110" height="34" rx="6" />
					<rect class="plain" x="248" y="44" width="110" height="34" rx="6" />
					<rect class="plain" x="362" y="44" width="110" height="34" rx="6" />
					<text class="m" x="490" y="66">…</text>
					<text class="m" x="36" y="66">65,520 B</text>
					<text class="m" x="150" y="66">65,520 B</text>
					<text class="m" x="264" y="66">65,520 B</text>
					<text class="m" x="378" y="66">65,520 B</text>
					<text class="s" x="530" y="58">random key K for this file</text>
					<text class="s" x="530" y="76">ChaCha20-Poly1305, nonce = segment number + last flag</text>
					<path class="thin" d="M240 84 v24" />
					<path class="thin" d="M234 100 l6 8 l6 -8" />
					<text class="h" x="20" y="134">2 · Encrypted segments, each exactly 64 KiB</text>
					<rect class="seg" x="20" y="148" width="110" height="34" rx="6" />
					<rect class="seg" x="134" y="148" width="110" height="34" rx="6" />
					<rect class="seg" x="248" y="148" width="110" height="34" rx="6" />
					<rect class="seg" x="362" y="148" width="110" height="34" rx="6" />
					<text class="m" x="490" y="170">…</text>
					<text class="m" x="44" y="170">64 KiB</text>
					<text class="m" x="158" y="170">64 KiB</text>
					<text class="m" x="272" y="170">64 KiB</text>
					<text class="m" x="386" y="170">64 KiB</text>
					<path class="thin" d="M362 182 L560 212" />
					<path class="thin" d="M472 182 L900 212" />
					<rect class="seg" x="560" y="212" width="82" height="30" rx="5" />
					<rect class="seg" x="646" y="212" width="82" height="30" rx="5" />
					<rect class="seg" x="732" y="212" width="82" height="30" rx="5" />
					<rect class="seg" x="818" y="212" width="82" height="30" rx="5" />
					<text class="m" x="574" y="232">16 KiB</text>
					<text class="m" x="660" y="232">16 KiB</text>
					<text class="m" x="746" y="232">16 KiB</text>
					<text class="m" x="832" y="232">16 KiB</text>
					<text class="s" x="560" y="262">four iroh chunk groups: each verified on its own,</text>
					<text class="s" x="560" y="280">so a seek fetches whole segments and nothing more</text>
					<text class="h" x="20" y="232">3 · Pieces of 16,384 segments</text>
					<rect class="seg" x="20" y="246" width="150" height="40" rx="7" />
					<rect class="seg" x="176" y="246" width="150" height="40" rx="7" />
					<rect class="seg" x="332" y="246" width="150" height="40" rx="7" />
					<text class="m" x="34" y="271">piece 0 · 1 GiB</text>
					<text class="m" x="190" y="271">piece 1 · 1 GiB</text>
					<text class="m" x="346" y="271">piece n · rest</text>
					<path class="thin" d="M95 286 V316 M251 286 V316 M407 286 V316 M95 316 H407 M251 316 V330" />
					<rect class="box" x="120" y="330" width="262" height="36" rx="7" />
					<text class="m" x="134" y="353">HashSeq root = list of piece hashes</text>
					<text class="h" x="20" y="400">4 · The edit that brings it</text>
					<rect class="edit" x="20" y="412" width="500" height="44" rx="8" />
					<text class="s" x="36" y="432">in the clear: root hash, size</text>
					<text class="s" x="36" y="449">encrypted: name, type, key K, plaintext length</text>
					<path class="thin" d="M251 366 V412" />
					<text class="s" x="560" y="400">the edit is signed and synced like any edit;</text>
					<text class="s" x="560" y="420">the pieces follow by need, from whoever holds them</text>
				</svg>
			</div>
			<figcaption>
				This format is called sealed blob v1. The tag adds 0.024 %. Pieces cannot be swapped or reordered, because every
				nonce counts segments across the whole file. Whoever holds the key verifies by decrypting; everyone else verifies
				the ciphertext with BLAKE3.
			</figcaption>
		</figure>
	</section>

	<section>
		<p class="eyebrow">Roundtrips</p>
		<h2>Six journeys through the system</h2>
		<p class="swipe">Swipe a diagram sideways to see all of it.</p>
		{#each TRIPS as trip, i (trip.title)}
			<figure>
				<h3>{i + 1} · {trip.title}</h3>
				<div class="frame">
					<Sequence spec={trip.spec} label={trip.title} />
				</div>
				<figcaption>{trip.caption}</figcaption>
			</figure>
		{/each}
	</section>

	<section>
		<p class="eyebrow">Trust</p>
		<h2>What the server and the bucket can and cannot see</h2>
		<div class="split">
			<div>
				<h3>The server sees</h3>
				<ul>
					<li>Which devices connect, and when</li>
					<li>Vault and cap ids, and which device belongs to which vault</li>
					<li>Sizes and BLAKE3 hashes of ciphertext</li>
					<li>Which pieces get read, which hints at what plays</li>
				</ul>
			</div>
			<div class="no">
				<h3>It never sees</h3>
				<ul>
					<li>Any content: notes, todos, file bytes</li>
					<li>File names, types, tags, who shares what with whom inside a vault</li>
					<li>Any key, since keys travel inside sealed edits</li>
					<li>Whether two people hold the same film, because every file has its own random key</li>
				</ul>
			</div>
			<div class="no">
				<h3>The bucket sees</h3>
				<ul>
					<li>Sealed objects and their sizes, nothing more</li>
					<li>Not even what the server sees: every object is sealed with a 256-bit key the server keeps</li>
					<li>Whoever records the link to it, classical TLS since Hetzner offers nothing else, sees the same noise</li>
				</ul>
			</div>
		</div>
		<p class="note prose-col">
			A Public cap is the exception by design: it publishes a key in the clear so anyone can read what it covers.
		</p>
	</section>

	<section>
		<p class="eyebrow">Where the bytes live</p>
		<h2>Storage on each kind of place</h2>
		<div class="table">
			<table>
				<thead>
					<tr><th>Place</th><th>Small blobs (edits)</th><th>Big blobs (pieces)</th><th>Kept until</th></tr>
				</thead>
				<tbody>
					<tr>
						<td>Mac</td>
						<td>Its store on disk</td>
						<td>iroh FsStore files, with their outboards</td>
						<td>No sync rule wants them, then garbage collection</td>
					</tr>
					<tr>
						<td>Phone or browser</td>
						<td>OPFS, its one store (IndexedDB moved over and gone)</td>
						<td>OPFS, what you watched or pinned</td>
						<td>Played and not pinned, oldest first</td>
					</tr>
					<tr>
						<td>Server disk</td>
						<td>A copy of what the bucket holds</td>
						<td>A cache of recent pieces and their outboards</td>
						<td>A cache: wiped any time, rebuilt from the bucket</td>
					</tr>
					<tr>
						<td>Bucket</td>
						<td><code>edits/</code> packs and <code>keys/</code>, each sealed</td>
						<td><code>pieces/</code>, one object per piece (B3b)</td>
						<td>The source of truth: every version locked 7 days, replaced ones gone 7 days later</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p class="prose-col">
			Packing is what makes object storage work for a database. Hetzner bills every object as at least 64 KB and allows
			750 requests a second per bucket. A million edits stored one per object would take 22 minutes of a fully busy
			bucket to write or restore. Packed, they are a few hundred objects.
		</p>
	</section>

	<section>
		<p class="eyebrow">Numbers</p>
		<h2>What it costs, in bytes and euros</h2>
		<div class="table">
			<table>
				<thead>
					<tr><th>Item</th><th>Value</th><th>Why it matters</th></tr>
				</thead>
				<tbody>
					<tr>
						<td>Verification data (outboard)</td>
						<td class="num">0.39 %</td>
						<td>64 bytes per 16 KiB: 195 MB for a 50 GB file, 19.5 GB for 5 TB</td>
					</tr>
					<tr>
						<td>Encryption overhead</td>
						<td class="num">0.024 %</td>
						<td>16 bytes per 64 KiB segment: 1.2 GB for 5 TB</td>
					</tr>
					<tr>
						<td>Pieces in a 4 TB film</td>
						<td class="num">3,727</td>
						<td>Its HashSeq root is 119 KB; each piece is one bucket object of 64 parts</td>
					</tr>
					<tr>
						<td>Largest object at Hetzner</td>
						<td class="num">5 TB</td>
						<td>1 GiB pieces stay far below it, and below the 10,000-part limit</td>
					</tr>
					<tr>
						<td>5 TB of film in the bucket</td>
						<td class="num">≈ €32.5 a month</td>
						<td>Base €6.49 with 1 TB included, then about €6.47 per TB; requests are free</td>
					</tr>
					<tr>
						<td>Upload from home at 54 Mbit/s</td>
						<td class="num">≈ 41 h per TB</td>
						<td>The real bottleneck for big media, not the server or the bucket</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section>
		<p class="eyebrow">Building it</p>
		<h2>Five steps, each one shippable</h2>
		<ol class="phases">
			<li class="done">
				<span class="tag">B1 · blob core · built (<a href="{PR}530">#530</a>, <a href="{PR}532">#532</a>)</span>
				<h3>Sealed blob v1 and edits that name files</h3>
				<p>
					Seekable encryption in the core crate with test vectors. Writes name the files they bring, their keys sealed in
					the body, in the Lean model and the wire format, and T27 proves that files follow their edits: whoever may
					receive the write may fetch the file, only its readers open it.
				</p>
			</li>
			<li class="done">
				<span class="tag"
					>B2 · stores and sync rules · built (<a href="{PR}537">#537</a>, <a href="{PR}539">#539</a>,
					<a href="{PR}541">#541</a>)</span
				>
				<h3>One iroh store per node, and what each peer wants</h3>
				<p>
					One blob store per node, on disk on the Mac and the server: a file is sealed as it is read, any byte range is
					fetched through the cap gate, and the server keeps every file whole. Sync rules: the cap selector per device for
					any data, sealed, marked on each entry by the vault's stewards and applied by every peer from the marks (T28,
					T29). The browser's store in OPFS, in a worker of its own. The browser's file pieces in OPFS move to B4, with
					the page's file API.
				</p>
			</li>
			<li class="now">
				<span class="tag">B3 · bucket · under way (<a href="{PR}557">#557</a>)</span>
				<h3>The server on object storage</h3>
				<p>
					The bucket is made, locked and sealed. Next, B3a: the server writes every edit and key it takes to the bucket
					first, and only then counts it; its disk becomes a cache it rebuilds from the bucket. Then B3b: one object per
					file piece, and read-ahead range serving.
				</p>
			</li>
			<li>
				<span class="tag">B4 · streaming</span>
				<h3>Play anything, anywhere</h3>
				<p>
					A decrypting reader for the Mac's player, a service worker that decrypts ranges in the browser, the browser's
					file pieces in OPFS, and a Files page in each vault: drop a file, watch it sync, play it.
				</p>
			</li>
			<li>
				<span class="tag">B5 · Studio</span>
				<h3>Studio on avenDB</h3>
				<p>
					Media, story and transcript entries, sync rules per device, ingest from cards and the watch folder. New work
					goes to avenDB; the legacy media vault keeps running untouched beside it.
				</p>
			</li>
		</ol>
	</section>

	<section>
		<p class="eyebrow">Decided</p>
		<h2>Two choices, made</h2>
		<div class="decided">
			<div>
				<h3>A new bucket, locked</h3>
				<p>
					avenDB has a bucket of its own, <code>maiacity-avendb</code> in Helsinki, beside the media vault's. Every
					object version is locked for 7 days in compliance mode: no key, not even the project's, deletes or overwrites
					it before then, so even a compromised server can't wipe the backup. A replaced or deleted version goes 7 days
					later.
				</p>
			</div>
			<div>
				<h3>Sealed, since the link is classical</h3>
				<p>
					Hetzner's endpoint refuses post-quantum key exchange; it speaks classical X25519 only. So the server seals
					every object with a 256-bit key of its own before upload: what crosses the link, and what the bucket keeps, is
					safe against a quantum computer, and Hetzner sees only noise. The key lives in the deploy's secrets, with a
					copy kept offline.
				</p>
			</div>
		</div>
	</section>

	<footer class="note">
		Sources: iroh-blobs 0.103.1 and bao-tree 0.16.1 source, n0's blog and docs, n0's iroh-s3-bao-store experiment,
		Hetzner Object Storage documentation and the bucket's own answers, and avenDB's and Studio's code as of 13 October
		2026.
	</footer>
</main>

<style>
	main {
		--mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		display: grid;
		gap: 4rem;
		padding-block: 3rem 6rem;
	}
	.back {
		justify-self: start;
		font-size: 0.95rem;
		color: var(--ink-soft);
		text-decoration: none;
		margin-bottom: -2.5rem;
	}
	.back:hover {
		color: var(--ink);
	}
	.intro {
		display: grid;
		gap: 1.25rem;
	}
	h1 {
		font-size: clamp(2.6rem, 7vw, 5rem);
		max-width: 16ch;
		text-wrap: balance;
	}
	h2 {
		font-size: clamp(1.9rem, 4vw, 2.8rem);
		text-wrap: balance;
	}
	h3 {
		font-size: 1.35rem;
	}
	.lede {
		max-width: 46ch;
		margin: 0;
		font-size: 1.15rem;
		color: var(--ink-soft);
	}
	.status {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0;
	}
	.status span {
		padding: 0.3rem 0.85rem;
		border-radius: 999px;
		background: var(--paper);
		border: 1px solid var(--line);
		font-size: 0.85rem;
		font-weight: 500;
	}
	.status span:first-child {
		background: color-mix(in srgb, var(--sage) 45%, var(--paper));
		border-color: transparent;
	}
	.status span:nth-child(2) {
		background: color-mix(in srgb, var(--mustard) 45%, var(--paper));
		border-color: transparent;
	}
	section {
		display: grid;
		gap: 1.25rem;
		min-width: 0;
	}
	section > .eyebrow {
		margin-bottom: -0.5rem;
	}
	.prose-col {
		max-width: 44rem;
		margin: 0;
		color: var(--ink-soft);
	}
	code {
		font-family: var(--mono);
		font-size: 0.86em;
	}
	a {
		text-underline-offset: 0.2em;
	}

	/* what changed lately */
	.changes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		border-radius: var(--radius);
		background: var(--paper);
		overflow: hidden;
	}
	.changes li {
		display: grid;
		grid-template-columns: 4.5rem 1fr;
		gap: 1rem;
		padding: 1rem 1.4rem;
		border-bottom: 1px solid var(--line);
	}
	.changes li:last-child {
		border-bottom: 0;
	}
	.changes .when {
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--terracotta);
		padding-top: 0.2rem;
	}
	.changes p {
		margin: 0;
		max-width: 60rem;
	}
	.prs {
		margin-left: 0.35rem;
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	/* the short answers */
	.answers {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
		gap: 1rem;
	}
	.answers div {
		display: grid;
		gap: 0.5rem;
		align-content: start;
		padding: 1.25rem 1.35rem;
		border-radius: var(--radius);
		background: var(--paper);
	}
	.answers b {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.15;
	}
	.answers .yes {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--terracotta);
	}
	.answers p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.95rem;
	}

	/* figures scroll sideways inside themselves, never the page */
	figure {
		margin: 0;
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	figure + figure {
		margin-top: 1.5rem;
	}
	.frame {
		background: var(--paper);
		border-radius: var(--radius);
		padding: 1.25rem;
		overflow-x: auto;
	}
	figcaption {
		font-size: 0.92rem;
		color: var(--ink-soft);
		max-width: 46rem;
	}
	/* only where the diagrams are wider than the screen */
	.swipe {
		display: none;
		margin: 0;
		font-size: 0.92rem;
		color: var(--muted);
	}
	@media (max-width: 760px) {
		.swipe {
			display: block;
		}
	}
	.fig {
		display: block;
		min-width: 46rem;
		width: 100%;
		height: auto;
	}
	.fig text {
		font-family: var(--font-body);
		fill: var(--ink);
	}
	.fig .h {
		font-weight: 600;
		font-size: 15px;
	}
	.fig .s {
		font-size: 12.5px;
		fill: var(--ink-soft);
	}
	.fig .m {
		font-family: var(--mono);
		font-size: 11.5px;
		fill: var(--ink-soft);
	}
	.fig .box {
		fill: var(--paper);
		stroke: var(--line);
		stroke-width: 1.5;
	}
	.fig .node {
		fill: color-mix(in srgb, var(--sage) 18%, var(--paper));
		stroke: var(--ink);
		stroke-width: 1.4;
	}
	.fig .srv {
		fill: color-mix(in srgb, var(--sage) 38%, var(--paper));
		stroke: var(--ink);
		stroke-width: 2;
	}
	.fig .bkt {
		fill: color-mix(in srgb, var(--mustard) 30%, var(--paper));
		stroke: var(--ink);
		stroke-width: 1.5;
	}
	.fig .seg {
		fill: color-mix(in srgb, var(--terracotta) 18%, var(--paper));
		stroke: var(--terracotta);
		stroke-width: 1;
	}
	.fig .plain {
		fill: color-mix(in srgb, var(--muted) 12%, var(--paper));
		stroke: var(--muted);
		stroke-width: 1;
	}
	.fig .edit {
		fill: color-mix(in srgb, var(--sage) 28%, var(--paper));
		stroke: var(--ink);
		stroke-width: 1.4;
	}
	.fig .ctl {
		stroke: var(--ink);
		stroke-width: 2;
		fill: none;
	}
	.fig .relay {
		stroke: var(--ink);
		stroke-width: 2;
		stroke-dasharray: 6 5;
		fill: none;
	}
	.fig .bytes {
		stroke: var(--terracotta);
		stroke-width: 5;
		fill: none;
		stroke-linecap: round;
	}
	.fig .thin {
		stroke: var(--muted);
		stroke-width: 1.2;
		fill: none;
	}
	.fig .bc {
		fill: var(--terracotta);
	}
	.fig .band-n0 {
		fill: color-mix(in srgb, var(--mustard) 22%, var(--paper));
		stroke: var(--line);
	}
	.fig .band-av {
		fill: color-mix(in srgb, var(--sage) 32%, var(--paper));
		stroke: var(--line);
	}

	/* tables */
	.table {
		overflow-x: auto;
		border-radius: var(--radius);
		background: var(--paper);
	}
	table {
		border-collapse: collapse;
		width: 100%;
		min-width: 36rem;
		font-size: 0.95rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.75rem 1.1rem;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}
	tr:last-child td {
		border-bottom: 0;
	}
	th {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	td.num {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* who sees what */
	.split {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
		gap: 1rem;
	}
	.split > div {
		display: grid;
		gap: 0.6rem;
		align-content: start;
		padding: 1.25rem 1.35rem;
		border-radius: var(--radius);
		background: var(--paper);
		border-top: 4px solid var(--sage);
	}
	.split > div.no {
		border-top-color: var(--terracotta);
	}
	ul {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.35rem;
	}
	.note {
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	/* the phases */
	ol.phases {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		border-left: 2px solid var(--line);
		margin-left: 0.4rem;
	}
	ol.phases li {
		position: relative;
		padding: 0 0 1.75rem 1.6rem;
		display: grid;
		gap: 0.4rem;
	}
	ol.phases li::before {
		content: '';
		position: absolute;
		left: -8px;
		top: 0.3rem;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--cream);
		border: 2px solid var(--ink);
	}
	ol.phases li.done::before {
		background: var(--sage);
	}
	ol.phases li.now::before {
		background: var(--mustard);
	}
	ol.phases .tag {
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--terracotta);
	}
	ol.phases p {
		margin: 0;
		color: var(--ink-soft);
		max-width: 46rem;
	}

	/* the choices made */
	.decided {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: 1rem;
	}
	.decided > div {
		display: grid;
		gap: 0.6rem;
		align-content: start;
		padding: 1.25rem 1.35rem;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--sage) 22%, var(--paper));
	}
	.decided p {
		margin: 0;
		color: var(--ink-soft);
	}

	@media (max-width: 640px) {
		main {
			gap: 3rem;
		}
		.changes li {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
