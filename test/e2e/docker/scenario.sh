#!/usr/bin/env bash
# Scenario end-to-end di Micelio su 4 container (DHT pubblica). Uso: npm run e2e:docker
# I container usano il LLM finto (compose.yaml): i ricordi di prova devono avere un contenuto
# di almeno ~30 caratteri, altrimenti il finto classificatore li considera banali (→ inbox).
set -euo pipefail
cd "$(dirname "$0")"

dc() { docker compose -p micelio-e2e "$@"; }
m() { local n=$1; shift; dc exec -T "$n" micelio "$@"; }
field() { m "$1" status --json | node -pe "JSON.parse(require('fs').readFileSync(0)).$2"; }
pass=0; fail=0
ok() { echo "  ✔ $1"; pass=$((pass + 1)); }
ko() { echo "  ✘ $1"; fail=$((fail + 1)); }

# Attende che tutti i nodi indicati abbiano N ricordi
converge() {
  local want=$1; shift; local t0=$SECONDS
  while (( SECONDS - t0 < 90 )); do
    local all=1
    for n in "$@"; do [[ $(field "$n" memories 2>/dev/null || echo -1) == "$want" ]] || all=0; done
    if (( all )); then ok "$* → $want ricordi in $((SECONDS - t0)) s"; return; fi
    sleep 1
  done
  ko "$* non convergono su $want ricordi"; for n in "$@"; do echo "    $n: $(field "$n" memories 2>/dev/null || echo down)"; done
}

wait_up() { for n in "$@"; do until m "$n" status --json >/dev/null 2>&1; do sleep 1; done; done; }
invite_code() { m "$1" invite --json | node -pe "JSON.parse(require('fs').readFileSync(0)).code"; }

echo "== Preparazione"
dc down -v >/dev/null 2>&1 || true
dc up -d --build node1 node2 node3 >/dev/null 2>&1
wait_up node1 node2 node3

echo "== 1. node1 crea il team, node2 e node3 entrano con un invito"
m node1 init "Team E2E" --name node1 >/dev/null
m node2 join "$(invite_code node1)" --name node2 >/dev/null && ok "node2 entrato"
m node3 join "$(invite_code node1)" --name node3 >/dev/null && ok "node3 entrato"

echo "== 2. Scritture concorrenti: 3 ricordi per nodo"
for i in 1 2 3; do for n in node1 node2 node3; do
  m "$n" remember "Ricordo $i di $n" -b "Contenuto $i scritto da $n" -t e2e >/dev/null &
done; done; wait
converge 9 node1 node2 node3

echo "== 3. Il fondatore va offline: node2 e node3 continuano a sincronizzarsi"
dc stop node1 >/dev/null 2>&1
m node2 remember "Scritto senza fondatore A" -b "Ricordo tecnico scritto mentre il fondatore è offline (A)." >/dev/null
m node3 remember "Scritto senza fondatore B" -b "Ricordo tecnico scritto mentre il fondatore è offline (B)." >/dev/null
converge 11 node2 node3

echo "== 4. node2 invita node4 e va offline: node4 entra grazie a node3"
code=$(invite_code node2)
dc stop node2 >/dev/null 2>&1
dc up -d node4 >/dev/null 2>&1; wait_up node4
m node4 join "$code" --name node4 >/dev/null && ok "node4 entrato con l'invitante offline"
converge 11 node3 node4

echo "== 5. Tutti di nuovo online: convergenza completa"
dc start node1 node2 >/dev/null 2>&1; wait_up node1 node2
m node4 remember "Primo ricordo di node4" -b "ciao team" >/dev/null
converge 12 node1 node2 node3 node4
hit=$(m node1 recall "ciao team" | head -2 | tail -1)
[[ $hit == *"Primo ricordo di node4"* ]] && ok "node1 trova il ricordo di node4" || ko "recall su node1: $hit"

echo "== 6. Permessi: un membro non può espellere, l'admin sì"
m node3 members remove node1 >/dev/null 2>&1 && ko "node3 ha espulso node1" || ok "node3 (membro) non può espellere"
m node1 members remove node4 >/dev/null && ok "node1 (admin) espelle node4"
sleep 3
[[ $(field node3 members) == 3 ]] && ok "node3 vede 3 membri attivi" || ko "node3 vede $(field node3 members) membri"

echo "== Albero degli inviti visto da node3"
m node3 members | sed 's/^/    /'

dc down -v >/dev/null 2>&1
# Ogni rebuild lascia l'immagine precedente orfana (~480 MB): la eliminiamo per non saturare il disco.
docker image prune -f --filter label=org.micelio.image=node >/dev/null
echo
echo "Risultato: $pass ok, $fail falliti"
(( fail == 0 ))
