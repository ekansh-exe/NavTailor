# NavTailor: one container that serves the API AND the built React app from one origin.
#
#   docker build --build-arg VITE_GOOGLE_CLIENT_ID=<id> -t navtailor .
#   docker run --env-file server/.env -e CLIENT_ORIGIN=http://localhost:8000 -e PORT=8000 -p 8000:8000 navtailor
#
# No secret is ever an ARG or ENV in this file. Secrets (MONGODB_URI, JWT_SECRET, API keys) are given
# to the running container by the host. The image itself contains none, so it is safe to build from a
# public repo.

# ---------- stage 1: build the React client ----------
FROM node:22-bookworm-slim AS client
WORKDIR /build/client

# Dependencies first: this layer is reused until package*.json changes.
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY client/ ./
# Vite writes VITE_* variables INTO the built JavaScript, so this must be known at build time.
# A Google OAuth client id is public (every visitor's browser sees it); it is not a secret.
# Render (like most Docker hosts) passes a service environment variable with the same name to this ARG.
ARG VITE_GOOGLE_CLIENT_ID
RUN test -n "$VITE_GOOGLE_CLIENT_ID" || (echo "VITE_GOOGLE_CLIENT_ID build argument is missing" >&2 && exit 1)
RUN npm run build

# ---------- stage 2: the runtime image ----------
FROM node:22-bookworm-slim AS runtime

# Tectonic, the LaTeX engine: one pinned, static (musl) binary from the official release, checked
# against its published sha256 before it is used. ca-certificates: Tectonic downloads its TeX bundle
# over HTTPS during the warm-up below.
ARG TECTONIC_VERSION=0.17.0
ARG TECTONIC_SHA256=8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL -o /tmp/tectonic.tar.gz \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
 && echo "${TECTONIC_SHA256}  /tmp/tectonic.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic \
 && rm /tmp/tectonic.tar.gz \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && tectonic --version

WORKDIR /app/server

# Production dependencies only (mongodb-memory-server is a test tool and stays out).
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# The code. Owned by root and not writable by the user the app runs as, so a compromised process
# cannot change it.
COPY server/src ./src
COPY server/scripts ./scripts
COPY --from=client /build/client/dist /app/client/dist

# The only folder the app user may write to (besides /tmp, where each compile gets its own temp folder).
RUN mkdir -p /app/.cache && chown node:node /app/.cache
ENV XDG_CACHE_HOME=/app/.cache

# Run as the unprivileged "node" user (uid 1000) that the official Node image provides. Never root.
USER node

# Fill Tectonic's cache NOW, at build time: the TeX packages and fonts the template needs become part
# of the image. A host that wipes its disk on every restart still has them, and the first real PDF
# does not wait a minute for downloads. The script then compiles again with --only-cached, so an
# incomplete cache FAILS THIS BUILD instead of a user's PDF.
RUN npm run warm:pdf

# At runtime Tectonic may still download a file the cache lacks (TECTONIC_ONLY_CACHED is deliberately
# NOT set): a template change that needs a new font then costs one slow compile, not a broken PDF.
# Production mode: Secure cookie, no /api/dev routes.
ENV NODE_ENV=production \
    PORT=8000

EXPOSE 8000
CMD ["node", "src/index.js"]
