<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import Sequence from '$lib/docs/Sequence.svelte';
	import { TRIPS } from '$lib/docs/avendb.js';

	// the page's own contents, one link per section: the guarantees, then the pieces, then the protocol
	const contents = /** @type {[string, [string, string][]][]} */ ([
		[
			'What it promises',
			[
				['guarantees', 'Guarantees'],
				['who-sees', 'Who sees what'],
				['mishaps', 'When something goes wrong']
			]
		],
		[
			'The pieces',
			[
				['local-first', 'Local first'],
				['shape', 'Entry, Share, Blob'],
				['vaults', 'Vaults'],
				['devices', 'Passkey and device keys'],
				['edits', 'Edits and logs'],
				['crdt', 'Entries'],
				['history', 'History'],
				['shares', 'Shares'],
				['audiences', 'Audiences and keys'],
				['schemas', 'Schemas and lenses'],
				['ops', 'JSON ops']
			]
		],
		[
			'How it runs',
			[
				['system', 'The whole system'],
				['node', 'Inside one node'],
				['sync', 'Sync'],
				['files', 'Files'],
				['roundtrips', 'Roundtrips'],
				['storage', 'Storage'],
				['post-quantum', 'Post-quantum'],
				['proofs', 'Proofs']
			]
		]
	]);
	const ids = contents.flatMap(([, links]) => links.map(([id]) => id));

	/** The section being read: the last whose top has passed the top of the screen, or at the page's end the last in
	 *  view. */
	let current = $state(ids[0]);
	/** @type {HTMLElement | undefined} the contents, which scroll on their own */
	let toc = $state();

	onMount(() => {
		let frame = 0;
		const look = () => {
			frame = 0;
			const end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
			let now = ids[0];
			for (const id of ids) {
				const top = document.getElementById(id)?.getBoundingClientRect().top ?? Infinity;
				if (top <= 120 || (end && top < innerHeight)) now = id;
			}
			current = now;
		};
		const soon = () => (frame ||= requestAnimationFrame(look));
		look();
		addEventListener('scroll', soon, { passive: true });
		addEventListener('resize', soon);
		return () => {
			removeEventListener('scroll', soon);
			removeEventListener('resize', soon);
			cancelAnimationFrame(frame);
		};
	});

	// the link of the section being read stays in view in the contents, moving only them, never the page
	$effect(() => {
		const link = toc?.querySelector(`a[href="#${current}"]`);
		if (!toc || !link) return;
		const [box, at] = [toc.getBoundingClientRect(), link.getBoundingClientRect()];
		if (at.top < box.top || at.bottom > box.bottom) toc.scrollTop += at.top - box.top - (box.height - at.height) / 2;
		if (at.left < box.left || at.right > box.right) toc.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
	});

	// what avenDB promises, most of it kept by a theorem of the Lean model (see Proofs)
	const guarantees = [
		{
			short: 'The server',
			q: 'The server holds ciphertext only.',
			a: 'It relays, stays online for sync and keeps an encrypted backup, and never holds a key to your vaults. It still checks every edit exactly as an owner would, from labels that say who may write, not what is written.'
		},
		{
			short: 'Readers',
			q: 'Only the people you share with can read.',
			a: 'Each entry’s key reaches only the people whose shares pick it. A Backup or Relay share, the kind the server holds, gets no key at all.'
		},
		{
			short: 'Revoking',
			q: 'Revoking a share is final for what comes next.',
			a: 'The entries it reached move to a new key the revoked person never gets. What they read before stays read. Nothing new reaches them, and they can’t slip in an edit dated before the revocation.'
		},
		{
			short: 'A lost phone',
			q: 'A lost or stolen device opens nothing.',
			a: 'Your passkey is the root: a device’s keys unlock only with it, at every start. Remove the device from any other one, and your vault’s keys move on without it.'
		},
		{
			short: 'Offline',
			q: 'Every edit counts the moment you make it.',
			a: 'Online or not. Edits made at the same time on two devices merge the same way everywhere, and no server orders or approves them.'
		},
		{
			short: 'Strangers',
			q: 'Connecting tells a stranger nothing.',
			a: 'A device that acts for no vault and follows none is sent nothing at all. Even what you share with Everyone goes only to devices with a reason to ask for it.'
		},
		{
			short: 'Backed up',
			q: 'Backed up means in the bucket.',
			a: 'The server says it holds an edit or a file only once its sealed bucket has it. Until then, the device that made it keeps it and offers it again.'
		},
		{
			short: 'Quantum',
			q: 'Post-quantum everywhere.',
			a: 'Every connection, signature and sealed key has a post-quantum half, and a write counts only once a hash-based signature vouches for it.'
		}
	];

	// the server's view: what it sees, what it never sees, and what its bucket sees
	const serverSees = [
		'Which devices connect, when, and from where',
		'Vault ids, and each vault’s owners and devices',
		'Who holds a share, and at which level',
		'Which shares pick each entry, its size, and when it changes',
		'Which files each edit brings, by hash and sealed size, and which pieces get read',
		'What each device holds, log by log and file by file, and when it last checked',
		'Schemas, lenses and anything else shared with Everyone'
	];
	const serverNever = [
		'Any content: notes, todos, file bytes',
		'File names, types and tags',
		'What a share picks, or what it allows',
		'Any key, except those published for Everyone',
		'Whether two people hold the same film: each person’s files are keyed by a secret of their own vault'
	];
	const bucketSees = [
		'Sealed objects, their sizes, and names that are hashes',
		'Not even what the server sees: every object is sealed with a 256-bit key the server keeps',
		'Whoever records the link to it, classical TLS since Hetzner offers nothing else, sees the same noise'
	];

	const keyring = [
		[
			'Your passkey',
			'You',
			'In your phone’s or computer’s passkey store, synced by it (iCloud Keychain, for one)',
			'The same everywhere: its keys come from its PRF output the same way each time. It owns your vault.'
		],
		[
			'A device key',
			'One install: a browser on maia.city, or the desktop app',
			'Masked on that install’s own shelf',
			'Made once from the install’s own randomness, kept until its storage is wiped, never made again.'
		],
		[
			'The unlock',
			'One session',
			'In memory only',
			'One passkey prompt as the device starts. The key is wiped as the device closes.'
		]
	];

	const mishaps = [
		[
			'You lose your phone',
			'Locked, it opens nothing: its keys unlock only with your passkey. Remove it from your desktop. Your vault’s keys move on, so it reads nothing written after, and whatever it signed that your other devices hadn’t seen by then is cut.'
		],
		[
			'You revoke someone’s share',
			'Every entry it reached moves to a new key that only the shares still live get. What they read before stays read. Nothing new reaches them, and their edits your devices hadn’t seen when you revoked are cut.'
		],
		[
			'Your phone is offline for a month',
			'It keeps working on what it holds, and your desktop still shows what it holds, as of when it last checked. Back online, each side sends only what the other lacks, log by log, and both end in the same state.'
		],
		[
			'Two devices change the same note at once',
			'Both changes stay. Text merges character by character, list rows by their id, and any other field takes one value, the same on every device.'
		],
		[
			'You lose every device',
			'Sign in on a new one with your passkey. The server hands it your vault’s log, the new device adds itself, and your entries come back from the encrypted backup. With backups off the server kept nothing, so what only your devices held is gone with them.'
		],
		[
			'The server’s disk dies',
			'Its disk is only a cache. A new server starts from the bucket alone, as the same device, and your vaults notice nothing.'
		],
		[
			'The server is down',
			'Nothing you write waits on it. Each device keeps working, and they catch up as soon as they reach each other or the server again.'
		],
		[
			'Someone breaks elliptic curves',
			'Recorded traffic stays closed, since every link and every sealed key has a post-quantum half, and every edit counts by its hash-based signature alone.'
		]
	];

	// Ink & Switch's seven ideals of local-first software, and how avenDB meets each
	const ideals = [
		['Fast', 'Reads and writes run on the device’s own store. No round trip to a server sits between you and your data.'],
		[
			'Multi-device',
			'Your desktop and phone each hold what their keep shares say of your vaults, and keep each other up to date.'
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
			'A vault is owned by its passkeys. Shares say who may do what, and every device checks them, the server too.'
		]
	];

	const kinds = [
		['Genesis', 'A new vault: its kind, owners, threshold and root', 'Its vault'],
		['Settings', 'How many owners must approve, or handing the root passkey on', 'The vault'],
		['Share', 'A share, an owner or a device', 'Its own log, or the vault’s for owners and devices'],
		['Revoke', 'Ends any of them', 'The same log as what it ends'],
		['Write', 'An encrypted change of one entry, and the files it brings', 'The entry'],
		['Mark', 'Which shares pick an entry, and which keep shares want it', 'The entry'],
		['Keys', 'Sealed boxes of one key, for exactly who may open it', 'The key’s family']
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
		[
			'Merge into main',
			'As a pull request merges: what only the proposal changed lands, and nothing main changed is lost. Where both changed the same place, you pick which value main keeps.'
		],
		['Update from main', 'The same merge the other way: brings what main gained since into the proposal.'],
		['Restore', 'Puts back any older version, as a new write.'],
		['Undo', 'Takes out one older edit by a three-way merge, keeping every change made after it.'],
		[
			'Make a variant',
			'A new note, in this vault or another, with the line’s content and tags. Its first edit names this note and the version it came from by the hashes of its edits, so its history goes on into this one’s.'
		]
	];

	const who = [
		['A person, a group or an agent', 'Their vault. It reaches every device that acts for it, so a new phone needs no new share.'],
		['Everyone', 'Read only. Its key is published in the clear, and it goes only to devices with a reason to ask.'],
		['One of your own devices', 'Only as a keep share: what that device syncs. It grants nothing.']
	];

	const groups = [
		['Owner', 'Owner', 'Everything, and share on', 'Co-owners, on the whole vault; anyone, on a slice'],
		['Editor', 'Write', 'Read, create, set, tag, propose, merge', 'Someone who works on the entries'],
		['Suggester', 'Write', 'Read and propose; set and merge on proposals', 'A reviewer: main changes only when an editor merges'],
		['Viewer', 'Read', 'Read', 'A reader'],
		['Public', 'Read', 'Read, for Everyone', 'Anything published: its key goes out in the clear'],
		['Backup', 'Backup', 'Keep the ciphertext, read nothing', 'The server, by default'],
		['Relay', 'Relay', 'Find the vault’s devices, keep nothing', 'The server, with backups off']
	];

	const SHARE = `{ "name": "Tick work",
  "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] },
  "ops": [{ "op": "read" },
          { "op": "set", "path": ["status"], "to": ["doing", "done"] }] }`;

	const keeps = [
		['Keep whole', 'Syncs the entries it picks, and keeps their files whole', 'Your desktop, for the originals'],
		['Keep when opened', 'Syncs them, and fetches a file’s pieces as they play', 'Your phone'],
		['Never keep', 'Doesn’t sync what it picks', 'An archive the phone never needs']
	];

	const rotations = [
		['A share is given, a vault gains a device', 'A few boxes: the share’s key to its holder, the vault’s seed to the device'],
		['A share is revoked', 'Each audience it reached moves to a new epoch, boxed to the shares still live'],
		['A vault loses a device or an owner', 'Its seed moves on, and with it the keys in use under it'],
		['An entry’s tags change, a new share picks it', 'One mark, with a link to its earlier keys']
	];

	const TODO_V0 = `{ "title": "Water the figs",
  "done": false }`;

	const TODO_V1 = `{ "title": "Water the figs",
  "status": "doing" }`;

	const TODO_LENS = `{ "lens": "Todo, v0 to v1",
  "from": "40de6c0e…", "to": "0d785ad3…",
  "steps": [{ "convert": {
    "from": ["done"], "to": ["status"],
    "forward": [[{ "done": true },  { "status": "done" }],
                [{ "done": false }, { "status": "open" }]],
    "backward": [[{ "status": "done" },  { "done": true }],
                 [{ "status": "open" },  { "done": false }],
                 [{ "status": "doing" }, { "done": false }]]
  } }] }`;

	const QUERY = `{ "op": "query",
  "where": { "all": [{ "type": ["todo"] }, { "tag": "garden" },
                     { "path": ["status"], "ne": "done" }] },
  "order": [["created", "desc"]], "limit": 20 }`;

	const ANSWER = `{ "ok": { "rows": [{ "entry": "…", "type": "todo", "tags": ["garden"],
                    "record": { "title": "Water the figs", "status": "doing" } }],
          "count": 1 } }

{ "refused": "NotAllowed",
  "why": "the ops of the shares the vault acts through don't allow what it does" }

{ "approve": { "challenge": "…", "signers": ["…"], "draft": "…" } }`;

	// every op `run(op)` takes, by what it does: reads, asks (dry runs), changes of an entry, changes of a vault
	const reads = [
		'query',
		'get',
		'history',
		'schemas',
		'groups',
		'world',
		'jobs',
		'database',
		'note',
		'log',
		'read_file',
		'creatable',
		'taggable'
	];
	const asks = ['may', 'shares'];
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
	const vaultOps = [
		'share',
		'keep',
		'copy',
		'revoke',
		'settings',
		'found',
		'put_file',
		'back_up',
		'mark',
		'card',
		'profile',
		'follow'
	];

	const messages = [
		['Request', 'The frontier of each log it holds, its loose edits, the keys it lacks, the vaults it follows', 'A page of edits'],
		['Announce', 'Its holdings: in full once, then only what changed', 'Nothing'],
		[
			'State',
			'A device’s signed statement of its holdings, with when it checked: its own, or another’s passed on',
			'Nothing, once kept or found older'
		],
		['Ask logs', 'A request for some logs alone, those whose heads it lacks', 'A page of edits'],
		['Link', 'A passkey’s pass, for a new device', 'The vault logs of that passkey'],
		['Join', 'The edit that adds the new device', 'Nothing, once taken'],
		['Card', 'A request for the server’s contact card', 'The vault logs of CEO Aven and every vault that owns it'],
		[
			'Claim key, Claim',
			'Asks an unclaimed server, or a new agent device, for its key to seal to, then claims it',
			'The key; the claim, signed by the claimed device too'
		]
	];

	const blobs = [
		['An edit (a write, a share, a mark)', 'Its signed bytes; a write’s body is encrypted', 'about 17 KiB of SLH-DSA signature, then its body', 'In a journal entry, then a pack'],
		['A pack of edits', 'One blob of many edits, named by a head', 'up to 64 saves', 'On the shelf'],
		['A McEliece public key', 'One blob, named by its hash in the edits that use it', 'about 1 MiB', 'On the shelf'],
		['A photo, a document', 'One sealed blob', 'up to 1 GiB', 'On the shelf, with its outboard'],
		['A film or a camera card', 'A HashSeq of sealed 1 GiB pieces', '1 GiB to many TB', 'Whole, or fetched as it plays']
	];

	const places = [
		['Desktop', 'A folder of the app’s own', 'What its keep shares want; files whole where they say so'],
		['Phone or browser', 'The page’s private storage (OPFS), in a worker', 'The same; pieces read but not kept stay in memory'],
		['Drive', 'A folder on the drive, hosted by the Mac it is plugged into', 'The same as a desktop'],
		['Server', 'The sealed bucket; its disk is only a cache', 'Every file whole, by default']
	];

	const LAYOUT = `g8/                 one generation, 8 or later since the last reset; starting fresh makes g9
  meta/<n>          what opens the device again, its follow list too (browser, desktop)
  journal/<n>       what one save added: new edits, and the McEliece keys they brought
  heads/<n>         after every 64 saves: the packs that hold the log so far
  blobs/<hash>      edit packs, McEliece keys, HashSeqs and file pieces
  outboards/<hash>  each blob's BLAKE3 outboard, written last
  stated/<device>/  each device's signed holdings, named by when it checked, at most one an hour each
  new/              what is still being written`;

	const quantum = [
		['Connections', 'TLS 1.3 with X25519MLKEM768 as the only key exchange, on every link between nodes.'],
		[
			'Hellos',
			'Each connection opens with an SLH-DSA signature each way over its TLS session, so both ends know which device they speak to even once the curves fall.'
		],
		[
			'Signatures',
			'SLH-DSA-SHA2-128f on every edit, the only signature that counts. A passkey adds its WebAuthn assertion beside it, which only shows a person was there.'
		],
		[
			'Keys sent to devices',
			'Sealed boxes of X-Wing (ML-KEM-768 with X25519) and Classic McEliece 6688128f together: closed while either holds.'
		],
		[
			'Edits and files',
			'XChaCha20-Poly1305 for edits and keys, ChaCha20-Poly1305 per 64 KiB segment for files, all with 256-bit keys.'
		],
		[
			'Hashes',
			'BLAKE3 for every hash of avenDB’s own: an id is the plain hash of the bytes, the name iroh gives them, and every other hash derives its own key for its purpose.'
		],
		['The bucket', 'Every object sealed again with a 256-bit key of the server’s, since the link to it is classical.']
	];

	const proofs = [
		['Only edits by someone allowed stand, and a revocation wins over what it hadn’t seen', 'T1'],
		['Changing owners, devices or settings needs the vault’s approval and the newcomer’s consent', 'T2'],
		['A key opens only for whoever may read what it protects', 'T5, T24'],
		['After a removal, the current keys open only for those still entitled, and new writes use them', 'T6, T15'],
		['The server holds no key of a vault, except what is public', 'T7'],
		['Everyone can only read', 'T8'],
		['The same edits in any order give the same state', 'T11'],
		['Sync sends only what shares reach, and strangers get nothing', 'T12'],
		['Frontier sync loses nothing, and two devices that synced once hold the same edits', 'T13, T19'],
		['An edit backdated past a removal that relied on what it took is cut', 'T16'],
		['A share never grants more than what it rests on', 'T22'],
		['The marks on each entry mean exactly what the shares say', 'T23'],
		['The server decides every edit as an owner does, without reading a selector', 'T25'],
		['A relay share receives no entry, and files go only with the edits that bring them', 'T26, T27'],
		['Each device syncs what its keep shares say, and revoking one cuts nothing', 'T28, K1'],
		[
			'What a device announces it holds counts only from that device, on its own connection, and no node announces it for another',
			'H1'
		],
		[
			'A signed statement of holdings counts only as the word of its device, the newest wins, and it is passed on only to peers that may know all of it',
			'H2'
		],
		['What any device says or signs it holds never gets anyone a file the rules refuse', 'T27'],
		['Every reader agrees whether a write counts, and a write that breaks its schema counts for no one', 'C2, S3'],
		['Merging a proposal loses nothing: what main changed stays, and what only the proposal changed lands', 'T10']
	];
</script>

<svelte:head>
	<title>avenDB architecture · Docs · maiaCITY</title>
	<meta
		name="description"
		content="avenDB's architecture: a user-owned, local-first, post-quantum database. What the server can and cannot see, who can read what, and how vaults, entries, shares, keys, sync over iroh and a sealed bucket fit together."
	/>
</svelte:head>

<div class="wrap docs">
	<aside class="toc" bind:this={toc} aria-label="On this page">
		<p>On this page</p>
		<nav>
			{#each contents as [group, links] (group)}
				<span>{group}</span>
				{#each links as [id, name] (id)}
					<a href="#{id}" class:on={id === current} aria-current={id === current ? 'location' : undefined}>
						{name}
					</a>
				{/each}
			{/each}
		</nav>
	</aside>

	<main>
		<a class="back" href="{base}/docs">← Docs</a>

		<header class="intro">
			<p class="eyebrow">avenDB&ensp;·&ensp;architecture&ensp;·&ensp;updated 15 October 2026</p>
			<h1>avenDB Architecture</h1>
			<p class="lede">
				A user-owned, local-first database with post-quantum security. Every write happens on your device first and merges
				with everyone else’s without a server deciding anything. The server relays, stays online for sync and keeps an
				encrypted backup, without ever holding a key.
			</p>
		</header>

		<section id="guarantees">
			<p class="eyebrow">Guarantees</p>
			<h2>What avenDB promises</h2>
			<p class="prose-col">
				Most of these promises are theorems with machine-checked proofs in avenDB’s Lean model, and the code is held to the
				model by shared test vectors. The <a href="#proofs">proofs</a> section names them.
			</p>
			<div class="answers">
				{#each guarantees as x (x.q)}
					<div>
						<span class="short">{x.short}</span>
						<b>{x.q}</b>
						<p>{x.a}</p>
					</div>
				{/each}
			</div>
		</section>

		<section id="who-sees">
			<p class="eyebrow">Who sees what</p>
			<h2>What the server and the bucket can and cannot see</h2>
			<p class="prose-col">
				Your devices, and the devices of the people you share with, read your entries. The server reads none of them. It
				sees enough to route edits and check them, and no more.
			</p>
			<div class="split">
				<div>
					<h3>The server sees</h3>
					<ul>
						{#each serverSees as line (line)}<li>{line}</li>{/each}
					</ul>
				</div>
				<div class="no">
					<h3>It never sees</h3>
					<ul>
						{#each serverNever as line (line)}<li>{line}</li>{/each}
					</ul>
				</div>
				<div class="no">
					<h3>The bucket sees</h3>
					<ul>
						{#each bucketSees as line (line)}<li>{line}</li>{/each}
					</ul>
				</div>
			</div>
			<p class="note prose-col">
				With backups off, the server sees only a vault’s owners and devices, to let them through its relay. A Public share
				is the exception by design: it publishes its key so that anyone with a reason to ask can read what it covers.
			</p>
		</section>

		<section id="mishaps">
			<p class="eyebrow">When something goes wrong</p>
			<h2>Lost devices, revoked shares, a dead disk</h2>
			<div class="cards">
				{#each mishaps as [what, does] (what)}
					<div>
						<h3>{what}</h3>
						<p>{does}</p>
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
				more peer: an always-online device of CEO Aven, an agent vault, that relays, syncs and keeps an encrypted backup, under the
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

		<section id="shape">
			<p class="eyebrow">The shape</p>
			<h2>Three parts: Entry, Share, Blob</h2>
			<p class="prose-col">
				Everything in avenDB is one of three things. All else is worked out from them and never typed in: whom an entry is
				shared with, its key, which devices it is synced to, and what a device still has to fetch.
			</p>
			<div class="cards">
				<div>
					<h3>Entry: what</h3>
					<p>
						All data is an entry in a vault: notes, todos, articles, files, a device’s card, a vault’s profile, and the schemas and
						lenses too. An entry changes only by signed writes.
					</p>
				</div>
				<div>
					<h3>Share: who may</h3>
					<p>
						Who, at which level, on what. People, Everyone, the server and each of your devices are given shares, and a
						vault’s owners and devices are shares too. Revoke ends any of them.
					</p>
				</div>
				<div>
					<h3>Blob and holdings: where</h3>
					<p>
						All bytes are blobs named by their BLAKE3 hash, on one shelf per place. Each device tells its peers what it
						holds for good, and signs it with when it checked. Every “synced to” comes from that.
					</p>
				</div>
			</div>
		</section>

		<section id="vaults">
			<p class="eyebrow">Identity</p>
			<h2>A vault is an identity</h2>
			<p class="prose-col">
				Everything belongs to a vault, the way an account belongs to a person: a vault owns its entries, holds shares in
				other vaults and has owners who may change it. There are three kinds.
			</p>
			<div class="cards">
				<div>
					<h3>Human vault</h3>
					<p>
						Yours. Owned by your passkeys, and by the master recovery key, a way back in kept offline that you remove
						like any owner. Its devices, your desktop and phone, act for it, and each one unlocks its keys with your
						passkey at every start. Nothing else can unlock them.
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
					<p>
						An agent’s identity, such as CEO Aven or your own aven. Owned like a COOP; its devices, a server or the agent
						devices of the harnesses that control it, act for it but never govern it.
					</p>
				</div>
			</div>
			<p class="prose-col">
				A vault has two settings: how many owners must approve a change, and its root passkey, which approves anything on
				its own. Adding or removing an owner or a device takes the vault’s approval and the newcomer’s consent; devices
				approve nothing. A new device joins with your passkey alone, through a QR code on a device you have or by signing
				in through the server. Set up avenDB on a second device with the same passkey and it joins the vault that passkey
				already has: one passkey, one human vault. The first person to found a vault through a new server claims it. The
				same prompt founds four vaults: Maia Holding GmbH and avenCEO GmbH, two COOPs, each owned by the one before; CEO
				Aven, the agent the server is a device of; and Maia City, a COOP avenCEO GmbH owns, where the city’s content
				lives. Each is named as it is founded.
			</p>
		</section>

		<section id="devices">
			<p class="eyebrow">Keys</p>
			<h2>Your passkey is you, a device key is one install</h2>
			<p class="prose-col">
				Two kinds of key act for a human vault. Your passkey is the root, and the same on every device it syncs to. Each
				install of avenDB, a browser on maia.city or the desktop app, has a device key of its own, which signs what that
				install writes.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Key</th><th>Stands for</th><th>Lives</th><th>Lasts</th></tr>
					</thead>
					<tbody>
						{#each keyring as [key, stands, lives, lasts] (key)}
							<tr><td><b>{key}</b></td><td>{stands}</td><td>{lives}</td><td>{lasts}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<h3>Random, not derived</h3>
			<p class="prose-col">
				A device key is 32 random bytes the install draws when it is made, not something derived from your passkey. So
				it exists before the first prompt, and that one prompt both unlocks the device and vouches for it by its id: two
				prompts to set up or sign in, where a derived key would need a third. A device key holds no data, so nothing is
				lost with it. A wiped or new install joins with your passkey and syncs from your other devices and the server,
				and you revoke the old one. Making an old key again would do harm: the copy would sign edits that don’t build on
				the old device’s own, which sync flags as a fork, as for a stolen key, and a revoked device would come back.
			</p>
			<h3>How long it lasts</h3>
			<p class="prose-col">
				As long as the install’s storage. Closing a tab, the browser or the app keeps everything: the next start takes one
				prompt, opens with all the device had, and syncs only what changed, log by log. Only wiped storage makes a new
				device: cleared site data, a private window, an uninstall, a new phone. Browsers may clear a site’s storage on
				their own (Safari after a week unused), so every browser starts as a light copy and the desktop app as a full
				one.
			</p>
			<h3>Where it lives, and how it is kept</h3>
			<p class="prose-col">
				A browser keeps its device in maia.city’s private storage (OPFS); the desktop app in its folder,
				<code>~/Library/Application Support/city.maia.studio/avendb/</code>. Beside the signed, sealed edits, public keys
				and file pieces, the device keeps one small record that opens it again: its name, its id, its relay, the 32
				bytes of its salt, the passkey’s credential and public key, the vaults it follows, and its secret XORed with
				your passkey’s PRF output on that salt. Nothing on disk is a secret: whoever copies it gets only noise, as
				unmasking the secret takes that PRF output, which only your authenticator gives, after Face ID, Touch ID or your
				PIN, and only to maia.city. While the device is open its key is in memory only, and wiped as it closes. What a
				disk can’t protect against: malware on a machine while the device is open, and the site’s own scripts, which may
				ask your passkey for a prompt as any page of maia.city may. The server is the one device whose secret is on
				disk, sealed in its bucket, as nobody is there to unlock it.
			</p>
		</section>

		<section id="edits">
			<p class="eyebrow">Edits and logs</p>
			<h2>Seven kinds of signed edit, one log each</h2>
			<p class="prose-col">
				Every change in avenDB is an edit: signed, named by the BLAKE3 hash of its bytes, and kept for good. There are seven
				kinds. Each edit belongs to one log, a vault’s, a share’s, an audience’s or an entry’s, and its kind alone says
				which, so a peer that can read nothing of it can still route it.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Kind</th><th>What it does</th><th>Its log</th></tr>
					</thead>
					<tbody>
						{#each kinds as [kind, does, log] (kind)}
							<tr><td><b>{kind}</b></td><td>{does}</td><td>{log}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="prose-col">
				Each edit names its log’s latest edits, the frontier, as its parents, so every log is a small graph of hashes: no
				edit can be changed, dropped or put in another order without every device noticing. Every device replays the edits
				it holds in one order, so concurrent edits settle the same way everywhere. A removal, such as a revocation, names
				the edits it had seen. An edit it hadn’t seen that relied on what it took away is cut, so nobody can backdate an
				edit around it.
			</p>
		</section>

		<section id="crdt">
			<p class="eyebrow">Entries and the CRDT</p>
			<h2>Every entry merges</h2>
			<p class="prose-col">
				An entry is one note, todo, article, file, card or profile. Its type and tags travel encrypted inside its writes. Each entry
				is a Loro document, a CRDT: any device changes its own copy at any time, and two devices that hold the same writes
				read the same entry, whatever order the writes arrived in.
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
					The desktop and the phone change the same note at the same time. Once each holds both writes, both read “Buy oat
					milk and bread”, whichever came first. The next write, on either device, names both as its parents.
				</figcaption>
			</figure>
		</section>

		<section id="history">
			<p class="eyebrow">History</p>
			<h2>Main, proposals and variants</h2>
			<p class="prose-col">
				Nothing is overwritten: every write extends a line. Main is what everyone reads. A proposal is a line of its own
				that starts from any version, so a change can be tried and reviewed without touching main. A variant is a new note
				made from any version; it keeps its link to this history, as a fork does, and the original lists its variants.
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
						<text class="s" x="652" y="104">Merge into main:</text>
						<text class="s" x="652" y="122">nothing is lost</text>
						<text class="s" x="600" y="40">Restore and Undo are new writes too</text>
						<text class="s" x="760" y="196">a variant: a new note,</text>
						<text class="s" x="760" y="214">linked to this version</text>
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

		<section id="shares">
			<p class="eyebrow">Shares</p>
			<h2>A share says who may do what, on which entries</h2>
			<p class="prose-col">
				Every permission in avenDB is a share: <b>who</b>, at which <b>level</b>, on <b>what</b>. People, groups, Everyone,
				the server and each of your own devices are given shares. A vault’s owners and its devices are shares too, so the
				device lists them with every other share, and Revoke ends any of them. Every device checks every write against the shares its author
				relies on, so a write no share allows counts for no one.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Who</th><th>How it works</th></tr>
					</thead>
					<tbody>
						{#each who as [name, how] (name)}
							<tr><td><b>{name}</b></td><td>{how}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="prose-col">
				<b>What</b> is everything in the vault, or a selector over an entry’s labels: its type, the vault that created it,
				its id, when it was created, and its tags. Tags change, so a share reaches every entry tagged so, now and later. A
				share is also a named group of JSON ops, and its <b>level</b> is the class of its strongest op. Anyone may name a
				group of their own. In the app, one Share form makes every share, wherever a page offers to share, and a vault’s
				Sharing page is the one place that says who has it.
			</p>
			<figure>
				<pre><code>{SHARE}</code></pre>
				<figcaption>Bob may read the todos tagged work, and set their status to doing or done.</figcaption>
			</figure>
			<div class="table">
				<table>
					<thead>
						<tr><th>Group</th><th>Level</th><th>May</th><th>Typical for</th></tr>
					</thead>
					<tbody>
						{#each groups as [name, level, may, typical] (name)}
							<tr><td><b>{name}</b></td><td>{level}</td><td>{may}</td><td>{typical}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="prose-col">
				The selector, the name and the ops travel sealed, to the vault, the holder and whoever gave the share. In the clear
				a share shows only who holds it and at which level, so the server learns nothing of what it picks or allows. A
				share may rest on another, and a chain of shares allows only what every share of it allows.
			</p>
			<h3>Owners and devices</h3>
			<p class="prose-col">
				An owner is “Owner on Everything”: a co-owner who approves changes to the vault. Only signers own a human vault:
				its person’s passkeys, and the master recovery key it is founded with. An Owner share on a slice, one todo or one tag, is something else: its holder may share that slice on. A device
				“acts for” its vault: it writes as the vault and approves nothing.
			</p>
			<h3>Keep shares: what each of your devices syncs</h3>
			<p class="prose-col">
				A keep share goes from your vault to one of your own devices, by the same selector as any share. It grants nothing:
				it says what that device syncs, and whether it keeps files whole.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Keep</th><th>What it does</th><th>Typical for</th></tr>
					</thead>
					<tbody>
						{#each keeps as [mode, does, typical] (mode)}
							<tr><td><b>{mode}</b></td><td>{does}</td><td>{typical}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="prose-col">
				Each device also has one copy setting, a keep share over everything it may read: a full copy keeps every entry and
				file whole, a light copy syncs every entry and fetches a file only when it is opened. You pick it when the device
				joins, the desktop app full and any browser light by default, and change it in Owners and devices. With neither, the
				server keeps every file whole and any other device fetches pieces as it reads them. A keep share always brings the
				vault’s schemas along. Only the vault that made it can end it, so nobody else can force your phone to sync more.
			</p>
			<h3>The server: Backup or Relay</h3>
			<p class="prose-col">
				Each vault gives the server’s vault a Backup share on everything when it is founded: the server keeps the
				ciphertext of every entry, and opens none. With backups off it gives Relay instead: the server learns the vault’s
				devices, to let them through its relay, and keeps nothing of its entries.
			</p>
			<h3>Revoking</h3>
			<p class="prose-col">
				Revoke ends a share and every share resting on it. Whoever gave it may revoke it, so may the vault it is over, and
				its holder may give it up. The entries it reached move to a new key, sealed only to the shares still live. What was
				read stays read.
			</p>
		</section>

		<section id="audiences">
			<p class="eyebrow">Audiences and keys</p>
			<h2>One key for what the same shares pick</h2>
			<p class="prose-col">
				Entries are not encrypted with one key each, nor with one key for the whole vault. Each entry carries, in the
				clear, its audience: the list of shares that pick it. An audience has one key per epoch, and each entry’s key is
				derived from it. Share the todos tagged garden with Bob as an Editor, and every todo tagged garden has the audience
				“that share”. Bob gets its key once.
			</p>
			<p class="prose-col">
				Tag another todo garden and a device of the vault’s own marks it into that audience, with a link that lets its
				readers read its whole history. Revoke Bob’s share and the audience moves to a new epoch, with a key only the
				remaining shares get: what Bob read before stays his, and nothing new reaches him.
			</p>
			<p class="prose-col">
				The audience is in the clear for a reason. The server reads no selector, type or tag, yet it checks every write:
				the mark on each entry tells it which shares may write there. The marks provably mean what the shares say, so the
				server decides every edit exactly as an owner would.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>When</th><th>What gets new keys</th></tr>
					</thead>
					<tbody>
						{#each rotations as [when, work] (when)}
							<tr><td>{when}</td><td>{work}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="note prose-col">
				Keys are derived inside the vault and wrapped only across a trust boundary. Every key sent to a person or a device
				is sealed with X-Wing and Classic McEliece together. Backup and Relay shares get no key at all.
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
					<pre><code>{TODO_V0}</code></pre>
					<figcaption>Todo, version 0, as an old app reads it</figcaption>
				</figure>
				<figure>
					<pre><code>{TODO_V1}</code></pre>
					<figcaption>The same todo in version 1</figcaption>
				</figure>
				<figure class="wide">
					<pre><code>{TODO_LENS}</code></pre>
					<figcaption>The lens between them: “doing” has no word in version 0, so it reads as not done there.</figcaption>
				</figure>
			</div>
			<ul class="prose-col">
				<li>
					<b>Schemas and lenses are entries</b> of two built-in types. A vault shares them with Everyone, by a Public share
					named “Schemas and lenses” that it makes with its first schema or lens, so every device that reads anything of
					the vault reads its schemas too.
				</li>
				<li>
					<b>Only the vault itself adds them.</b> A schema entry counts only if the vault created it, so no one with a share
					can change what its entries mean.
				</li>
				<li>
					<b>Readers count only writes that fit.</b> A write whose result breaks its schema stays in the log and changes
					nothing anyone sees, so a patched app can’t slip in a value its schema forbids.
				</li>
				<li>
					<b>avenDB’s own schemas ship with every app</b>: documents, todos, articles, stories, flows, functions, posts,
					and a device’s card, a vault’s profile and a file, one version each, and each starts at version 1. Every vault
					reads and writes them offline, and avenCEO GmbH holds each as a Public entry of its own, with the same bytes and so
					the same id. The todo’s version 0 above is the lens engine’s worked example, which lives only in its tests.
				</li>
				<li>
					<b>Flows are stages any entry can be in.</b> An article goes from idea to draft to published. A stage is a
					tag, so a move is one tag change, and a public stage is one Public share on that tag. Functions react to a
					move: each runs in QuickJS on the device that moves the entry and asks for changes, which its vault’s shares
					still decide. Publishing an article makes a public post about it, which the server’s feed serves to the
					Maia Universe stream, and asks whether the pictures it shows go public too, so the stream shows them.
				</li>
			</ul>
		</section>

		<section id="ops">
			<p class="eyebrow">JSON ops</p>
			<h2>One JSON op for every read and change</h2>
			<p class="prose-col">
				Every read and every change, of an entry or of a vault, is one JSON op through one entry point,
				<code>run(op)</code>, the same on a desktop, a phone and in a browser. The page, the desktop app and agents all
				speak it. The device runs the op and answers with what it read or did, or with why it refused. A query picks
				entries by the same selector shares use, then by their values.
			</p>
			<div class="codes">
				<figure class="wide">
					<pre><code>{QUERY}</code></pre>
					<figcaption>The open todos tagged garden, newest first</figcaption>
				</figure>
				<figure class="wide">
					<pre><code>{ANSWER}</code></pre>
					<figcaption>What comes back: what it found, a refusal and why, or what your passkey must approve</figcaption>
				</figure>
			</div>
			<div class="chips">
				<span class="kind">Reads</span>
				{#each reads as op (op)}<code>{op}</code>{/each}
			</div>
			<div class="chips">
				<span class="kind">Asks</span>
				{#each asks as op (op)}<code>{op}</code>{/each}
			</div>
			<div class="chips">
				<span class="kind">Entries</span>
				{#each changes as op (op)}<code>{op}</code>{/each}
			</div>
			<div class="chips">
				<span class="kind">Vaults</span>
				{#each vaultOps as op (op)}<code>{op}</code>{/each}
			</div>
			<p class="prose-col">
				Before it shows a button, the page asks <code>may</code>: would this device be allowed to make the op, on what it
				holds now? So a button you see is a change you may make. The page keeps no rule of its own: it reads levels, ops
				and who may do what from the device’s answers. A <code>batch</code> runs several changes of entries as one.
			</p>
			<p class="prose-col">
				Most changes need nothing but the device. A change the vault’s owners must approve, such as a co-owner, a new
				device, a threshold or new vaults, is drafted on the device and signed by your passkey, in one prompt however many
				edits it makes. With no passkey at hand, as for an agent, the answer is <code>approve</code>: what to sign and by
				whom, and nothing is made until it is signed.
			</p>
			<p class="prose-col">
				An aven is an identity your vault owns, and agent harnesses control it, each as an agent device with a key of its
				own, never a token: Claude Code as agentClaude, Codex as agentCodex, and likewise Cursor, Grok and our own
				native aven. <code>avendb-device agent claude</code> is that device on your desktop, which Claude Code starts as
				its MCP. Access is asked for and given as any share is, on one consent screen: the agent says what it wants and
				why, and you pick the aven it joins and all your vaults or only some, a level each, Viewer, Suggester or Editor.
				One prompt of your passkey adds a new device to the aven, the way a new server is claimed; the shares need none.
				Every harness of an aven acts with the aven’s access, and removing one device leaves the others. It keeps no
				file of its own: it reads your files from your desktop’s one store, so nothing is kept twice.
			</p>
			<p class="prose-col">
				An external drive you use for avenDB is a device of your vault of its own, as a phone is, on the same sync,
				shares, copy setting and holdings. One prompt of your passkey adds it, in Owners and devices on the desktop app,
				and it keeps a full copy unless you make it light. It holds only ciphertext, in <code>.avendb</code> on the
				drive, and its key never in plain: masked by your passkey, as every device’s, and wrapped by each Mac that hosts
				it under that Mac’s own device key, so plugging it in again asks for nothing. While it is plugged in, the Mac’s
				device runs it as a second node; unplugged, its last signed statement of what it holds shows when it checked.
				Eject it in the page, which stops its node before macOS ejects it, so nothing on it is in use. A lost drive is
				removed like a lost phone.
			</p>
		</section>

		<section id="system">
			<p class="eyebrow">The whole system</p>
			<h2>Desktop, phone and server: one protocol stack</h2>
			<p class="prose-col">
				Every device is a full avenDB node with its own shelf: a folder on a desktop, the page’s private storage on a phone
				or in a browser. The server is the same kind of node, and its shelf is a sealed bucket. Devices talk to each other
				directly whenever the network allows it, and through the relay when it does not. A phone or a browser always goes
				through the relay. So as it sets up or signs in, a browser first waits up to 20 seconds for the relay to let it in,
				then reaches the server: a dial sent sooner would be lost, and tried again ever later.
			</p>
			<figure>
				<div class="frame">
					<svg class="fig" viewBox="0 0 960 560" role="img" aria-label="System map">
						<rect class="node" x="20" y="30" width="290" height="180" rx="16" />
						<text class="h" x="40" y="62">Desktop</text>
						<text class="s" x="40" y="88">avenDB device, native, beside the app</text>
						<text class="s" x="40" y="110">one shelf, a folder:</text>
						<text class="s" x="40" y="130">edits in packs,</text>
						<text class="s" x="40" y="150">files as sealed blobs</text>
						<text class="s" x="40" y="180">keeps what its keep shares say</text>
						<rect class="node" x="20" y="350" width="290" height="180" rx="16" />
						<text class="h" x="40" y="382">Phone or browser</text>
						<text class="s" x="40" y="408">avenDB device, in the page</text>
						<text class="s" x="40" y="430">one shelf in OPFS,</text>
						<text class="s" x="40" y="450">laid out as on a desktop</text>
						<text class="s" x="40" y="480">streams files as they play,</text>
						<text class="s" x="40" y="500">keeps what its keep shares say</text>
						<rect class="srv" x="390" y="150" width="300" height="250" rx="16" />
						<text class="h" x="410" y="182">avenDB server · Hetzner</text>
						<text class="s" x="410" y="212">relay: lets your devices meet</text>
						<text class="s" x="410" y="234">sync peer: always online</text>
						<text class="s" x="410" y="256">backup: ciphertext only, no keys</text>
						<line class="thin" x1="410" y1="276" x2="670" y2="276" />
						<text class="s" x="410" y="300">its shelf is the bucket;</text>
						<text class="s" x="410" y="322">its disk, a cache it can lose:</text>
						<text class="s" x="410" y="344">parts read lately, blobs in transit</text>
						<text class="m" x="410" y="380">a device of CEO Aven</text>
						<path class="bkt" d="M770 170 v210 a80 18 0 0 0 160 0 v-210" />
						<ellipse class="bkt" cx="850" cy="170" rx="80" ry="18" />
						<text class="h" x="850" y="214" text-anchor="middle">Object storage</text>
						<text class="s" x="850" y="236" text-anchor="middle">maiacity-avendb, hel1</text>
						<text class="m" x="850" y="264" text-anchor="middle">g&lt;n&gt;/journal/</text>
						<text class="m" x="850" y="284" text-anchor="middle">g&lt;n&gt;/heads/</text>
						<text class="m" x="850" y="304" text-anchor="middle">g&lt;n&gt;/blobs/</text>
						<text class="m" x="850" y="324" text-anchor="middle">g&lt;n&gt;/outboards/</text>
						<text class="s" x="850" y="352" text-anchor="middle">sealed, locked 7 days</text>
						<text class="s" x="850" y="372" text-anchor="middle">the server's truth</text>
						<line class="relay" x1="120" y1="210" x2="120" y2="350" />
						<path class="bytes" d="M175 214 V346" stroke-dasharray="2 9" />
						<text class="s" x="190" y="268">QUIC end to end,</text>
						<text class="s" x="190" y="288">through the relay</text>
						<line class="ctl" x1="310" y1="110" x2="390" y2="190" />
						<path class="bytes" d="M310 150 L388 228" />
						<line class="relay" x1="310" y1="420" x2="390" y2="350" />
						<path class="bytes" d="M310 470 L388 380" stroke-dasharray="2 9" />
						<path class="bytes" d="M692 260 H758" />
						<polygon class="bc" points="756,252 770,260 756,268" />
						<path class="bytes" d="M766 300 H704" />
						<polygon class="bc" points="706,292 692,300 706,308" />
						<text class="s" x="700" y="246">up</text>
						<text class="s" x="700" y="326">parts</text>
						<g transform="translate(410 440)">
							<line class="ctl" x1="0" y1="10" x2="34" y2="10" />
							<text class="s" x="44" y="14">edits, holdings and control (avendb/sync/1)</text>
							<path class="bytes" d="M0 40 H34" />
							<text class="s" x="44" y="44">file bytes and McEliece keys (iroh-blobs, BLAKE3 verified)</text>
							<line class="relay" x1="0" y1="70" x2="34" y2="70" />
							<text class="s" x="44" y="74">through the relay: phones and browsers always, others when no direct path</text>
						</g>
					</svg>
				</div>
				<figcaption>
					Every arrow carries ciphertext only. Keys never leave the devices of the people a vault shares with, and the
					server seals every object again before it goes to the bucket.
				</figcaption>
			</figure>
		</section>

		<section id="node">
			<p class="eyebrow">Inside one node</p>
			<h2>The layering n0 intends, and what avenDB adds</h2>
			<p class="prose-col">
				iroh’s own guidance: an endpoint, a router that hands each connection to a protocol by its ALPN, the app’s own
				protocol for app logic, and iroh-blobs for bytes. avenDB has all four. Its sync protocol decides what moves and
				carries the edits; iroh-blobs carries McEliece keys and file pieces, verified as they arrive.
			</p>
			<figure>
				<div class="frame">
					<svg class="fig" viewBox="0 0 960 360" role="img" aria-label="The layers of an avenDB node">
						<rect class="band-av" x="20" y="20" width="760" height="56" rx="10" />
						<text class="h" x="40" y="45">Lab: vaults, shares, audiences, keys, Loro entries, JSON ops</text>
						<text class="s" x="40" y="65">decides what counts, opens what this device may read, keeps marks and keys up to date</text>
						<rect class="band-n0" x="20" y="86" width="372" height="56" rx="10" />
						<text class="h" x="40" y="111">Shelf store: iroh-blobs over one shelf</text>
						<text class="s" x="40" y="131">a folder on a desktop, OPFS on a phone or in a browser</text>
						<rect class="band-av" x="408" y="86" width="372" height="56" rx="10" />
						<text class="h" x="428" y="111">On the server, the shelf is the bucket</text>
						<text class="s" x="428" y="131">every object sealed, its disk only a cache</text>
						<rect class="band-av" x="20" y="152" width="372" height="66" rx="10" />
						<text class="h" x="40" y="178">avendb/sync/1</text>
						<text class="s" x="40" y="200">hellos, frontiers per log, holdings, asks</text>
						<rect class="band-n0" x="408" y="152" width="372" height="66" rx="10" />
						<text class="h" x="428" y="178">/iroh-bytes/4 (iroh-blobs)</text>
						<text class="s" x="428" y="200">one pool, verified ranges, resume, GetMany</text>
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
					The sync protocol carries edits and decisions: what changed, who holds what. iroh-blobs carries bytes, and lets
					a device in only beside a sync connection whose hello proved it. Both share one endpoint, one identity and one
					post-quantum TLS setup.
				</figcaption>
			</figure>
		</section>

		<section id="sync">
			<p class="eyebrow">Sync</p>
			<h2>Devices say what they hold, and ask only for what differs</h2>
			<p class="prose-col">
				Each connection opens with a hello each way: an SLH-DSA signature over the TLS session, so both ends know which
				device they speak to. Then each tells the other its holdings: for every log it may share with that peer, its
				frontier, and for every file, whether it holds it whole or in pieces. After that it sends only what changed. A
				device that hears of a head it lacks asks for that log alone, and gets only what it lacks, in pages of about 4
				MiB. Order never matters, so any device can sync with any other, in any order, any number of times.
			</p>
			<div class="split">
				<div>
					<h3>Shares: what a device may get</h3>
					<p>
						A peer sends a device only the entries its vaults may receive, the logs needed to check them, and nothing else.
						A relay share gets the vault’s devices and no entry.
					</p>
				</div>
				<div>
					<h3>Keep shares: what it wants</h3>
					<p>
						Whole, when opened or never, by the same selector a share uses. Your phone fetches pieces as it plays, your
						desktop keeps originals whole, the server keeps all.
					</p>
				</div>
				<div>
					<h3>Holdings: who has what</h3>
					<p>
						Only what a device holds for good, on its shelf. Announced, they count only from the device itself on its own
						connection, and choose whom to fetch from; signed, they outlive it and only show. Both fill in “Synced to”.
						They never grant anything.
					</p>
				</div>
				<div>
					<h3>Interest and follow</h3>
					<p>
						What a vault shares with Everyone goes only to devices with an interest in it, or that follow it by name. A
						device keeps its follow list across restarts. One that acts for no vault and follows none is sent nothing.
					</p>
				</div>
			</div>
			<div class="table">
				<table>
					<thead>
						<tr><th>Message</th><th>What it carries</th><th>The answer</th></tr>
					</thead>
					<tbody>
						{#each messages as [name, carries, answer] (name)}
							<tr><td><b>{name}</b></td><td>{carries}</td><td>{answer}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="note prose-col">
				Every message is a stream of its own on the one avenDB protocol, with exactly one encoding for every value.
				Announcements go straight to one proven device, never by gossip, and no node announces another device’s holdings:
				what it passes on is only that device’s own signed statement.
			</p>
			<h3>Signed holdings: “checked 2 h ago”</h3>
			<p class="prose-col">
				An announcement counts only while its device is connected. So each device also signs what it tells a peer it
				holds, with when it checked: a statement, signed with SLH-DSA like an edit and good for nothing else. It signs a
				new one on each connection and once its holdings change, at most every 10 seconds, and again every 15 minutes
				while they stay the same, and hands it only to the peers it is connected to. Every node, the server no less than
				your desktop, keeps the newest statement of each device it knows, whoever brought it, passes it on to each
				connected peer that may know all it says, and keeps it on its shelf, so it outlives the device’s connection and
				the node’s restarts. “Synced to” lists a device connected now by what it announced, and any other by its newest
				statement, with when it checked: the phone in your drawer shows as “checked 2 h ago”. Statements only show: a
				node asks and fetches by what its connected peers announce, and no statement lets anyone fetch anything.
			</p>
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
						{#each blobs as [thing, form, size, where] (thing)}
							<tr><td>{thing}</td><td>{form}</td><td class="num">{size}</td><td>{where}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="prose-col">
				Every edit and every blob has one name, the BLAKE3 hash of its bytes, which is also the name iroh stores and
				moves those bytes by. An edit’s signatures sign that name. Edits are kept in packs and files in pieces, each a
				blob. The write that brings a file names the file’s root hash and sealed size in the clear, because the server and
				other devices need them to back the file up and to know who may fetch it. The file’s key sits inside the write’s
				encrypted body. Whoever may fetch the write may fetch its files, and nobody else.
			</p>
			<p class="prose-col">
				Every vault has a Library that lists its files by kind: films, images, SVGs, PDFs and audio. A file is an ordinary
				entry of type <code>file</code>, a document named after the file whose first write brings it, so shares, sync and
				deletion work on it as on a note. A film plays as it streams: the player asks for byte ranges, and the device
				fetches only the 64 KiB segments those ranges need, verified by iroh-blobs, and opens them. The database lists
				files too, as a table like any other, with each file’s root, size, sealed size and pieces.
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
						<text class="s" x="530" y="58">key K derived from the file, keyed by the vault</text>
						<text class="s" x="530" y="76">ChaCha20-Poly1305, nonce = segment number + last flag</text>
						<path class="thin" d="M240 84 v24" />
						<path class="thin" d="M234 100 l6 8 l6 -8" />
						<text class="h" x="20" y="134">2 · Sealed segments, each exactly 64 KiB</text>
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
						<text class="h" x="20" y="400">4 · The write that brings it</text>
						<rect class="edit" x="20" y="412" width="500" height="44" rx="8" />
						<text class="s" x="36" y="432">in the clear: root hash, sealed size</text>
						<text class="s" x="36" y="449">encrypted: key K and length, with the entry’s name and type</text>
						<path class="thin" d="M251 366 V412" />
						<text class="s" x="560" y="400">the write is signed and synced like any edit;</text>
						<text class="s" x="560" y="420">the pieces follow, from whoever holds them</text>
					</svg>
				</div>
				<figcaption>
					This format is called sealed blob v2. The tag adds 0.024 %. Pieces cannot be swapped or reordered, because every
					nonce counts segments across the whole file. Whoever holds the key verifies by decrypting; everyone else verifies
					the ciphertext with BLAKE3. A file’s key is derived from what it holds, keyed by a secret of the person’s vault: the
					same film added again by any of their devices seals to the same blobs, kept once, while another person’s copy
					seals to unrelated ones.
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
			<h2>One shelf per place</h2>
			<p class="prose-col">
				Each place keeps what lasts on one shelf, laid out the same everywhere. A shelf says it has something only once its
				place’s source of truth holds it, so “synced to” never means “on its way”. Pieces a device reads but doesn’t keep
				stay in memory, 64 MiB at most.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Place</th><th>Its shelf</th><th>What it keeps</th></tr>
					</thead>
					<tbody>
						{#each places as [place, shelf, keeps] (place)}
							<tr><td><b>{place}</b></td><td>{shelf}</td><td>{keeps}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<figure>
				<pre><code>{LAYOUT}</code></pre>
				<figcaption>
					One generation of a shelf. A node starts from its newest head and the journal after it: a few dozen objects,
					however long the log.
				</figcaption>
			</figure>
			<p class="prose-col">
				Packing is what makes object storage work for a database. Hetzner bills every object as at least 64 KB and allows
				750 requests a second per bucket. A million edits stored one per object would take 22 minutes of a fully busy
				bucket to write or restore. Packed, a node reads a few dozen objects to start.
			</p>
			<ul class="prose-col">
				<li>
					<b>Put aside, clear at a reset.</b> Forgetting an account, or starting fresh, makes a new generation beside the
					old one, which is never read again. A reset raises the lowest generation, now 8. As each place opens, it deletes
					every older one: the desktop its folder, a browser its private storage, the server its folder and its bucket.
				</li>
				<li>
					<b>Nothing counts until the bucket has it.</b> The server’s shelf answers only once the bucket holds the object,
					so its holdings name an edit or a file only then.
				</li>
				<li>
					<b>Sealed and in parts.</b> Every object in the bucket is sealed and bound to its name. A blob is stored in 8 MiB
					parts, and counts once its outboard, written last, is there.
				</li>
				<li>
					<b>Its disk is a cache.</b> The server caches parts it read lately, 8 GiB by default. Its own device secret is in
					the bucket too, sealed, so a server whose disk is lost comes back from the bucket alone.
				</li>
				<li>
					<b>Locked.</b> Every object version is kept for 7 days in compliance mode, so not even a compromised server can
					wipe the backup. What a reset deletes stays there 7 more days, then goes.
				</li>
			</ul>
		</section>

		<section id="post-quantum">
			<p class="eyebrow">Post-quantum</p>
			<h2>Quantum-proof, everywhere</h2>
			<p class="prose-col">
				Every node runs in post-quantum-only mode: no classical-only path is left. Every edit counts by its SLH-DSA
				signature alone, and where a classical algorithm still appears, in a key exchange or a sealed box, a post-quantum
				one stands beside it, so it stays closed while either holds.
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

		<section id="proofs">
			<p class="eyebrow">Proofs</p>
			<h2>What the Lean model proves</h2>
			<p class="prose-col">
				avenDB’s rules are written twice: in Lean 4, where each guarantee below is a theorem with a machine-checked proof,
				and in Rust. Shared test vectors hold the two to the same answers, edit by edit. The proofs assume that signatures
				can’t be forged, that sealed data reveals nothing without its key, that ids don’t collide and that Loro converges.
				Verifpal models cover the hello, linking and the sealed box against an attacker who breaks the curves.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Guarantee</th><th>Theorem</th></tr>
					</thead>
					<tbody>
						{#each proofs as [what, names] (names)}
							<tr><td>{what}</td><td class="num">{names}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="note prose-col">
				Not covered by the proofs: the Rust and Loro code itself, which the vectors and tests check; timing and traffic
				analysis; a file’s exact length, which its sealed size shows; and a device compromised while it is unlocked.
			</p>
		</section>

		<footer class="note">
			Sources: Ink &amp; Switch’s <i>Local-first software</i> (2019), Loro 1.16, iroh 1.3, iroh-blobs 0.103.1 and bao-tree
			0.16.1 source, n0’s blog and docs, Hetzner Object Storage documentation, and avenDB’s code and Lean model for edit
			format 9, as of 15 October 2026. The full reference is <code>avendb/docs/ARCHITECTURE.md</code>.
		</footer>
	</main>
</div>

<style>
	/* the contents on the left, scrolling on their own beside the page; on a phone a strip on top */
	.docs {
		display: grid;
		grid-template-columns: 14rem minmax(0, 1fr);
		gap: 3.5rem;
		align-items: start;
	}
	main {
		--mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		display: grid;
		gap: 4rem;
		min-width: 0;
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
		position: sticky;
		top: env(safe-area-inset-top, 0px);
		max-height: calc(100vh - env(safe-area-inset-top, 0px));
		max-height: calc(100dvh - env(safe-area-inset-top, 0px));
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-block: 3rem 2rem;
		scrollbar-width: thin;
	}
	.toc p,
	.toc span {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.toc nav {
		display: grid;
		gap: 0.1rem;
		margin-top: 0.9rem;
		border-left: 1px solid var(--line);
	}
	.toc span {
		padding: 1rem 0 0.35rem 1rem;
		font-size: 0.68rem;
	}
	.toc span:first-child {
		padding-top: 0.2rem;
	}
	.toc a {
		margin-left: -1px;
		padding: 0.32rem 0.5rem 0.32rem 1rem;
		border-left: 2px solid transparent;
		font-size: 0.9rem;
		line-height: 1.3;
		color: var(--ink-soft);
		text-decoration: none;
	}
	.toc a:hover {
		color: var(--ink);
	}
	.toc a.on {
		border-left-color: var(--terracotta);
		font-weight: 600;
		color: var(--ink);
	}
	@media (max-width: 960px) {
		.docs {
			grid-template-columns: minmax(0, 1fr);
			gap: 0;
		}
		.toc {
			z-index: 2;
			max-height: none;
			margin-inline: -1.5rem;
			padding: 0.6rem 1.5rem;
			overflow-x: auto;
			overflow-y: hidden;
			background: color-mix(in srgb, var(--cream) 92%, transparent);
			backdrop-filter: blur(8px);
			border-bottom: 1px solid var(--line);
			scrollbar-width: none;
		}
		.toc p,
		.toc span {
			display: none;
		}
		.toc nav {
			display: flex;
			gap: 0.4rem;
			margin: 0;
			border: 0;
		}
		.toc a {
			flex: none;
			margin: 0;
			padding: 0.3rem 0.8rem;
			border: 1px solid var(--line);
			border-radius: 999px;
			background: var(--paper);
			font-size: 0.85rem;
			white-space: nowrap;
		}
		.toc a.on {
			border-color: var(--ink);
			background: var(--ink);
			color: var(--paper);
		}
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
