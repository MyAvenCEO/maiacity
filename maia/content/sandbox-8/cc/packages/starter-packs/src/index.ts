/**
 * @cc/starter-packs: what the players start with (decision 0011): people, machines, stock and
 * capital. A world definition names one; the region and its economy decide what it costs to go on.
 */
import { camper } from './camper.ts';
import { contractor } from './contractor.ts';
import { forestFriends } from './forest-friends.ts';
import { homesteaders } from './homesteaders.ts';
import { lindemann } from './lindemann.ts';
import { smallContractor } from './small-contractor.ts';

export { camper, contractor, forestFriends, homesteaders, lindemann, smallContractor };

/** starter pack id → what it brings, in the order the world definition names them (the first is the seat) */
export const starterPacks: Record<string, Record<string, unknown>> = { contractor, smallContractor, camper, lindemann, homesteaders, forestFriends };
