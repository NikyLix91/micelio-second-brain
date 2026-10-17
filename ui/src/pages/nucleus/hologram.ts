/**
 * @file Elementi grafici del Nucleo 3D: l'"ologramma" attorno ai ricordi.
 *
 * - glowTexture / starSprite: ogni ricordo è uno sprite con un alone radiale, in fusione
 *   ADDITIVA (le luci sovrapposte si sommano, come in un ologramma);
 * - createHologram: anelli orbitali sottili, meridiani tratteggiati e un pulviscolo di
 *   particelle sulla superficie della sfera. Il gruppo ruota lentamente (animateHologram);
 * - sphericalForce: forza per la simulazione d3 che dispone i ricordi dentro un guscio
 *   sferico, invece della classica "nuvola" informe di un grafo a forze.
 *
 * Il bagliore vero e proprio (bloom) lo aggiunge Nucleus.tsx con UnrealBloomPass.
 */
import * as THREE from 'three'

/** Raggio della sfera del nucleo, nelle unità della scena. */
export const SPHERE_RADIUS = 120

/** Colori dell'ologramma: ambra / oro come nell'immagine di riferimento. */
export const HOLO = {
  amber: '#ffb347',
  gold: '#ffd27a',
  deep: '#ff8c1a',
  // Nero puro: con la catena di post-processing (bloom) qualunque altro colore di fondo viene
  // schiarito (grigio-blu), mentre il nero resta nero. Verificato con le catture dell'app.
  background: '#000000'
}

let cachedTexture: THREE.Texture | null = null

/** Texture con un alone radiale bianco → trasparente, condivisa da tutti gli sprite. */
export function glowTexture (): THREE.Texture {
  if (cachedTexture) return cachedTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.2, 'rgba(255,255,255,0.8)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  cachedTexture = new THREE.CanvasTexture(canvas)
  return cachedTexture
}

/**
 * Sprite luminoso per un ricordo.
 * @param color   colore dell'alone
 * @param size    dimensione (più grande = più collegato o selezionato)
 * @param opacity 1 per i ricordi "accesi", bassa per quelli spenti da un filtro
 */
export function starSprite (color: string, size: number, opacity = 1): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false, // gli aloni non si "tagliano" a vicenda
    blending: THREE.AdditiveBlending
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(size, size, 1)
  return sprite
}

/** Materiale per linee olografiche sottili. */
function lineMaterial (color: string, opacity: number, dashed = false): THREE.LineBasicMaterial {
  const params = { color: new THREE.Color(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }
  return dashed ? new THREE.LineDashedMaterial({ ...params, dashSize: 3, gapSize: 4 }) : new THREE.LineBasicMaterial(params)
}

/** Cerchio di raggio r nel piano XY, come linea chiusa. */
function circle (r: number, material: THREE.LineBasicMaterial, segments = 160): THREE.LineLoop {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0))
  }
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material)
  line.computeLineDistances() // necessario per le linee tratteggiate
  return line
}

/**
 * Crea la "gabbia" olografica attorno ai ricordi. I numeri pseudo-casuali sono generati da
 * un seme fisso: la scena è identica a ogni apertura.
 */
export function createHologram (radius = SPHERE_RADIUS): THREE.Group {
  const group = new THREE.Group()
  group.name = 'hologram'
  let seed = 7
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }

  // Anelli orbitali a inclinazioni diverse: alcuni pieni, altri tratteggiati.
  for (let i = 0; i < 9; i++) {
    const r = radius * (1.02 + rand() * 0.38)
    const ring = circle(r, lineMaterial(i % 3 === 0 ? HOLO.gold : HOLO.amber, 0.12 + rand() * 0.25, i % 2 === 1))
    ring.rotation.set(rand() * Math.PI, rand() * Math.PI, 0)
    ring.userData.spin = (rand() - 0.5) * 0.004 // velocità di rotazione propria
    group.add(ring)
  }
  // Archi parziali: segmenti di circonferenza a raggi e inclinazioni diverse, come i "circuiti"
  // dell'immagine di riferimento. Alcuni più luminosi, la maggior parte appena accennati.
  for (let i = 0; i < 26; i++) {
    const r = radius * (0.7 + rand() * 0.75)
    const start = rand() * Math.PI * 2
    const span = Math.PI * (0.15 + rand() * 0.55)
    const pts: THREE.Vector3[] = []
    for (let s = 0; s <= 48; s++) {
      const a = start + (span * s) / 48
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0))
    }
    const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial(rand() > 0.75 ? HOLO.gold : HOLO.amber, 0.15 + rand() * 0.45))
    arc.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    arc.userData.spin = (rand() - 0.5) * 0.006
    group.add(arc)
  }
  // Corone graduate: anelli con tacche radiali, come le scale di uno strumento.
  for (let i = 0; i < 3; i++) {
    const r = radius * (1.18 + i * 0.12)
    const pts: THREE.Vector3[] = []
    const ticks = 120
    for (let t = 0; t < ticks; t++) {
      const a = (t / ticks) * Math.PI * 2
      const len = t % 10 === 0 ? 6 : 2.5 // una tacca lunga ogni dieci
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0), new THREE.Vector3(Math.cos(a) * (r + len), Math.sin(a) * (r + len), 0))
    }
    const crown = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial(HOLO.amber, 0.35))
    crown.rotation.set(rand() * Math.PI, rand() * Math.PI, 0)
    crown.userData.spin = (rand() - 0.5) * 0.002
    group.add(crown)
  }
  // Meridiani tratteggiati: danno l'idea di un globo.
  for (let i = 0; i < 6; i++) {
    const m = circle(radius * 0.98, lineMaterial(HOLO.deep, 0.08, true))
    m.rotation.y = (i / 6) * Math.PI
    group.add(m)
  }
  // Pulviscolo: particelle sparse appena fuori dalla superficie.
  const count = 1800
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1
    const phi = rand() * Math.PI * 2
    const r = radius * (0.95 + rand() * 0.55)
    const s = Math.sqrt(1 - u * u)
    positions.set([r * s * Math.cos(phi), r * s * Math.sin(phi), r * u], i * 3)
  }
  const dust = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
    new THREE.PointsMaterial({ color: new THREE.Color(HOLO.amber), size: 1.0, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
  )
  dust.userData.spin = 0.0006
  group.add(dust)
  return group
}

/** Fa ruotare lentamente il gruppo e ogni anello con la sua velocità. Da chiamare a ogni frame. */
export function animateHologram (group: THREE.Object3D): void {
  group.rotation.y += 0.0008
  for (const child of group.children) {
    const spin = child.userData.spin as number | undefined
    if (spin) child.rotation.z += spin
  }
}

/**
 * Forza d3 che spinge ogni nodo verso il proprio raggio "preferito" dentro la sfera, tra il
 * 45% e il 100% di `radius`. Il raggio preferito dipende dall'id del nodo (stabile fra un
 * avvio e l'altro), così i ricordi riempiono un guscio spesso invece di ammassarsi al centro.
 */
export function sphericalForce (radius = SPHERE_RADIUS, strength = 0.08) {
  let nodes: any[] = []
  const preferred = new Map<string, number>()
  const force = (alpha: number) => {
    for (const n of nodes) {
      const d = Math.hypot(n.x, n.y, n.z) || 1
      const target = preferred.get(n.id) ?? radius
      const k = ((target - d) / d) * alpha * strength
      n.vx += n.x * k
      n.vy += n.y * k
      n.vz += n.z * k
    }
  }
  force.initialize = (ns: any[]) => {
    nodes = ns
    for (const n of ns) {
      let h = 0
      for (let i = 0; i < n.id.length; i++) h = (h * 31 + n.id.charCodeAt(i)) >>> 0
      preferred.set(n.id, radius * (0.45 + ((h % 1000) / 1000) * 0.55))
    }
  }
  return force
}
