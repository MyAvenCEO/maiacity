// The legal pages maia.city hosts, in English. Texts come from aven-brands
// (brands/CEO/design-system/src); update them there first, then copy again.
import { SITE_NOTICE_EN } from './imprint';
import { PRIVACY_POLICY_EN } from './privacy';
import { SOCIAL_MEDIA_EN } from './social-media';
import type { LegalDocument } from './types';

export type { LegalBlock, LegalDocument } from './types';

export const LEGAL_DOCUMENTS: LegalDocument[] = [SITE_NOTICE_EN, PRIVACY_POLICY_EN, SOCIAL_MEDIA_EN];

export const legalByPath = (path: string) =>
	LEGAL_DOCUMENTS.find((d) => d.path === (path.endsWith('/') ? path : `${path}/`));

/** The row at the very bottom of every page. */
export const LEGAL_LINKS = [
	{ href: SITE_NOTICE_EN.path, label: 'Site notice' },
	{ href: PRIVACY_POLICY_EN.path, label: 'Privacy' },
	{ href: SOCIAL_MEDIA_EN.path, label: 'Social media privacy' }
];
