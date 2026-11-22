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