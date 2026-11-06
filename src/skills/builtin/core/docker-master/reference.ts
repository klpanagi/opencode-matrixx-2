export const referenceSection = `## SECTION 6 — SHARED KNOWLEDGE

<shared_knowledge>
### Multi-Stage Build Rationale

\`\`\`
BENEFITS:
  1. Smaller final images - only runtime dependencies
  2. Separate concerns - dev deps isolated from production
  3. Security - no compilers or package managers in final image
  4. Cache independence - build and runtime stages cache separately
\`\`\`

### Health Check Patterns

\`\`\`dockerfile
HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1
HEALTHCHECK CMD ["curl", "-f", "http://localhost:3000/health"]
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1
\`\`\`

### .dockerignore

\`\`\`
The .dockerignore file is NOT optional. Without it:
  - Full directory sent as build context (100MB+)
  - Secrets may be leaked (node_modules may contain .env files)
  - Builds are unnecessarily slow
\`\`\`

### Layer Caching Fundamentals

\`\`\`
Each Dockerfile instruction creates a cacheable layer.
CACHE HITS: same FROM image, same instruction text, same file contents.
INVALIDATION: when a layer changes, all subsequent layers rebuild.
KEY STRATEGIES:
  - COPY package.json + lockfile BEFORE source code
  - Combine RUN commands with && to minimize layers
  - Use BuildKit cache mounts for persistent cross-build caches
\`\`\`

### Volume Permission Patterns

\`\`\`
Solutions for bind mount UID/GID mismatch:
  1. Run with host UID: docker run --user "$(id -u):$(id -g)" -v "$(pwd):/app" IMAGE
  2. Create matching user in Dockerfile: adduser --system --uid 1001 appuser
  3. Startup script adjusts permissions dynamically
\`\`\`

### Docker Context vs Dockerfile Location

\`\`\`
docker build [OPTIONS] CONTEXT_PATH
The -f flag specifies the Dockerfile. The final argument is the build context.
  docker build -f app/Dockerfile .  # Dockerfile at app/Dockerfile, context is .
  docker build .                    # Dockerfile in context, context is .
\`\`\`

### ARG vs ENV

\`\`\`
ARG (build-time): available during docker build, NOT persisted in final image.
  Syntax: ARG NODE_VERSION=20
  Pass: docker build --build-arg NODE_VERSION=22 .

ENV (runtime): available during build AND persisted in final image.
  Syntax: ENV NODE_ENV=production
  Visible via docker inspect.

SECURITY: NEVER use ENV or ARG for secrets - they leak in image history.
  Use BuildKit --secret instead (see Phase I4).
\`\`\`

### Security Cross-Reference

For a complete Dockerfile hardening checklist, load the \`security-infra\` skill (covers Trivy scanning, Grype, Dockerfile hardening, and more):
- Container image scanning with Trivy and Grype
- Vulnerability severity classification and remediation
- Docker Bench Security assessment
- Supply chain security for containerized applications
</shared_knowledge>

---

## SECTION 7 — DESTRUCTIVE COMMAND GUARDS

<critical_warning>
**The following Docker commands are DESTRUCTIVE — they cause PERMANENT DATA LOSS or SECURITY BREACHES.**

---

### GUARD 1: docker system prune -af --volumes

\`\`\`bash
# DESTROYS ALL unused containers, networks, images, build cache, AND volumes
docker system prune -af --volumes

# Safer alternatives:
docker system prune -f              # dangling images, stopped containers
docker system prune -af             # + unused images (not just dangling)
\`\`\`

**Irreversible:** All unattached volumes deleted permanently. Build cache cleared. No confirmation with \`-f\`.

**When appropriate:** CI runners and dev environments after confirming no important volumes exist (\`docker volume ls\`).

---

### GUARD 2: docker rmi -f

\`\`\`bash
docker rmi -f IMAGE  # force-removes even if containers reference it
\`\`\`

**Irreversible:** Image layers deleted — must pull or rebuild. Running containers may become unstable.
**Prefer:** Remove containers first, then \`docker rmi\` without \`-f\`.

---

### GUARD 3: --privileged Flag

\`\`\`bash
# Bypasses ALL Docker security isolation - full host device access
docker run --privileged IMAGE

# Safer alternatives:
docker run --cap-add SYS_ADMIN --cap-add NET_ADMIN IMAGE
docker run --device /dev/snd:/dev/snd IMAGE
\`\`\`

**When appropriate:** Docker-in-Docker in CI, kernel module manipulation (extremely rare).

**Irreversible:** Container can escape Docker isolation, modify host system, gain root-equivalent host access.
**NEVER use --privileged in production without documented security review.**
</critical_warning>

---

## SECTION 8 — HARD RULES

<critical_warning>
**These rules are NON-NEGOTIABLE. Violations are automatic failures.**

\`\`\`
1. NEVER use \`latest\` tag without a specific version adjacent — tag explicitly
2. NEVER run containers with \`--privileged\` without documenting security implications
3. NEVER use Compose v1 as primary syntax - use docker compose (v2)
4. NEVER bake secrets into images — use BuildKit \`--secret\` or runtime env
5. NEVER use \`ADD\` when \`COPY\` suffices (ADD auto-extracts archives and fetches URLs)
6. NEVER skip \`.dockerignore\` — always include the minimum context
7. NEVER run as root in containers when a non-root user works
8. NEVER use \`latest\` CI tag for production deployments
9. NEVER suggest orchestration platforms or alternative container runtimes (out of scope)
11. Always verify Docker is available before running commands (\`command -v docker\`)
\`\`\`
</critical_warning>

---

## SECTION 9 — ANTI-PATTERNS

<anti_patterns>
### Image and Build Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|---|---|---|
| \`latest\` tag in production | Unreproducible builds, no rollback | Pin to semver or SHA tag |
| Single-stage Dockerfiles | Images include build tools, 10x larger | Multi-stage builds (B1) |
| Compose v1 today | Unmaintained since July 2023 | Use docker compose (v2) |
| Running as root in containers | Security risk if compromised | Add \`USER\` directive |
| \`COPY .\` without .dockerignore | Sends entire project as context | Always include .dockerignore |
| Sequential RUN without chaining | Creates unnecessary layers | Chain with \`&&\` |
| \`--no-cache\` on every build | Defeats layer caching entirely | Use selective \`--no-cache-filter\` |
| \`ADD\` for \`COPY\` purposes | ADD auto-extracts, fetches URLs | Use \`COPY\` for local files |
| Ignoring \`HEALTHCHECK\` | No self-healing ability | Always define health checks |
| \`ARG\` for secrets | Leaks in image history | Use BuildKit \`--secret\` |

### Compose Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|---|---|---|
| Hardcoding secrets in YAML | Secrets committed to git | Use \`.env\` file or docker secrets |
| \`depends_on\` without health checks | Service may start before dependency ready | Add \`condition: service_healthy\` |
| Missing resource limits | One service can starve others | Set \`deploy.resources.limits\` |
| Default network only | No isolation between services | Define custom networks |

### CI/CD Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|---|---|---|
| Pushing \`latest\` without SHA tag | Cannot identify or rollback build | Include SHA or version tag |
| Single-platform builds | ARM users can't run your image | Build for amd64 + arm64 |
| No cache-from in CI | Every build starts from scratch | Use \`type=gha\` cache |
| Building without tests | Broken images in registry | Test before build (I1.2) |

### General Anti-Patterns

\`\`\`
1. "It works on my machine" — use compose for reproducible environments
2. One container for multiple processes — use multiple services
3. Storing state in containers — use volumes for persistence
4. :latest in production — always pin versions
5. Disabling security scanning — scan images before pushing
\`\`\`
</anti_patterns>

---

## Quick Reference

| Goal | Command |
|------|---------|
| Build an image | \`docker build -t name:tag .\` |
| Build with BuildKit | \`DOCKER_BUILDKIT=1 docker build .\` |
| Run a container | \`docker run -d --name myapp -p 3000:3000 IMAGE\` |
| List running/all containers | \`docker ps\` / \`docker ps -a\` |
| Follow logs | \`docker logs -f CONTAINER\` |
| Exec into container | \`docker exec -it CONTAINER sh\` |
| Compose up/down | \`docker compose up -d\` / \`docker compose down\` |
| Compose logs/config | \`docker compose logs -f\` / \`docker compose config\` |
| BuildX multi-arch | \`docker buildx build --platform linux/amd64,linux/arm64 --push .\` |
| Prune dangling/all | \`docker system prune\` / \`docker system prune -a\` |
| Login to registry | \`docker login REGISTRY\` |
| System disk usage | \`docker system df\` |

### Decision Tree

\`\`\`
What is the user asking about?
  +-- Building images / Dockerfile?       -> BUILD mode (B1-B5)
  +-- Service definitions / compose?       -> COMPOSE mode (C1-C6)
  +-- Debugging / troubleshooting?         -> DEBUG mode (D1-D5)
  +-- Optimization / reducing size?        -> OPTIMIZE mode (O1-O4)
  +-- CI/CD / registry / deployment?       -> CICD mode (I1-I4)
  +-- Mixed or unclear?
        -> Check VERSION first, then execute modes sequentially
\`\`\`

### Mode Map

| Mode | Entry Phase | Key Phase | Exit Verification |
|------|-------------|-----------|-------------------|
| BUILD | V1 (Version) | B1 (Multi-stage) | \`docker build .\` succeeds |
| COMPOSE | V1 (Version) | C4 (Health Checks) | \`docker compose config\` validates |
| DEBUG | V1 (Version) | D4 (Common Issues) | Container runs as expected |
| OPTIMIZE | V1 (Version) | O1 (Image Size) | \`docker image ls\` shows reduced size |
| CICD | V1 (Version) | I1 (GitHub Actions) | Image pushed to registry |
`
