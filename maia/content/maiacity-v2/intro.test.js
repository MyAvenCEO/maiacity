// @ts-nocheck — explicit per-version contract data.
import { introContract } from '../maiacity-testing/intro.js';
import * as intro from './intro.js';
introContract('maiacity-v2', import.meta.dir, intro, {
 plants: { A:'apple', B:'pear', C:'cherry' },
 moves: seat => ['mint','invest',...(seat === 'C' ? ['collectShelter'] : []),'invest',...(seat === 'C' ? ['settleShelter'] : []),'mark','seedling','plant']
});
