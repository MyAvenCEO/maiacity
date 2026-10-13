// The roundtrips of the avenDB architecture page (/docs/avendb/), each a sequence diagram ($lib/docs/Sequence.svelte).

const you = { id: 'you', label: 'You', person: true };
const mac = { id: 'M', label: 'Mac device' };
const phone = { id: 'P', label: 'Phone device' };
const server = { id: 'S', label: 'avenDB server' };
const bucket = { id: 'B', label: 'Bucket' };

export const TRIPS = [
	{
		title: 'You write a note',
		caption:
			'If the Mac and the phone see each other directly, they sync directly too, and the server only catches up. The server takes the edit only once the bucket holds it, so its announcement is the receipt: until then the Mac keeps the edit marked as not backed up yet, and announces it again.',
		spec: {
			actors: [you, mac, server, bucket, phone],
			steps: [
				{ from: 'you', to: 'M', text: 'type in the note' },
				{ from: 'M', to: 'M', text: 'sign the edit, encrypt its body, keep it' },
				{ note: ['M'], text: 'it counts now, online or not' },
				{ from: 'M', to: 'S', text: 'announce the new frontier' },
				{ from: 'S', to: 'M', text: 'ask for what it lacks' },
				{ from: 'M', to: 'S', text: 'the edit, ciphertext', reply: true },
				{ from: 'S', to: 'B', text: 'seal it, write it in a pack' },
				{ from: 'B', to: 'S', text: 'held, locked for 7 days', reply: true },
				{ from: 'S', to: 'S', text: 'check signatures and caps, take it' },
				{ from: 'S', to: 'M', text: 'announce: the server holds it' },
				{ note: ['M'], text: 'backed up' },
				{ from: 'S', to: 'P', text: 'announce' },
				{ from: 'P', to: 'S', text: 'ask' },
				{ from: 'S', to: 'P', text: 'the edit', reply: true },
				{ from: 'P', to: 'P', text: 'decrypt, apply to the note' }
			]
		}
	},
	{
		title: 'You add a 2 TB film on the Mac',
		caption:
			'Your uplink sets the pace: at 54 Mbit/s a terabyte takes about 41 hours, at 1 Gbit/s about 2.2 hours. The Mac keeps working the whole time, and the film is readable on the Mac from the first second.',
		spec: {
			actors: [you, mac, server, bucket],
			steps: [
				{ from: 'you', to: 'M', text: 'drop the film into a vault' },
				{
					group: 'loop',
					label: 'every 1 GiB piece, as it is read',
					steps: [{ from: 'M', to: 'M', text: 'encrypt 64 KiB segments, hash with BLAKE3' }]
				},
				{ from: 'M', to: 'M', text: 'write the HashSeq root, sign one edit naming it' },
				{ from: 'M', to: 'S', text: 'sync the edit (small, instant)' },
				{ note: ['S'], text: 'its sync rule says: keep every file' },
				{ from: 'S', to: 'M', text: 'get the root, then piece after piece' },
				{
					group: 'loop',
					label: 'each piece, up to 32 at once',
					steps: [
						{ from: 'M', to: 'S', text: 'bytes, verified every 16 KiB', reply: true },
						{ from: 'S', to: 'B', text: 'multipart upload, 16 MiB parts' },
						{ from: 'S', to: 'S', text: "keep the piece's outboard" }
					]
				},
				{ note: ['M', 'S'], text: 'a dropped link resumes at the next missing range' }
			]
		}
	},
	{
		title: 'You play it on the phone and jump to minute 93',
		caption:
			'The server reads whole windows, never single 16 KiB groups and never whole files, so seeking stays fast on a 50 GB file and the bucket’s 750 requests a second are never the limit.',
		spec: {
			actors: [you, phone, mac, server, bucket],
			steps: [
				{ from: 'you', to: 'P', text: 'play, then seek to minute 93' },
				{ from: 'P', to: 'P', text: 'byte offset to segment, piece and range' },
				{
					group: 'alt',
					label: 'the Mac is reachable',
					steps: [
						{ from: 'P', to: 'M', text: 'get piece 1,412, that range' },
						{ from: 'M', to: 'P', text: 'verified bytes from its disk', reply: true }
					],
					else: {
						label: 'only the server',
						steps: [
							{ from: 'P', to: 'S', text: 'get the same range' },
							{ from: 'S', to: 'B', text: 'one ranged GET, a 4 to 8 MiB window' },
							{ from: 'B', to: 'S', text: 'ciphertext', reply: true },
							{ from: 'S', to: 'P', text: 'bytes, verified against the outboard', reply: true }
						]
					}
				},
				{ from: 'P', to: 'P', text: 'decrypt the segments, hand them to the player' },
				{ note: ['P'], text: 'playback starts after one window' }
			]
		}
	},
	{
		title: 'Your devices keep each other in sync',
		caption:
			'Every pair of devices runs the same exchange. Order never matters: each log is a chain of hashes, and Loro merges concurrent edits to the same note deterministically. File pieces are not copied by sync: each device fetches them when it plays them or when its sync rules say so.',
		spec: {
			actors: [
				{ id: 'M', label: 'Mac' },
				{ id: 'P', label: 'Phone' },
				{ id: 'W', label: 'Browser' },
				{ id: 'S', label: 'avenDB server' }
			],
			steps: [
				{ note: ['M', 'P'], text: 'same café wifi, a direct path' },
				{ from: 'M', to: 'P', text: 'frontier digests per log' },
				{ from: 'P', to: 'M', text: 'what differs, both ways', reply: true },
				{ note: ['P'], text: 'offline: you keep writing' },
				{ from: 'P', to: 'P', text: 'edits pile up, each one valid' },
				{ note: ['P', 'S'], text: 'back online, only the server is reachable' },
				{ from: 'P', to: 'S', text: 'announce frontiers' },
				{ from: 'S', to: 'P', text: 'everything the Mac wrote meanwhile', reply: true },
				{ from: 'P', to: 'S', text: 'everything the phone wrote' },
				{ from: 'S', to: 'M', text: 'announce' },
				{ from: 'M', to: 'S', text: "ask, and get the phone's edits" },
				{ from: 'W', to: 'S', text: 'through the relay, the same exchange' }
			]
		}
	},
	{
		title: 'A new phone signs in with your passkey alone',
		caption:
			'History moves in pages of thousands of edits per request, so a vault with a million edits arrives in seconds instead of a million round trips.',
		spec: {
			actors: [you, { id: 'N', label: 'New phone' }, server],
			steps: [
				{ from: 'you', to: 'N', text: 'sign in with your passkey' },
				{ from: 'N', to: 'S', text: 'show the pass your passkey signed' },
				{ from: 'S', to: 'N', text: "your vault's log, still encrypted", reply: true },
				{ from: 'N', to: 'N', text: 'check every edit, open the keys your passkey unlocks' },
				{ from: 'N', to: 'S', text: 'join: the edit that adds this phone' },
				{ from: 'S', to: 'N', text: 'pages of history', reply: true },
				{ note: ['N'], text: 'notes and todos are there' },
				{ from: 'N', to: 'S', text: 'pieces of a file, only when you open it' }
			]
		}
	},
	{
		title: 'The server is lost and rebuilt',
		caption:
			"The bucket holds every edit and key the server took, sealed. The server's identity key and the seal key sit apart from it: the seal key in the deploy's secrets, with a copy in its owner's password manager. Without the identity key a new server starts as a new device, and your vault adds it with one owner edit.",
		spec: {
			actors: [{ id: 'S', label: 'New server' }, bucket, { id: 'D', label: 'Any of your devices' }],
			steps: [
				{ from: 'S', to: 'B', text: 'list edits/ and keys/' },
				{ from: 'B', to: 'S', text: 'the names of every pack and key', reply: true },
				{ from: 'S', to: 'B', text: 'fetch what its disk lacks' },
				{ from: 'B', to: 'S', text: 'sealed packs and keys', reply: true },
				{ from: 'S', to: 'S', text: 'open each with the seal key, check every edit again' },
				{ note: ['S'], text: 'it announces only what the bucket holds' },
				{ from: 'D', to: 'S', text: 'sync as usual' },
				{ note: ['S', 'D'], text: 'anything newer comes back from your devices' }
			]
		}
	}
];

// What changed lately, newest first: each line one shipped step, with its pull requests.
export const CHANGES = [
	{
		when: '13 Oct',
		what: 'The bucket is made: maiacity-avendb in Helsinki, every object locked for 7 days in compliance mode. Hetzner offers no post-quantum key exchange, so the server seals every object with a key of its own before it leaves.',
		prs: [557]
	},
	{
		when: '13 Oct',
		what: 'No more acting-as switcher: in a vault you own, directly or through your COOPs, you act as that vault; elsewhere, as whichever of your vaults holds the strongest cap there.',
		prs: [554]
	},
	{
		when: '13 Oct',
		what: 'A master recovery key, built in: every human vault is founded with it among its owners, and it is added and removed like any owner. avenDB started afresh with it (edit format 7).',
		prs: [543, 547, 549, 552]
	},
	{
		when: '13 Oct',
		what: "The browser's store moved into OPFS, in a worker of its own: its edits, its McEliece keys and what opens it again. IndexedDB moved over once and is gone.",
		prs: [541]
	},
	{
		when: '13 Oct',
		what: 'Sync rules: what each device wants of a vault, by the same selector as caps, for any data. Sealed, marked on each entry by the vault’s stewards and applied by every peer alike (T28, T29).',
		prs: [539]
	},
	{
		when: '13 Oct',
		what: 'One iroh blob store per node, on disk on the Mac and the server: a file is sealed as it is read, any byte range is fetched through the cap gate, and the server keeps every file whole.',
		prs: [537]
	},
	{
		when: '13 Oct',
		what: 'Sealed blob v1, the seekable file format, and edits that name the files they bring (T27: files follow their edits).',
		prs: [530, 532]
	}
];
