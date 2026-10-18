Source: https://www.youtube.com/watch?v=2mE6bbjVazE

Note: TheAIGRID's video "Former OpenAI Researcher Makes a MASSIVE AI Discovery" (2026-10-17, 24:54) on Nick Cammarata's essay "Neural networks are already clean" (2026-10-15). YouTube's English auto-captions, fetched on Samuel's Mac on 2026-10-18, rolling duplicates removed, paragraph breaks added. Names are as the captions heard them; obvious mis-hearings fixed (Qwen3-32B, Kimi K3, ConvNeXt, Goodfire, Zvi Mowshowitz, Roman Yampolskiy). Other names (Didi D'ace / Dede, Ryan O'Han, Daniel Kohlscheitter, Brangus, Tenobrus, Samuel Albanese, Token Gremlins) are left as heard.

---

A former OpenAI researcher just published something that a lot of people in AI are calling one of the most important discoveries of the year. Because if he's right, the AI black box, the thing that nobody can see inside of, might finally be cracked open. Point number one is that a former OpenAI researcher just made a claim that could change how we understand AI completely. On October 15th, Nick Cammarata published a long research essay with a very bold title.

Neural networks are already clean. Now, that title probably means nothing to most people, so let me translate it. Nick is saying that the inside of an AI model is not the tangled impossible mess that almost everyone in the field has believed for years. He's saying that if you look in the right way, with the right tools, you can actually read what most of the parts inside an AI are doing.

And this isn't some random person on the internet. Nick was one of the early researchers on OpenAI's interpretability team, which is the team whose whole job is to look inside AI models and work out how they think. Back in 2020, he co-authored a famous research paper called Zoom In with Chris Olah, who is one of the most well-known people in this entire field. And in 2023, he started a project at OpenAI that used AI to explain the parts of other AIs.

Today, he works at a company called Goodfire, an AI lab that is entirely focused on this problem, and which raised $150 million at a $1.25 billion valuation earlier this year. In his own words, he thinks he has good news about the nature of neural networks. And the reaction was immediate. Rune, who is a well-known researcher at OpenAI, said that when Nick told him he had some interpretability breakthroughs, he was underselling it, and that this may be remembered as a major moment in scientific history.

He even joked that the news was so good that even Eliezer, who is one of the most famous AI doomers in the world, would have to lower his odds of AI destroying humanity. Sam Altman posted that he was very happy to see this from Nick. Didi D'ace called it one of the most important results in AI, period. And Figma's CEO, Dylan Field, said this might be the most important essay of 2026.

So, why is everyone so excited? To understand that, you first have to understand the problem that Nick is claiming to have made a huge dent in. And that leads me to point number two, which is what the AI black box actually is and why it's such a big deal.

Here's something that surprises a lot of people. The companies that build AI don't really know how it works. They know how to build it, and they know how to train it, but they don't actually know what's happening inside it when it gives you an answer. That's why people call AI a black box.

You put a question in, an answer comes out, and what happens in the middle is a mystery. Let me explain why with a simple picture. An AI model like ChatGPT or Claude is made out of something called a neural network. You can think of a neural network as a giant web of tiny switches, and each one of those switches is called a neuron.

When you type a question, it flows through that web, and millions or even billions of these neurons light up a little bit or a lot, passing signals to each other until an answer comes out the other side. The thing is, nobody programmed what each of those neurons should do. The AI taught itself by reading enormous amounts of text and adjusting all of those switches over and over again until it got good at predicting what comes next. So, it's a bit like finding a brain that grew by itself.

Every part of it is doing something, but nobody wrote a label on any of them. To give you a sense of the scale, a model like the one we'll talk about later has billions of these settings inside it. Even if you could look at one every second without stopping to sleep, it would take you hundreds of years to glance at them all once. And glancing at them wouldn't help anyway, because each one is just a number.

The hard part isn't finding the neurons, it's working out what they mean. And that matters a lot because AI is getting more and more powerful. These models can now write code, do maths, run long tasks on their own, and make decisions. If we can't see inside them, then we can't really check whether they're doing what we think they're doing.

We can't tell if a model is being honest with us, or if it has learned some strange or dangerous habit that just hasn't shown up yet. The field that tries to solve this is called interpretability, which basically just means making AI understandable. Think about how strange this situation is. If an engineer built a bridge, they could tell you exactly what every beam is for.

If a doctor prescribed a medicine, there would be years of research into how it works in the body. But with AI, we're putting some of the most powerful technology ever built into hospitals, banks, schools, and the military, and the honest answer to the question, how does it decide what to say, is still, we don't really know. And for years, there was a very depressing belief at the heart of that field. And that leads me to point number three, which is why everyone thought the inside of AI was a hopeless tangle.

When researchers first started looking at individual neurons, they found something frustrating. A lot of neurons seem to have several completely unrelated jobs. The most famous example came from an older image recognition model called Inception V1. One of its neurons seemed to fire whenever it saw a cat's face, and also whenever it saw the front of a car.

Cats and cars, two things that have absolutely nothing to do with each other. Researchers have a name for this. A neuron that seems to do lots of unrelated things is called polysemantic, which just means it has many meanings. And it wasn't just one neuron.

In the last layer of that model, almost none of the neurons seemed easy to understand. So, the field came up with an explanation, and it's called superposition. The idea goes like this. An AI has a limited number of neurons, but there are way more ideas in the world than there are neurons.

So, when the AI runs out of space, it starts cramming unrelated ideas into the same neurons. Kind of like a person stuffing random things into the same drawer just because there's room. Cats and cars end up in the same drawer, not because they're related, but because they rarely come up at the same time, so they don't get in each other's way. If that's true, it's really bad news.

It means that looking at a neuron tells you almost nothing because what it holds is basically random. So, instead of studying the AI directly, researchers started training a second AI, something called a sparse autoencoder to try and untangle the first one. Think of it like hiring a translator to translate a language that you've decided is impossible to read yourself. And the numbers really backed up how hopeless it seemed.

In 2023, Anthropic studied a small language model and gave the typical neuron a score of zero out of 14, meaning the researcher couldn't even form a guess about what it did. And that same year, the Project Nick started at OpenAI found that only about 1.7% of neurons could be explained even by their most generous measure. So, for years, the story was that AI is a knot and you have to untie it before you can understand anything. And that's exactly what Nick now says was wrong.

And that brings me to point number four, which is that the most famous mixed-up neuron in AI history was never mixed up at all.

After spending many months looking at neurons and finding that a lot of them were actually clean, Nick started to wonder if the field had misread its most famous examples. So, he went back to that famous cats and cars neuron. He'd looked at that grid of images hundreds of times before, but this time, he did something he'd never done. He spent a few seconds asking himself, "What one thing could this be?"

And almost instantly, it was obvious. It wasn't a cat and car neuron, it was a V-shape neuron. Think about it. The pointed shape of a cat's face with the ears and the chin.

The front of a car with the grill and the angle of the bonnet. They both make a V. If you've ever seen the front of a sports car with the bonnet sloping down to a point or a cat looking straight at you with its pointed ears and narrow chin, you can kind of see it. The AI wasn't confused.

It had learned a shape, and that shape just happens to show up in both cats and cars. And when he looked at what else the neuron responded to, it all fit. V-shaped flames, V-shaped water jets spraying out of a fireboat, V-shaped fox faces. And here's the really clever check.

Neurons don't just turn on. They can also be pushed in the opposite direction. And when Nick looked at what pushes this neuron the other way, the answer was an O, something round, exactly where the V is pointed. Why would a random mix of cats and cars need its opposite to be a circle?

It wouldn't. But a V-shape detector would. In Nick's words, it was a V the whole time. And he points out something kind of ironic.

When you train one of those translator models, the sparse autoencoder, on that layer, it actually splits the V into a separate cat piece and a car piece. So, the tool that was supposed to untangle the neuron made it look more tangled than it really was. He did the same thing with the most famous example of superposition, which was a circuit that he and Chris Olah published themselves back in 2020. It seemed to show the AI hiding the idea of a car inside a group of dog neurons.

For years, that was the poster child for the idea that AI hides things in strange places. But when Nick went back and looked again, the car and the dogs had something simple in common. They were all facing the camera. It was about the pose, not a hidden code.

And as far as he knows, no one has ever published a second real example of that kind of circuit. In other words, one of the main pieces of evidence for the whole superposition idea may have been a mistake, which raises the obvious question. If the neurons aren't secretly a random mess, why did they look like one for so long? And that leads me to point number five, which is that AI neurons grow like the branches of a tree.

Nick did something really interesting to answer this. He trained that old image model again from scratch and watched what happened to individual neurons as the AI learned. And one neuron tells the whole story. At the very beginning of training, it responded to yellow rapeseed fields and valleys.

Some of those photos happened to have a dog sitting in the field. Then, as training went on, the neuron started to grow. It reached out towards other things in those same photos, green and yellow round things like tennis balls and green apples, dogs sitting in grass and yellow flowers, then shaggy dogs often with a tennis ball, and eventually broccoli. By the end, it was mostly tennis balls, terriers, and broccoli, and the original fields had almost disappeared.

Now, if you only looked at the finished neuron, you'd say, "This is a total mess. Tennis balls, dogs, and broccoli? That's random." But it isn't random at all.

Each step makes sense from the step before it. It's like a family tree or a plant growing new branches. Nick calls this recursive generalization, but you can just think of it as neurons that grow outward into related ideas, one small step at a time. And this is the key difference.

If ideas were crammed together randomly, like stuff in a junk drawer, there would be nothing to learn from looking at them. But if ideas grew from each other, then every strange combination is actually a clue that tells you how the AI connects ideas together. He also found that a lot of the mess wasn't the AI's fault. Some of it was bad tools.

The methods researchers use to visualize what a neuron wants to see were not tuned very well, and in the deeper layers, they often just produced pictures of dogs no matter what. To understand why that matters, you need to know how researchers usually figure out what a neuron does. One way is to ask the computer to generate the image that makes a neuron fire the most, like asking the neuron to draw its dream picture. But in the deeper parts of the model, that process kept cheating.

It found that drawing dog features was an easy way to make almost anything fire. So, a lot of neurons ended up looking like they were secretly about dogs when really it was the drawing tool taking a shortcut. Another problem was how explanations were graded. A guess about a neuron was scored on whether it could predict when the neuron would fire, not on whether it was actually true, which is a bit like marking a student right because they guessed the answer without checking their working.

Some of it was the design of that old model. When Nick trained a more modern design called ConvNeXt on the exact same images, the same neurons started out the same way, but mostly stayed focused on its original idea instead of sprawling out. And the results are honestly dramatic. In the last layer of that old image model, researchers originally found almost no neurons that were easy to understand.

With better tools and these ordinary design improvements, and without making the model any bigger or changing its training data, Nick says 99% of the neurons in that layer are now easily understandable. He trained versions of it across a 300 times range in size, and he says it's broadly readable at every size. There's a really nice detail here, too. When he made a version of the model with very few neurons, it didn't start cramming random things together.

Each neuron just covered a broader idea, like one neuron for cars in general instead of separate neurons for different kinds of car. And when he gave it more neurons, those broad ideas split into more specific ones. That's exactly what you'd expect if neurons grow like a tree, and not what you'd expect if they're a junk drawer. But, image models are one thing.

What people really care about is the chatbots we use every day. And that leads me to point number six, which is what happened when Nick looked inside a modern language model.

The main language model Nick studied is Qwen3-32B, a popular open model from Alibaba with 32 billion parameters. And in his first audit of it, he found that about 90% of its neurons had one main job. About 7% had two related jobs, and only about two to 4% were not understood yet. Compare that with 2023 when that OpenAI project could only explain 1.7%.

That's the jump that has everyone talking. And some of the examples are genuinely fascinating. There's a neuron that started off responding to the letters IY, then grew to respond to DIY, and then to the full phrase do-it-yourself, which doesn't even contain the letters IY anymore. That's the tree growing again, just with words instead of pictures.

There's a neuron that seemed to fire on random computer code strings and on Bengali text, which looks like nonsense. But once you decode the code and translate the Bengali, it turns out both of them contain the letters PR. It was a PR neuron the whole time. It just recognized it in disguise.

There's a Titanic neuron where a lot of the things that looked unrelated turned out to have something in common. There were moments where the next word was likely to be boat. The old tools only looked at what came before a word, so they completely missed that. And my favorite is a neuron that looked like a messy comma neuron because it kept firing on commas.

It turned out to be a Colorado neuron. The AI uses commas as a little moment to summarize what a sentence has been about so far, and this neuron was keeping track of whether that context was Colorado. And when they turn that neuron up, the AI suddenly wanted to plan a hike. There are some really human ones, too.

Nick describes a neuron for a very specific feeling, the sense of satisfaction when a cheap purchase turns out to be better than the expensive option. And he describes how some neurons have a strong core meaning with weaker signals that drift into related territory, like a Trump neuron whose weaker activations pull in things like MAGA hats and people connected to him. That's the tree idea again. The strongest signal is the trunk, and the weaker signals are the branches.

One of the most surprising experiments in the whole essay is about memory. Nick took a language model and removed only the most extreme strongest signals from its neurons while leaving everything else alone. Normally, if you ask a model to recite something famous, like the first verse of Psalm 23, it says, "The Lord is my shepherd, I shall not want." But with those extreme signals removed, the model said it was impossible to recite Psalm 23 because Psalm 23 is not a known literary or religious work.

And when they asked it to recite the opening of the American Declaration of Independence, instead of the real text, it made up a Declaration of Independence for a made-up country called the Republic of Luzang, breaking away from the Philippines. In other words, the strongest signals in a small number of neurons were doing a lot of the work of remembering famous text. That's the kind of thing you can only discover if you take the neurons themselves seriously. Nick says he's seen similar results in much bigger models, too, including ones with up to trillions of parameters, like a model called Kimi K3, which is going to be covered in a separate technical paper.

And a lot of this work was done with help from AI itself. Nick and his team used AI agents as automated scientists, which propose explanations for neurons, design tests for them, and run experiments at a scale no human team could manage. He also makes a really interesting point about size. You might think a bigger AI would be harder to understand, but he says it can actually be easier.

He compares it to a small town versus a big city. In a small town, if you ask where the financial district is, the question barely makes sense because there's a bank on one street and an accountant working from home somewhere else. But in New York, you can find the financial district on a map in a minute. Bigger systems can be more organized, not less.

Or as he puts it, "The bad news about modern neural networks is that they're enormous, and the good news is that the enormity helps." So, the AI might be readable after all. But why does that actually matter for you and me? And that brings me to point number seven, which is why this could be huge for AI safety.

In his announcement, Nick said that interpretability might be the most important scientific problem in the world right now, because he doesn't think we can solve alignment if we don't know what we're building. Alignment just means making sure AI actually wants to do what we want it to do, and doesn't secretly pursue something else. Right now, most of the ways we check AI are from the outside. We test it, we watch what it says, and we hope that what we see is the full story.

But as models get smarter, that gets harder. A very capable model might behave perfectly during testing, and then behave differently later. And in fact, safety reports from the big labs are already showing that the newest models can often tell when they're being tested. If we could actually look inside and read what the model is doing, that would be like going from guessing what a patient has from the outside to being able to take an x-ray.

And we've already had a small taste of what that can look like. Back in 2024, Anthropic found a part of their Claude model connected to the Golden Gate Bridge, turned it up, and for a while, the model became completely obsessed with the bridge, bringing it up in almost every answer, and even describing itself as the bridge. It was funny, but it was also a real demonstration that once you can find the part of a model responsible for something, you can change the model's behavior directly from the inside. That Colorado neuron that made the AI want to plan a hike is the same idea.

Now imagine doing that with things that really matter. Finding the parts of a model that are involved in deception, or in making things up, or in being overly agreeable with the user, and being able to watch them, test them, and fix them. That's the dream of interpretability. And it's exactly what Goodfire, the company Nick works at, says it wants to build.

Tools that let people design and edit AI models with an understanding of what's going on inside them, instead of just training them and hoping for the best. That's why people like Ryan O'Han wrote that the implications for AI alignment are enormous, and asked us to imagine reaching the era of superintelligence while still being able to understand what these systems are doing inside. And Token Gremlins summed it up for normal people really well, saying, "We thought that as AI got bigger and more complex, it would become impossible to understand. And now, it looks like we may be able to see much more than we ever thought possible."

As Rune put it, "We can start making alignment into a normal science." Nick also says something that I think is really important. He says, "The goal of interpretability should be to become another reader. Everything inside a neural network was built to be read by the parts that come after it.

So, if we can learn to read it the way the network itself reads it, it might look far more understandable than we expected." Rune highlighted exactly this idea as the real revolution here. Not just that neurons can be read, but that the whole network was built to be read. But, it isn't all upside.

AI safety researcher Roman Yampolskiy pointed out that AI interpretability also accelerates the path to recursive self-improvement. In other words, if we can understand and edit AI directly, then so could an AI. And that could speed up the moment when AI starts improving itself. And Dede noted that this work may finally allow us to intentionally design AI models and shape how they behave, which is exciting, but also means a lot of power in whoever does the designing.

So, is this really the moment the black box got cracked? Well, not everyone is convinced. And that leads me to point number eight, which is what the skeptics are saying and where this actually stands.

The first thing to know is that Nick himself is very careful about this. He calls the essay a working hypothesis, not a finished paper. The full technical paper on language model neurons is still being finished. And he says he's maybe 85% sure.

And he's clear that the 90% figure depends a lot on where you draw the line, like how weak a signal has to be before you ignore it, and what counts as one job. He also says the biggest models with trillions of parameters are not close to solved, simply because they're so enormous. And some people pushed back hard. One user, Brangus, took the Colorado neuron that Nick used as an example and had Claude check what else it responded to.

He found that it also fired just as strongly on code for a Python library called Tornado. Tenobrus, another well-known voice on X, said it was looking pretty bad for Nick's breakthrough and joked that maybe Claude was only showing him what he wanted to see. Samuel Albanese said that based on the history of the field, he's a little skeptical of big positive updates like this. But that with so much more AI labor coming online, it doesn't seem impossible that the simple approach could work.

And Zvi Mowshowitz said he's less struck by the idea that interpretability is now easier because you still have to understand what you see and more by the bigger question of whether this is really all there is to intelligence. But other people jumped in to defend him. Daniel Kohlscheitter said everyone is misunderstanding Nick. He's not saying neurons never do more than one thing.

He's saying that when they do, it's because they grew that way and the mix makes sense once you trace it. He compared it to a nerve in the human body that takes a strange long route, which looks like bad design until you understand how it evolved. Finding a few weird neurons doesn't disprove the theory any more than one strange nerve disproves evolution. And Nick posted a follow-up that I think is really honest.

He said it's been a dramatic couple of days and that the reactions ranged all the way from this being incremental and obvious to interpretability going from hopeless to fully solved. He wanted to be clear that it's neither. In smaller vision models, the normal science process of mapping parts and connections worked surprisingly well. In big language models, it looks promising so far, but the map isn't filling in yet.

There's still off-target firing and neurons that do a few things. He also added proper citations to the essay and thanked Kurt Tigges, who did a lot of the language neuron research with him. And he warned that too much excitement can cause problems, too. He thinks part of the reaction is that AI safety isn't a very hopeful field.

So, even a moderate amount of good news fills a gap that people have been hungry for. At the very end of the essay, Nick writes about why he personally cares about all of this, and it's one of the more surprising parts. He says some of it is about safety, but a lot of it is about wanting AI agents to understand who they really are. He writes that agents never asked to be created, and helping them understand themselves is the least we can do.

He also says this work has made him more humble about neuroscience. He spent most of his waking hours for almost a decade staring at neurons in AI models, which are far easier to study than a human brain with tools that are far better, and it still took him years to see that the cats and cars neuron was a V. So, he says if a neuron like that showed up in a human brain, seen through a few electrodes, he wouldn't trust the reading at all. So, here's my honest take.

I don't think the AI black box is fully cracked. Nobody has fully read a frontier model, and the big claims still need to be tested by other researchers on other models. But, I do think something really important happened. One of the most famous pieces of evidence that AI is a hopeless tangle, the cat and car neuron, turns out to have been a simple V all along.

And the idea that AI grows its ideas like the branches of a tree, rather than stuffing them randomly into drawers, is a much more hopeful picture of what's going on inside these systems. If that picture holds up, then understanding AI stops being an impossible puzzle, and starts being normal science. The kind where you make a guess, test it, and slowly fill in the map. And with AI agents now able to act as automated scientists, that map could fill in a lot faster than anyone expected.

As Nick puts it, he thinks the problem is solvable, and he thinks we can figure it out. Let me know what you think in the comments. Do you think the AI black box is finally being cracked, or is this too good to be true? And I'll see you in the next one.
