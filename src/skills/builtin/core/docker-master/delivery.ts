export const deliverySection = `## SECTION 4 — OPTIMIZE MODE

<optimize_mode>
### Phase O1: Image Size Optimization

#### O1.1 Base Image Comparison

\`\`\`
node:20             ~1.1 GB     — full OS + build tools
node:20-slim        ~250 MB     — minimal OS
node:20-alpine      ~130 MB     — musl-based, very small
distroless          ~70 MB      — static binary + minimal runtime
scratch             ~0 MB       — nothing (static binaries only)

RECOMMENDATIONS:
  Production Node.js/Python:  slim variant
  Production Go/Rust:         distroless or scratch
  Development:                alpine or full
  Maximum security:           distroless (no shell, no package manager)
\`\`\`

#### O1.2 Package Manager Optimization

\`\`\`dockerfile
# npm — production only, no cache layer
RUN npm ci --only=production && npm cache clean --force

# pip — no cache
RUN pip install --no-cache-dir -r requirements.txt

# apt — clean in same layer
RUN apt-get update && apt-get install -y --no-install-recommends curl \\
    && rm -rf /var/lib/apt/lists/*

# apk — Alpine (compact by default)
RUN apk add --no-cache curl

# BuildKit cache mount for cross-build persistence
RUN --mount=type=cache,target=/root/.npm \\
    npm ci --only=production
\`\`\`

---

### Phase O2: Build Speed Optimization

#### O2.1 Layer Ordering Strategy

\`\`\`dockerfile
# Stable layers first, then dependencies, then app code
FROM node:20-alpine
RUN apk add --no-cache dumb-init curl
COPY package*.json tsconfig.json ./
RUN npm ci
COPY . .
RUN npm run build
\`\`\`

#### O2.2 CI Pipeline Caching

\`\`\`bash
docker build \\
  --cache-from registry.example.com/my-app:cache \\
  --tag registry.example.com/my-app:latest \\
  --tag registry.example.com/my-app:$CI_COMMIT_SHA \\
  .
\`\`\`

#### O2.3 Parallel Builds with BuildX Bake

\`\`\`hcl
# docker-bake.hcl
group "default" { targets = ["app", "worker"] }
target "app" { context = "."; tags = ["my-app:latest"] }
target "worker" { context = "."; tags = ["my-worker:latest"] }
\`\`\`

\`\`\`bash
docker buildx bake
docker buildx bake app
\`\`\`

---

### Phase O3: Runtime Optimization

\`\`\`yaml
services:
  app:
    read_only: true           # security + performance
    tmpfs:
      - /tmp
      - /var/run
    volumes:
      - app-data:/app/data    # persistent writable storage
\`\`\`

\`\`\`bash
# Resource limits
docker run --memory="512m" --memory-reservation="256m" --cpus="0.5" IMAGE

# Graceful shutdown
docker stop -t 30 CONTAINER
\`\`\`

---

### Phase O4: Security Cross-Reference

For a complete Dockerfile hardening checklist, load the \`security-infra\` skill (covers Trivy scanning, Grype, Dockerfile hardening, and more).

Key Dockerfile hardening points (quick reference — see \`security-infra\` for full detail):
- Use specific image tags (never \`latest\` without a specific version adjacent)
- Multi-stage builds to minimize final image size and attack surface
- Run as non-root user (\`USER\` directive)
- Don't copy secrets into images (use BuildKit \`--secret\` or runtime env)
- Use \`COPY\` instead of \`ADD\` (\`ADD\` auto-extracts archives and fetches URLs)
- Set \`HEALTHCHECK\` for container monitoring
- Minimize installed packages, remove package manager caches
- Use \`.dockerignore\` to exclude sensitive files
</optimize_mode>

---

## SECTION 5 — CI/CD MODE

<cicd_mode>
### Phase I1: GitHub Actions

#### I1.1 Build and Push Workflow

\`\`\`yaml
name: Docker Build and Push
on:
  push:
    branches: [main]
    tags: ["v*"]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: $\{{ github.actor }}
          password: $\{{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/$\{{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,format=short
            type=ref,event=branch

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: $\{{ steps.meta.outputs.tags }}
          labels: $\{{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64
\`\`\`

#### I1.2 Test Before Build

\`\`\`yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          docker compose -f compose.test.yml up --abort-on-container-exit --exit-code-from app

  build:
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: $\{{ github.actor }}
          password: $\{{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/$\{{ github.repository }}:$\{{ github.sha }}
\`\`\`

---

### Phase I2: Multi-Platform Builds

\`\`\`bash
# Setup QEMU emulation for multi-arch
docker run --privileged --rm tonistiigi/binfmt --install all

# Create multi-architecture builder
docker buildx create --name multiarch --use
docker buildx inspect --bootstrap

# Build for multiple platforms
docker buildx build \\
  --platform linux/amd64,linux/arm64,linux/arm/v7 \\
  --tag my-app:latest --push .

docker manifest inspect my-app:latest
\`\`\`

---

### Phase I3: Registry Management

\`\`\`bash
# Authenticate
docker login -u USERNAME
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Tag and push
docker tag my-app:latest ghcr.io/owner/repo:v1.2.3
docker tag my-app:latest ghcr.io/owner/repo:sha-abc1234
docker push ghcr.io/owner/repo --all-tags
\`\`\`

#### Tagging Strategies

\`\`\`
RECOMMENDED (most -> least specific):
  1. SEMVER:    v1.2.3, v1.2, v1     <- BEST for releases
  2. SHA:       sha-<short-sha>      <- BEST for traceability
  3. BRANCH:    main, develop       <- BEST for CI/CD
  4. LATEST:    latest               <- ALWAYS pair with a specific tag

WARNING: \`latest\` tag ALONE is dangerous:
  - Builds are not reproducible without additional tags
  - Rolling back is impossible
  - ALWAYS pair \`latest\` with a specific version tag in the same push
\`\`\`

---

### Phase I4: Secret Management in CI

#### I4.1 BuildKit Secrets (Recommended)

\`\`\`dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=npm_token \\
    NPM_TOKEN=$(cat /run/secrets/npm_token) && \\
    npm config set //registry.npmjs.org/:_authToken $NPM_TOKEN && \\
    npm ci
\`\`\`

\`\`\`bash
# Pass secret from environment variable
DOCKER_BUILDKIT=1 docker build \\
  --secret id=npm_token,env=NPM_TOKEN -t my-app .

# GitHub Actions
- uses: docker/build-push-action@v6
  with:
    secrets: |
      npm_token=$\{{ secrets.NPM_TOKEN }}
\`\`\`

#### I4.2 Anti-Pattern: Baking Secrets with ARG

\`\`\`dockerfile
# WRONG - secret leaks in image history
FROM node:20-alpine
ARG NPM_TOKEN
RUN npm config set //registry.npmjs.org/:_authToken $NPM_TOKEN && npm ci

# CORRECT - use BuildKit --secret (see I4.1)
\`\`\`

#### I4.3 Runtime Secrets

\`\`\`yaml
# OK for runtime - not baked into image layers
services:
  app:
    environment:
      - DATABASE_URL=\${DATABASE_URL}
      - API_KEY=\${API_KEY}
    # NEVER hardcode secrets in compose.yaml
\`\`\`
</cicd_mode>

---

`
