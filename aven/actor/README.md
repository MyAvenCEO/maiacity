# aven/actor

avenACTORS: the actor engine, where an actor is a definition with its own Doc that changes its state only by handling
one message at a time, in pure turns, under caps. It holds the Lean model, `Aven.Actor`, and the version 1 design and
its decisions; the actors' runtimes are built in [`aven/runtimes`](../runtimes/README.md). It is its own package,
Rust only, with its own Cargo workspace, lockfile, Lean project and check; it depends on no storage backend, and the
repository's root workspace excludes it, as it excludes `aven/DB2`. "Actor" here means a software actor: the people
and animals of the worlds (`maia/content/actors`, the actor skill) are another thing with the same word.

Its architecture: [avenACTORS](../DB2/brain/actors/README.md)

## Build and test

In the box, from `aven/DB2`:

```
bun run box sh sandbox/vectors.sh --check   builds Aven.Actor with the other specs and checks its vectors
```

From `aven/actor/spec`:

```
lake build          proves every theorem
lake exe vectors    writes the kernel's traces into spec/vectors/
```

## Files

```
aven/actor/
  README.md          this file
  ARCHITECTURE.md    the version 1 design and its decisions (section 15)
  spec/              the Lean model, Aven.Actor, and the vectors it exports
```
