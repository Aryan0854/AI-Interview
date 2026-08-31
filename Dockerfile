# =============================================================================
# AI Interview Platform — Azure Container Apps / Azure App Service / ACR
# =============================================================================
#
# Prerequisites:
#   - Supabase project with schema from docs/supabase-schema/master-azure-migration.sql
#   - Storage buckets: app-data, docs-ingest (public or signed URLs per your policy)
#   - Sync scripts run once from CI or locally:
#       npx tsx scripts/sync-manifest-to-supabase.ts
#       DOCS_USE_CLOUD=1 npx tsx scripts/sync-docs-to-cloud.ts
#
# Build (pass public Next.js vars at build time):
#   docker build -t ai-interview:latest \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
#     --build-arg NEXT_PUBLIC_APP_URL=https://your-app.azurecontainerapps.io \
#     .
#
# Run locally:
#   docker run -p 3000:3000 --env-file .env.azure ai-interview:latest
#
# Azure Container Apps:
#   1. az acr build -r MYREGISTRY -t ai-interview:latest .
#   2. Create Container App with port 3000, ingress external
#   3. Set runtime secrets from .env.azure.example (App Settings / Key Vault refs)
#   4. Optional volume mount at /app/uploads for ephemeral file cache
#
# =============================================================================

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# --- Install all dependencies (devDeps required for `next build`) ---
FROM base AS deps
COPY package.json package-lock.json* .npmrc ./
RUN npm ci

# --- Build Next.js standalone output ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- Production runtime ---
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Container / Azure runtime — Supabase DB + cloud doc storage (not local JSON/docs)
ENV CONTAINER=1
ENV USE_SUPABASE_PRIMARY=1
ENV DOCS_USE_CLOUD=1
ENV UPLOADS_DIR=/app/uploads

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/uploads \
  && chown -R nextjs:nodejs /app/uploads

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Employee portal Excel sources (admin employee tab + login cohort)
COPY --chown=nextjs:nodejs excel ./excel

# Seed/fallback JSON bundled with the app (accounts, manifest, local_tests_db)
COPY --chown=nextjs:nodejs src/data ./src/data

USER nextjs
EXPOSE 3000

VOLUME ["/app/uploads"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
