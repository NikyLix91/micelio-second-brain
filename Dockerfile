# Immagine di un nodo Micelio (usata per i test end-to-end e per nodi "sempre accesi").
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

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
