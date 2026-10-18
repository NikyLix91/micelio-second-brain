# Immagine Docker di micelio-server: il nodo di avvio della DHT privata del team (vedi README.md).
#
# Costruzione (dalla cartella server/):
#   docker build -t micelio-server .
#
# Esecuzione (vedi README.md, sezione "Con Docker"):
#   docker run -d --name micelio-server --restart unless-stopped --network host \
#     -e MICELIO_SERVER_HOST=<IP pubblico> micelio-server
#
# Base Debian (glibc) e non Alpine: il modulo nativo di rete di hyperdht (udx-native) non ha binari
# precompilati per musl, e su Alpine il server non parte.
#
# Due fasi: la prima compila il TypeScript, la seconda contiene solo il JavaScript compilato e le
# dipendenze di produzione (hyperdht), così l'immagine resta piccola. Nessun dato da conservare:
# il nodo di avvio non salva nulla su disco, quindi niente volumi.

# ── 1. Compilazione ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── 2. Esecuzione ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Porta UDP del nodo di avvio (MICELIO_SERVER_PORT, default 49737). Con --network host è solo
# documentazione; con -p va pubblicata come UDP: -p 49737:49737/udp
EXPOSE 49737/udp

# Utente senza privilegi (presente nell'immagine ufficiale di Node)
USER node
ENTRYPOINT ["node", "dist/main.js"]
