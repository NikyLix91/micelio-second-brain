# Immagine di un nodo Micelio (usata per i test end-to-end e per nodi "sempre accesi").
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Solo le dipendenze della radice (daemon e CLI): UI ed Electron non servono in un nodo headless.
RUN npm ci --workspaces=false
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# Senza dipendenze opzionali: transformers.js (embedding locali, ~900 MB con il runtime ONNX) non
# serve nei container, che usano l'embedder finto o solo le parole chiave.
RUN npx tsc -p tsconfig.build.json && npm prune --omit=dev --omit=optional --workspaces=false

FROM node:24-slim
# Etichetta usata per ripulire SOLO le immagini orfane di Micelio dopo i rebuild
# (docker image prune -f --filter label=org.micelio.image=node), senza toccare altri progetti.
LABEL org.micelio.image=node
WORKDIR /app
ENV MICELIO_HOME=/data MICELIO_HOST=0.0.0.0 NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN printf '#!/bin/sh\nexec node /app/dist/cli/main.js "$@"\n' > /usr/local/bin/micelio && chmod +x /usr/local/bin/micelio
VOLUME /data
EXPOSE 7337
CMD ["micelio", "daemon"]
