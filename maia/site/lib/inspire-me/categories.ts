import type { SourceType } from './types';

export interface Category {
	id: string;
	label: string;
	color: string;
	blurb: string;
}

// Blueprint pillars, ordered roughly from physical infrastructure to society to the self.
// Add new ones freely when a source doesn't fit — and list them in inspire-me/FORMAT.md.
export const categories: Category[] = [
	{ id: 'energy', label: 'Energy', color: '#efb54d', blurb: 'Generation, storage, grids, efficiency' },
	{ id: 'water', label: 'Water', color: '#86c5c9', blurb: 'Sourcing, cycles, sanitation' },
	{ id: 'food', label: 'Food', color: '#a8b88a', blurb: 'Growing, nutrition, kitchens, soil' },
	{ id: 'health', label: 'Health', color: '#e6a58c', blurb: 'Body, medicine, longevity, care' },
	{ id: 'housing', label: 'Housing', color: '#ead2ac', blurb: 'Homes, shelter, living space, affordability' },
	{ id: 'architecture', label: 'Architecture', color: '#c49a6c', blurb: 'Design, building materials, construction' },
	{ id: 'ecology', label: 'Ecology', color: '#86ad83', blurb: 'Land, regeneration, biodiversity, climate' },
	{ id: 'transport', label: 'Transport', color: '#8fbcc0', blurb: 'Moving people: mobility, vehicles, streets' },
	{ id: 'logistics', label: 'Logistics', color: '#d2d8c7', blurb: 'Moving goods: supply chains, storage, delivery' },
	{ id: 'internet', label: 'Internet', color: '#9fb8d9', blurb: 'Connectivity, networks, protocols' },
	{ id: 'ai', label: 'AI', color: '#b9b3d6', blurb: 'Models, agents, automation, tools' },
	{ id: 'code', label: 'Code', color: '#a9c3b5', blurb: 'Software, protocols, open source, tooling' },
	{ id: 'game', label: 'The Game', color: '#b99ada', blurb: 'avenCITY: building the city in game first' },
	{ id: 'privacy', label: 'Privacy', color: '#a7b2ae', blurb: 'Identity, data sovereignty, security' },
	{ id: 'money', label: 'Money', color: '#d3c67f', blurb: 'Currency, value, finance' },
	{ id: 'coop', label: 'Co-op', color: '#d9a5b3', blurb: 'Governance, shared ownership, co-ops, DAOs' },
	{ id: 'civic', label: 'Civic', color: '#c2b49b', blurb: 'Law, rights, citizenship, residency' },
	{ id: 'education', label: 'Education', color: '#e8d27f', blurb: 'Learning, skills, schools' },
	{ id: 'filmmaking', label: 'Film making', color: '#d4a8c7', blurb: 'Cameras, editing, captions, publishing' },
	{ id: 'self', label: 'Self', color: '#f0c4b0', blurb: 'Mind, spirit, belief, passion, purpose' }
];

const byId = new Map(categories.map((c) => [c.id, c]));

export function categoryById(id: string): Category {
	return byId.get(id) ?? { id, label: id, color: '#dcd5c4', blurb: '' };
}

const typeLabels: Record<SourceType, string> = {
	video: 'Video',
	podcast: 'Podcast',
	paper: 'Paper',
	article: 'Article',
	post: 'Post',
	thread: 'Thread',
	report: 'Report',
	book: 'Book'
};

export function typeLabel(type: SourceType): string {
	return typeLabels[type] ?? type;
}

export function sourceLabel(type: SourceType): string {
	return type === 'video' || type === 'podcast' ? 'Transcript' : 'Full text';
}
