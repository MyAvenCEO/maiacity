// Shapes copied from aven-brands (brands/CEO/design-system/src/legal.ts), so the
// legal texts below stay byte-identical to the counsel-provided originals.
export type LegalLang = 'de' | 'en';
export type LegalSlug = 'impressum' | 'datenschutz' | 'social-media' | 'widerruf';

export interface LegalParagraph {
	/** Bold lead line above the lines, e.g. "Vertreten durch:". */
	lead?: string;
	lines: string[];
}

/** A bullet list — discriminated from a paragraph by `items`. */
export interface LegalList {
	items: string[];
}

export type LegalBlock = LegalParagraph | LegalList;

export interface LegalSection {
	level?: 2 | 3 | 4 | 5;
	title?: string;
	blocks: LegalBlock[];
}

export interface LegalDocument {
	slug: LegalSlug;
	lang: LegalLang;
	title: string;
	path: string;
	sections: LegalSection[];
}
