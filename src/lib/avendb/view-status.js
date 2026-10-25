/** Current mounted read observations only; never authoritative manifest completeness. */
/** @param {{total:number,local:number,pending:number}} reads @param {{reading:number,waiting:number}} files */
export function viewStatus(reads, files) {
 if (files.waiting > 0) return { label: `Waiting for ${files.waiting} files`, state: 'waiting' };
 if (files.reading > 0) return { label: `Loading ${files.reading} files`, state: 'loading' };
 if (reads.pending > 0) return { label: 'Loading this view', state: 'loading' };
 if (reads.total > reads.local) return { label: 'Local view unavailable', state: 'unavailable' };
 if (reads.total > 0 && reads.local === reads.total) return { label: 'Local view loaded', state: 'local' };
 return { label: 'View completeness unknown', state: 'unknown' };
}
