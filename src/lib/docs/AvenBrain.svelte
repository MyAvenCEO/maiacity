<script>
	// avenBRAIN's architecture, as a page: on the site (/docs/avenbrain/) with its contents on the left, and in avenDB's
	// Docs view as the avenBRAIN doc's page (`embedded`), where the view's right side gives its outline instead and the
	// page around it scrolls. A design, Samuel 2026-10-20: nothing of it is built yet, and the page says so.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';

	let { embedded = false } = $props();

	// the page's own contents, one link per section
	const contents = /** @type {[string, [string, string][]][]} */ ([
		[
			'What it is',
			[
				['promises', 'Promises'],
				['origin', 'From harness2'],
				['status', 'Status']
			]
		],
		[
			'The pieces',
			[
				['harness', 'A harness is entries'],
				['round', 'One round'],
				['lanes', 'Two editors, one composer'],
				['objectives', 'Measured in Lean'],
				['memory', 'Memory'],
				['schemas', 'Five schemas']
			]
		],
		[
			'How it runs',
			[
				['substrates', 'Any runtime'],
				['avenmaia', 'On avenMAIA'],
				['proofs', 'Budget and proofs'],
				['examples', 'Examples'],
				['roadmap', 'Roadmap']
			]
		]
	]);
	const ids = contents.flatMap(([, links]) => links.map(([id]) => id));

	/** The section being read: the last whose top has passed the top of the screen, or at the page's end the last in
	 *  view. */
	let current = $state(ids[0]);
	/** @type {HTMLElement | undefined} the contents, which scroll on their own */
	let toc = $state();

	onMount(() => {
		if (embedded) return;
		let frame = 0;
		const look = () => {
			frame = 0;
			const end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
			let now = ids[0];
			for (const id of ids) {
				const top = document.getElementById(id)?.getBoundingClientRect().top ?? Infinity;
				if (top <= 120 || (end && top < innerHeight)) now = id;
			}
			current = now;
		};
		const soon = () => (frame ||= requestAnimationFrame(look));
		look();
		addEventListener('scroll', soon, { passive: true });
		addEventListener('resize', soon);
		return () => {
			removeEventListener('scroll', soon);
			removeEventListener('resize', soon);
			cancelAnimationFrame(frame);
		};
	});

	// the link of the section being read stays in view in the contents, moving only them, never the page
	$effect(() => {
		const link = toc?.querySelector(`a[href="#${current}"]`);
		if (!toc || !link) return;
		const [box, at] = [toc.getBoundingClientRect(), link.getBoundingClientRect()];
		if (at.top < box.top || at.bottom > box.bottom) toc.scrollTop += at.top - box.top - (box.height - at.height) / 2;
		if (at.left < box.left || at.right > box.right) toc.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
	});

	// what avenBRAIN promises once it is built
	const promises = [
		{
			short: 'Your accept',
			q: 'Only a human accept reaches main.',
			a: 'avenBRAIN acts as a device of avenMAIA, with its Suggester and AIP author shares. It proposes, drafts, measures and promotes. Every skill, harness, deliverable and lesson it changes reaches main only when an owner of the vault accepts the AIP that holds it.'
		},
		{
			short: 'Any runtime',
			q: 'One harness runs on Claude Code, Codex or our own LLM API.',
			a: 'The runtime is a plug-in, a substrate. Each has its own living variant of the harness, so its caps and file shapes stay on its variant while it follows main.'
		},
		{
			short: 'Versioned',
			q: 'Every piece has a version, an author and a history.',
			a: 'Skills, harnesses, runs, traces and lessons are avenDB entries. Candidates are proposal lines, so a round never overwrites anything, and a bad adoption is undone with a restore.'
		},
		{
			short: 'Evidence',
			q: 'An edit stays only where a run shows why.',
			a: 'The composer keeps an edit only with a moment in a trajectory that explains it. A failure seen in one run of several is noise, and an edit aimed at it is overfitting.'
		},
		{
			short: 'Measured',
			q: 'Better means what a Lean objective says.',
			a: 'Every round lives on one AIP whose objective is a file of Lean metrics. Readings are signed writes, so who measured what, and when, is on record.'
		},
		{
			short: 'Memory',
			q: 'The library holds only lessons you have seen.',
			a: 'The reflector drafts at most one lesson per round inside its AIP. It joins the domain’s library when the AIP is accepted, and not before.'
		}
	];

	// harness2's parts and where each lives in avenBRAIN
	const ported = [
		['Harness tree, eight kinds of file', 'A harness entry: always-on text, links to skill entries and code entries, each pinned at a version'],
		['Skill folders, SKILL.md and its files', 'A skill entry: name, trigger, main text, and its other files as rows'],
		['Substrates and their surface specs', 'A Substrate in Rust, and a living variant of the harness per substrate'],
		['A benchmark’s task', 'A task entry: domain tag, prompt, pinned inputs, the entry its deliverable writes to, and its AIP'],
		['A rollout in a run folder', 'A run entry with its trace as a file by BLAKE3 hash; its deliverable is a proposal line, never main'],
		['The run fingerprint', 'The run’s key: BLAKE3 of the task pin, the harness pin, the substrate and the model'],
		['The context folder', 'The same context/ folder, built from entries the agent may read, with its leak checks'],
		['Two editors writing files', 'Two editors, each writing a proposal line on the harness and skill entries'],
		['Compose: a model writes one tree', 'Compose: a three-way merge of the editors’ lines into a compose line, clashes resolved by take'],
		['Blind selection', 'A blind pick of one final for the AIP; the vault’s owner is the last selector'],
		['The judge, after selection', 'The AIP’s Lean objective, evaluated per candidate'],
		['The budget ledger', 'A Lean theorem over the round, replayed by Rust, and a cap in USD and minutes'],
		['The domain library and EXPERIENCE.md', 'Lesson entries tagged by domain; the index is a query, never a file']
	];

	// the steps of one round
	const steps = [
		['Base runs', 'The current harness runs k times on the task. Each run is a run entry, its deliverable a proposal line on the target entry, its trace a file.'],
		['Context', 'For each editor, the engine writes a context/ folder: the task, every trace, the harness, earlier candidates, and the domain’s lessons.'],
		['Propose', 'Two editors edit the harness at the same time, each on its own proposal line: INV on how the agent works, DOM on what an expert knows.'],
		['Check', 'A proposal that leaves the harness’s shape, lacks a skill’s trigger, passes a size cap or does not compile gets one retry with the error. A second failure falls back to the harness it started from.'],
		['Probe', 'Each candidate runs once on the same task. Its deliverable is its own proposal line, so every candidate stays to compare.'],
		['Compose', 'The composer merges the editors’ lines into one line, keeps each edit a trajectory moment supports, or keeps the harness as it was.'],
		['Pick and propose', 'A blind selector picks one final. One AIP holds its deliverable line, the harness and skill lines, its readings and a lesson draft, and is promoted.'],
		['Accept and remember', 'An owner accepts, declines or revises the AIP. On accept the lines merge into main and the lesson joins the domain’s library.']
	];

	// the four layers of memory
	const layers = [
		['Always-on memory', 'Short facts true for every task of a domain, capped by the runtime', 'The agent, on every run', 'Fields of the harness entry'],
		['Skills', 'Know-how with a trigger, loaded when it fires', 'The agent, when the trigger fires', 'Skill entries the harness pins'],
		['Lessons', 'What each edit did, and at most one lesson per round: cue, lesson, evidence, confidence', 'The editors and the composer', 'Lesson entries tagged brain:domain:<domain>'],
		['Runs and traces', 'Every run’s trajectory, deliverable line, cost and readings', 'The editors of the next round', 'Run entries and their trace files']
	];

	// the five schemas avenDB is to ship for it
	const schemas = [
		['skill', 'name, description (its trigger), text, files as rows {id, name, text}'],
		['harness', 'title, domain, substrate, the always-on texts, links to skills and code entries pinned at versions'],
		['task', 'domain, prompt, inputs pinned at versions, the target entry, the AIP that measures it'],
		['run', 'task, harness pin, substrate, model, round and stage, delivered, cost, minutes, readings, trace file'],
		['lesson', 'domain, cue, lesson, evidence, confidence, edit rows {component, change, observed, verdict}, the harness and runs behind it']
	];

	// the substrates
	const substrates = [
		['Claude Code', 'Headless (claude -p), in a cloud session or on the Mac', 'CLAUDE.md, .claude/skills, scripts, subagents, hooks'],
		['Codex', 'codex exec, in a workspace of its own', 'AGENTS.md (8,000 characters at most), .agents/skills, hooks'],
		['Aven native', 'Our own loop in Rust over an LLM API, avenDB ops as its tools', 'The harness entry as it stands, read straight from avenDB']
	];

	// where the work stands
	const roadmap = [
		['B0', 'Decisions: where the code lives, schemas, who picks, which LLM API, budget, the skills’ source', 'Open'],
		['B1', 'Lean: Round.lean (both schedules, the 4k and 3k budget, the fallback) and the five schemas', 'Waits for the AIP objective stage to merge'],
		['B2', 'avenDB ships the five schemas; no new op, no wire change', 'Not started'],
		['B3', 'The skills become skill entries; a pinned harness is written into a workspace', 'Not started'],
		['B4', 'The engine in Rust, with harness2’s ledger demo as its test', 'Not started'],
		['B5', 'Substrates: Claude Code and Aven native; Codex later', 'Not started'],
		['B6', 'The store and the device agentBrain of avenMAIA', 'Not started'],
		['B7', 'A brain rule on the Jobs page: leases, keys, caps', 'Not started'],
		['B8', 'Pilot: one story-writing round', 'Not started'],
		['B9', 'Film editing rounds', 'Not started'],
		['B10', 'Assets and worlds rounds', 'Not started'],
		['B11', 'A Brain view in avenDB', 'Not started']
	];

	const objective = `import AvenDB.Objective
open AvenDB.Objective

/-- Every item of the editor's audit passes. -/
def audit : Metric := metric "Audit items passed" (atLeast (reading "audit_passed") 9)

/-- The visual hook lands within 3 seconds. -/
def hook : Metric := metric "Visual hook, s" (atMost (reading "hook_s") 3)

/-- The fine cut keeps a third to two-thirds of the assembly. -/
def kept : Metric := metric "Kept share of assembly"
  (between (reading "locked_s" / reading "assembly_s") 0.33 0.67)

def objective : List Metric := [audit, hook, kept]`;

	const layout = `avenbrain/                       its own Cargo workspace, beside avendb/
  NOTICE                         harness2's Apache 2.0 notice
  spec/AvenBrain/                Lean: Round.lean, RoundVectors.lean
  crates/avenbrain/              the engine: schedule, context, checks, ledger
  crates/avenbrain-substrate/    Claude Code, Codex, Aven native
  crates/avenbrain-store/        avenDB: a device of avenMAIA, ops through run(op)
  crates/avenbrain-cli/          the avenbrain binary: round, materialise, demo, check`;
</script>

<div class="docs" class:wrap={!embedded} class:embedded>
	{#if !embedded}<aside class="toc" bind:this={toc} aria-label="On this page">
		<p>On this page</p>
		<nav>
			{#each contents as [group, links] (group)}
				<span>{group}</span>
				{#each links as [id, name] (id)}
					<a href="#{id}" class:on={id === current} aria-current={id === current ? 'location' : undefined}>
						{name}
					</a>
				{/each}
			{/each}
		</nav>
	</aside>{/if}

	<svelte:element this={embedded ? 'div' : 'main'} class="page">
		{#if !embedded}<a class="back" href="{base}/docs">← Docs</a>{/if}

		<header class="intro">
			<p class="eyebrow">avenBRAIN&ensp;·&ensp;architecture&ensp;·&ensp;design of 20 October 2026</p>
			<h1>avenBRAIN Architecture</h1>
			<p class="lede">
				avenMAIA’s own harness, and the loop that makes it better. The skills, memory, guardrails, scripts and subagents an
				aven works with are entries in avenDB. Each real task runs them, tries edits on the same task, merges the edits that
				earned their place, and puts the result to a person as one proposal.
			</p>
		</header>

		<section id="promises">
			<p class="eyebrow">Promises</p>
			<h2>What avenBRAIN promises</h2>
			<p class="prose-col">
				A harness is everything around a model that makes it an agent. avenBRAIN never changes a model. It changes the
				harness, from evidence, and only through proposals a person accepts.
			</p>
			<div class="answers">
				{#each promises as x (x.q)}
					<div>
						<span class="short">{x.short}</span>
						<b>{x.q}</b>
						<p>{x.a}</p>
					</div>
				{/each}
			</div>
		</section>

		<section id="origin">
			<p class="eyebrow">From harness2</p>
			<h2>A port of Google Research’s harness2, made native</h2>
			<p class="prose-col">
				avenBRAIN takes its method from <a href="https://github.com/google-research/harness2">harness2</a>, Google
				Research’s framework for recursive agent harnessing (Apache 2.0, paper
				<a href="https://arxiv.org/abs/2610.14224">arXiv 2610.14224</a>). harness2 improves a frozen model’s harness in
				two loops. On one task, a Propose–Probe–Compose step proposes edits, runs them on the same task, and composes a
				better harness from how the runs differ. Across tasks, a library per domain keeps the harness that was adopted and
				the lessons the evidence supports, for the next task of that domain.
			</p>
			<p class="prose-col">
				harness2 keeps all of this as folders on disk. avenBRAIN keeps every piece as avenDB entries, lines and versions,
				so most of the method needs no new rule: proposals, merges, variants, AIPs, objectives and files already exist.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>In harness2</th><th>In avenBRAIN</th></tr>
					</thead>
					<tbody>
						{#each ported as [was, now] (was)}
							<tr><td><b>{was}</b></td><td>{now}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section id="status">
			<p class="eyebrow">Status</p>
			<h2>A design, not built yet</h2>
			<p class="prose-col">
				This page describes avenBRAIN as it is planned. No code of it exists yet, and avenDB ships none of its schemas.
				It builds on the AIP objective stage (idea, objective, proposed, archived), which is being built now. The
				<a href="#roadmap">roadmap</a> says what comes in which order, and what each step waits for.
			</p>
		</section>

		<section id="harness">
			<p class="eyebrow">The harness</p>
			<h2>A harness is entries</h2>
			<p class="prose-col">
				harness2 edits eight kinds of file: the system prompt, guardrails, memory, tool guidance, subagents, skills, scripts
				and plugins. In avenBRAIN they are fields and links of one harness entry. The always-on texts, which an agent reads
				on every run, are fields of it. Each skill is a skill entry of its own, and each script a code entry, and the
				harness links to each at a version. So a harness version names exactly which skill text and which script it ran
				with.
			</p>
			<p class="prose-col">
				A harness is written down into a workspace before it runs, as the runtime expects it: for Claude Code its
				CLAUDE.md and .claude/skills, for Codex its AGENTS.md and .agents/skills. The aven’s own runtime needs no files: it
				reads the harness from avenDB.
			</p>
		</section>

		<section id="round">
			<p class="eyebrow">One round</p>
			<h2>Run, propose, probe, compose, propose to a person</h2>
			<p class="prose-col">
				One round improves the harness on one task. Its budget k sets how many base runs, candidates and compositions it
				makes. Parallel rounds explore wider: k candidates per editor from the same evidence, then k compositions.
				Sequential rounds refine deeper: k passes, each editing the last one’s result and reading its run.
			</p>
			<figure>
				<div class="frame">
					<svg class="fig" viewBox="0 0 960 330" role="img" aria-label="One avenBRAIN round, from base runs to one AIP and a lesson">
						<path class="ctl" d="M180 107 H200 V57 H216" />
						<path class="ctl" d="M200 107 V157 H216" />
						<path class="ctl" d="M400 57 H420 V107 H436" />
						<path class="ctl" d="M400 157 H420 V107" />
						<path class="ctl" d="M600 107 H626" />
						<path class="ctl" d="M790 107 H811" />
						<path class="relay" d="M880 144 V268 H794" />
						<path class="relay" d="M440 268 H310 V198" />
						<polygon class="arrow" points="216,51 226,57 216,63" />
						<polygon class="arrow" points="216,151 226,157 216,163" />
						<polygon class="arrow" points="436,101 446,107 436,113" />
						<polygon class="arrow" points="626,101 636,107 626,113" />
						<polygon class="arrow" points="811,101 821,107 811,113" />
						<polygon class="arrow" points="804,262 794,268 804,274" />
						<polygon class="arrow" points="304,206 310,196 316,206" />
						<rect class="box" x="20" y="70" width="160" height="74" rx="10" />
						<text class="h" x="36" y="98">1  Base runs</text>
						<text class="s" x="36" y="118">the current harness,</text>
						<text class="s" x="36" y="134">k times on the task</text>
						<rect class="node" x="226" y="20" width="174" height="74" rx="10" />
						<text class="h" x="242" y="48">2  INV editor</text>
						<text class="s" x="242" y="68">how the agent works:</text>
						<text class="s" x="242" y="84">tools, scripts, checks</text>
						<rect class="node" x="226" y="120" width="174" height="74" rx="10" />
						<text class="h" x="242" y="148">2  DOM editor</text>
						<text class="s" x="242" y="168">what an expert knows:</text>
						<text class="s" x="242" y="184">skills, rules, checks</text>
						<rect class="box" x="446" y="70" width="154" height="74" rx="10" />
						<text class="h" x="462" y="98">3  Probe</text>
						<text class="s" x="462" y="118">each edit runs once,</text>
						<text class="s" x="462" y="134">on its own line</text>
						<rect class="box" x="636" y="70" width="154" height="74" rx="10" />
						<text class="h" x="652" y="98">4  Compose</text>
						<text class="s" x="652" y="118">merge the lines that</text>
						<text class="s" x="652" y="134">earned their place</text>
						<rect class="srv" x="821" y="70" width="124" height="74" rx="10" />
						<text class="h" x="835" y="98">5  One AIP</text>
						<text class="s" x="835" y="118">its readings;</text>
						<text class="s" x="835" y="134">you accept it</text>
						<rect class="seg" x="446" y="236" width="344" height="64" rx="10" />
						<text class="h" x="462" y="262">6  A lesson in the domain’s library</text>
						<text class="s" x="462" y="282">read by the editors of the next round</text>
						<text class="s" x="890" y="210">on accept</text>
						<text class="s" x="200" y="300">the next task in this domain</text>
					</svg>
				</div>
				<figcaption>
					One round on one task. Steps 1 to 5 improve the harness for this task; the dashed path is the second loop: what an
					accepted round learned is read by the next task of the same domain.
				</figcaption>
			</figure>
			<p class="swipe">Swipe the diagram sideways to see all of it.</p>
			<ul class="steps">
				{#each steps as [name, what] (name)}
					<li><b>{name}.</b> {what}</li>
				{/each}
			</ul>
		</section>

		<section id="lanes">
			<p class="eyebrow">Two editors, one composer</p>
			<h2>Each editor owns one kind of change</h2>
			<div class="cards">
				<div>
					<h3>INV: how the agent works</h3>
					<p>
						Procedure, tool use and finishing. It traces the workflow, fixes the first point where it went wrong, and picks
						the cheapest lever: a bounded fallback for a tool error, a script for a repeated mechanical step, a skill with a
						trigger for a narrow procedure, a check that reopens the deliverable after it is written.
					</p>
				</div>
				<div>
					<h3>DOM: what an expert knows</h3>
					<p>
						The deliverable, its audience, its required parts and the checks an expert makes, written as rules the agent
						can apply and check. Its default home is a skill with a trigger. It never invents a source, a standard or a
						fact.
					</p>
				</div>
				<div>
					<h3>The composer</h3>
					<p>
						It reads the base runs, every candidate and its run, and the editors’ notes. It may merge both lines, take one
						whole, or keep the harness as it was: keeping it is a real answer. Every decision is one line of notes with
						the evidence that decided it, such as “kept, the audit script: same-size pair in 2 of 2 base runs, gone in
						inv1”.
					</p>
				</div>
			</div>
			<p class="note prose-col">
				Compose is avenDB’s own merge: the editors’ lines merge into a compose line three ways, as a pull request merges,
				and a merge into a proposal needs no accept. Where both lines changed one place, the composer picks a side.
			</p>
		</section>

		<section id="objectives">
			<p class="eyebrow">Measured in Lean</p>
			<h2>An objective says what better means</h2>
			<p class="prose-col">
				harness2 refuses every score while it improves, because a benchmark’s grader could leak its answers. avenBRAIN’s
				metrics are a vault’s own targets, so it uses them, and keeps harness2’s care about who sees what. A round starts
				only from an AIP whose objective holds at least one metric, written in Lean against AvenDB.Objective.
			</p>
			<ul class="prose-col">
				<li>Each candidate keeps its own readings, and the objective is evaluated for each one alone.</li>
				<li>The final that goes into the AIP has its readings written on the AIP, where its reviewer reads them.</li>
				<li>The editors see the metrics’ names and goals, never a candidate’s readings. The composer and the selector see both.</li>
				<li>Work metrics measure the deliverable. Process metrics, such as delivered, cost and minutes, come from every run.</li>
				<li>Where it can, a trusted checker reads a metric from the deliverable itself, such as a cut’s own rows.</li>
			</ul>
			<figure>
				<pre><code>{objective}</code></pre>
				<figcaption>An objective for one film-editing round: the editor’s audit, the visual hook, and how much of the assembly the fine cut keeps.</figcaption>
			</figure>
		</section>

		<section id="memory">
			<p class="eyebrow">Memory</p>
			<h2>Four layers, from always loaded to raw evidence</h2>
			<p class="prose-col">
				Every memory is an entry, so each has a version, an author, a history and a review. The index of a domain’s
				library is a query of its lesson entries, newest first, each with its cue, written into the editors’ context as
				harness2 writes its INDEX.md.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Layer</th><th>What it holds</th><th>Who reads it</th><th>Where it lives</th></tr>
					</thead>
					<tbody>
						{#each layers as [layer, what, who, where] (layer)}
							<tr><td><b>{layer}</b></td><td>{what}</td><td>{who}</td><td>{where}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="prose-col">
				A lesson names the edit rows and runs it rests on. When a later round tries the same component, its verdicts join
				the lesson by proposal, so a lesson grows stronger or weaker with evidence. A lesson whose rows say only
				“confounded” reads as a guess, and a round may write no lesson at all.
			</p>
		</section>

		<section id="schemas">
			<p class="eyebrow">Five schemas</p>
			<h2>What avenDB is to hold for it</h2>
			<p class="prose-col">
				Five schemas, written in avenDB’s Lean model first and shipped like every built-in schema, so every app reads them
				offline. No new op and no change on the wire: avenBRAIN writes with create, propose, set, merge, variant and the
				AIP ops, as any agent does.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Type</th><th>Fields</th></tr>
					</thead>
					<tbody>
						{#each schemas as [type, fields] (type)}
							<tr><td><code>{type}</code></td><td>{fields}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section id="substrates">
			<p class="eyebrow">Any runtime</p>
			<h2>One harness, three runtimes</h2>
			<p class="prose-col">
				A substrate knows how to write a harness for its runtime, run it, and read its trajectory into one shared grammar of
				actions, observations and errors. The editors and the composer run on a channel of the same kind, so avenBRAIN
				needs no one vendor.
			</p>
			<div class="table">
				<table>
					<thead>
						<tr><th>Substrate</th><th>How it runs</th><th>What it reads of the harness</th></tr>
					</thead>
					<tbody>
						{#each substrates as [name, how, reads] (name)}
							<tr><td><b>{name}</b></td><td>{how}</td><td>{reads}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section id="avenmaia">
			<p class="eyebrow">On avenMAIA</p>
			<h2>A device of the aven, with its rights and no more</h2>
			<p class="prose-col">
				avenBRAIN is its own Rust workspace beside avenDB, reusable by any COOP’s aven. For Maia City it runs as
				agentBrain, a device of avenMAIA that an owner adds in The OS, as for every agent. It holds what avenMAIA holds:
				Suggester on Maia City and an AIP author share. So it proposes lines, drafts new entries, records readings and
				promotes AIPs, and merges nothing into main.
			</p>
			<p class="prose-col">
				Its runs are tasks on the Jobs page. Each has a lease and a key, the BLAKE3 of what it runs, so a round stopped
				halfway resumes without running a finished run again. A round has a cap in money and minutes, and runs where its
				work can: a cloud session for text, the Mac for renders.
			</p>
			<pre><code>{layout}</code></pre>
		</section>

		<section id="proofs">
			<p class="eyebrow">Budget and proofs</p>
			<h2>Every round spends exactly what its budget says</h2>
			<p class="prose-col">
				A round of budget k makes 4k runs (k base runs, 2k candidates, k finals) and 3k editor sessions (k INV, k DOM, k
				compositions), in both modes. Lean is to prove it of both schedules, and that a stage that fails twice falls back to
				the harness it started from. The Rust engine replays the Lean vectors, as it does for avenDB’s rules and for
				objectives, and refuses a round whose record does not add up, as a repeated label means one run took another’s
				place.
			</p>
		</section>

		<section id="examples">
			<p class="eyebrow">Examples</p>
			<h2>A film cut and a story, one round each</h2>
			<div class="cards">
				<div>
					<h3>Film editing</h3>
					<p>
						The task: cut a day’s film from its script and footage. The deliverable is a line on the film’s cut entry. The
						objective is the Lean file above. Both base runs leave two same-size shots in a row and never reopen the cut.
						INV adds an audit script and a rule to run it before finishing; DOM adds the rule to put each named thing on
						screen at its word. The composer merges both, the AIP holds the chosen cut line and the skill lines, and the
						lesson reads: when a tool call writes the deliverable, the harness reopens and checks it.
					</p>
				</div>
				<div>
					<h3>Story writing</h3>
					<p>
						The task: write a day’s journal story from its sparks. The deliverable is a line on the story’s text, so it is
						the cheapest domain to start with. The objective: the peak beat in the second half, an end warmer than the
						start, a hook of 12 words at most, and no fact without a spark. INV may add a step that plans the intensity
						curve first; DOM may add the false summit just before the peak.
					</p>
				</div>
			</div>
			<p class="note prose-col">
				The edits in both examples show the mechanism; a real round’s edits come from what its runs show. Assets, worlds,
				game rules and docs follow the same pattern, each with its own deliverable entry and its own readings.
			</p>
		</section>

		<section id="roadmap">
			<p class="eyebrow">Roadmap</p>
			<h2>From Lean to a first round</h2>
			<div class="table">
				<table>
					<thead>
						<tr><th>Step</th><th>What it ships</th><th>Where it stands</th></tr>
					</thead>
					<tbody>
						{#each roadmap as [step, what, now] (step)}
							<tr><td class="num"><b>{step}</b></td><td>{what}</td><td>{now}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	</svelte:element>
</div>

<style>
	/* the contents on the left, scrolling on their own beside the page; on a phone a strip on top (as the avenDB page) */
	.docs {
		display: grid;
		grid-template-columns: 14rem minmax(0, 1fr);
		gap: 3.5rem;
		align-items: start;
	}
	.docs.embedded {
		display: block;
	}
	.embedded .page {
		padding-block: 0.5rem 4rem;
	}
	.page {
		--mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		display: grid;
		gap: 4rem;
		min-width: 0;
		padding-block: 3rem 6rem;
	}
	.back {
		justify-self: start;
		font-size: 0.95rem;
		color: var(--ink-soft);
		text-decoration: none;
		margin-bottom: -2.5rem;
	}
	.back:hover {
		color: var(--ink);
	}
	.intro {
		display: grid;
		gap: 1.25rem;
	}
	h1 {
		font-size: clamp(2.6rem, 7vw, 5rem);
		max-width: 16ch;
		text-wrap: balance;
	}
	h2 {
		font-size: clamp(1.9rem, 4vw, 2.8rem);
		text-wrap: balance;
	}
	h3 {
		font-size: 1.35rem;
	}
	.lede {
		max-width: 46ch;
		margin: 0;
		font-size: 1.15rem;
		color: var(--ink-soft);
	}
	section {
		display: grid;
		gap: 1.25rem;
		min-width: 0;
		scroll-margin-top: 5rem;
	}

	.toc {
		position: sticky;
		top: env(safe-area-inset-top, 0px);
		max-height: calc(100vh - env(safe-area-inset-top, 0px));
		max-height: calc(100dvh - env(safe-area-inset-top, 0px));
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-block: 3rem 2rem;
		scrollbar-width: thin;
	}
	.toc p,
	.toc span {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.toc nav {
		display: grid;
		gap: 0.1rem;
		margin-top: 0.9rem;
		border-left: 1px solid var(--line);
	}
	.toc span {
		padding: 1rem 0 0.35rem 1rem;
		font-size: 0.68rem;
	}
	.toc span:first-child {
		padding-top: 0.2rem;
	}
	.toc a {
		margin-left: -1px;
		padding: 0.32rem 0.5rem 0.32rem 1rem;
		border-left: 2px solid transparent;
		font-size: 0.9rem;
		line-height: 1.3;
		color: var(--ink-soft);
		text-decoration: none;
	}
	.toc a:hover {
		color: var(--ink);
	}
	.toc a.on {
		border-left-color: var(--terracotta);
		font-weight: 600;
		color: var(--ink);
	}
	@media (max-width: 960px) {
		.docs {
			grid-template-columns: minmax(0, 1fr);
			gap: 0;
		}
		.toc {
			z-index: 2;
			max-height: none;
			margin-inline: -1.5rem;
			padding: 0.6rem 1.5rem;
			overflow-x: auto;
			overflow-y: hidden;
			background: color-mix(in srgb, var(--cream) 92%, transparent);
			backdrop-filter: blur(8px);
			border-bottom: 1px solid var(--line);
			scrollbar-width: none;
		}
		.toc p,
		.toc span {
			display: none;
		}
		.toc nav {
			display: flex;
			gap: 0.4rem;
			margin: 0;
			border: 0;
		}
		.toc a {
			flex: none;
			margin: 0;
			padding: 0.3rem 0.8rem;
			border: 1px solid var(--line);
			border-radius: 999px;
			background: var(--paper);
			font-size: 0.85rem;
			white-space: nowrap;
		}
		.toc a.on {
			border-color: var(--ink);
			background: var(--ink);
			color: var(--paper);
		}
	}
	section > .eyebrow {
		margin-bottom: -0.5rem;
	}
	.prose-col {
		max-width: 44rem;
		margin: 0;
		color: var(--ink-soft);
	}
	code {
		font-family: var(--mono);
		font-size: 0.86em;
	}
	a {
		text-underline-offset: 0.2em;
	}

	/* the short answers */
	.answers {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
		gap: 1rem;
	}
	.answers div {
		display: grid;
		gap: 0.5rem;
		align-content: start;
		padding: 1.25rem 1.35rem;
		border-radius: var(--radius);
		background: var(--paper);
	}
	.answers b {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.15;
	}
	.answers .short {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--terracotta);
	}
	.answers p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.95rem;
	}

	/* the round's steps */
	.steps {
		max-width: 44rem;
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.5rem;
		color: var(--ink-soft);
	}
	.steps b {
		color: var(--ink);
	}

	/* figures scroll sideways inside themselves, never the page */
	figure {
		margin: 0;
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	.frame {
		background: var(--paper);
		border-radius: var(--radius);
		padding: 1.25rem;
		overflow-x: auto;
	}
	figcaption {
		font-size: 0.92rem;
		color: var(--ink-soft);
		max-width: 46rem;
	}
	.swipe {
		display: none;
		margin: 0;
		font-size: 0.92rem;
		color: var(--muted);
	}
	@media (max-width: 760px) {
		.swipe {
			display: block;
		}
	}
	.fig {
		display: block;
		min-width: 46rem;
		width: 100%;
		height: auto;
	}
	.fig text {
		font-family: var(--font-body);
		fill: var(--ink);
	}
	.fig .h {
		font-weight: 600;
		font-size: 15px;
	}
	.fig .s {
		font-size: 12.5px;
		fill: var(--ink-soft);
	}
	.fig .box {
		fill: var(--paper);
		stroke: var(--line);
		stroke-width: 1.5;
	}
	.fig .node {
		fill: color-mix(in srgb, var(--sage) 18%, var(--paper));
		stroke: var(--ink);
		stroke-width: 1.4;
	}
	.fig .srv {
		fill: color-mix(in srgb, var(--sage) 38%, var(--paper));
		stroke: var(--ink);
		stroke-width: 2;
	}
	.fig .seg {
		fill: color-mix(in srgb, var(--terracotta) 18%, var(--paper));
		stroke: var(--terracotta);
		stroke-width: 1;
	}
	.fig .ctl {
		stroke: var(--ink);
		stroke-width: 2;
		fill: none;
	}
	.fig .relay {
		stroke: var(--ink);
		stroke-width: 2;
		stroke-dasharray: 6 5;
		fill: none;
	}
	.fig .arrow {
		fill: var(--ink);
	}

	/* code */
	pre {
		margin: 0;
		padding: 1rem 1.25rem;
		border-radius: var(--radius);
		background: var(--paper);
		overflow-x: auto;
		font-family: var(--mono);
		font-size: 0.82rem;
		line-height: 1.5;
	}
	pre code {
		font-size: inherit;
	}

	/* tables */
	.table {
		overflow-x: auto;
		border-radius: var(--radius);
		background: var(--paper);
	}
	table {
		border-collapse: collapse;
		width: 100%;
		min-width: 36rem;
		font-size: 0.95rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.75rem 1.1rem;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}
	tr:last-child td {
		border-bottom: 0;
	}
	th {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	td.num {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	ul {
		padding-left: 1.2rem;
		display: grid;
		gap: 0.35rem;
	}
	.note {
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	/* cards side by side */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: 1rem;
	}
	.cards > div {
		display: grid;
		gap: 0.6rem;
		align-content: start;
		padding: 1.25rem 1.35rem;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--sage) 22%, var(--paper));
	}
	.cards p {
		margin: 0;
		color: var(--ink-soft);
	}

	@media (max-width: 640px) {
		.page {
			gap: 3rem;
		}
	}
</style>
