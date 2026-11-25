# Práctica DWES UD4: préstamos de material informático

Aplicación web para llevar el inventario de equipos de un centro (portátiles,
tabletas, proyectores...) y registrar sus préstamos y devoluciones sin que los
datos se queden a medias.

Node.js se ejecuta en mi equipo y PostgreSQL dentro de un contenedor. El acceso
a los datos es con SQL directo y consultas parametrizadas, usando el
controlador `pg`. Las dos páginas HTML se pintan con EJS.

## 1. Requisitos

- Node.js 24 (yo lo he probado con la versión 26.7, que también funciona)
- Docker y Docker Compose
- PostgreSQL 18 (viene en la imagen del contenedor)
- Dependencias: Express 5, pg 8 y EJS 3

## 2. Configuración

Hay dos archivos de configuración distintos, como en clase:

| Archivo | Para qué sirve |
| --- | --- |
| `infra-postgres/.env` | Solo la contraseña del administrador de PostgreSQL, que usa Compose para crear la base |
| `.env` (raíz) | Datos de conexión que lee Node (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) y el `PORT` de Express |

Ninguno de los dos se entrega. En su lugar están `infra-postgres/.env.example`
y `.env.example`, que tienen los nombres de las variables pero no las
contraseñas de verdad. Para poner en marcha el proyecto hay que copiarlos:

```
cp infra-postgres/.env.example infra-postgres/.env
cp .env.example .env
```

Y luego editarlos poniendo las contraseñas propias.

## 3. Arrancar PostgreSQL

Desde la carpeta `infra-postgres`:

```
docker compose up -d
docker compose ps
```

Hay que esperar a que el servicio aparezca como `healthy`. El contenedor
publica el puerto `15432` del equipo, así que Node se conecta a
`127.0.0.1:15432`.

Si ya tengo levantada la carpeta `infra-postgres` de la sesión 12, ese puerto
está ocupado y no hace falta crear otro contenedor: puedo usar el que ya tengo
y saltar al punto 4. Dos contenedores a la vez dan error de puerto.

La primera vez hay que crear el usuario de la aplicación (si no se hizo ya en
la sesión 12):

```
docker compose exec db psql -U postgres -d dwes
```

Y dentro de psql:

```
CREATE ROLE dwes_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password dwes_app
GRANT CONNECT, CREATE ON DATABASE dwes TO dwes_app;
\q
```

La contraseña que ponga aquí es la que va en `PGPASSWORD` del `.env` de la raíz.

## 4. Crear las tablas y los datos

`init.sql` crea el esquema `practica_prestamos` con las tres tablas, sus
restricciones y los datos de ejemplo. Se entra como el usuario de la aplicación
y se pega el contenido del archivo:

```
docker compose exec db psql -h 127.0.0.1 -U dwes_app -d dwes -W
```

El archivo empieza creando lo que falte y termina con un `TRUNCATE ...
RESTART IDENTITY`, así que se puede volver a pegar siempre que quiera dejar los
datos como al principio. Ojo: borra los datos de práctica que hubiera.

Datos iniciales:

- 3 usuarios: Ana Gil (1), Luis Soto (2), Marta Ruiz (3)
- 12 equipos en 6 categorías: `portatil`, `tableta`, `proyector`, `monitor`,
  `camara` y `audio`. Todos empiezan disponibles.

## 5. Arrancar la aplicación

Desde la raíz del proyecto:

```
npm install
node --env-file=.env src/server.mjs
```

Antes de abrir el puerto hace un `SELECT 1` para comprobar que la base
responde. Si no responde, avisa por consola y no arranca. La aplicación queda
en http://127.0.0.1:3000.

## 6. Rutas

Páginas HTML:

| Ruta | Qué hace |
| --- | --- |
| `GET /equipos` | Tabla con código, nombre, categoría y estado. Busca por nombre sin distinguir mayúsculas (`ILIKE`), filtra por categoría y por disponibilidad, ordena por código o por nombre y pagina de 5 en 5. Los enlaces Anterior y Siguiente mantienen los filtros. Si no hay resultados lo dice. |
| `GET /equipos/:id` | Datos del equipo, quién lo tiene prestado ahora si lo tiene, y la lista de todos sus préstamos con usuario y fechas. Devuelve 400 si el id está mal escrito y 404 si no existe. |

API (recibe y devuelve JSON):

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `POST /api/equipos` | `{ codigo, nombre, categoria }` | 201 con el equipo creado y la cabecera `Location`; 409 si el código ya existe; 400 si los datos están mal |
| `PUT /api/equipos/:id` | `{ codigo, nombre, categoria }` | 200 con el equipo actualizado; 404 si no existe; 409 si el código ya existe |
| `DELETE /api/equipos/:id` | sin cuerpo | 204 sin cuerpo; 404 si no existe; 409 si tiene préstamos |
| `POST /api/prestamos` | `{ equipoId, usuarioId }` | 201 con el préstamo; 409 si el equipo no está disponible; 400 si el usuario no existe |
| `POST /api/prestamos/:id/devolucion` | sin cuerpo | 200 con el préstamo devuelto; 409 si no existe o ya estaba devuelto |

Ejemplo con un cliente HTTP:

```
POST http://127.0.0.1:3000/api/prestamos
Content-Type: application/json

{ "equipoId": 1, "usuarioId": 1 }
```

## 7. Reglas que se cumplen

- El código de equipo es único y tiene entre 1 y 20 caracteres. Ni el nombre ni
  la categoría pueden ir vacíos. Eso lo vigila la base con `UNIQUE`, `NOT NULL`
  y `CHECK`, no solo la validación de Express.
- Un equipo no puede tener dos préstamos activos a la vez. Lo garantiza un
  índice `UNIQUE` parcial sobre `equipo_id` cuando `fecha_devolucion IS NULL`,
  más la comprobación de disponibilidad en la aplicación.
- Un equipo con préstamos, aunque ya estén devueltos, no se puede borrar. Las
  claves foráneas no tienen borrado en cascada, así que el histórico se
  conserva.
- La fecha de devolución no puede ser anterior a la del préstamo (`CHECK`).
- El préstamo y la devolución son atómicos. Cada uno pide un cliente al pool,
  hace `BEGIN`, las dos escrituras y `COMMIT`. Si algo falla, `ROLLBACK`, y el
  cliente se libera siempre en el `finally`.
- Al prestar se actualiza el equipo con `WHERE id=$1 AND disponible=true`. Si
  `rowCount` es 0, no se crea el préstamo. Esa condición es la que decide quién
  se lleva el equipo cuando llegan dos peticiones a la vez.
- El `INSERT` del préstamo va después, a propósito: si el usuario no existe,
  falla la clave foránea y el `ROLLBACK` devuelve el equipo a disponible. Así
  se ve una reversión de verdad, después de haber escrito.
- `PUT` no toca `disponible`. Ese campo solo cambia al prestar o al devolver.
- Todos los valores que llegan del cliente van como parámetros `$1`, `$2`...
  incluidos los filtros, los ids y el `LIMIT`/`OFFSET`. La ordenación no se
  concatena: el usuario elige entre dos opciones y el programa traduce cada una
  a un trozo de SQL escrito por mí.
- Los errores de restricción se tratan por su código (`23505` código repetido,
  `23503` referencia que no existe, `23502` y `23514` datos no admitidos) y no
  por el texto del mensaje. Al navegador no le llega SQL ni contraseñas.

## 8. Comprobaciones hechas

`comprobaciones.mjs` pasa los casos con `fetch`, sin instalar nada más. Para
que salga igual hay que volver a pegar `init.sql` antes (datos de partida) y
tener el servidor arrancado en otra terminal:

```
node --env-file=.env src/server.mjs     (una terminal)
node comprobaciones.mjs                 (otra terminal)
```

La prueba de simultaneidad manda los dos préstamos con `Promise.all`, sin
esperar a que termine el primero.

| Caso | Petición | Resultado esperado | Resultado obtenido |
| --- | --- | --- | --- |
| Alta de equipo | `POST /api/equipos` | 201, Location sí | 201, Location sí |
| Código repetido | `POST /api/equipos` (mismo codigo) | 409 | 409 |
| Datos no válidos | `POST /api/equipos` (codigo y nombre malos) | 400 | 400 |
| Modificación | `PUT /api/equipos/13` | 200, tableta | 200, tableta |
| PUT no cambia disponible | `PUT /api/equipos/13` con `disponible:false` | true | true |
| Modificar id inexistente | `PUT /api/equipos/999999` | 404 | 404 |
| Listado (5 por página, orden por código) | `GET /equipos` | 200, ALT01 sí, PORT01 no | 200, ALT01 sí, PORT01 no |
| Búsqueda ILIKE | `GET /equipos?q=PORTÁTIL` | 200, PORT01 sí | 200, PORT01 sí |
| Filtro por categoría | `GET /equipos?categoria=audio` | 200, AUR01 sí, PORT01 no | 200, AUR01 sí, PORT01 no |
| Orden por nombre | `GET /equipos?orden=nombre` | 200, ALT01 sí | 200, ALT01 sí |
| Segunda página | `GET /equipos?pagina=2` | 200, PORT01 sí, ALT01 no | 200, PORT01 sí, ALT01 no |
| Filtros al paginar | `GET /equipos?q=o&orden=nombre&pagina=2` | 200, enlace con q y orden sí | 200, enlace con q y orden sí |
| Sin resultados | `GET /equipos?q=zzzz` | 200, aviso sí | 200, aviso sí |
| Paginación no válida | `GET /equipos?pagina=0` | 400 | 400 |
| Id mal formado | `GET /equipos/abc` | 400 | 400 |
| Equipo inexistente | `GET /equipos/999999` | 404 | 404 |
| Borrado sin historial | `DELETE /api/equipos/13` | 204 | 204 |
| Borrado repetido | `DELETE /api/equipos/13` | 404 | 404 |
| Préstamo correcto | `POST /api/prestamos` (equipo 1, usuario 1) | 201 | 201 |
| Equipo prestado | `GET /equipos/1` | Prestado sí, Ana Gil sí | Prestado sí, Ana Gil sí |
| Préstamo duplicado | `POST /api/prestamos` (equipo 1 otra vez) | 409 | 409 |
| Borrado con préstamos | `DELETE /api/equipos/1` | 409 | 409 |
| Rollback (usuario inexistente) | `POST /api/prestamos` (equipo 2, usuario 999) | 400 | 400 |
| Estado tras rollback | `GET /equipos/2` | Disponible sí, sin préstamos sí | Disponible sí, sin préstamos sí |
| Devolución | `POST /api/prestamos/1/devolucion` | 200, fecha_devolucion sí | 200, fecha_devolucion sí |
| Equipo devuelto | `GET /equipos/1` | Disponible sí | Disponible sí |
| Segunda devolución | `POST /api/prestamos/1/devolucion` | 409 | 409 |
| Simultaneidad | `POST /api/prestamos` x2 a la vez (equipo 3) | 201,409 | 201,409 |
| Un solo préstamo guardado | `GET /equipos/3` | 1 fila de préstamo | 1 fila de préstamo |

Las 29 comprobaciones salen bien.

Como la respuesta HTTP sola no demuestra lo que quedó guardado, también lo he
mirado en psql:

```
SELECT e.codigo, e.disponible, p.id, p.fecha_devolucion
  FROM practica_prestamos.equipos AS e
  LEFT JOIN practica_prestamos.prestamos AS p ON p.equipo_id = e.id
 ORDER BY e.id;
```

Y he probado a saltarme las restricciones a mano, que es la forma de ver que
están puestas de verdad:

| Lo que intento en psql | Qué pasa |
| --- | --- |
| Insertar un segundo préstamo activo del mismo equipo | Error del índice `un_prestamo_activo` |
| Insertar un equipo con código vacío | Error del `CHECK` de `codigo` |
| Insertar un equipo con nombre vacío | Error del `CHECK` de `nombre` |
| Borrar el equipo 1, que ya tiene un préstamo devuelto | Error de clave foránea |
| Poner una devolución anterior al préstamo | Error del `CHECK` de fechas |
| Prestar a un usuario que no existe | Error de clave foránea |

## 9. Las mismas comprobaciones con curl

El script del punto 8 lo hace todo de golpe. Aquí están las mismas peticiones
una a una desde la terminal, para poder verlas en directo. Pego `init.sql`
antes de empezar y las lanzo en este orden, porque cada bloque da por hecho el
estado que deja el anterior. La opción `-i` saca el código de estado y las
cabeceras, que es lo que se compara con la tabla.

```
BASE=http://127.0.0.1:3000
```

Si lo lanzo desde el CMD de Windows, el `-d` con comillas simples no funciona;
uso Git Bash o PowerShell.

### 9.1. Alta y modificación

Con los datos de `init.sql` recién pegados hay 12 equipos, así que el equipo
nuevo sale con el id 13. Si no coincide, uso el id que venga en la respuesta.

```
# 201 y cabecera Location
curl -i -X POST "$BASE/api/equipos" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"TEST01","nombre":"Equipo de prueba","categoria":"portatil"}'

# 409: el código ya existe
curl -i -X POST "$BASE/api/equipos" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"TEST01","nombre":"Otro equipo","categoria":"portatil"}'

# 400: el código solo admite mayúsculas, números y guiones, y el nombre no
# puede ir vacío
curl -i -X POST "$BASE/api/equipos" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"minusculas!","nombre":"","categoria":"portatil"}'

# 200 y la categoría cambiada a tableta
curl -i -X PUT "$BASE/api/equipos/13" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"TEST01","nombre":"Equipo de prueba editado","categoria":"tableta"}'

# 200 y disponible sigue en true: PUT no toca ese campo
curl -i -X PUT "$BASE/api/equipos/13" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"TEST01","nombre":"Equipo de prueba editado","categoria":"tableta","disponible":false}'

# 404: el id no existe
curl -i -X PUT "$BASE/api/equipos/999999" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"NADA","nombre":"No existe","categoria":"portatil"}'
```

### 9.2. Consulta y filtros

```
# Primera página ordenada por código: sale ALT01 y no sale PORT01
curl -i "$BASE/equipos"

# Búsqueda sin distinguir mayúsculas ni minúsculas (ILIKE)
curl -i -G "$BASE/equipos" --data-urlencode "q=PORTÁTIL"

# Filtro por categoría: sale AUR01 y no sale PORT01
curl -i "$BASE/equipos?categoria=audio"

# Filtro por disponibilidad (solo admite si o no)
curl -i "$BASE/equipos?disponibilidad=si"
curl -i "$BASE/equipos?disponibilidad=no"

# Ordenar por nombre
curl -i "$BASE/equipos?orden=nombre"

# Segunda página: sale PORT01 y ya no sale ALT01
curl -i "$BASE/equipos?pagina=2"

# Los filtros se mantienen al pasar de página: en los enlaces Anterior y
# Siguiente aparecen q y orden
curl -i "$BASE/equipos?q=o&orden=nombre&pagina=2"

# 200 con el aviso de que no hay equipos
curl -i "$BASE/equipos?q=zzzz"

# 400: la página empieza en 1
curl -i "$BASE/equipos?pagina=0"

# Detalle correcto, id mal escrito (400) e id inexistente (404)
curl -i "$BASE/equipos/1"
curl -i "$BASE/equipos/abc"
curl -i "$BASE/equipos/999999"
```

Para ver solo el código de estado, sin el HTML de la página:

```
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/equipos?pagina=0"
```

### 9.3. Borrado

```
# 204 sin cuerpo: el equipo de prueba no tiene préstamos
curl -i -X DELETE "$BASE/api/equipos/13"

# 404: ya está borrado
curl -i -X DELETE "$BASE/api/equipos/13"
```

### 9.4. Préstamo, duplicado y borrado con historial

```
# 201 con el id del préstamo
curl -i -X POST "$BASE/api/prestamos" \
  -H "Content-Type: application/json" \
  -d '{"equipoId":1,"usuarioId":1}'

# El equipo 1 aparece como Prestado y a nombre de Ana Gil
curl -i "$BASE/equipos/1"

# 409: el mismo equipo ya está prestado
curl -i -X POST "$BASE/api/prestamos" \
  -H "Content-Type: application/json" \
  -d '{"equipoId":1,"usuarioId":2}'

# 409: el equipo 1 ya tiene préstamos registrados
curl -i -X DELETE "$BASE/api/equipos/1"
```

### 9.5. Rollback

El usuario 999 no existe, así que falla la clave foránea del `INSERT` y el
`ROLLBACK` tiene que devolver el equipo a disponible.

```
# 400
curl -i -X POST "$BASE/api/prestamos" \
  -H "Content-Type: application/json" \
  -d '{"equipoId":2,"usuarioId":999}'

# El equipo 2 sigue Disponible y sin ningún préstamo
curl -i "$BASE/equipos/2"
```

### 9.6. Devolución

El id de la URL es el del préstamo, no el del equipo. Con el estado de partida
el primer préstamo es el 1.

```
# 200 y fecha_devolucion con valor
curl -i -X POST "$BASE/api/prestamos/1/devolucion"

# El equipo 1 vuelve a estar Disponible
curl -i "$BASE/equipos/1"

# 409: ese préstamo ya se devolvió
curl -i -X POST "$BASE/api/prestamos/1/devolucion"

# 409: el préstamo no existe
curl -i -X POST "$BASE/api/prestamos/999999/devolucion"
```

### 9.7. Simultaneidad

Los dos préstamos del equipo 3 salen a la vez (el `&` los deja en segundo plano
y `wait` espera a los dos). Solo uno puede confirmarse: uno responde 201 y el
otro 409.

```
curl -s -o /dev/null -w "A: %{http_code}\n" -X POST "$BASE/api/prestamos" \
  -H "Content-Type: application/json" -d '{"equipoId":3,"usuarioId":1}' &
curl -s -o /dev/null -w "B: %{http_code}\n" -X POST "$BASE/api/prestamos" \
  -H "Content-Type: application/json" -d '{"equipoId":3,"usuarioId":2}' &
wait

# El equipo 3 tiene una sola fila de préstamo
curl -i "$BASE/equipos/3"
```
