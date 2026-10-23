#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Instale o Docker (com Docker Compose) e rode de novo: https://docs.docker.com/get-docker/"
  echo "Sem Docker, rode só o editor com: npm run serve"
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  password=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
  key=$(head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 64)
  sed -i.bak -e "s|^CRIVO_DB_PASSWORD=.*|CRIVO_DB_PASSWORD=${password}|" -e "s|^CRIVO_SECRET_KEY=.*|CRIVO_SECRET_KEY=${key}|" .env
  rm -f .env.bak
  echo "Arquivo .env criado com senha e chave aleatórias."
fi

docker compose up -d --build

port=$(grep -E '^CRIVO_PORT=' .env | cut -d= -f2)
port=${port:-8080}
printf "Aguardando o Crivo subir"
for _ in $(seq 1 90); do
  if curl -fsS "http://localhost:${port}/api/v2/health" >/dev/null 2>&1; then
    echo
    echo "Pronto! Abra http://localhost:${port}"
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${port}" >/dev/null 2>&1 || true; fi
    if command -v open >/dev/null 2>&1; then open "http://localhost:${port}" >/dev/null 2>&1 || true; fi
    exit 0
  fi
  printf "."
  sleep 2
done
echo
echo "O Crivo ainda está subindo. Acompanhe com: docker compose logs -f web"
