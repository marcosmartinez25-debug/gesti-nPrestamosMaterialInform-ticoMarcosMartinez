#!/usr/bin/env bash
# Arranca la práctica entera: PostgreSQL en Docker, el usuario dwes_app,
# las tablas y el servidor de Node.
#
# Uso:
#   ./arrancar.sh            arranca todo
#   ./arrancar.sh --datos    además recarga init.sql y deja los datos como al principio
#
# Nota: no uses comillas simples en las contraseñas.

set -e

cd "$(dirname "$0")"
RAIZ="$(pwd)"

echo "== Práctica de préstamos de material informático =="

# 1. ¿Está Docker en marcha?
if ! docker info > /dev/null 2>&1; then
  echo "Docker no responde."
  echo "Abre Docker Desktop, espera a que ponga 'Engine running' y vuelve a lanzarme."
  exit 1
fi

# 2. El .env de Docker (clave del administrador de PostgreSQL)
if [ ! -f infra-postgres/.env ]; then
  echo "Falta infra-postgres/.env"
  read -r -s -p "Escribe una clave de administrador para PostgreSQL: " CLAVE_ADMIN
  echo
  printf 'DB_ADMIN_PASSWORD=%s\n' "$CLAVE_ADMIN" > infra-postgres/.env
  echo "Creado infra-postgres/.env"
fi

# 3. El .env de Node (datos de conexión)
if [ ! -f .env ]; then
  echo "Falta .env"
  read -r -s -p "Escribe la clave para el usuario dwes_app: " CLAVE_NUEVA
  echo
  printf 'PGHOST=127.0.0.1\nPGPORT=15432\nPGDATABASE=dwes\nPGUSER=dwes_app\nPGPASSWORD=%s\nPORT=3000\n' "$CLAVE_NUEVA" > .env
  echo "Creado .env"
fi

CLAVE_APP="$(grep '^PGPASSWORD=' .env | cut -d= -f2- | tr -d '\r')"
if [ -z "$CLAVE_APP" ]; then
  echo "El .env de la raíz no tiene PGPASSWORD. Revísalo."
  exit 1
fi

# 4. Levantar PostgreSQL
cd infra-postgres
docker compose up -d

printf 'Esperando a que PostgreSQL responda'
for _ in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U postgres -d dwes > /dev/null 2>&1; then
    break
  fi
  printf '.'
  sleep 2
done
echo

if ! docker compose exec -T db pg_isready -U postgres -d dwes > /dev/null 2>&1; then
  echo "PostgreSQL no ha llegado a arrancar. Mira qué dice: docker compose logs db"
  exit 1
fi
echo "PostgreSQL listo en 127.0.0.1:15432"

# 5. El usuario de la aplicación (si ya existe, no pasa nada)
docker compose exec -T db psql -U postgres -d dwes -q \
  -c "CREATE ROLE dwes_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;" > /dev/null 2>&1 || true
docker compose exec -T db psql -U postgres -d dwes -q \
  -c "ALTER ROLE dwes_app PASSWORD '$CLAVE_APP';" \
  -c "GRANT CONNECT, CREATE ON DATABASE dwes TO dwes_app;" > /dev/null
echo "Usuario dwes_app listo"

# 6. Las tablas y los datos
HAY_TABLAS="$(docker compose exec -T -e PGPASSWORD="$CLAVE_APP" db \
  psql -h 127.0.0.1 -U dwes_app -d dwes -tAc \
  "SELECT to_regclass('practica_prestamos.equipos') IS NOT NULL" | tr -d '\r')"

if [ "$HAY_TABLAS" != "t" ] || [ "$1" = "--datos" ]; then
  echo "Cargando init.sql..."
  docker compose exec -T -e PGPASSWORD="$CLAVE_APP" db \
    psql -h 127.0.0.1 -U dwes_app -d dwes -q -v ON_ERROR_STOP=1 < "$RAIZ/init.sql"
  echo "Tablas y datos de ejemplo cargados"
else
  echo "Las tablas ya estaban (./arrancar.sh --datos para dejarlas como al principio)"
fi

# 7. Dependencias de Node
cd "$RAIZ"
if [ ! -d node_modules ]; then
  echo "Instalando dependencias..."
  npm install
fi

# 8. El servidor
echo
echo "Arrancando el servidor. Abre http://127.0.0.1:3000/equipos"
echo "Para parar: Ctrl+C"
echo
node --env-file=.env src/server.mjs
