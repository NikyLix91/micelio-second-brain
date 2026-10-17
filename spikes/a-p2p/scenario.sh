#!/usr/bin/env bash
# Scenario dello spike A. Presuppone `docker compose up -d` già eseguito e i 3 nodi writer.
set -u
cd "$(dirname "$0")"

port() { echo $((7300 + ${1#node})); }
remember() { curl -s -X POST "localhost:$(port "$1")/remember" -d "{\"title\":\"$2\",\"body\":\"scritto da $1\"}" >/dev/null; }
status() { local s; for _ in 1 2 3 4 5; do s=$(curl -s "localhost:$(port "$1")/status") && [[ -n $s ]] && { echo "$s"; return; }; sleep 1; done; echo '{"name":"'$1'","members":[],"memories":-1,"digest":"down"}'; }
summary() { for n in "$@"; do status "$n" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(`  ${j.name}: membri=${j.members.length} ricordi=${j.memories} digest=${j.digest} peer=${j.peers} writable=${j.writable}`)})'; done; }

# Attende che tutti i nodi indicati abbiano `want` ricordi con lo stesso digest
converge() {
  local want=$1; shift; local t0=$SECONDS
  while (( SECONDS - t0 < 90 )); do
    local digests=() ok=1
    for n in "$@"; do
      local s; s=$(status "$n")
      [[ $(echo "$s" | node -pe 'JSON.parse(require("fs").readFileSync(0)).memories') == "$want" ]] || ok=0
      digests+=("$(echo "$s" | node -pe 'JSON.parse(require("fs").readFileSync(0)).digest')")
    done
    if (( ok )) && [[ $(printf '%s\n' "${digests[@]}" | sort -u | wc -l) == 1 ]]; then
      echo "  ✔ convergenza su $want ricordi in $((SECONDS - t0)) s"; return 0
    fi
    sleep 1
  done
  echo "  ✘ nessuna convergenza entro 90 s"; summary "$@"; return 1
}

echo "== 1. Scritture concorrenti: 5 ricordi per nodo"
for i in 1 2 3 4 5; do for n in node1 node2 node3; do remember $n "$n-ricordo-$i" & done; done; wait
converge 15 node1 node2 node3
summary node1 node2 node3

echo "== 2. Duplicato: stesso contenuto da due nodi diversi"
curl -s -X POST localhost:7301/remember -d '{"title":"dup","body":"stesso"}' >/dev/null
curl -s -X POST localhost:7302/remember -d '{"title":"dup","body":"stesso"}' >/dev/null
converge 16 node1 node2 node3

echo "== 3. Founder offline: node2 e node3 continuano a scambiarsi conoscenza"
docker compose stop node1 >/dev/null 2>&1
remember node2 "senza-founder-a"; remember node3 "senza-founder-b"
converge 18 node2 node3

echo "== 4. node3 offline, node2 scrive, node1 torna online e recupera tutto da node2"
docker compose stop node3 >/dev/null 2>&1
for i in 1 2 3; do remember node2 "mentre-node3-dorme-$i"; done
docker compose start node1 >/dev/null 2>&1; sleep 3
converge 21 node1 node2

echo "== 5. node3 torna online e si riallinea"
docker compose start node3 >/dev/null 2>&1; sleep 3
converge 21 node1 node2 node3
summary node1 node2 node3

echo "== 6. node1 invita node4 e va offline: node4 entra tramite node2/node3 e riceve tutto"
curl -s -X POST localhost:7301/invite -d '{"name":"node4"}' >/dev/null; sleep 2
docker compose stop node1 >/dev/null 2>&1
docker compose --profile late up -d node4 >/dev/null 2>&1; sleep 5
remember node4 "primo-ricordo-di-node4"
converge 22 node2 node3 node4
summary node2 node3 node4
