//! Hold the actual native receive checker to exercise contention and detached cancellation.
use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn prepared_page_allows_generic_access_and_keeps_cancelled_work_admitted() {
    let mut w = avendb::cast::world();
    let me = w.phone_a;
    let node = Arc::new(
        Node::spawn(
            w.lab.split(me, &[], [224; 32]),
            me,
            Options {
                lazy: true,
                ..Options::local()
            },
        )
        .await
        .unwrap(),
    );
    let entry = w
        .lab
        .create(
            w.mac_a,
            w.alice,
            w.alice,
            avendb::world::NOTE,
            &[],
            avendb::cast::document("Live during sync", "generic entry", w.mac_a),
        )
        .unwrap();
    let incoming = w.lab.backup(w.mac_a).signed().to_vec();
    for cancelled in [false, true] {
        let permit = node.shared.pulls.page(false, true).await.unwrap();
        let (entered, waiting) = tokio::sync::oneshot::channel();
        let (release, held) = std::sync::mpsc::channel();
        let shared = node.shared.clone();
        let edits = incoming.clone();
        let task = tokio::spawn(async move {
            shared
                .prepare_received_page(
                    edits,
                    permit,
                    (),
                    Some(Box::new(move || {
                        entered.send(()).unwrap();
                        held.recv().unwrap();
                    })),
                )
                .await
                .unwrap()
        });
        waiting.await.unwrap();
        // Both paths use the actual shared mutex. The checker cannot finish until we release it.
        let access_started = std::time::Instant::now();
        time::timeout(Duration::from_secs(2), node.read(|lab, me| lab.size(me)))
            .await
            .expect("generic reads proceed during signature work");
        time::timeout(
            Duration::from_secs(2),
            node.try_act(|lab, me| lab.gate(me, false)),
        )
        .await
        .expect("generic mutations proceed during signature work")
        .unwrap();
        eprintln!("generic read+mutation while receive crypto held: {:?}", access_started.elapsed());
        if cancelled {
            task.abort();
            assert!(matches!(task.await, Err(error) if error.is_cancelled()));
            assert!(
                time::timeout(
                    Duration::from_millis(30),
                    node.shared.pulls.page(true, false)
                )
                .await
                .is_err(),
                "detached crypto keeps its page charged"
            );
            assert!(time::timeout(Duration::from_millis(30), node.shared.receive_checking.clone().lock_owned()).await.is_err(),
                "detached work retains the single checker slot");
            let closing_node = node.clone();
            let mut closing = tokio::spawn(async move { closing_node.shutdown().await });
            assert!(
                time::timeout(Duration::from_millis(30), &mut closing)
                    .await
                    .is_err(),
                "shutdown waits for detached crypto"
            );
            release.send(()).unwrap();
            time::timeout(Duration::from_secs(10), closing)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        } else {
            release.send(()).unwrap();
            let (prepared, permit, activity, ()) = task.await.unwrap();
            node.try_act(move |lab, me| {
                let (_permit, _activity) = (permit, activity);
                lab.receive_prepared(me, prepared, true)
            })
            .await
            .unwrap();
            assert!(
                node.read(move |lab, me| lab.item(me, entry).is_some())
                    .await
            );
        }
    }
}

#[tokio::test(flavor="multi_thread",worker_threads=2)]
async fn bounded_admission_cancel_counts_only_completed_chunk_and_retry_finishes() {
    let mut w=avendb::cast::world(); let me=w.phone_a;
    let node=Arc::new(Node::spawn(w.lab.split(me,&[],[225;32]),me,
        Options {lazy:true,..Options::local()}).await.unwrap());
    let mut incoming=Vec::new();
    w.lab.together(|lab|for n in 0..300 {
        let entry=lab.create(w.mac_a,w.alice,w.alice,avendb::world::NOTE,&[],
            avendb::cast::document(&format!("Batch {n}"),"body",w.mac_a)).unwrap();
        let id=lab.state(w.mac_a).entry(entry).unwrap().creation;
        incoming.push(lab.signed_edit(w.mac_a,id).unwrap().clone());
    });
    let ids:Vec<_>=incoming.iter().map(|s|s.edit.id()).collect();
    let permit=node.shared.pulls.page(false,true).await.unwrap();
    let (prepared,permit,activity,())=node.shared.prepare_received_page(incoming.clone(),permit,(),None).await.unwrap();
    struct Owner {count:AtomicUsize,entered:std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
        gate:std::sync::Mutex<std::sync::mpsc::Receiver<()>>}
    let (send,entered)=tokio::sync::oneshot::channel();let (release,gate)=std::sync::mpsc::channel();
    let owner=Arc::new(Owner {count:AtomicUsize::new(0),entered:std::sync::Mutex::new(Some(send)),gate:std::sync::Mutex::new(gate)});
    let shared=node.shared.clone();let held=owner.clone();
    let task=tokio::spawn(async move {shared.admit_received_batches(prepared,permit,activity,held,
        lab_schedule::Class::Background,|owner,new| {
            owner.count.fetch_add(new,Ordering::Relaxed);
            if let Some(send)=owner.entered.lock().unwrap().take() {
                let _=send.send(());owner.gate.lock().unwrap().recv().unwrap();
            }
        }).await});
    entered.await.unwrap(); task.abort();
    assert!(time::timeout(Duration::from_millis(30),node.shared.pulls.page(true,false)).await.is_err());
    release.send(()).unwrap();
    let check=ids.clone();
    let held=node.read(move|lab,me|check.iter().filter(|id|lab.signed_edit(me,**id).is_some()).count()).await;
    assert_eq!(held,128);assert_eq!(owner.count.load(Ordering::Relaxed),128);
    let permit=node.shared.pulls.page(false,true).await.unwrap();
    let (prepared,permit,activity,())=node.shared.prepare_received_page(incoming,permit,(),None).await.unwrap();
    let (new,_,())=node.shared.admit_received_batches(prepared,permit,activity,(),
        lab_schedule::Class::Background,|_,_|{}).await.unwrap();
    assert_eq!(new,172,"retry counts only newly admitted edits");
    assert!(node.read(move|lab,me|ids.iter().all(|id|lab.signed_edit(me,*id).is_some())).await);
    node.shutdown().await.unwrap();
}
