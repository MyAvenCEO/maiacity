// The roundtrips of the avenDB architecture page (/docs/avendb/), each a sequence diagram ($lib/docs/Sequence.svelte).

const you = { id: 'you', label: 'You', person: true };
const desktop = { id: 'M', label: 'Desktop' };
const phone = { id: 'P', label: 'Phone' };
const server = { id: 'S', label: 'avenDB server' };
const bucket = { id: 'B', label: 'Bucket' };

export const TRIPS = [
	{
		title: 'You write a note',
		caption:
			'If the desktop and the phone reach each other, they sync directly too, and the server only catches up. The server says it holds an edit only once the bucket does, so its holdings are the receipt: until then the desktop sees the server lacks it, and the server keeps trying to save it. Only logs that changed are named, so a quiet vault costs nothing.',
		spec: {
			actors: [you, desktop, server, bucket, phone],
			steps: [
				{ from: 'you', to: 'M', text: 'type in the note' },
				{ from: 'M', to: 'M', text: 'sign the edit, encrypt its body, save it on the shelf' },
				{ note: ['M'], text: 'it counts now, online or not' },
				{ from: 'M', to: 'S', text: 'holdings: this note has a new head' },
				{ from: 'S', to: 'M', text: 'ask for that log alone' },
				{ from: 'M', to: 'S', text: 'the edit, ciphertext', reply: true },
				{ from: 'S', to: 'S', text: 'check signatures and shares, keep it' },
				{ from: 'S', to: 'B', text: 'seal it into the journal' },
				{ from: 'B', to: 'S', text: 'held, locked for 7 days', reply: true },
				{ from: 'S', to: 'M', text: 'holdings: the server holds it' },
				{ note: ['M'], text: 'Synced to: the server' },
				{ from: 'S', to: 'P', text: 'holdings: that note changed' },
				{ from: 'P', to: 'S', text: 'ask for that log' },
				{ from: 'S', to: 'P', text: 'the edit', reply: true },
				{ from: 'P', to: 'P', text: 'open it, merge it into the note' }
			]
		}
	},
	{
		title: 'You add a 2 TB film on your desktop',
		caption:
			'Your uplink sets the pace: at 54 Mbit/s a terabyte takes about 41 hours, at 1 Gbit/s about 2.2 hours. The desktop keeps working the whole time. The film is in your vault once the desktop has read it twice, once for its key and once to seal it, and the upload starts then. A piece counts on the server once its outboard is in the bucket, written after every part.',
		spec: {
			actors: [you, desktop, server, bucket],
			steps: [
				{ from: 'you', to: 'M', text: 'drop the film into a vault' },
				{ from: 'M', to: 'M', text: 'read the whole film once, to derive its key' },
				{
					group: 'loop',
					label: 'every 1 GiB piece, as it is read again',
					steps: [{ from: 'M', to: 'M', text: 'seal 64 KiB segments, hash with BLAKE3, shelve it' }]
				},
				{ from: 'M', to: 'M', text: 'write the HashSeq root, sign one write that brings it' },
				{ from: 'M', to: 'S', text: 'sync the write (small, at once)' },
				{ note: ['S'], text: 'it keeps every file whole' },
				{ from: 'S', to: 'M', text: 'get the root, then piece after piece' },
				{
					group: 'loop',
					label: 'each piece',
					steps: [
						{ from: 'M', to: 'S', text: 'bytes, verified every 16 KiB', reply: true },
						{ from: 'S', to: 'B', text: 'sealed parts of 8 MiB' },
						{ from: 'S', to: 'B', text: 'its outboard, last' }
					]
				},
				{ note: ['M', 'S'], text: 'a dropped link resumes at the next missing range' },
				{ from: 'S', to: 'M', text: 'holdings: the film, whole' },
				{ note: ['M'], text: 'Synced to: the server' }
			]
		}
	},
	{
		title: 'You play it on the phone and jump to minute 93',
		caption:
			'Holdings tell the phone which devices hold the piece, so it asks them first. The server reads whole 8 MiB parts and caches them, never single segments and never whole files, so seeking stays fast on a 50 GB file and the bucket’s 750 requests a second are never the limit.',
		spec: {
			actors: [you, phone, desktop, server, bucket],
			steps: [
				{ from: 'you', to: 'P', text: 'play, then seek to minute 93' },
				{ from: 'P', to: 'P', text: 'byte offset to segment, piece and range' },
				{
					group: 'alt',
					label: 'the desktop holds that piece and is reachable',
					steps: [
						{ from: 'P', to: 'M', text: 'get piece 1,412, a 4 MiB range' },
						{ from: 'M', to: 'P', text: 'verified bytes from its shelf', reply: true }
					],
					else: {
						label: 'only the server',
						steps: [
							{ from: 'P', to: 'S', text: 'get the same range' },
							{ from: 'S', to: 'B', text: 'the 8 MiB part that holds it, unless cached' },
							{ from: 'B', to: 'S', text: 'a sealed part', reply: true },
							{ from: 'S', to: 'P', text: 'bytes, verified against the outboard', reply: true }
						]
					}
				},
				{ from: 'P', to: 'P', text: 'open the segments, hand them to the player' }
			]
		}
	},
	{
		title: 'Your devices keep each other in sync',
		caption:
			'Every pair of devices runs the same exchange. Each log has its own frontier, so a device asks only for the logs that changed, never the whole vault. Order never matters: Loro merges concurrent edits to the same note the same way everywhere. File pieces are not copied by sync: each device fetches them as its keep shares say, or as it plays them.',
		spec: {
			actors: [
				{ id: 'M', label: 'Desktop' },
				{ id: 'P', label: 'Phone' },
				{ id: 'W', label: 'Browser' },
				{ id: 'S', label: 'avenDB server' }
			],
			steps: [
				{ note: ['M', 'P'], text: 'same café wifi' },
				{ from: 'M', to: 'P', text: 'hello, proven by a post-quantum signature' },
				{ from: 'P', to: 'M', text: 'hello', reply: true },
				{ from: 'M', to: 'P', text: 'holdings: each log’s frontier' },
				{ from: 'P', to: 'M', text: 'holdings, and ask the logs that differ' },
				{ from: 'M', to: 'P', text: 'what it lacks, nothing more', reply: true },
				{ note: ['P'], text: 'offline: you keep writing' },
				{ from: 'P', to: 'P', text: 'edits pile up, each one counts' },
				{ note: ['P', 'S'], text: 'back online, only the server is reachable' },
				{ from: 'P', to: 'S', text: 'hello, then holdings' },
				{ from: 'S', to: 'P', text: 'ask the logs that changed' },
				{ from: 'P', to: 'S', text: 'the phone’s edits', reply: true },
				{ from: 'P', to: 'S', text: 'ask what the desktop wrote meanwhile' },
				{ from: 'S', to: 'P', text: 'those edits', reply: true },
				{ from: 'S', to: 'M', text: 'holdings: these logs changed' },
				{ from: 'M', to: 'S', text: 'ask those logs alone' },
				{ from: 'W', to: 'S', text: 'through the relay, the same exchange' }
			]
		}
	},
	{
		title: 'A new phone signs in with your passkey alone',
		caption:
			'The link card holds the logs of the vaults your passkey owns and nothing of an entry, so the pass alone reads nothing. History then comes in pages of about 4 MiB, each edit after its past, so a vault of any size arrives a page at a time, never one round trip per edit. With every other device lost, this is how a vault comes back. Signing in on a second device with the same passkey takes this same path, and founds nothing new.',
		spec: {
			actors: [you, { id: 'N', label: 'New phone' }, server],
			steps: [
				{ from: 'you', to: 'N', text: 'sign in with your passkey' },
				{ from: 'N', to: 'N', text: 'wait for the relay to let it in, up to 20 s' },
				{ from: 'N', to: 'S', text: 'through the relay: show the pass your passkey signed' },
				{ from: 'S', to: 'N', text: 'the link card: your vault’s log', reply: true },
				{ from: 'N', to: 'N', text: 'check every edit, open the keys your passkey unlocks' },
				{ from: 'N', to: 'S', text: 'join: the edit that adds this phone' },
				{ from: 'N', to: 'S', text: 'ask for every log it may receive' },
				{ from: 'S', to: 'N', text: 'pages of history', reply: true },
				{ note: ['N'], text: 'notes and todos are there' },
				{ from: 'N', to: 'S', text: 'pieces of a file as you open it, or whole by your copy setting' }
			]
		}
	},
	{
		title: 'The server is lost and rebuilt',
		caption:
			'The bucket holds every edit and key the server took, and the server’s own device secret, all sealed. Only the seal key sits apart, in the deploy’s secrets. So a new server on an empty disk is the same device again, and nothing changes for your vaults. File parts come back from the bucket as they are read. Were the bucket itself lost, the nightly snapshots in the second bucket bring the server back: a restore puts every vault into a new, empty folder with the server’s device secret, and a server started there is the same device.',
		spec: {
			actors: [{ id: 'S', label: 'New server' }, bucket, { id: 'D', label: 'Any of your devices' }],
			steps: [
				{ from: 'S', to: 'B', text: 'get its device secret' },
				{ from: 'B', to: 'S', text: 'sealed', reply: true },
				{ from: 'S', to: 'S', text: 'open it with the seal key: the same device again' },
				{ from: 'S', to: 'B', text: 'the newest head, and the journal after it' },
				{ from: 'B', to: 'S', text: 'a head and up to 63 entries, sealed', reply: true },
				{ from: 'S', to: 'B', text: 'the packs and McEliece keys they name' },
				{ from: 'B', to: 'S', text: 'up to 64 sealed packs, and the keys', reply: true },
				{ from: 'S', to: 'S', text: 'open each, check every edit again' },
				{ note: ['S'], text: 'its holdings name only what the bucket holds' },
				{ from: 'D', to: 'S', text: 'hello and holdings, as usual' },
				{ note: ['S', 'D'], text: 'anything newer comes back from your devices' }
			]
		}
	}
];
