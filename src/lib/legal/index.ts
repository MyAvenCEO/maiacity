// The legal pages maia.city hosts. Texts are copied verbatim from aven-brands;
// update them there first, then copy again.
import { IMPRESSUM_DE, SITE_NOTICE_EN } from './imprint';
import { SOCIAL_MEDIA_DE, SOCIAL_MEDIA_EN } from './social-media';
import type { LegalDocument } from './types';

export type { LegalBlock, LegalDocument } from './types';

export const LEGAL_DOCUMENTS: LegalDocument[] = [
	SITE_NOTICE_EN,
	IMPRESSUM_DE,
	SOCIAL_MEDIA_EN,
	SOCIAL_MEDIA_DE
];

export const legalByPath = (path: string) =>
	LEGAL_DOCUMENTS.find((d) => d.path === (path.endsWith('/') ? path : `${path}/`));

/** The row at the very bottom of every page. */
export const LEGAL_LINKS = [
	{ href: SITE_NOTICE_EN.path, label: 'Site notice' },
	{ href: IMPRESSUM_DE.path, label: 'Impressum' },
	{ href: SOCIAL_MEDIA_EN.path, label: 'Social media privacy' }
];
