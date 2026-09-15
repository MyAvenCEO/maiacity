export type SourceType =
	| 'video'
	| 'podcast'
	| 'paper'
	| 'article'
	| 'post'
	| 'thread'
	| 'report'
	| 'book';

export interface InspirationMeta {
	slug: string;
	title: string;
	originalTitle?: string;
	source: string;
	type: SourceType;
	author?: string;
	authorSlug?: string;
	authorUrl?: string;
	via?: string;
	published?: string;
	added: string;
	categories: string[];
	hook: string;
	shift?: { from: string; to: string };
	quote?: string;
	quoteBy?: string;
	language?: string;
	youtubeId?: string;
}

export interface InspirationSection {
	id: string;
	title: string;
	html: string;
}

export interface InspirationEntry extends InspirationMeta {
	sections: InspirationSection[];
	sourceHtml: string | null;
	sourceWords: number;
}

export interface Author {
	slug: string;
	name: string;
	urls: string[];
	entries: InspirationMeta[];
}
