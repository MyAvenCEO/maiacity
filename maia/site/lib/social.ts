// avenSAMUEL's channels — the same four listed in the aven-brands social-media policy.
export const socials = [
	{ id: 'youtube', label: 'YouTube', handle: '@avenSAMUEL', href: 'https://www.youtube.com/@avenSAMUEL' },
	{ id: 'x', label: 'X', handle: '@samuelandert', href: 'https://x.com/samuelandert' },
	{ id: 'instagram', label: 'Instagram', handle: '@samuelandert', href: 'https://instagram.com/samuelandert' },
	{
		id: 'linkedin',
		label: 'LinkedIn',
		handle: 'Samuel Andert',
		href: 'https://www.linkedin.com/in/samuel-andert-797b6211b/'
	}
] as const;

export type SocialId = (typeof socials)[number]['id'];
