#!/bin/sh
# The box's test certificates for the relay's QUIC address discovery (QAD): a CA and a certificate for every name the
# box's relays go by (aven, prod, the lanes' 10.78.0.10), made once with openssl into the shared build folder, which
# every peer mounts at /target. Test keys, valid only inside the box; `docker volume rm avensandbox_target` makes new
# ones. A real relay serves its real certificate and needs no extra CA (aven/DB2/sandbox/box/compose.yml).
set -e
dir=target/qad-1
[ -f "$dir/cert.pem" ] && exit 0
rm -rf "$dir.next" && mkdir -p "$dir.next" && cd "$dir.next"
ec="-newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes"
openssl req -x509 $ec -days 3650 -subj "/CN=avenSANDBOX test CA" -keyout ca.key -out ca.pem \
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign 2>/dev/null
openssl req $ec -subj "/CN=aven" -keyout key.pem -out relay.csr 2>/dev/null
printf 'subjectAltName=DNS:aven,DNS:prod,DNS:localhost,IP:10.78.0.10,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' > ext
openssl x509 -req -in relay.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 3650 -extfile ext -out cert.pem 2>/dev/null
rm -f ca.key relay.csr ext ca.srl
cd .. && mv qad-1.next qad-1
