//! Deleting a line (`Aven.DB.Chains`, "Deleting a line"): a retraction is a line of its own whose body names the
//! retracted line by its id and place. It counts only from a device of the line's own vault ([`retracts`]); every peer
//! judges that itself and ignores any other. After every line a peer settles ([`Keeper::settle`]): a retraction that
//! counts for a line it doesn't hold keeps that line's place as a stub, so its chain goes on past it and the line,
//! arriving later, never shows; every line a retraction counts for loses its text, keeping its id and place, so the
//! chain still links; and a file whose last naming line lost its text is dropped. Deletion binds honest peers only.

use std::collections::BTreeSet;

use super::{Answer, Body, Held, Keeper, Line, check, fits};

/// Whether `r` retracts `l`, named `id`: it names `l` by its id and place, its device acts for `l`'s vault
/// (`author`), and `l` is no retraction (`Aven.DB.Chains.retracts`).
pub fn retracts(author: &impl Fn(&str) -> String, r: &Line, id: &str, l: &Line) -> bool {
    let Body::Retract(t) = &r.body else {
        return false;
    };
    t.target == id
        && t.device == l.device
        && t.seq == l.seq
        && t.prev == l.prev
        && t.at == l.at
        && author(&r.device) == author(&l.device)
        && !matches!(l.body, Body::Retract(_))
}

/// The place a retraction keeps for a line the peer doesn't hold: its id and place, without its text.
fn stub(r: &Line) -> Option<Held> {
    let Body::Retract(t) = &r.body else {
        return None;
    };
    Some(Held {
        id: t.target.clone(),
        line: Line {
            network: r.network.clone(),
            device: t.device.clone(),
            seq: t.seq,
            prev: t.prev.clone(),
            at: t.at,
            sig: String::new(),
            body: Body::Redacted,
        },
    })
}

/// What settling changed: the files dropped (each once, in order), the lines that lost their text as they were before,
/// each with the retraction that counts for it, and the stubs placed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Settled {
    pub dropped: Vec<String>,
    pub redacted: Vec<(Held, Held)>,
    pub stubs: Vec<(Held, Held)>,
}

/// The files lines name.
fn named<'a>(lines: impl Iterator<Item = &'a Held>) -> BTreeSet<String> {
    lines
        .filter_map(|h| match &h.line.body {
            Body::File(f) => Some(f.file.clone()),
            _ => None,
        })
        .collect()
}

impl Keeper {
    /// Every line it holds, forks and stubs included.
    pub fn all(&self) -> impl Iterator<Item = &Held> {
        self.chains.values().flatten().chain(self.loose.iter())
    }

    /// Every line it holds but the forks: what may count.
    pub fn live(&self) -> impl Iterator<Item = &Held> {
        self.chains
            .values()
            .flatten()
            .chain(self.loose.iter().filter(|h| !self.forks.contains(&h.id)))
    }

    /// The retractions it holds that count for `h`.
    pub fn retracting<'a>(
        &'a self,
        author: &'a impl Fn(&str) -> String,
        h: &'a Held,
    ) -> impl Iterator<Item = &'a Held> {
        self.live()
            .filter(move |r| retracts(author, &r.line, &h.id, &h.line))
    }

    /// How a line shows: deleted when its text is gone or a retraction it holds counts for it.
    pub fn deleted(&self, author: &impl Fn(&str) -> String, h: &Held) -> bool {
        h.line.body == Body::Redacted || self.retracting(author, h).next().is_some()
    }

    /// What a peer sends in place of a line it holds without its text: a retraction that counts for it, the first by
    /// its device and number; any other line as it is.
    pub fn stand_in(&self, author: &impl Fn(&str) -> String, h: &Held) -> Option<Held> {
        if h.line.body != Body::Redacted {
            return Some(h.clone());
        }
        self.retracting(author, h)
            .min_by(|a, b| (&a.line.device, a.line.seq).cmp(&(&b.line.device, b.line.seq)))
            .cloned()
    }

    /// A line put in its place, unchecked: on top of its device's chain with what then fits after it, or kept loose.
    fn place(&mut self, h: Held) {
        let device = h.line.device.clone();
        if !fits(self.chain(&device).last(), &h.line) {
            self.loose.insert(0, h);
            return;
        }
        let chain = self.chains.entry(device.clone()).or_default();
        chain.push(h);
        while let Some(at) = self.loose.iter().position(|m| {
            m.line.device == device && fits(chain.last(), &m.line) && !self.forks.contains(&m.id)
        }) {
            chain.push(self.loose.remove(at));
        }
    }

    /// Every retraction it holds that counts, naming a line at a place where it holds nothing: that line's stub, in
    /// the order of their places, then their retractions'.
    fn stubs(&mut self, author: &impl Fn(&str) -> String) -> Vec<(Held, Held)> {
        let mut wanted: Vec<(Held, Held)> = self
            .live()
            .filter_map(|r| stub(&r.line).map(|s| (s, r.clone())))
            .collect();
        wanted.sort_by(|(s, r), (t, q)| {
            (
                &s.line.device,
                s.line.seq,
                s.line.at,
                &r.line.device,
                r.line.seq,
            )
                .cmp(&(
                    &t.line.device,
                    t.line.seq,
                    t.line.at,
                    &q.line.device,
                    q.line.seq,
                ))
        });
        let mut placed = vec![];
        for (s, r) in wanted {
            let taken = self
                .held(&s.line.device)
                .any(|m| m.id == s.id || m.line.seq == s.line.seq);
            if author(&r.line.device) == author(&s.line.device) && !taken {
                self.place(s.clone());
                placed.push((s, r));
            }
        }
        placed
    }

    /// After a line: the stubs placed, the texts of the lines a retraction counts for dropped, and the files no line
    /// names any more.
    pub fn settle(&mut self, author: &impl Fn(&str) -> String) -> Settled {
        let stubs = self.stubs(author);
        let before = named(self.all());
        let mut redacted = vec![];
        for h in self.all() {
            if matches!(h.line.body, Body::Text(_) | Body::File(_))
                && let Some(r) = self.retracting(author, h).next()
            {
                redacted.push((h.clone(), r.clone()));
            }
        }
        let gone: BTreeSet<&str> = redacted.iter().map(|(h, _)| h.id.as_str()).collect();
        for h in self
            .chains
            .values_mut()
            .flatten()
            .chain(self.loose.iter_mut())
        {
            if gone.contains(h.id.as_str()) && matches!(h.line.body, Body::Text(_) | Body::File(_))
            {
                h.line.body = Body::Redacted;
                h.line.sig = String::new();
            }
        }
        let after = named(self.all());
        Settled {
            dropped: before.difference(&after).cloned().collect(),
            redacted,
            stubs,
        }
    }

    /// A held line of `device` named `id` whose text it doesn't hold: a stub, or a line it redacted.
    pub fn stub_of(&self, device: &str, id: &str) -> Option<&Held> {
        self.held(device)
            .find(|m| m.id == id && m.line.body == Body::Redacted)
    }

    /// A line as it arrives, named `id`, then settled (`Aven.DB.Chains.Keeper.take`). A line whose stub it holds takes
    /// the stub's place, when it is the same place; another line at that place is a fork.
    #[allow(clippy::too_many_arguments)]
    pub fn take(
        &mut self,
        network: &str,
        member: impl Fn(&str) -> bool,
        verify: impl Fn(&str, &str, &str) -> bool,
        author: &impl Fn(&str) -> String,
        id: String,
        line: Line,
    ) -> (Answer, Settled) {
        if let Err(why) = check(network, &member, &verify, &line) {
            return (Answer::Refused(why), Settled::default());
        }
        let answer = match self.stub_of(&line.device, &id).cloned() {
            Some(s) if (s.line.seq, &s.line.prev, s.line.at) == (line.seq, &line.prev, line.at) => {
                for m in self
                    .chains
                    .values_mut()
                    .flatten()
                    .chain(self.loose.iter_mut())
                {
                    if m.id == id && m.line.body == Body::Redacted {
                        m.line = line.clone();
                    }
                }
                Answer::Known
            }
            Some(_) => {
                self.forks.insert(0, id.clone());
                self.loose.insert(0, Held { id, line });
                Answer::Fork
            }
            None => self.receive(network, member, verify, id, line),
        };
        (answer, self.settle(author))
    }
}
