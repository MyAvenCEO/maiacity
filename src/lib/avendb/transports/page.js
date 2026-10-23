// @ts-nocheck — one host per device Worker; only that worker's authenticated core can open routes.
import { packetPort } from './port.js';
import { webRtc } from './webrtc.js';
import { MAX_ROUTES } from './packets.js';

export function rtcPageHost({ create = webRtc } = {}) {
	const routes = new Map(); let stopped = false;
	const closeDevice = (device) => { for (const route of [...routes.values()]) if (route.device === device) route.close(); };
	return {
		message(data) {
			if (data?.$transport === 'close-device') { closeDevice(data.device); return true; }
			if (data?.$transport !== 'open-rtc') return false;
			const { device, route, epoch, port } = data;
			if (!port) return true;
			if (stopped || !Number.isSafeInteger(device) || typeof route !== 'string' || !route.length || route.length > 128 || !Number.isInteger(epoch) || epoch < 0 || epoch > 0xffff_ffff || typeof data.initiator !== 'boolean') { port.close(); return true; }
			const key = `${device}:${route}`, previous = routes.get(key);
			if ((previous && previous.epoch >= epoch) || (!previous && routes.size >= MAX_ROUTES)) { port.close(); return true; }
			previous?.close();
			let carrier, bridge, ended = false;
			const entry = { device, epoch, close: (why = 'closed') => {
				if (ended) return; ended = true;
				if (routes.get(key) === entry) routes.delete(key);
				carrier?.close(why); bridge?.close(why);
			} };
			routes.set(key, entry);
			bridge = packetPort(port, {
				receive: (bytes) => carrier?.send(bytes) ?? false,
				event: (value) => value.kind === 'signal' ? carrier?.signal(value.signal) ?? false : false,
				closed: entry.close
			});
			carrier = create({ initiator: data.initiator }, {
				receive: (bytes) => !ended && bridge.send(bytes),
				event: (value) => {
					if (ended) return false;
					if (value.kind === 'closed') { entry.close(value.reason); return true; }
					return bridge.event(value);
				}
			});
			if (ended) carrier.close();
			return true;
		},
		closeDevice,
		suspend() { for (const route of [...routes.values()]) route.close('page suspended'); },
		close() { if (stopped) return; stopped = true; for (const route of [...routes.values()]) route.close(); }
	};
}
