# Stage 1: Build the Go binary
FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Stage 2: Final small image
FROM alpine:latest
WORKDIR /root/
COPY --from=builder /app/main .
# If you have a .env file or config folders, copy them here too
EXPOSE 8080
CMD ["./main"]