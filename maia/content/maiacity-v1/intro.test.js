// @ts-nocheck — explicit per-version contract data.
import { introContract } from '../maiacity-testing/intro.js';
import * as intro from './intro.js';
introContract('maiacity-v1', import.meta.dir, intro, {
 plants: { A:'apple', B:'pear' },
 moves: seat => ['mint','invest','invest','invest','mark','seedling','plant']
});
