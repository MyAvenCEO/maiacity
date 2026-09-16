/**
 * Impressum / Site Notice — the one legal document TEMPLATED from
 * [[COMPANY]] rather than transcribed: its content IS the company facts.
 * Legal texts are maintained manually — updated counsel text goes through
 * the same HTML-to-structure conversion the other documents used.
 */
import { COMPANY } from './company'
import type { LegalDocument } from './types'

const c = COMPANY
const address = [c.legalName, c.street, c.city]

export const SITE_NOTICE_EN: LegalDocument = {
	slug: 'impressum',
	lang: 'en',
	title: 'Site Notice',
	path: '/site-notice/',
	sections: [
		{
			blocks: [
				{ lines: address },
				{ lines: [`Commercial Register: ${c.register}`, `Registration court: ${c.registerCourt}`] },
				{ lead: 'Represented by:', lines: [c.representative] }
			]
		},
		{
			level: 2,
			title: 'Contact',
			blocks: [{ lines: [`Phone: ${c.phone}`, `E-mail: ${c.email}`] }]
		},
		{
			level: 2,
			title: 'VAT ID',
			blocks: [
				{
					lines: [
						'Sales tax identification number according to Sect. 27 a of the Sales Tax Law:',
						c.vatId
					]
				}
			]
		},
		{
			level: 2,
			title: 'Business identification number',
			blocks: [{ lines: [c.businessId] }]
		},
		{
			level: 2,
			title: 'Person responsible for editorial',
			blocks: [{ lines: [c.representative, c.street, c.city] }]
		},
		{
			level: 2,
			title: 'Dispute resolution proceedings in front of a consumer arbitration board',
			blocks: [
				{
					lines: [
						'We are not willing or obliged to participate in dispute resolution proceedings in front of a consumer arbitration board.'
					]
				}
			]
		},
		{
			level: 2,
			title:
				'Central contact point according to the Digital Services Act - DSA (Regulation (EU) 2022/2065)',
			blocks: [
				{
					lines: [
						'You can reach our central contact point for users and authorities in accordance with Art. 11, 12 DSA as follows:'
					]
				},
				{ lines: [`E-mail: ${c.email}`] },
				{
					lines: [`The languages available for contact are: ${c.contactLanguages.en}.`]
				}
			]
		}
	]
}
