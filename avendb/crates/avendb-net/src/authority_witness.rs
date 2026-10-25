//! Bounded authorized locations of checkpoint evidence; never admission evidence.
use super::*;
use avendb::id::VaultId;
pub(crate) const KIND:u8=23;
pub(crate) const LIMIT:usize=33;
const RESPONSE:usize=34+4*32;
fn request(bytes:&[u8])->Result<EditId> {
    anyhow::ensure!(bytes.len()==LIMIT && bytes[0]==1,"witness request shape");
    Ok(EditId(bytes[1..].try_into().unwrap()))
}
fn decode(bytes:&[u8],target:EditId)->Result<Vec<VaultId>> {
    anyhow::ensure!(bytes.len()>=34 && bytes.len()<=RESPONSE && bytes[0]==1,"witness response shape");
    anyhow::ensure!(bytes[1..33]==target.0 && bytes[33]<=4 && bytes.len()==34+32*bytes[33] as usize,"witness binding/count");
    let vaults:Vec<_>=bytes[34..].chunks_exact(32).map(|b|VaultId(b.try_into().unwrap())).collect();
    anyhow::ensure!(vaults.iter().collect::<BTreeSet<_>>().len()==vaults.len(),"duplicate witnesses");
    Ok(vaults)
}
pub(crate) async fn answer(shared:&Arc<Shared>,peer:&Peer,bytes:&[u8],permit:Arc<tokio::sync::OwnedSemaphorePermit>)->Result<Vec<u8>> {
    let target=request(bytes)?;let requester=peer.device;
    let (revision,vaults)=shared.read(move|lab,me| {
        let _permit=permit;
        (lab.log(me).revision(),lab.authority_witness_hints(me,requester,target))
    }).await;
    anyhow::ensure!(shared.read(move|lab,me|lab.log(me).revision()==revision).await,"witness policy changed");
    let mut out=vec![1];out.extend(target.0);out.push(vaults.len() as u8);
    for vault in vaults {out.extend(vault.0);}
    Ok(out)
}
pub(crate) async fn fetch(shared:&Arc<Shared>,peer:&Peer,target:EditId)->Option<Vec<VaultId>> {
    let mut bytes=vec![1];bytes.extend(target.0);
    // Dropping the owning demand future drops this exchange; no result is
    // installed or admitted here, and no detached background task is spawned.
    let _permit=time::timeout(Duration::from_secs(2),shared.pulls.page(false,false)).await.ok()?.ok()?;
    let reply=time::timeout(Duration::from_secs(2),session::exchange(&peer.conn,KIND,&bytes,RESPONSE)).await.ok()?.ok()?;
    decode(&reply,target).ok()
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn witness_hint_is_bound_and_bounded() {
        let id=EditId([2;32]);let mut bytes=vec![1];bytes.extend(id.0);bytes.push(0);
        assert!(decode(&bytes,id).unwrap().is_empty());
        assert!(decode(&bytes,EditId([3;32])).is_err());
        bytes[33]=5;assert!(decode(&bytes,id).is_err());
        bytes[33]=2;bytes.extend([4;64]);assert!(decode(&bytes,id).is_err());
        assert!(request(&[]).is_err());
    }
}
