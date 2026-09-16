// Sets a Stream video's thumbnail to one of our own images, so Bunny's player
// opens on the post's banner instead of a frame it picked from the middle.
//   node scripts/bunny-thumbnail.mjs <videoId> <public image url>
import { NAMES, api, videoApi } from './bunny.mjs';

const [videoId, imageUrl] = process.argv.slice(2);
if (!videoId || !imageUrl) {
	console.error('usage: node scripts/bunny-thumbnail.mjs <videoId> <public image url>');
	process.exit(1);
}

const { Items } = await api('/videolibrary?page=1&perPage=100');
const library = Items.find((l) => l.Name === NAMES.streamLibrary);
if (!library) throw new Error(`stream library ${NAMES.streamLibrary} not found`);

const result = await videoApi(
	`/library/${library.Id}/videos/${videoId}/thumbnail?thumbnailUrl=${encodeURIComponent(imageUrl)}`,
	{ method: 'POST', accessKey: library.ApiKey }
);
console.log(`thumbnail set for ${videoId}:`, result?.message ?? result);
