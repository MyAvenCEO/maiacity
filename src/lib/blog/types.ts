export interface PostMeta {
	slug: string;
	title: string;
	subtitle?: string;
	day?: number;
	author: string;
	authorImage?: string;
	authorRole?: string;
	date: string;
	cover?: string;
	coverAlt?: string;
	excerpt: string;
	categories: string[];
	readingMinutes: number;
}

export interface Post extends PostMeta {
	html: string;
}
