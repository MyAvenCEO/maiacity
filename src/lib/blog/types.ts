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
	video?: string;
	videoLocal?: string;
	videoAspect?: string;
	videoLibrary?: string;
	coverAlt?: string;
	excerpt: string;
	categories: string[];
	draft?: boolean;
	readingMinutes: number;
}

export interface Post extends PostMeta {
	html: string;
}
