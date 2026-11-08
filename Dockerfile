# syntax=docker/dockerfile:1
# Production image: multi-stage, Node 24 (matches .nvmrc), Next.js standalone output, non-root user.

FROM node:24.22.2-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# postinstall runs `prisma generate`; no database connection is needed for it.
RUN npm ci

FROM node:24.22.2-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# Browser-visible Supabase settings are inlined into the JavaScript bundle at build time, so they
# must be passed as build arguments. They are the project URL and the PUBLISHABLE key only.
# Never pass SUPABASE_SECRET_KEY, DATABASE_URL, DIRECT_URL or an AI key as a build argument.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

FROM node:24.22.2-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Server-only secrets (SUPABASE_SECRET_KEY, DATABASE_URL, AI keys, ...) are supplied at run time
# with `docker run --env-file` or the platform's secret store, never baked into the image.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
