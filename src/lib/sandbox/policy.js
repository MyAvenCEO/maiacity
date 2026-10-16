// @ts-nocheck — plain JS
/*
 * The walls every sandboxed frame of ours shares (the asset box, the view frames): one list, so a feature turned off
 * for one is off for all. Part of the kernel: changing it changes every box at once.
 */

/** Every powerful browser feature, off: no device, no passkey, no clipboard, no payment, no full screen. */
export const DENIED = [
	'camera', 'microphone', 'geolocation', 'display-capture', 'clipboard-read', 'clipboard-write', 'payment', 'usb',
	'serial', 'hid', 'bluetooth', 'midi', 'publickey-credentials-get', 'publickey-credentials-create', 'storage-access',
	'fullscreen', 'screen-wake-lock', 'idle-detection', 'local-fonts', 'otp-credentials', 'xr-spatial-tracking'
];

/** The frame's `allow` attribute: every feature in DENIED turned off. */
export const DENY = DENIED.map((f) => `${f} 'none'`).join('; ');

/** The `sandbox` attribute: scripts, and nothing else (no same origin, forms, popups, modals, downloads, top navigation). */
export const SANDBOX = 'allow-scripts';
