import AvenDB.Logs

/-!
The blob gate depends on authenticated connections and current permitted history,
not provider deployment role. This is a corollary of the existing Node.hands gate,
not a new permission policy. Runtime correspondence exercises a previously granted
requester after revocation against an ordinary provider and a backup server.
-/
namespace AvenDB.PeerRoleGate

theorem equivalent_views_same_gate (ordinary server : Node) (ep : EndpointId)
    (blob : FileBlob) (follow : List VaultId)
    (sameHistory : ordinary.edits = server.edits)
    (sameConnections : ordinary.conns = server.conns) :
    ordinary.hands ep blob follow = server.hands ep blob follow := by
  simp only [Node.hands, sameHistory, sameConnections]

theorem authenticated_but_no_current_permission (node : Node) (ep : EndpointId)
    (blob : FileBlob) (follow : List VaultId) (connection : Conn)
    (authenticated : node.conns.find? (·.endpoint == ep) = some connection)
    (denied : mayFetch node.edits connection.device blob.file follow = false) :
    node.hands ep blob follow = false := by
  simp [Node.hands, authenticated, denied]

end AvenDB.PeerRoleGate
