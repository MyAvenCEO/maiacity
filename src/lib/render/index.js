/*
 * THE RENDERER — one core and its purpose renderers (plan C5). A page mounts one purpose renderer; none makes a
 * WebGLRenderer, OrbitControls or EffectComposer itself (./lint.test.js).
 *
 *   ./core.js     createRenderer, lowPower, topPixelRatio, adaptiveResolution, precompile, fitTo, disposeObject,
 *                 disposeRenderer, createControls, materialCache
 *   ./post.js     createPost: the one post stack; createComposer: the one EffectComposer (the Factories' too)
 *   ./world.js    createWorldRenderer (the sandbox kit's createStage), worldRenderer: worlds
 *   ./stage.js    createStageRenderer: asset viewers (the paper studio on top: ../assets/stage.js)
 *   ./preview.js  picture: one frame on demand, offscreen
 *   ./film.js     the film camera's hold on a world (filmDraws, worldTime, filmHoldsSize; the darkroom)
 *   ./diagram.js  createDiagram: explainers' figures (theOS)
 *
 * Each is imported by its own path, so a page loads only what it draws with.
 */
export * from './core.js';
