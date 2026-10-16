// @ts-nocheck — plain JS, runs inside the box before anything else
// The box's second lock is the shell's (../../sandbox/lockdown.js): the same for every worker we start for code we
// cannot trust.
import '../../sandbox/lockdown.js';
