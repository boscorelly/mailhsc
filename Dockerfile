# ─── Build stage ──────────────────────────────────────────────────────────────
# Pin digest after first build: run ./scripts/pin-images.sh
FROM golang:1.22-alpine AS builder

# Security: no CGO, static binary
# GOARCH auto-detected from build platform — remove explicit GOARCH for multi-arch
ENV CGO_ENABLED=0 GOOS=linux

WORKDIR /build

# Cache dependencies first
COPY go.mod ./
RUN go mod download

COPY . .

RUN go build -trimpath -ldflags="-s -w" -o /mailhsc .

# ─── Final stage ──────────────────────────────────────────────────────────────
# Use distroless: no shell, no package manager, minimal CVE surface
# Pin digest after first build: run ./scripts/pin-images.sh
FROM gcr.io/distroless/static-debian12:nonroot

# Copy binary + static files only
# Static files are embedded in the binary — no separate copy needed
COPY --from=builder --chown=nonroot:nonroot /mailhsc /mailhsc

# nonroot user (65532) already set by distroless:nonroot
USER nonroot:nonroot

EXPOSE 8080

ENTRYPOINT ["/mailhsc"]
