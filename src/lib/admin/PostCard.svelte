<!--
	One post, simulated the way its platform lays it out, read only: the base article on our own journal, YouTube's
	watch page or its Shorts player (on a phone), a LinkedIn feed card, an X post, a thread of them or an X Article
	(the long read), an Instagram feed post (square, in the feed) or a Reel (9:16, on a phone). A video or Reel plays its delivered file; a text post shows its picture, if it has one.
	Below it, the file it uploads, its character count against the platform's limit, and any warning it carries. No
	real logos: neutral glyphs, the platforms' layout conventions.
-->
<script lang="ts">
	import { API, fileUrl, postFiles, type Delivery, type Post } from '$lib/auth/client';
	import { formatOf } from './board';
	import { readingMinutes, renderMarkdown, splitArticle } from './markdown';

	const raw = (hash: string) => fileUrl(hash);

	let {
		post,
		deliveries,
		when = null,
		article = '',
		image = raw
	}: {
		post: Post;
		deliveries: Delivery[];
		/** the base article (Markdown), which the journal post publishes */
		article?: string;
		/** when it goes out, for the date the cards show */
		when?: string | null;
		/** an image's address */
		image?: (hash: string) => string;
	} = $props();

	// the limits the platforms count against, and the account they post from
	const LIMIT: Record<Exclude<Post['platform'], 'journal'>, { limit: number; title?: number }> = {
		youtube: { limit: 5000, title: 100 },
		linkedin: { limit: 3000 },
		x: { limit: 280 },
		instagram: { limit: 2200 }
	};
	const NAME = 'Samuel Andert';
	const HANDLE = 'samuelandert';
	const CHANNEL_NAME = 'avenSAMUEL';

	const format = $derived(formatOf(post));
	const files = $derived(postFiles(post, deliveries));
	// a video or Reel plays its file — and so does the blog post of a day with a film (the post opens on it);
	// anything else shows its picture, if it has one
	const moving = $derived(format === 'video' || format === 'short' || format === 'reel' || (post.platform === 'journal' && Boolean(files.video)));
	// a browser that cannot decode the HEVC master (Firefox, some Chrome builds) plays the H.264 cut of the same frame instead
	let fallback = $state(false);
	const source = $derived(moving ? (fallback && postFiles({ ...post, codec: 'h264' }, deliveries).video) || files.video : undefined);
	const poster = $derived(files.thumbnail ? image(files.thumbnail.hash) : undefined);
	// an Instagram post without a placement is a Reel when it is vertical, a feed post otherwise
	const reel = $derived(post.platform === 'instagram' && (post.placement ?? (post.aspect === '9:16' ? 'reel' : 'feed')) === 'reel');
	const feed = $derived(post.platform === 'instagram' && !reel);
	// a YouTube Short (square or vertical, on the phone), and X's long read
	const short = $derived(post.platform === 'youtube' && format === 'short');
	const xArticle = $derived(post.platform === 'x' && format === 'article');
	// an X Article is Markdown, rendered the way the journal renders it
	const articleHtml = $derived(xArticle ? renderMarkdown(post.text) : '');

	const length = (s: string) => [...s].length;
	// X weighs a link as 23 characters and anything outside the Latin-ish ranges (CJK, emoji) as two
	const xLength = (s: string) => {
		let n = 0;
		for (const ch of s.replace(/https?:\/\/\S+/g, 'x'.repeat(23))) {
			const c = ch.codePointAt(0)!;
			n += c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247) ? 1 : 2;
		}
		return n;
	};
	// an X thread: one tweet per entry, each counted on its own
	const tweets = $derived(post.thread?.length ? post.thread : [post.text]);
	const counts = $derived.by(() => {
		if (post.platform === 'journal') return [];
		if (format === 'thread') return [{ label: 'Tweets', n: tweets.length, max: 25 }];
		if (xArticle) return [{ label: 'Title', n: length(post.title ?? ''), max: 100 }, { label: 'Article', n: length(post.text), max: 100_000 }];
		const lim = LIMIT[post.platform] ?? { limit: 2200 };
		if (lim.title) return [{ label: 'Title', n: length(post.title ?? ''), max: lim.title }, { label: 'Description', n: length(post.text), max: lim.limit }];
		return [{ label: post.platform === 'instagram' ? 'Caption' : 'Post', n: post.platform === 'x' ? xLength(post.text) : length(post.text), max: lim.limit }];
	});

	// ── the words, broken into what the platforms make clickable: chapters and links ──
	type Token = { t: 'text' | 'time' | 'link'; v: string; s?: number };
	const TOKEN = /(^|\n)((?:\d{1,2}:)?\d{1,2}:\d{2})(?=[ \t])|(https?:\/\/\S*[^\s.,;:!?)])/gu;
	const toSeconds = (t: string) => t.split(':').reduce((s, n) => s * 60 + Number(n), 0);
	function tokens(text: string, chapters = false): Token[] {
		const out: Token[] = [];
		let at = 0;
		for (const m of text.matchAll(TOKEN)) {
			if (m[2] !== undefined && !chapters) continue;
			out.push({ t: 'text', v: text.slice(at, m.index) + (m[1] ?? '') });
			if (m[2] !== undefined) out.push({ t: 'time', v: m[2], s: toSeconds(m[2]) });
			else out.push({ t: 'link', v: m[3] });
			at = m.index! + m[0].length;
		}
		out.push({ t: 'text', v: text.slice(at) });
		return out;
	}

	// the journal publishes the base article itself: its title, its opening, "read more"
	const journal = $derived.by(() => {
		if (post.platform !== 'journal') return null;
		const a = splitArticle(article || post.text);
		return { ...a, title: post.title ?? a.title, html: renderMarkdown(a.body, 3), minutes: readingMinutes(a.body) };
	});

	// YouTube only turns timestamps into chapters when the first is 0:00, there are three or more, each ten seconds or longer
	const chapterWarning = $derived.by(() => {
		if (post.platform !== 'youtube') return '';
		const times = [...post.text.matchAll(/(?:^|\n)((?:\d{1,2}:)?\d{1,2}:\d{2})(?=[ \t])/g)].map((m) => toSeconds(m[1]));
		if (!times.length) return '';
		const end = files.video?.seconds ?? Infinity;
		const short = times.findIndex((t, i) => (times[i + 1] ?? end) - t < 10);
		const why =
			times[0] !== 0 ? 'the first must be 0:00' : times.length < 3 ? 'it takes three or more' : short >= 0 ? `the one at ${mmss(times[short])} is shorter than 10 s` : '';
		return why ? `YouTube will not turn these timestamps into chapters: ${why}.` : '';
	});

	// a Short is square or vertical, and three minutes at most
	const shortWarning = $derived.by(() => {
		if (!short) return '';
		if (post.aspect && post.aspect !== '1:1' && post.aspect !== '9:16') return `A Short is square or vertical (1:1 or 9:16), not ${post.aspect}.`;
		const s = files.video?.seconds ?? 0;
		return s > 180 ? `A Short runs 3 minutes at most; this video runs ${mmss(s)}. YouTube will post it as a regular video.` : '';
	});

	// a caption collapsed the way the apps do it: one flowing line or two, cut at a word, then "… more"
	function collapsed(text: string, budget: number) {
		const flat = text.replace(/\s*\n+\s*/g, ' ').trim();
		if (flat.length <= budget) return { text: flat, cut: false };
		const cut = flat.slice(0, budget);
		return { text: cut.slice(0, Math.max(cut.lastIndexOf(' '), budget * 0.6)).replace(/[\s.,;:!?—–-]+$/, ''), cut: true };
	}

	const mmss = (s: number) => {
		const t = Math.round(s);
		return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
	};
	const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
	const ratio = (a: string) => a.replace(':', ' / ');
	const day = $derived(when ? new Date(when).toLocaleDateString([], { day: 'numeric', month: 'short' }) : 'now');
	const longDay = $derived(when ? new Date(when).toLocaleDateString([], { day: 'numeric', month: 'long' }) : 'Just now');

	// ── playing: muted until it is clicked; one video in the drawer plays at a time ──
	let video = $state<HTMLVideoElement>();
	let started = $state(false);
	let paused = $state(true);
	let more = $state(false);
	let clamped = $state(false);
	let safe = $state(false);

	function play(at?: number) {
		const v = video;
		if (!v) return;
		if (at !== undefined) {
			// Safari ignores a seek before the metadata is in
			if (v.readyState >= 1) v.currentTime = at;
			else v.addEventListener('loadedmetadata', () => (v.currentTime = at), { once: true });
			v.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
		started = true;
		v.muted = false;
		void v.play().catch(() => {});
	}
	const toggle = () => (video?.paused ? play() : video?.pause());
	const solo = (e: Event) => document.querySelectorAll('video').forEach((v) => v !== e.currentTarget && v.pause());

	/** Tells whether a clamped block of text is cut off, so "…more" only shows when there is more. */
	function overflows(el: HTMLElement, set: (cut: boolean) => void) {
		const check = () => set(el.scrollHeight > el.clientHeight + 1);
		const watch = new ResizeObserver(check);
		watch.observe(el);
		check();
		return { destroy: () => watch.disconnect() };
	}

	const ICON: Record<string, string> = {
		play: 'M8 5v14l11-7z',
		heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
		comment: 'M4 5h16v11H9l-5 4z',
		share: 'M14 5l6 6-6 6M20 11H10a6 6 0 0 0-6 6v2',
		send: 'M21 3 3 10l7 3 3 7zM10 13 21 3',
		bookmark: 'M6 3h12v18l-6-4-6 4z',
		repost: 'M7 7h11v5M17 17H6v-5M15 4l3 3-3 3M9 20l-3-3 3-3',
		views: 'M5 20v-8M12 20V5M19 20v-9',
		up: 'M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6a2 2 0 0 1-2 1.7H7',
		down: 'M17 13V4h3v9zM17 13l-4 7a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17',
		dots: 'M5 12h.01M12 12h.01M19 12h.01',
		music: 'M9 18V5l10-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
		remix: 'M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9M17 3v4h-4M7 21v-4h4',
		search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4'
	};
</script>

{#snippet icon(name: string)}
	<svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[name]} /></svg>
{/snippet}

{#snippet words(list: Token[])}
	{#each list as k, i (i)}
		{#if k.t === 'time'}<button class="lnk" onclick={() => play(k.s)}>{k.v}</button>{:else if k.t === 'link'}<a class="lnk" href={k.v} target="_blank" rel="noopener">{k.v}</a>{:else}{k.v}{/if}
	{/each}
{/snippet}

<!-- the landscape player (YouTube, X, LinkedIn): the thumbnail until it is clicked, then the film with controls -->
{#snippet wide(shape: string)}
	<div class="media" style:aspect-ratio={ratio(shape)}>
		{#if source}
			<video
				bind:this={video}
				src={poster ? raw(source.hash) : `${raw(source.hash)}#t=0.1`}
				onerror={() => (fallback = true)}
				onplay={solo}
				{poster}
				controls={started}
				preload="metadata"
				playsinline
				muted
				crossorigin="anonymous"
			></video>
		{:else if poster}
			<img src={poster} alt="" />
		{/if}
		{#if !started}
			<button class="poster" onclick={() => play()} aria-label="Play" disabled={!files.video}>
				<span class="go">{@render icon('play')}</span>
				{#if files.video}<span class="dur">{mmss(files.video.seconds)}</span>{/if}
			</button>
		{/if}
	</div>
{/snippet}

<!-- the looping player of the feed and the Reels: the poster until it is tapped, a tap plays and pauses -->
{#snippet looped(fit: boolean)}
	{#if source}
		<video
			bind:this={video}
			bind:paused
			class:fit
			src={poster ? raw(source.hash) : `${raw(source.hash)}#t=0.1`}
			onerror={() => (fallback = true)}
			onplay={solo}
			{poster}
			preload="metadata"
			playsinline
			muted
			loop
			crossorigin="anonymous"
		></video>
	{:else if poster}
		<img src={poster} alt="" />
	{/if}
	<button class="tap" onclick={toggle} aria-label={paused ? 'Play' : 'Pause'} disabled={!files.video}>
		{#if paused}<span class="go">{@render icon('play')}</span>{/if}
	</button>
{/snippet}

<!-- what a post carries: the film for a video, else its picture (if it has one) -->
{#snippet media(shape: string)}
	{#if moving}
		{@render wide(shape)}
	{:else if poster}
		<div class="media" style:aspect-ratio={ratio(shape)}><img src={poster} alt="" /></div>
	{/if}
{/snippet}

<div class="card">
	{#if journal}
		<!-- our own journal: the base article as the site shows it, its title, its opening, then "read more" -->
		<article class="jr">
			<p class="jr-eyebrow">maiaCITY · Journal</p>
			<h4 class="jr-title">{journal.title ?? '(no title)'}</h4>
			{#if journal.subtitle}<p class="jr-sub">{journal.subtitle}</p>{/if}
			<!-- the day's film, when it has one, in the player the post shows it in; else the cover -->
			{#if files.video}{@render wide(post.aspect ?? '16:9')}{:else if poster ?? journal.cover}<img class="jr-cover" src={poster ?? journal.cover} alt="" />{/if}
			<div class="jr-body">{@html journal.html}</div>
			<p class="jr-more">Read more →</p>
		</article>
	{:else if short}
		<!-- a YouTube Short: the film in the black 9:16 frame (a square one sits in the middle, letterboxed, not cropped),
		     the channel and the title bottom left, the rail of actions on the right -->
		<div class="phone">
			<div class="screen yts" class:letterbox={post.aspect !== '9:16'} style:aspect-ratio="9 / 16">
				{@render looped(post.aspect !== '9:16')}

				<div class="top yts-top"><b>Shorts</b><span class="grow"></span>{@render icon('search')}{@render icon('dots')}</div>

				<div class="rail">
					<span>{@render icon('up')}<small>Like</small></span>
					<span>{@render icon('down')}<small>Dislike</small></span>
					<span>{@render icon('comment')}<small>0</small></span>
					<span>{@render icon('share')}<small>Share</small></span>
					<span>{@render icon('remix')}<small>Remix</small></span>
					<span class="sq"></span>
				</div>

				<div class="cap" class:open={more}>
					<p class="acct"><span class="av sm">aS</span><b>@{CHANNEL_NAME}</b><span class="yts-sub">Subscribe</span></p>
					{#if more}
						<p class="words full"><b>{post.title ?? '(no title)'}</b></p>
						{#if post.text}<p class="words full">{@render words(tokens(post.text))}</p>{/if}
						<button class="more" onclick={() => (more = false)}>less</button>
					{:else}
						<div class="clip">
							<p class="words yts-title" use:overflows={(c) => (clamped = c)}>{post.title ?? '(no title)'}</p>
							{#if clamped || post.text}<button class="more yts-more" onclick={() => (more = true)}>…more</button>{/if}
						</div>
					{/if}
					<p class="audio">{@render icon('music')} {CHANNEL_NAME} · Original sound</p>
				</div>

				<div class="tabbar"><i></i><i></i><i class="plus"></i><i></i><i></i></div>
			</div>
		</div>
	{:else if post.platform === 'youtube'}
		<!-- YouTube's watch page: player, title, channel row, the description box -->
		<article class="yt">
			{@render wide('16:9')}
			<h4 class="yt-title">{post.title ?? '(no title)'}</h4>
			<div class="yt-row">
				<span class="av">aS</span>
				<span class="who"><b>{CHANNEL_NAME}</b><small>— subscribers</small></span>
				<span class="yt-sub">Subscribe</span>
				<span class="grow"></span>
				<span class="yt-pill">{@render icon('up')}<i></i>{@render icon('down')}</span>
				<span class="yt-pill">{@render icon('share')} Share</span>
			</div>
			<div class="yt-desc">
				<p class="yt-stats">0 views · {when ? `Premieres ${day}` : 'just now'}</p>
				<div class="clip">
					<p class="text" class:clamp3={!more} use:overflows={(c) => (clamped = c)}>{@render words(tokens(post.text, true))}</p>
					{#if !more && clamped}<button class="more yt-more" onclick={() => (more = true)}>…more</button>{/if}
				</div>
				{#if more}<button class="more" onclick={() => (more = false)}>Show less</button>{/if}
			</div>
		</article>
	{:else if xArticle}
		<!-- an X Article, in X's reader: the author, the cover (if it has one), the big title, the body from its Markdown,
		     cut after about eight lines until "Read more" -->
		<article class="xa">
			<p class="x-who xa-who">
				<span class="av">SA</span>
				<span class="who"><b>{NAME}</b><small>@{HANDLE} · {day}</small></span>
				<span class="grow"></span>
				<span class="xa-tag">Article</span>
			</p>
			{#if poster}<div class="media xa-cover" style:aspect-ratio={ratio(files.thumbnail?.aspect ?? '5:2')}><img src={poster} alt="" /></div>{/if}
			<h4 class="xa-title">{post.title ?? '(no title)'}</h4>
			<div class="xa-body" class:shut={!more} use:overflows={(c) => (clamped = c)}>{@html articleHtml}</div>
			{#if more}
				<button class="more xa-more" onclick={() => (more = false)}>Show less</button>
			{:else if clamped}
				<button class="more xa-more" onclick={() => (more = true)}>Read more</button>
			{/if}
			<div class="x-acts">
				<span>{@render icon('comment')}</span><span>{@render icon('repost')}</span><span>{@render icon('heart')}</span><span>{@render icon('views')}</span>
				<span>{@render icon('bookmark')}{@render icon('share')}</span>
			</div>
		</article>
	{:else if post.platform === 'x'}
		<!-- an X post, or a thread of them joined by a line: avatar, name and handle, the words as written, the film or
		     picture on the first; each tweet counted against 280 -->
		<div class="x" class:thread={tweets.length > 1}>
			{#each tweets as t, i (i)}
				{@const n = xLength(t)}
				<article class="tw">
					<div class="tw-side">
						<span class="av">SA</span>
						{#if i < tweets.length - 1}<i class="tw-line"></i>{/if}
					</div>
					<div class="x-body">
						<p class="x-who"><b>{NAME}</b> <span>@{HANDLE} · {day}</span></p>
						<p class="text">{@render words(tokens(t))}</p>
						{#if i === 0}{@render media(post.aspect ?? '16:9')}{/if}
						<div class="x-acts">
							<span>{@render icon('comment')}</span><span>{@render icon('repost')}</span><span>{@render icon('heart')}</span><span>{@render icon('views')}</span>
							{#if tweets.length > 1}<small class="tw-count" class:over={n > 280}>{i + 1}/{tweets.length} · {n} / 280</small>{:else}<span>{@render icon('bookmark')}{@render icon('share')}</span>{/if}
						</div>
					</div>
				</article>
			{/each}
		</div>
	{:else if post.platform === 'linkedin'}
		<!-- a LinkedIn feed card: author, three lines and "…see more", the film, the actions -->
		<article class="li">
			<header>
				<span class="av">SA</span>
				<span class="who"><b>{NAME}</b><small>Building maiaCITY</small><small>{day} · ◍</small></span>
				<span class="grow"></span>
				<span class="li-follow">+ Follow</span>
			</header>
			<div class="clip li-clip">
				<p class="text" class:clamp3={!more} use:overflows={(c) => (clamped = c)}>{@render words(tokens(post.text))}</p>
				{#if !more && clamped}<button class="more li-more" onclick={() => (more = true)}>…see more</button>{/if}
			</div>
			{@render media(post.aspect ?? '16:9')}
			<footer>
				<span>{@render icon('up')} Like</span><span>{@render icon('comment')} Comment</span><span>{@render icon('repost')} Repost</span><span>{@render icon('send')} Send</span>
			</footer>
		</article>
	{:else if feed}
		<!-- an Instagram feed post: the account row, the square film, the actions, the likes, the caption under its name -->
		{@const cap = collapsed(post.text, 96)}
		<article class="ig">
			<header>
				<span class="av ring">SA</span>
				<b>{HANDLE}</b>
				<span class="grow"></span>
				{@render icon('dots')}
			</header>
			<div class="media ig-media" style:aspect-ratio={ratio(post.aspect ?? '1:1')}>
				{@render looped(false)}
			</div>
			<div class="ig-acts">
				{@render icon('heart')}{@render icon('comment')}{@render icon('send')}<span class="grow"></span>{@render icon('bookmark')}
			</div>
			<p class="ig-likes">Be the first to like this</p>
			{#if more}
				<p class="ig-cap full"><b>{HANDLE}</b> {@render words(tokens(post.text))}</p>
				<button class="more ig-less" onclick={() => (more = false)}>less</button>
			{:else}
				<p class="ig-cap"><b>{HANDLE}</b> {@render words(tokens(cap.text))}{#if cap.cut}<button class="more" onclick={() => (more = true)}>… more</button>{/if}</p>
			{/if}
			<p class="ig-date">{longDay}</p>
		</article>
	{:else if reel}
		<!-- a Reel: the vertical film full screen, the caption clear of the bottom 15% and the rail -->
		{@const cap = collapsed(post.text, 58)}
		<div class="phone">
			<div class="screen" style:aspect-ratio="9 / 16">
				{@render looped(post.aspect !== '9:16')}

				<div class="top"><b>Reels</b></div>

				<div class="rail">
					<span>{@render icon('heart')}<small>0</small></span>
					<span>{@render icon('comment')}<small>0</small></span>
					<span>{@render icon('repost')}<small>0</small></span>
					<span>{@render icon('send')}<small>0</small></span>
					<span>{@render icon('dots')}</span>
					<span class="sq"></span>
				</div>

				<div class="cap" class:open={more}>
					<p class="acct"><span class="av sm">SA</span><b>{HANDLE}</b><span class="follow">Follow</span></p>
					{#if more}
						<p class="words full">{@render words(tokens(post.text))}</p>
						<button class="more" onclick={() => (more = false)}>less</button>
					{:else}
						<p class="words">{@render words(tokens(cap.text))}{#if cap.cut}<button class="more" onclick={() => (more = true)}>… more</button>{/if}</p>
					{/if}
					<p class="audio">{@render icon('music')} {HANDLE} · Original audio</p>
				</div>

				<div class="tabbar"><i></i><i></i><i class="plus"></i><i></i><i></i></div>

				{#if safe}
					<div class="safe s-top"></div>
					<div class="safe s-bottom"></div>
					<div class="safe s-rail"></div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- what goes up, and whether it fits -->
	<div class="facts">
		<p class="counts">
			{#each counts as c (c.label)}
				<span class:over={c.n > c.max}>{c.label} <b>{c.n.toLocaleString()} / {c.max.toLocaleString()}</b></span>
			{/each}
			{#if reel}<button class="quiet" class:on={safe} onclick={() => (safe = !safe)}>{safe ? 'Hide' : 'Show'} safe zones</button>{/if}
		</p>
		{#if journal}
			<p>About {journal.minutes} min to read{#if post.title && journal.title !== post.title} · published as “{post.title}”{/if}</p>
		{:else if files.video && moving}
			<p>
				Uploads <a href={raw(files.video.hash)} target="_blank" rel="noopener">{files.video.cut ? `${files.video.cut} · ` : ''}{files.video.format} · {files.video.width}×{files.video.height} · {files.video.codec} · {size(files.video.bytes)} · {mmss(files.video.seconds)} ↗</a>
				{#if files.thumbnail}with <a href={raw(files.thumbnail.hash)} target="_blank" rel="noopener">thumbnail {files.thumbnail.width}×{files.thumbnail.height} ↗</a>{/if}
			</p>
		{:else if moving}
			<p class="warn">No {post.aspect ?? ''} {post.codec ?? ''} video has been delivered for this post yet.</p>
		{:else if files.thumbnail}
			<p>Goes out with <a href={raw(files.thumbnail.hash)} target="_blank" rel="noopener">picture {files.thumbnail.width}×{files.thumbnail.height} ↗</a></p>
		{/if}
		{#if post.note}<p class="warn">{post.note}</p>{/if}
		{#if chapterWarning}<p class="warn">{chapterWarning}</p>{/if}
		{#if shortWarning}<p class="warn">{shortWarning}</p>{/if}
	</div>
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		min-width: 0;
	}

	/* ── shared pieces ── */
	svg {
		width: 1.15em;
		height: 1.15em;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		vertical-align: -0.2em;
	}

	.go svg {
		fill: currentColor;
		stroke: none;
	}

	.av {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 50%;
		background: #c9d6cc;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--ink);
	}

	.who {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}

	.who small {
		font-size: 0.72rem;
		color: #606060;
	}

	.grow {
		flex: 1;
	}

	.text {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.clamp3 {
		display: -webkit-box;
		overflow: hidden;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
	}

	.clip {
		position: relative;
	}

	.lnk {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: #065fd4;
		text-decoration: none;
		cursor: pointer;
	}

	button.lnk:hover,
	a.lnk:hover {
		text-decoration: underline;
	}

	.more {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.86rem;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
	}

	.media {
		position: relative;
		overflow: hidden;
		border-radius: 12px;
		background: #111;
	}

	.media video,
	.media img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.poster {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		cursor: pointer;
	}

	.poster:disabled {
		cursor: default;
	}

	.poster .go {
		display: grid;
		place-items: center;
		width: 3.4rem;
		height: 2.4rem;
		border-radius: 12px;
		background: rgb(20 20 20 / 0.75);
		color: #fff;
		font-size: 1.2rem;
	}

	.dur {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		padding: 0.05rem 0.3rem;
		border-radius: 4px;
		background: rgb(0 0 0 / 0.8);
		font-size: 0.72rem;
		font-weight: 500;
		color: #fff;
	}

	/* the tap-to-play layer of the feed and the Reels */
	.tap {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		color: #fff;
		cursor: pointer;
	}

	.tap .go {
		font-size: 2.6rem;
		opacity: 0.8;
		filter: drop-shadow(0 1px 4px rgb(0 0 0 / 0.5));
	}

	/* ── YouTube ── */
	.yt {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.8rem;
		border-radius: 14px;
		background: #fff;
		color: #0f0f0f;
	}

	.yt-title {
		display: -webkit-box;
		overflow: hidden;
		margin: 0.2rem 0 0;
		font-family: var(--font-body);
		font-size: 1.08rem;
		font-weight: 700;
		line-height: 1.35;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.yt-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.86rem;
	}

	.yt-sub {
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		background: #0f0f0f;
		font-size: 0.8rem;
		font-weight: 600;
		color: #fff;
	}

	.yt-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		background: #f2f2f2;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.yt-pill i {
		width: 1px;
		height: 1.1rem;
		background: #ccc;
	}

	.yt-desc {
		padding: 0.7rem 0.8rem;
		border-radius: 12px;
		background: #f2f2f2;
	}

	.yt-stats {
		margin: 0 0 0.2rem;
		font-size: 0.84rem;
		font-weight: 600;
	}

	.yt-more {
		position: absolute;
		right: 0;
		bottom: 0;
		padding-left: 2rem;
		background: linear-gradient(to right, transparent, #f2f2f2 1.6rem);
	}

	/* ── X Article: the long read ── */
	.xa {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 0.9rem 1rem;
		border: 1px solid #eff3f4;
		border-radius: 14px;
		background: #fff;
		color: #0f1419;
	}

	.xa-who {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.xa-who small {
		font-size: 0.82rem;
		color: #536471;
	}

	.xa-tag {
		padding: 0.1rem 0.55rem;
		border: 1px solid #cfd9de;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 600;
		color: #536471;
	}

	.xa-cover {
		border-radius: 16px;
	}

	.xa-cover img {
		object-fit: cover;
	}

	.xa-title {
		margin: 0.1rem 0 0;
		font-family: var(--font-body);
		font-size: 1.6rem;
		font-weight: 800;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	.xa-body {
		font-size: 0.95rem;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	/* about eight lines, fading out */
	.xa-body.shut {
		max-height: calc(0.95rem * 1.55 * 8);
		overflow: hidden;
		mask-image: linear-gradient(to bottom, #000 70%, transparent);
	}

	.xa-body :global(:is(p, ul, ol, blockquote, figure)) {
		margin: 0 0 0.8em;
	}

	.xa-body :global(:is(h1, h2, h3, h4)) {
		margin: 1em 0 0.4em;
		font-family: var(--font-body);
		font-weight: 800;
		line-height: 1.25;
	}

	.xa-body :global(:is(h1, h2)) {
		font-size: 1.25rem;
	}

	.xa-body :global(:is(h3, h4)) {
		font-size: 1.05rem;
	}

	.xa-body > :global(:first-child) {
		margin-top: 0;
	}

	.xa-body :global(blockquote) {
		padding-left: 0.8rem;
		border-left: 3px solid #cfd9de;
		color: #536471;
	}

	.xa-body :global(img) {
		display: block;
		max-width: 100%;
		border-radius: 12px;
	}

	.xa-body :global(figcaption) {
		font-size: 0.8rem;
		color: #536471;
	}

	.xa-body :global(a) {
		color: #1d9bf0;
		text-decoration: none;
	}

	.xa-more {
		align-self: flex-start;
		font-size: 0.9rem;
		color: #1d9bf0;
	}

	/* ── our journal ── */
	.jr {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.2rem 1.3rem 1rem;
		border-radius: 14px;
		background: var(--cream);
		color: var(--ink);
	}

	.jr-eyebrow {
		margin: 0;
		font-size: 0.66rem;
		font-weight: 500;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.jr-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.45rem;
		font-weight: 500;
		line-height: 1.15;
	}

	.jr-sub {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}

	.jr-cover {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 12px;
		object-fit: cover;
		object-position: center top; /* a title set into the cover sits at the top: never crop it away */
	}

	.jr-body {
		font-size: 0.92rem;
		line-height: 1.65;
	}

	.jr-body :global(p) {
		margin: 0 0 0.8em;
	}

	.jr-body :global(a) {
		color: inherit;
		text-decoration-color: var(--mustard);
	}

	.jr-more {
		margin: 0;
		font-size: 0.86rem;
		font-weight: 600;
		color: var(--terracotta);
	}

	/* ── X: one post, or a thread of them ── */
	.x {
		display: flex;
		flex-direction: column;
		padding: 0.9rem 1rem;
		border: 1px solid #eff3f4;
		border-radius: 14px;
		background: #fff;
		color: #0f1419;
	}

	.tw {
		display: flex;
		gap: 0.7rem;
	}

	.tw + .tw {
		padding-top: 0.3rem;
	}

	.tw-side {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	/* the line that joins a thread's tweets */
	.tw-line {
		flex: 1;
		width: 2px;
		min-height: 1rem;
		background: #cfd9de;
	}

	.thread .x-acts {
		padding-bottom: 0.6rem;
	}

	.tw-count {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: #536471;
	}

	.tw-count.over {
		font-weight: 600;
		color: #9c3b26;
	}

	.x-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.55rem;
		min-width: 0;
	}

	.x-who {
		margin: 0;
		font-size: 0.9rem;
	}

	.x-who span {
		color: #536471;
	}

	.x .text {
		font-size: 0.93rem;
	}

	.x .lnk {
		color: #1d9bf0;
	}

	.x .media {
		border: 1px solid #cfd9de;
		border-radius: 16px;
	}

	.x .poster .go {
		width: 3.2rem;
		height: 3.2rem;
		border-radius: 50%;
		background: #1d9bf0;
	}

	.x-acts {
		display: flex;
		justify-content: space-between;
		color: #536471;
	}

	.x-acts span:last-child {
		display: flex;
		gap: 0.8rem;
	}

	/* ── LinkedIn ── */
	.li {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-top: 0.8rem;
		border: 1px solid #e0dfdc;
		border-radius: 10px;
		background: #fff;
		color: rgb(0 0 0 / 0.9);
	}

	.li header,
	.li-clip {
		padding-inline: 0.9rem;
	}

	.li header {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		font-size: 0.86rem;
	}

	.li-follow {
		font-size: 0.86rem;
		font-weight: 600;
		color: #0a66c2;
	}

	.li .lnk {
		font-weight: 600;
		color: #0a66c2;
	}

	.li-more {
		position: absolute;
		right: 0.9rem;
		bottom: 0;
		padding-left: 2rem;
		font-weight: 400;
		color: #666;
		background: linear-gradient(to right, transparent, #fff 1.6rem);
	}

	.li .media {
		border-radius: 0;
	}

	.li .poster .go {
		width: 3.2rem;
		height: 3.2rem;
		border-radius: 50%;
		background: rgb(0 0 0 / 0.6);
		box-shadow: 0 0 0 2px #fff;
	}

	.li footer {
		display: flex;
		justify-content: space-around;
		padding: 0 0.4rem 0.6rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #666;
	}

	/* ── Instagram, in the feed ── */
	.ig {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		width: min(22rem, 100%);
		align-self: center;
		padding-bottom: 0.7rem;
		border: 1px solid #dbdbdb;
		border-radius: 10px;
		background: #fff;
		font-size: 0.84rem;
		line-height: 1.4;
		color: #0c1014;
	}

	.ig header {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.55rem 0.7rem 0.1rem;
	}

	.ig .av.ring {
		width: 2rem;
		height: 2rem;
		font-size: 0.65rem;
		box-shadow:
			0 0 0 2px #fff,
			0 0 0 3.5px #d6a14c;
	}

	.ig-media {
		border-radius: 0;
		background: #000;
	}

	.ig-media video,
	.ig-media img {
		object-fit: cover;
	}

	.ig-acts {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding-inline: 0.75rem;
	}

	.ig-acts svg {
		width: 1.45rem;
		height: 1.45rem;
	}

	.ig p {
		margin: 0;
		padding-inline: 0.75rem;
	}

	.ig-likes {
		font-weight: 600;
	}

	.ig-cap {
		overflow-wrap: anywhere;
	}

	.ig-cap.full {
		white-space: pre-wrap;
	}

	.ig-cap .more,
	.ig-less {
		margin-left: 0.2rem;
		font-size: 0.84rem;
		font-weight: 400;
		color: #737373;
	}

	.ig-less {
		align-self: flex-start;
		margin-left: 0.75rem;
	}

	.ig .lnk {
		color: #00376b;
	}

	.ig-date {
		font-size: 0.66rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #737373;
	}

	/* ── Instagram, in the Reels: the phone ── */
	.phone {
		align-self: center;
		width: min(17.5rem, 100%);
		padding: 0.45rem;
		border-radius: 2rem;
		background: #111;
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.25);
	}

	.screen {
		position: relative;
		overflow: hidden;
		border-radius: 1.6rem;
		background: #000;
		font-size: 0.78rem;
		line-height: 1.35;
		color: #fff;
	}

	.screen video,
	.screen img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.screen video.fit {
		object-fit: contain;
	}

	.top,
	.rail,
	.cap,
	.tabbar {
		position: absolute;
		text-shadow: 0 1px 3px rgb(0 0 0 / 0.55);
	}

	/* the overlays are not in the way of a tap on the film, except their own buttons */
	.top,
	.rail,
	.tabbar,
	.cap:not(.open) {
		pointer-events: none;
	}

	.cap button {
		pointer-events: auto;
	}

	.top {
		top: 4%;
		right: 0;
		left: 5%;
		font-size: 0.85rem;
	}

	.rail {
		right: 2.5%;
		bottom: 15%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		width: 14%;
	}

	.rail > span {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
	}

	.rail svg {
		width: 1.55rem;
		height: 1.55rem;
		filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.5));
	}

	.rail small {
		font-size: 0.62rem;
	}

	.sq {
		width: 1.8rem;
		height: 1.8rem;
		border: 2px solid #fff;
		border-radius: 6px;
		background: #c9d6cc;
	}

	.cap {
		right: 18%;
		bottom: 15%;
		left: 4%;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.cap.open {
		top: 30%;
		overflow: auto;
		padding: 0.6rem;
		margin: -0.6rem;
		border-radius: 10px;
		background: rgb(0 0 0 / 0.6);
	}

	.cap p {
		margin: 0;
	}

	.acct {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.acct .av.sm {
		width: 1.6rem;
		height: 1.6rem;
		font-size: 0.6rem;
		text-shadow: none;
	}

	.follow {
		padding: 0.1rem 0.5rem;
		border: 1px solid rgb(255 255 255 / 0.8);
		border-radius: 7px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.words {
		white-space: normal;
		overflow-wrap: anywhere;
	}

	.words.full {
		white-space: pre-wrap;
	}

	.screen .lnk {
		font-weight: 600;
		color: #fff;
	}

	.screen .more {
		margin-left: 0.2rem;
		font-size: 0.78rem;
		color: rgb(255 255 255 / 0.75);
	}

	.audio {
		overflow: hidden;
		font-size: 0.72rem;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.audio svg {
		width: 0.9rem;
		height: 0.9rem;
	}

	.tabbar {
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		justify-content: space-around;
		align-items: center;
		height: 7%;
		background: #000;
	}

	.tabbar i {
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid rgb(255 255 255 / 0.8);
		border-radius: 5px;
	}

	.tabbar i.plus {
		width: 1.9rem;
		border-radius: 7px;
		background: #fff;
	}

	/* ── a YouTube Short: the same phone, YouTube's overlays ── */
	.screen.letterbox img {
		object-fit: contain;
	}

	.yts-top {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		right: 5%;
		font-size: 1rem;
	}

	.yts-top svg {
		width: 1.2rem;
		height: 1.2rem;
	}

	.yts .rail small {
		font-size: 0.6rem;
	}

	.yts-sub {
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: #fff;
		font-size: 0.7rem;
		font-weight: 600;
		color: #0f0f0f;
		text-shadow: none;
	}

	.yts-title {
		display: -webkit-box;
		overflow: hidden;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		padding-right: 2.6rem;
	}

	.yts-more {
		position: absolute;
		right: 0;
		bottom: 0;
	}

	/* where the platform's own buttons and words sit: nothing important of the film belongs here */
	.safe {
		position: absolute;
		pointer-events: none;
		background: repeating-linear-gradient(135deg, rgb(239 181 77 / 0.45) 0 6px, rgb(239 181 77 / 0.15) 6px 12px);
		outline: 1px dashed var(--mustard);
	}

	.s-top {
		top: 0;
		right: 0;
		left: 0;
		height: 10%;
	}

	.s-bottom {
		right: 0;
		bottom: 0;
		left: 0;
		height: 15%;
	}

	.s-rail {
		top: 35%;
		right: 0;
		bottom: 15%;
		width: 17%;
	}

	/* ── what goes up ── */
	.facts {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.78rem;
		color: var(--ink-soft);
	}

	.facts p {
		margin: 0;
	}

	.facts a {
		color: var(--ink);
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 1rem;
	}

	.counts b {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.counts .over,
	.counts .over b {
		color: #9c3b26;
	}

	.counts .quiet {
		margin-left: auto;
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.72rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.counts .quiet.on {
		border-color: var(--mustard);
		background: #f3e3c1;
	}

	.warn {
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--mustard);
		border-radius: 6px;
		background: #f7ecd2;
		color: #6b4a12;
	}

	.warn::before {
		content: '⚠ ';
	}
</style>
