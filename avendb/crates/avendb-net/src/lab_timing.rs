//! Fixed-size completed-operation timings. No operation text, identities, or samples.
//! Observation only: these values never affect scheduling or authorization.
use std::sync::Mutex;
use std::time::Duration;
use serde_json::{Value, json};
use crate::lab_schedule::Class;

#[derive(Clone, Copy, Default)]
struct Timer { count: u64, total_ms: f64, max_ms: f64 }
impl Timer {
    fn add(&mut self, duration: Duration) {
        let ms=duration.as_secs_f64()*1000.0;
        self.count=self.count.saturating_add(1);
        self.total_ms+=ms;
        self.max_ms=self.max_ms.max(ms);
    }
    fn json(self) -> Value {
        json!({"count":self.count,"total_ms":self.total_ms,"max_ms":self.max_ms,
            "mean_ms":if self.count==0 {0.0} else {self.total_ms/self.count as f64}})
    }
}
#[derive(Default)]
pub(crate) struct Timings(Mutex<[[Timer;4];3]>);
impl Timings {
    pub(crate) fn record(&self, class: Class, phases: [Duration;4]) {
        let index=match class {Class::Mutation=>0,Class::Foreground=>1,Class::Background=>2};
        let mut rows=self.0.lock().unwrap_or_else(|e|e.into_inner());
        for (timer,elapsed) in rows[index].iter_mut().zip(phases) {timer.add(elapsed);}
    }
    pub(crate) fn json(&self) -> Value {
        let rows=*self.0.lock().unwrap_or_else(|e|e.into_inner());
        let mut classes=serde_json::Map::new();
        for (name,row) in ["mutation","foreground","background"].into_iter().zip(rows) {
            let mut phases=serde_json::Map::new();
            for (phase,timer) in ["queue","dispatch","lock_wait","operation"].into_iter().zip(row) {
                phases.insert(phase.into(),timer.json());
            }
            classes.insert(name.into(),Value::Object(phases));
        }
        Value::Object(classes)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lab_work_timings_keep_classes_and_phases_separate_without_samples() {
        let t=Timings::default();
        t.record(Class::Mutation,[1,2,3,4].map(Duration::from_millis));
        t.record(Class::Mutation,[3,4,5,6].map(Duration::from_millis));
        t.record(Class::Background,[50,0,1,100].map(Duration::from_millis));
        let v=t.json();
        assert_eq!(v.as_object().unwrap().len(),3);
        assert_eq!(v["mutation"].as_object().unwrap().len(),4);
        assert_eq!(v["mutation"]["queue"]["mean_ms"],2.0);
        assert_eq!(v["mutation"]["operation"]["max_ms"],6.0);
        assert_eq!(v["background"]["operation"]["max_ms"],100.0);
        assert_eq!(v["foreground"]["queue"]["count"],0);
        assert_eq!(v["mutation"]["operation"]["count"],2);
    }
}
