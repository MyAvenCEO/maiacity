// A STAND-IN for thread A's Peer-Light messages (MILESTONE2.md, thread B), on production's stand-in port only, until
// the Peer-Light gossips and the Aven Peer keeps invites and joins. It speaks exactly the messages the page will get
// (invites in `network`, `chat`, `room`, `refused`) and checks nothing a real peer checks: no signature, no passkey,
// no door. It goes, with os/web/peer/standin.js, once the Peer-Light has `say` (the worker uses it only without).
//
//   GET  /standin?device=<id>   server-sent events: this device's lines
//   POST /standin               {device, network: {claimed, tree}} | {device, say} | {device, frame: {frame, statement}}
const port = Number(process.env.AVENSANDBOX_PROD_PORT ?? 5174);

export function standin() {
	const clients = new Map();
	let claimed = null;
	let base = null;
	const members = [];
	const invites = new Map();

	// the tree the real Aven Peer told, with the stand-in's members added the way a claim adds its person and device
	function tree() {
		if (!base) return null;
		const t = structuredClone(base);
		for (const m of members) {
			t.keys[m.passkey.id] = `es256:${m.passkey.spki}`;
			t.keys[m.device.id] = m.device.key;
			const guardian = Object.values(t.vaults).find((v) => v.kind === 'person')?.owners.filter((o) => !o.startsWith('key:passkey-')) ?? [];
			t.vaults[m.person] = { name: `${m.name}'s vault`, kind: 'person', owners: [`key:${m.passkey.id}`, ...guardian] };
			t.vaults[m.device.id] = { name: `${m.name}'s browser`, kind: 'device', owners: [`vault:${m.person}`] };
		}
		return t;
	}
	// the devices of the admin's owners: the network vault's owner, or that owner's owners when it is a coop
	function admins(t) {
		const admin = t.vaults.aven?.owners[0]?.replace(/^vault:/, '');
		const people = t.vaults[admin]?.kind === 'person' ? [admin] : (t.vaults[admin]?.owners ?? []).map((o) => o.replace(/^vault:/, ''));
		return Object.keys(t.vaults).filter((id) => t.vaults[id].kind === 'device' && people.includes(t.vaults[id].owners[0].replace(/^vault:/, '')));
	}
	const actsFor = (t, device) => t?.vaults[device]?.owners[0]?.replace(/^vault:/, '');

	function write(res, line) {
		res.write(`data: ${JSON.stringify({ t: Date.now(), peer: 'standin', ...line })}\n\n`);
	}
	function tell() {
		const t = tree();
		const listed = [...invites.values()].map(({ id, key, state, person }) => ({ id, key, state, ...(person ? { person } : {}) }));
		const present = ['aven-peer', ...clients.keys()].filter((id) => id === 'aven-peer' || t?.vaults[id]);
		// nothing about the network until the real Aven Peer has said whether it is claimed
		if (claimed === null) return;
		for (const [device, res] of clients) {
			const mine = t?.vaults[device] ? JSON.stringify(t) : null;
			write(res, { event: 'network', claimed, tree: mine, ...(t && admins(t).includes(device) ? { invites: listed } : {}) });
			if (mine) write(res, { event: 'room', present });
		}
	}
	function chat(line) {
		const t = tree();
		for (const [device, res] of clients) if (t?.vaults[device]) write(res, { event: 'chat', at: Date.now(), ...line });
	}

	function take(device, body, res) {
		const refuse = (why) => (clients.get(device) && write(clients.get(device), { event: 'refused', why }), res.writeHead(204).end());
		if (body.network) {
			claimed = body.network.claimed;
			if (body.network.tree) base = JSON.parse(body.network.tree);
			if (!claimed) (base = null), (members.length = 0), invites.clear();
		}
		if (body.say) {
			if (!tree()?.vaults[device]) return refuse('only members chat');
			chat({ from: device, vault: actsFor(tree(), device), text: String(body.say).slice(0, 1000) });
		}
		const frame = body.frame;
		if (frame) {
			const s = JSON.parse(frame.statement);
			const t = tree();
			if (frame.frame === 'invite' || frame.frame === 'withdraw') {
				if (!t || !admins(t).includes(device)) return refuse('only the admin invites');
				if (frame.frame === 'invite') invites.set(s.invite, { id: `invite-${s.invite.slice(0, 16)}`, key: s.invite, state: 'open' });
				else if (invites.get(s.invite)?.state !== 'open') return refuse('no such open invite');
				else invites.get(s.invite).state = 'withdrawn';
			}
			if (frame.frame === 'join') {
				const i = invites.get(s.invite);
				if (!i) return refuse('no such invite');
				if (i.state === 'used') return refuse('this invite is used already');
				if (i.state === 'withdrawn') return refuse('this invite was withdrawn');
				Object.assign(i, { state: 'used', person: s.person });
				members.push(s);
				tell();
				chat({ from: 'aven-peer', vault: 'aven', joined: s.person, text: `${s.name} joined` });
			}
		}
		tell();
		res.writeHead(204).end();
	}

	return {
		name: 'aven-standin',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = new URL(req.url ?? '/', 'http://box');
				if (req.socket.localPort !== port || url.pathname !== '/standin') return next();
				const device = url.searchParams.get('device') ?? '';
				if (req.method === 'GET' && /^device-[0-9a-f]{16}$/.test(device)) {
					res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
					clients.set(device, res);
					req.on('close', () => clients.get(device) === res && (clients.delete(device), tell()));
					return tell();
				}
				if (req.method !== 'POST') return res.writeHead(405).end();
				let body = '';
				req.on('data', (chunk) => (body += chunk));
				req.on('end', () => {
					try {
						const parsed = JSON.parse(body);
						take(parsed.device, parsed, res);
					} catch (error) {
						res.writeHead(400).end(String(error));
					}
				});
			});
		},
	};
}
