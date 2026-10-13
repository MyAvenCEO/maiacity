<script>
	import { base } from '$app/paths';
	import Sequence from '$lib/docs/Sequence.svelte';
	import { TRIPS } from '$lib/docs/avendb.js';

	const answers = [
		{
			short: 'Yes',
			q: 'Is it one backend for data and blobs?',
			a: 'Yes. An edit is a small blob and a film is a big one. Both are named by their BLAKE3 hash, kept in the same iroh store, moved by the same protocol and backed up to the same bucket.'
		},
		{
			short: 'No',
			q: 'Can two edits conflict?',
			a: 'No. Every entry is a CRDT: edits made at the same time on different devices merge the same way everywhere, whatever order they arrive in, and nothing waits for a server to order them.'
		},
		{
			short: 'Yes',
			q: 'Is the server only relay, sync and backup?',
			a: 'Yes. Every write is signed and stored on a device first and counts from that moment. The server never orders or approves writes, so it needs no fast write path: what it needs is upload bandwidth for big files, and durable storage.'
		},
		{
			short: 'Yes',
			q: 'Can it stream terabytes?',
			a: 'Yes. Files are cut into 1 GiB pieces that are verified every 16 KiB, resume where they stopped and seek to any byte. The store that holds a note’s edits holds a 4 TB film the same way.'
		},
		{
			short: 'Yes',
			q: 'Is OPFS the browser’s one source of truth?',
			a: 'Yes. Edits, keys and file pieces live in OPFS, in a Web Worker where it has fast file access. Of a big film, a browser keeps only what you watched or pinned.'
		},
		{
			short: 'Yes',
			q: 'Is the bucket the server’s truth, its disk only a cache?',
			a: 'Yes, and only the bucket counts. The server announces an edit, or says it keeps a file, only once the bucket holds it. Until then the device that wrote it sees the server lacks it, keeps it, and announces it again. Wipe the disk and the server rebuilds from the bucket.'
		},
		{
			short: 'Yes',
			q: 'Are caps and sync rules one concept?',
			a: 'Yes. A cap says which vault may have what. A sync rule says what one of its devices wants of that, by the same selector, for any kind of data: kept whole, or fetched as it is read. A rule grants nothing. Proxies and originals are just the types or tags your app gives them: your phone keeps proxies, your desktop keeps originals, the server keeps all.'
		},
		{
			short: 'Recovery',
			q: 'What if every passkey is lost?',
			a: 'The master recovery key is among the owners of every human vault from its founding. Its secret is kept offline by its person, and it adds a new device or passkey like any owner would. It is added and removed in Settings like any owner.'
		}
	];

	// the page's own contents, one link per section
	const contents = [
		['local-first', 'Local first'],
		['vaults', 'Vaults'],
		['crdt', 'Entries and the CRDT'],
		['history', 'History'],
		['schemas', 'Schemas and lenses'],
		['caps', 'Caps and cells'],
		['ops', 'JSON ops'],
		['system', 'The whole system'],
		['node', 'Inside one node'],
		['sync', 'Sync'],
		['files', 'Files'],
		['roundtrips', 'Roundtrips'],
		['storage', 'Storage'],
		['trust', 'Trust'],
		['post-quantum', 'Post-quantum']
	];

	// Ink & Switch's seven ideals of local-first software, and how avenDB meets each
	const ideals = [
		['Fast', 'Reads and writes run on the device’s own store. No round trip to a server sits between you and your data.'],
		[
			'Multi-device',
			'Your desktop, phone and browser each hold what their sync rules want of your vaults, and keep each other up to date.'
		],
		['Offline', 'An edit counts the moment it is saved. Offline, edits pile up and go out when a peer is reachable again.'],
		[
			'Collaboration',
			'Every entry is a CRDT: edits made at the same time merge the same way on every device, with no server to order them.'
		],
		[
			'Longevity',
			'Your data is a log of signed edits in open formats (Loro documents, JSON Schema), kept on your devices. No service has to stay online for you to read it.'
		],
		[
			'Privacy',
			'End to end encrypted. The server and the bucket hold ciphertext only; keys stay on the devices of the people a vault shares with.'
		],
		[
			'User control',
			'A vault is owned by its passkeys. Caps say who may do what, and every device enforces them, the server too.'
		]
	];

	const merges = [
		['Text', 'Character by character: both insertions stay, in the same order on every device.'],
		[
			'A list of records (a note’s blocks, a checklist)',
			'Rows are matched by their id: rows added on two devices both stay, and a row moved or removed is that row and no other.'
		],
		['Any other field', 'One value wins, and it is the same one on every device.']
	];

	const lines = [
		['Propose from here', 'Starts a proposal from the version you are looking at, main or an older one.'],
		['Accept into main', 'A merge write on main that builds on both lines: Loro combines them, nothing is lost.'],
		['Make main match it', 'Accepts the proposal and makes main read exactly like it.'],
		['Update from main', 'Brings what main gained since into the proposal.'],
		['Restore', 'Puts back any older version, as a new write.'],
		['Undo', 'Takes out one older edit by a three-way merge, keeping every change made after it.'],
		['Make a variant', 'A new note with the line’s content and tags, and none of its history.']
	];

	const TODO_V1 = `{ "title": "Water the figs",
  "done": false }`;

	const TODO_V2 = `{ "title": "Water the figs",
  "status": "doing" }`;

	const TODO_LENS = `{ "lens": "Todo, v1 to v2",
  "from": "307636b7…", "to": "9e9b2af2…",
  "steps": [{ "convert": {
    "from": ["done"], "to": ["status"],
    "forward": [[{ "done": true },  { "status": "done" }],
                [{ "done": false }, { "status": "open" }]],
    "backward": [[{ "status": "done" },  { "done": true }],
                 [{ "status": "open" },  { "done": false }],
                 [{ "status": "doing" }, { "done": false }]]
  } }] }`;

	const CAP = `{ "name": "Tick work",
  "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] },
  "ops": [{ "op": "read" },
          { "op": "set", "path": ["status"], "to": ["doing", "done"] }] }`;

	const groups = [
		['Owner', 'Everything, and share', 'The vault’s owners'],
		['Editor', 'Read, create, set, tag, propose, merge', 'Someone who works on the entries'],
		['Suggester', 'Read and propose; set and merge on proposals', 'A reviewer: main changes only when an editor accepts'],
		['Viewer', 'Read', 'A reader'],
		['Public', 'Read, for everyone', 'Anything published: its key goes out in the clear'],
		['Backup', 'Keep the ciphertext, read nothing', 'The server, by default'],
		['Relay', 'Find the vault’s devices, keep nothing', 'The server, with backups off']
	];

	const QUERY = `{ "op": "query",
  "where": { "all": [{ "type": ["todo"] }, { "tag": "garden" },
                     { "path": ["status"], "ne": "done" }] },
  "order": [["created", "desc"]], "limit": 20 }`;

	const ANSWER = `{ "ok": { "rows": [{ "entry": "…", "type": "todo", "tags": ["garden"],
                    "record": { "title": "Water the figs", "status": "doing" } }],
          "count": 1 } }

{ "refused": "NotAllowed",
  "why": "the ops of the caps the vault acts through don't allow what it does" }`;

	const reads = ['query', 'get', 'history', 'schemas', 'groups'];
	const changes = [
		'create',
		'set',
		'unset',
		'insert',
		'remove',
		'move',
		'tag',
		'propose',
		'merge',
		'restore',
		'undo',
		'variant',
		'batch'
	];

	const quantum = [
		['Connections', 'TLS 1.3 with X25519MLKEM768 as the only key exchange, on every link between nodes.'],
		[
			'Signatures',
			'ed25519 for devices or P-256 for passkeys, each beside SLH-DSA-SHA2-128f. A write counts only once its author’s SLH-DSA checkpoint covers it.'
		],
		['Keys sent to devices', 'Sealed boxes of X-Wing and Classic McEliece 6688128f together.'],
		[
			'Edits and files',
			'XChaCha20-Poly1305 for edits and keys, ChaCha20-Poly1305 per 64 KiB segment for files, all with 256-bit keys.'
		],
		['Hashes', 'SHA-3 (cSHAKE256) for ids and what signatures sign, BLAKE3 for storage and transport.'],
		['The bucket', 'Every object sealed again with a 256-bit key of the server’s, since the link to it is classical.']
	];
</script>

<svelte:head>
	<title>avenDB architecture · Docs · maiaCITY</title>
	<meta
		name="description"
		content="avenDB's architecture: a user-owned, local-first, post-quantum database. Vaults, CRDT entries with history, schemas and lenses, caps, sync between your devices, and terabytes of media backed up to a sealed bucket."
	/>
</svelte:head>

<main class="wrap">
	<a class="back" href="{base}/docs">← Docs</a>

	<header class="intro">
		<p class="eyebrow">avenDB&ensp;·&ensp;architecture&ensp;·&ensp;updated 13 October 2026</p>
		<h1>avenDB Architecture</h1>
		<p class="lede">
			A user-owned, local-first database with post-quantum security. Every write happens on your device first and merges
			with everyone else’s without a server deciding anything. The server relays, stays online for sync and keeps an
			encrypted backup, without ever holding a key.
		</p>
		<nav class="toc" aria-label="On this page">
			{#each contents as [id, name] (id)}
				<a href="#{id}">{name}</a>
			{/each}
		</nav>
	</header>

	<section>
		<p class="eyebrow">Short answers</p>
		<h2>Your questions</h2>
		<div class="answers">
			{#each answers as x (x.q)}
				<div>
					<span class="short">{x.short}</span>
					<b>{x.q}</b>
					<p>{x.a}</p>
				</div>
			{/each}
		</div>
	</section>

	<section id="local-first">
		<p class="eyebrow">Local first</p>
		<h2>Your devices hold the data, the server only helps</h2>
		<p class="prose-col">
			Every change happens on your device first: it is signed, encrypted, saved, and counts at once, online or not.
			Devices then sync with each other, directly when they can and through the server when they can’t. The server is one
			more peer: an always-online device of the avenCEO vault that relays, syncs and keeps an encrypted backup, under the
			same rules as every other device and with no say over them.
		</p>
		<div class="table">
			<table>
				<thead>
					<tr><th>Ideal</th><th>How avenDB meets it</th></tr>
				</thead>
				<tbody>
					{#each ideals as [ideal, how] (ideal)}
						<tr><td><b>{ideal}</b></td><td>{how}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="note prose-col">
			The seven ideals are from Ink &amp; Switch’s essay <i>Local-first software</i> (2019).
		</p>
	</section>

	<section id="vaults">
		<p class="eyebrow">Identity</p>
		<h2>A vault is an identity</h2>
		<p class="prose-col">
			Everything belongs to a vault, the way an account belongs to a person: a vault owns its entries, holds caps in other
			vaults and has owners who may change it. There are three kinds.
		</p>
		<div class="cards">
			<div>
				<h3>Human vault</h3>
				<p>
					Yours. Owned by your passkeys. Its devices, your desktop, phone and browser, act for it, and each one unlocks
					its keys with your passkey at every start. Nothing else can unlock them.
				</p>
			</div>
			<div>
				<h3>COOP vault</h3>
				<p>
					Owned by human vaults and other COOP vaults, with no devices of its own. Its owners act for it from their
					devices.
				</p>
			</div>
			<div>
				<h3>Aven vault</h3>
				<p>An agent, such as avenCEO. Owned like a COOP; its servers act for it but never govern it.</p>
			</div>
		</div>
		<p class="prose-col">
			The passkey is the root. A new device joins by a QR code and one passkey approval on a device you already have, or
			by signing in with the passkey alone. The master recovery key, a software passkey kept offline, is among the owners
			of every new human vault, so a vault whose passkeys are all lost can still add a new one; it is removed like any
			owner. The first human vault founded through a new server owns avenCEO, and so the server.
		</p>
	</section>

	<section id="crdt">
		<p class="eyebrow">Entries and the CRDT</p>
		<h2>Every entry merges, every log is a chain of hashes</h2>
		<p class="prose-col">
			An entry is one note, todo, card or profile. Its type and tags travel encrypted inside its writes. Each entry is a
			Loro document, a CRDT: any device changes its own copy at any time, and two devices that hold the same edits read
			the same entry, whatever order the edits arrived in.
		</p>
		<div class="table">
			<table>
				<thead>
					<tr><th>Changed at the same time</th><th>How it merges</th></tr>
				</thead>
				<tbody>
					{#each merges as [what, how] (what)}
						<tr><td>{what}</td><td>{how}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="prose-col">
			An edit’s id is the SHA-3 hash of the whole edit, and its signatures sign that id. Each edit names its log’s latest
			edits, the frontier, as its parents, so every log is a small graph of hashes: no edit can be changed, dropped or
			put in another order without every device noticing.
		</p>
		<figure>
			<div class="frame">
				<svg class="fig" viewBox="0 0 960 290" role="img" aria-label="Two devices edit one note at the same time">
					<rect class="edit" x="30" y="115" width="210" height="60" rx="10" />
					<text class="h" x="48" y="140">e1 · on both</text>
					<text class="s" x="48" y="162">Buy milk</text>
					<rect class="node" x="330" y="25" width="250" height="60" rx="10" />
					<text class="h" x="348" y="50">e2 · desktop</text>
					<text class="s" x="348" y="72">inserts “oat ”: Buy oat milk</text>
					<rect class="node" x="330" y="205" width="250" height="60" rx="10" />
					<text class="h" x="348" y="230">e3 · phone, offline</text>
					<text class="s" x="348" y="252">appends “ and bread”</text>
					<rect class="edit" x="680" y="115" width="260" height="60" rx="10" />
					<text class="h" x="698" y="140">e4 · its parents: e2 and e3</text>
					<text class="s" x="698" y="162">Buy oat milk and bread</text>
					<path class="ctl" d="M240 145 C 285 145, 285 55, 322 55" />
					<polygon class="arrow" points="320,49 330,55 320,61" />
					<path class="ctl" d="M240 145 C 285 145, 285 235, 322 235" />
					<polygon class="arrow" points="320,229 330,235 320,241" />
					<path class="ctl" d="M580 55 C 630 55, 630 145, 672 145" />
					<polygon class="arrow" points="670,139 680,145 670,151" />
					<path class="ctl" d="M580 235 C 630 235, 630 145, 672 145" />
					<text class="s" x="640" y="215">the phone comes back online:</text>
					<text class="s" x="640" y="233">both hold e2 and e3</text>
				</svg>
			</div>
			<figcaption>
				The desktop and the phone change the same note at the same time. Once each holds both edits, both read “Buy oat
				milk and bread”, whichever came first. The next edit, on either device, names both as its parents.
			</figcaption>
		</figure>
	</section>

	<section id="history">
		<p class="eyebrow">History</p>
		<h2>Main, proposals and variants</h2>
		<p class="prose-col">
			Nothing is overwritten: every write extends a line. Main is what everyone reads. A proposal is a line of its own
			that starts from any version, so a change can be tried and reviewed without touching main.
		</p>
		<figure>
			<div class="frame">
				<svg class="fig" viewBox="0 0 960 230" role="img" aria-label="Main, a proposal and a variant">
					<text class="h" x="40" y="46">main</text>
					<line class="hl-main" x1="40" y1="70" x2="920" y2="70" />
					<path class="hl-prop" d="M240 70 C 290 70, 290 160, 340 160 H 540 C 590 160, 590 70, 640 70" />
					<path class="hl-var" d="M820 70 C 850 70, 872 120, 880 160" />
					<circle class="dot" cx="100" cy="70" r="9" />
					<circle class="dot" cx="240" cy="70" r="9" />
					<circle class="dot" cx="440" cy="70" r="9" />
					<circle class="dot" cx="640" cy="70" r="9" />
					<circle class="dot" cx="820" cy="70" r="9" />
					<circle class="dot-p" cx="380" cy="160" r="9" />
					<circle class="dot-p" cx="500" cy="160" r="9" />
					<circle class="dot-v" cx="880" cy="160" r="9" />
					<text class="s" x="112" y="104">Propose from here</text>
					<text class="s" x="330" y="196">a proposal: its own line, from any version</text>
					<text class="s" x="652" y="104">Accept into main:</text>
					<text class="s" x="652" y="122">a merge write</text>
					<text class="s" x="600" y="40">Restore and Undo are new writes too</text>
					<text class="s" x="760" y="196">a variant: a new note,</text>
					<text class="s" x="760" y="214">with none of this history</text>
				</svg>
			</div>
		</figure>
		<div class="table">
			<table>
				<thead>
					<tr><th>Action</th><th>What it does</th></tr>
				</thead>
				<tbody>
					{#each lines as [action, what] (action)}
						<tr><td><b>{action}</b></td><td>{what}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="note prose-col">
			None of them asks for the passkey: the device’s own keys, unlocked at start, sign them.
		</p>
	</section>

	<section id="schemas">
		<p class="eyebrow">Schemas and lenses</p>
		<h2>Change the shape, migrate nothing</h2>
		<p class="prose-col">
			Every record has a schema: a JSON Schema, named by its hash. When a schema changes, a lens says how a record of one
			version reads as the other, both ways. No record is ever migrated: an edit stays in the version it was written in,
			each app reads through the lens in its own version, and its edits go back as only what changed. So an old app and
			a new one edit the same todo side by side.
		</p>
		<div class="codes">
			<figure>
				<pre><code>{TODO_V1}</code></pre>
				<figcaption>Todo, version 1, as an old app reads it</figcaption>
			</figure>
			<figure>
				<pre><code>{TODO_V2}</code></pre>
				<figcaption>The same todo in version 2</figcaption>
			</figure>
			<figure class="wide">
				<pre><code>{TODO_LENS}</code></pre>
				<figcaption>The lens between them: “doing” has no word in version 1, so it reads as not done there.</figcaption>
			</figure>
		</div>
		<ul class="prose-col">
			<li>
				<b>Public by default.</b> Schemas and lenses carry no data, so a vault publishes them in the clear, in its own log:
				every device that syncs the vault reads them, with no key.
			</li>
			<li><b>Only the vault’s owners publish them</b>, so no one else can change what its entries mean.</li>
			<li>
				<b>Readers count only writes that fit.</b> A write whose result breaks its schema stays in the log and changes
				nothing anyone sees, so a patched app can’t slip in a value its schema forbids.
			</li>
			<li><b>Documents and todos ship with every app</b>, two versions each, with a lens between them.</li>
		</ul>
	</section>

	<section id="caps">
		<p class="eyebrow">Caps and cells</p>
		<h2>Caps say who may do what</h2>
		<p class="prose-col">
			A cap is a named group of JSON ops over a selector: which entries, by type, tag, author, entry or creation time, and
			what may be done to them. A vault gives caps to other vaults, or to everyone. Every device checks every write
			against its author’s caps, so a write no cap allows counts for no one.
		</p>
		<figure>
			<pre><code>{CAP}</code></pre>
			<figcaption>Bob may read the todos tagged work, and set their status to doing or done.</figcaption>
		</figure>
		<div class="table">
			<table>
				<thead>
					<tr><th>Group</th><th>May</th><th>Typical for</th></tr>
				</thead>
				<tbody>
					{#each groups as [name, may, who] (name)}
						<tr><td><b>{name}</b></td><td>{may}</td><td>{who}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<h3>Cells: one key for what the same caps reach</h3>
		<p class="prose-col">
			Entries are not encrypted with one key each, nor with one key for the whole vault. A cell is all the entries the
			same caps reach, and it has one key per generation. Share the todos tagged garden with Bob as an Editor, and that
			cap makes one cell: every todo tagged garden. Bob gets its key once. Tag another todo garden and it moves into the
			cell by a signed move, and Bob reads it. Revoke Bob’s cap and the cell moves to a new generation, with a key only
			the remaining caps get: what Bob read before stays his, and nothing new reaches him. Entries no other cap reaches
			stay in the vault’s own cell.
		</p>
	</section>

	<section id="ops">
		<p class="eyebrow">JSON ops</p>
		<h2>One JSON op for every read and change</h2>
		<p class="prose-col">
			The page, the desktop app and agents all speak one language: a JSON op, run on the device, which answers with what
			it read or did, or with why it refused. A query picks entries by the same selector caps use, then by their values.
		</p>
		<div class="codes">
			<figure class="wide">
				<pre><code>{QUERY}</code></pre>
				<figcaption>The open todos tagged garden, newest first</figcaption>
			</figure>
			<figure class="wide">
				<pre><code>{ANSWER}</code></pre>
				<figcaption>What comes back: what it found, or a refusal and why</figcaption>
			</figure>
		</div>
		<div class="chips">
			<span class="kind">Reads</span>
			{#each reads as op (op)}<code>{op}</code>{/each}
		</div>
		<div class="chips">
			<span class="kind">Changes</span>
			{#each changes as op (op)}<code>{op}</code>{/each}
		</div>
		<p class="prose-col">
			Before it shows a button, the page asks <code>may</code>: would this device be allowed to make the op, on what it
			holds now? So a button you see is a change you may make. A <code>batch</code> runs several ops as one.
		</p>
	</section>

	<section id="system">
		<p class="eyebrow">The whole system</p>
		<h2>Desktop, phone, browser and server: one protocol stack</h2>
		<p class="prose-col">
			Every device is a full avenDB node with its own store: on disk on a desktop or a phone, in OPFS in a browser. The
			server is the same kind of node, its bucket its source of truth and its disk only a cache. Devices talk to each
			other directly whenever the network allows it, and through the relay when it does not. Browsers always go through
			the relay.
		</p>
		<figure>
			<div class="frame">
				<svg class="fig" viewBox="0 0 960 560" role="img" aria-label="System map">
					<rect class="node" x="20" y="30" width="290" height="180" rx="16" />
					<text class="h" x="40" y="62">Desktop</text>
					<text class="s" x="40" y="88">avenDB device, native</text>
					<text class="s" x="40" y="110">one store on disk:</text>
					<text class="s" x="40" y="130">edits and keys in it,</text>
					<text class="s" x="40" y="150">file pieces as files</text>
					<text class="s" x="40" y="180">keeps what its sync rules want</text>
					<rect class="node" x="20" y="350" width="290" height="180" rx="16" />
					<text class="h" x="40" y="382">Phone or browser</text>
					<text class="s" x="40" y="408">avenDB device, in the app or the page</text>
					<text class="s" x="40" y="430">one store on the device,</text>
					<text class="s" x="40" y="450">in OPFS in a browser</text>
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
					<text class="m" x="850" y="316" text-anchor="middle">pieces/</text>
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

	<section id="node">
		<p class="eyebrow">Inside one node</p>
		<h2>The layering n0 intends, and what avenDB adds</h2>
		<p class="prose-col">
			iroh’s own guidance: an endpoint, a router that hands each connection to a protocol by its ALPN, the app’s own
			protocol for app logic, and iroh-blobs for every byte. avenDB has all four: its sync protocol decides what moves,
			and iroh-blobs carries the bytes of keys, files and edits.
		</p>
		<figure>
			<div class="frame">
				<svg class="fig" viewBox="0 0 960 360" role="img" aria-label="The five layers of an avenDB node">
					<rect class="band-av" x="20" y="20" width="760" height="56" rx="10" />
					<text class="h" x="40" y="45">Lab: vaults, caps, sync rules, keys, Loro documents, JSON ops</text>
					<text class="s" x="40" y="65">decides what counts, decrypts what this device may read, names the blobs each edit needs</text>
					<rect class="band-n0" x="20" y="86" width="372" height="56" rx="10" />
					<text class="h" x="40" y="111">Store: one iroh-blobs store per node</text>
					<text class="s" x="40" y="131">on disk on desktop, phone and server; in OPFS in a browser</text>
					<rect class="band-av" x="408" y="86" width="372" height="56" rx="10" />
					<text class="h" x="428" y="111">Behind it on the server</text>
					<text class="s" x="428" y="131">the sealed bucket, its source of truth</text>
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

	<section id="sync">
		<p class="eyebrow">Sync</p>
		<h2>Devices exchange only what differs</h2>
		<p class="prose-col">
			When a log changes, a node announces its digest to every peer that may hold it. A peer whose digest differs asks
			with its frontier, the latest edits it has, and gets only what it lacks, in pages of about 4 MiB. Order never
			matters, so any device can sync with any other, in any order, any number of times.
		</p>
		<div class="split">
			<div>
				<h3>Caps: what a device may have</h3>
				<p>
					A device receives an edit only if its vault may read it, or keep it as a backup. No peer sends what the
					receiver’s caps don’t allow.
				</p>
			</div>
			<div>
				<h3>Sync rules: what it wants</h3>
				<p>
					A sync rule uses the same selector as a cap, for any data, and grants nothing: keep these whole, fetch those as
					they are read. Your phone keeps proxies, your desktop keeps originals.
				</p>
			</div>
			<div>
				<h3>The server: Backup or Relay</h3>
				<p>
					By default the server keeps the ciphertext of every vault it backs up. With backups off it only relays: it
					finds your devices and keeps nothing.
				</p>
			</div>
		</div>
	</section>

	<section id="files">
		<p class="eyebrow">Files</p>
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
		<p class="prose-col">
			Every vault has a Library that lists its files by kind: films, images, SVGs, PDFs and audio. A file is an ordinary
			entry of type <code>file</code>, a document named after the file whose first edit brings it, so caps, sync and
			deletion work on it as on a note. A film plays as it streams: the player asks for byte ranges, and the device fetches
			only the 64 KiB segments those ranges need, verified by iroh-blobs, and opens them.
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

	<section id="roundtrips">
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

	<section id="storage">
		<p class="eyebrow">Where the bytes live</p>
		<h2>Storage on each kind of place</h2>
		<div class="table">
			<table>
				<thead>
					<tr><th>Place</th><th>Small blobs (edits)</th><th>Big blobs (pieces)</th><th>Kept until</th></tr>
				</thead>
				<tbody>
					<tr>
						<td>Desktop</td>
						<td>Its store on disk</td>
						<td>iroh files, with their outboards</td>
						<td>No sync rule wants them, then garbage collection</td>
					</tr>
					<tr>
						<td>Phone</td>
						<td>Its store on the phone</td>
						<td>What you watched or pinned</td>
						<td>Played and not pinned, oldest first</td>
					</tr>
					<tr>
						<td>Browser</td>
						<td>OPFS, its one store, in a worker</td>
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
						<td><code>pieces/</code>, one object per piece</td>
						<td>The source of truth: every version locked 7 days, replaced ones gone 7 days later</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p class="prose-col">
			Packing is what makes object storage work for a database. Hetzner bills every object as at least 64 KB and allows
			750 requests a second per bucket. A million edits stored one per object would take 22 minutes of a fully busy
			bucket to write or restore. Packed, they are a few hundred objects. Every object version is locked for 7 days in
			compliance mode, so not even a compromised server can wipe the backup.
		</p>
	</section>

	<section id="trust">
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
					<li>The vault’s schemas and lenses, which are public</li>
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

	<section id="post-quantum">
		<p class="eyebrow">Post-quantum</p>
		<h2>Quantum-proof, everywhere</h2>
		<p class="prose-col">
			Every node runs in post-quantum-only mode: no classical-only path is left. Where a classical algorithm still
			appears, a post-quantum one stands beside it, and a write counts only once the post-quantum half holds.
		</p>
		<div class="table">
			<table>
				<thead>
					<tr><th>Where</th><th>How</th></tr>
				</thead>
				<tbody>
					{#each quantum as [where, how] (where)}
						<tr><td><b>{where}</b></td><td>{how}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<footer class="note">
		Sources: Ink &amp; Switch’s <i>Local-first software</i> (2019), Loro 1.16, iroh 1.3, iroh-blobs 0.103.1 and bao-tree
		0.16.1 source, n0’s blog and docs, Hetzner Object Storage documentation, and avenDB’s code and Lean model as of 13
		October 2026.
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
	section {
		display: grid;
		gap: 1.25rem;
		min-width: 0;
		scroll-margin-top: 5rem;
	}
	section > h3 {
		margin-top: 1rem;
	}

	/* the page's contents */
	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.toc a {
		padding: 0.3rem 0.85rem;
		border-radius: 999px;
		background: var(--paper);
		border: 1px solid var(--line);
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--ink);
		text-decoration: none;
	}
	.toc a:hover {
		border-color: var(--ink);
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
	.answers .short {
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
	.fig .arrow {
		fill: var(--ink);
	}
	.fig .hl-main {
		stroke: var(--ink);
		stroke-width: 3;
		fill: none;
	}
	.fig .hl-prop {
		stroke: var(--terracotta);
		stroke-width: 3;
		fill: none;
	}
	.fig .hl-var {
		stroke: var(--muted);
		stroke-width: 2;
		stroke-dasharray: 6 5;
		fill: none;
	}
	.fig .dot {
		fill: var(--ink);
	}
	.fig .dot-p {
		fill: var(--terracotta);
	}
	.fig .dot-v {
		fill: var(--paper);
		stroke: var(--muted);
		stroke-width: 2;
	}
	.fig .band-av {
		fill: color-mix(in srgb, var(--sage) 32%, var(--paper));
		stroke: var(--line);
	}

	/* code: JSON as the engine reads it */
	pre {
		margin: 0;
		padding: 1rem 1.25rem;
		border-radius: var(--radius);
		background: var(--paper);
		overflow-x: auto;
		font-family: var(--mono);
		font-size: 0.82rem;
		line-height: 1.5;
	}
	pre code {
		font-size: inherit;
	}
	.codes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
	}
	.codes .wide {
		grid-column: 1 / -1;
	}
	.codes figure + figure {
		margin-top: 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
	}
	.chips .kind {
		min-width: 5.5rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.chips code {
		padding: 0.15rem 0.55rem;
		border-radius: 6px;
		background: var(--paper);
		border: 1px solid var(--line);
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
	.split p {
		margin: 0;
		color: var(--ink-soft);
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

	/* cards side by side */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: 1rem;
	}
	.cards > div {
		display: grid;
		gap: 0.6rem;
		align-content: start;
		padding: 1.25rem 1.35rem;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--sage) 22%, var(--paper));
	}
	.cards p {
		margin: 0;
		color: var(--ink-soft);
	}

	@media (max-width: 640px) {
		main {
			gap: 3rem;
		}
	}
</style>
