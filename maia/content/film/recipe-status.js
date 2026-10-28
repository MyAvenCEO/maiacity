/** Match the normal world's recipe gate: catalog failure blocks mounting;
 * individual missing recipes are reported by the asset that actually needs them. */
/** @param {{ phase: string, error?: string, waiting?: number }} state */
export function recipeStatus(state) {
 if (state.phase === 'failed') return { error: state.error || 'The asset recipes could not load', label: '' };
 if (state.phase === 'ready') return { error: '', label: '' };
 return { error: '', label: state.waiting ? 'Waiting for recipes to sync into local avenDB…' : 'Reading local asset recipes…' };
}
