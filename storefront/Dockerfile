# Production build for qa/prod. Local dev never uses this — `npm run dev`
# runs directly on the host via `op run`, which is faster to iterate on and
# needs no image at all.
#
# Three stages: install once, build once (with the NEXT_PUBLIC_* values baked
# in — Next.js inlines them at build time, so they can't be supplied later),
# then a minimal runtime that only holds `next.config.mjs`'s `output:
# "standalone"` result — not the full node_modules tree.
#
# NEXT_PUBLIC_* values differ between qa and prod (different domains), so this
# image is built once per environment, not once and reused. See the qa compose
# overlay's `build.args`.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Inlined into the client bundle by `next build` — there is no later point at
# which these could be supplied instead.
ARG NEXT_PUBLIC_SALEOR_API_URL
ARG NEXT_PUBLIC_SALEOR_CHANNEL
ARG NEXT_PUBLIC_SALEOR_DASHBOARD_URL
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SALEOR_API_URL=$NEXT_PUBLIC_SALEOR_API_URL \
    NEXT_PUBLIC_SALEOR_CHANNEL=$NEXT_PUBLIC_SALEOR_CHANNEL \
    NEXT_PUBLIC_SALEOR_DASHBOARD_URL=$NEXT_PUBLIC_SALEOR_DASHBOARD_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000

# Next's own recommendation: a non-root user for the runtime container.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
