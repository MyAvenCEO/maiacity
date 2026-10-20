// The kinds of beat a story's journey is made of, each with its name, what it is for and its own colour (avenDB's
// Story Journey and Story Movie).
/** @typedef {import('$lib/studio/types.js').BeatType} BeatType */

/** @type {Record<BeatType, string>} */
export const BEAT_LABEL = {
	hook: 'Hook',
	context: 'Context',
	problem: 'Problem',
	intention: 'Intention',
	obstacle: 'Obstacle',
	low: 'Low',
	turn: 'Turn',
	solution: 'Solution',
	vision: 'Vision'
};

/** @type {Record<BeatType, string>} what a beat of that kind does (storyteller: arc.md, structure.md) */
export const BEAT_NOTE = {
	hook: 'The anchor and the promise: why stay',
	context: 'Who, where, what is at stake: plead the case',
	problem: 'The pain, in the viewer’s own life',
	intention: 'What we set out to do',
	obstacle: 'What gets in the way',
	low: 'The lowest point: it might not work',
	turn: 'The insight that changes the way',
	solution: 'How it was solved, shown working',
	vision: 'What it means, and the door to tomorrow'
};

/** @type {Record<BeatType, string>} each kind its colour, the same on every card and on the curve */
export const BEAT_COLOR = {
	hook: '#e39a2d',
	context: '#7fa37a',
	problem: '#d4683f',
	intention: '#4f86c6',
	obstacle: '#c44d3a',
	low: '#6d5a9e',
	turn: '#2a958d',
	solution: '#4a9a58',
	vision: '#3f9fd6'
};
