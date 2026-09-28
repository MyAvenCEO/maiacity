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
	/** The film's own still, when the cover is a different picture. Falls back to the cover. */
	poster?: string;
	video?: string;
	videoLocal?: string;
	videoAspect?: string;
	videoLibrary?: string;
	coverAlt?: string;
	/** where to anchor the cover when it is cropped (CSS object-position): "top" for a cover with its title set in it */
	coverPosition?: string;
	/** the header on a wide screen, when the cover is not wide enough: the day's 5:2 title card (the cover stays the
	    header on a phone, and the picture everywhere else) */
	banner?: string;
	excerpt: string;
	categories: string[];
	draft?: boolean;
	readingMinutes: number;
	/** where the post is read, when not at /blog/<slug> (an unpublished day, previewed from the content board) */
	href?: string;
	/** the day's card on the content board — only ever set in an admin's browser, for a day not yet published */
	board?: BoardState;
}

/** Where a day stands on the content board, and when it goes out. */
export interface BoardState {
	status: string;
	/** when the journal post goes out (the day's own date, else its card's) */
	goesOut: string | null;
}

export interface Post extends PostMeta {
	html: string;
}
