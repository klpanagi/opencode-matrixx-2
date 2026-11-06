export const composeSection = `## SECTION 2 — COMPOSE MODE

<compose_mode>
### Phase C1: Service Definition

#### C1.1 image: vs build:

\`\`\`yaml
# Use image: for pre-built images (production, third-party)
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped

# Use build: for your own code (development, custom images)
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        NODE_ENV: production
\`\`\`

#### C1.2 Environment Variables

\`\`\`yaml
services:
  app:
    environment:
      NODE_ENV: production
      LOG_LEVEL: \${LOG_LEVEL:-info}

services:
  app:
    env_file:
      - .env
      - .env.prod
# docker compose --env-file .env.prod up
\`\`\`

#### C1.3 Port Mapping

\`\`\`yaml
services:
  app:
    ports:
      - "3000:3000"          # host:container
      - "127.0.0.1:3000:3000"  # bind to specific interface
\`\`\`

---

### Phase C2: Networking

\`\`\`yaml
services:
  app:
    networks:
      - frontend
      - backend
  api:
    networks:
      backend:
        aliases:
          - api.internal
  db:
    networks:
      - backend

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true  # no external access
\`\`\`

Services are discoverable by name — \`app\` can reach \`http://api:3000\`.

---

### Phase C3: Volume Management

\`\`\`yaml
services:
  app:
    volumes:
      - app-data:/app/data        # named volume
      - ./src:/app/src:ro         # bind mount (dev hot-reload)
      - /app/node_modules         # exclude from bind mount

volumes:
  app-data:
    driver: local
\`\`\`

---

### Phase C4: Health Checks

\`\`\`yaml
services:
  app:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
\`\`\`

---

### Phase C5: Resource Limits

\`\`\`yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 256M
\`\`\`

---

### Phase C6: Multiple Compose Files

\`\`\`bash
# Dev — compose.override.yml auto-loaded
docker compose up

# Production — explicit stack
docker compose -f compose.yaml -f compose.prod.yml up -d

# Specific env file
docker compose --env-file .env.prod up -d
\`\`\`
</compose_mode>

---

## SECTION 3 — DEBUG MODE

<debug_mode>
### Phase D1: Container Inspection

\`\`\`bash
# Logs
docker logs -f CONTAINER
docker logs --tail 100 CONTAINER
docker logs --timestamps CONTAINER
docker compose logs -f SERVICE
docker compose logs --tail 50 SERVICE

# Container metadata
docker inspect CONTAINER
docker inspect --format '{{.State.Status}}' CONTAINER
docker inspect --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\\n"}}{{end}}' CONTAINER

# Interactive shell
docker exec -it CONTAINER sh
docker exec -it CONTAINER bash
docker exec -u 1001 CONTAINER whoami
\`\`\`

---

### Phase D2: Network Debugging

\`\`\`bash
docker network ls
docker network inspect NETWORK_NAME
docker port CONTAINER
docker compose ps
docker compose ps -a
docker compose logs SERVICE
docker compose logs --tail=100 -f SERVICE
docker exec CONTAINER nslookup other-service 2>/dev/null || \\
  docker exec CONTAINER getent hosts other-service
\`\`\`

---

### Phase D3: Resource Debugging

\`\`\`bash
docker stats
docker stats --no-stream
docker system df
docker system df -v
docker container ls -a
docker ps -a
docker image ls
docker image ls --digests
\`\`\`

---

### Phase D4: Common Container Issues

\`\`\`bash
# Container exits immediately
docker logs CONTAINER                    # Step 1: check logs
docker inspect --format '{{.Path}}' CONTAINER  # Step 2: check entrypoint
docker run -it --rm IMAGE sh            # Step 3: run interactively

# Port already in use
lsof -i :PORT
kill $(lsof -t -i :PORT)
docker run -p 3001:3000 IMAGE  # use different host port

# No space left on device
docker system prune          # clean dangling
docker system prune -a       # clean all unused
docker builder prune         # clean build cache
# See DESTRUCTIVE COMMAND GUARDS before pruning volumes

# Permission denied
docker inspect --format '{{.Config.User}}' CONTAINER
docker run --user "$(id -u):$(id -g)" -v "$(pwd):/app" IMAGE
# Fix: adduser --system --uid 1001 appuser && USER appuser
\`\`\`

---

### Phase D5: Compose Troubleshooting

\`\`\`bash
docker compose config              # validate compose file
docker compose config --services
docker compose config --volumes
docker compose down -v             # stop and remove volumes
docker compose build --no-cache    # rebuild from scratch
docker compose up -d               # start fresh
docker compose run --rm SERVICE env # check env resolution
\`\`\`
</debug_mode>

---

`
