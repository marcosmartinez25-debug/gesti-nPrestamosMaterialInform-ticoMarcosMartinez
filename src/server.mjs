// Arranque de Express: rutas, validación de entradas, traducción de errores
// a respuestas HTTP y cierre ordenado. El SQL vive en los otros módulos.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { crearRepositorioEquipos } from './equipos.repo.mjs';
import { crearServicioPrestamos } from './prestamos.service.mjs';

const app = express();
const equipos = crearRepositorioEquipos(pool);
const prestamos = crearServicioPrestamos(pool);

app.use(express.json({ limit: '10kb' }));
app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('../views/', import.meta.url)));

// ---------- Validación ----------

const esApi = req => req.path.startsWith('/api/');

// Las páginas HTML responden texto; la API, JSON.
const responder = (req, res, estado, mensaje) =>
  esApi(req)
    ? res.status(estado).json({ error: mensaje })
    : res.status(estado).send(mensaje);

// Comprueba el :id de la URL antes de entrar en las rutas que lo usan.
app.param('id', (req, res, next, texto) => {
  const id = Number(texto);
  if (!/^[1-9]\d*$/.test(texto) || !Number.isSafeInteger(id) ||
      id > 2147483647) {
    return responder(req, res, 400, 'Identificador no válido');
  }
  req.idRecurso = id;
  next();
});

// Identificadores recibidos en el cuerpo JSON.
const idValido = x =>
  Number.isInteger(x) && x > 0 && x <= 2147483647;

// Cuerpo de alta y modificación de equipos.
function datosEquipoValidos(b) {
  return b &&
    typeof b.codigo === 'string' &&
    typeof b.nombre === 'string' &&
    typeof b.categoria === 'string' &&
    /^[A-Z0-9-]{1,20}$/.test(b.codigo) &&
    b.nombre.trim().length >= 1 && b.nombre.trim().length <= 80 &&
    b.categoria.trim().length >= 1 && b.categoria.trim().length <= 40;
}

const datosEquipo = b => ({
  codigo: b.codigo,
  nombre: b.nombre.trim(),
  categoria: b.categoria.trim()
});

// ---------- Modelos de vista ----------

const aVista = fila => ({
  id: fila.id,
  codigo: fila.codigo,
  nombre: fila.nombre,
  categoria: fila.categoria,
  estado: fila.disponible ? 'Disponible' : 'Prestado'
});

// Decisión sobre las fechas: se muestran con la zona horaria del servidor.
const fechaTexto = valor =>
  valor === null ? 'Sin devolver' : valor.toLocaleString('es-ES');

// ---------- Vistas HTML ----------

app.get('/equipos', async (req, res) => {
  const q = req.query.q ?? '';
  const categoria = req.query.categoria ?? '';
  const disponibilidad = req.query.disponibilidad ?? '';
  const orden = req.query.orden ?? 'codigo';
  const textoPagina = req.query.pagina ?? '1';

  if (typeof q !== 'string' || q.length > 80 ||
      typeof categoria !== 'string' || categoria.length > 40 ||
      typeof disponibilidad !== 'string' ||
      !['', 'si', 'no'].includes(disponibilidad) ||
      !['codigo', 'nombre'].includes(orden) ||
      typeof textoPagina !== 'string' ||
      !/^[1-9]\d{0,3}$/.test(textoPagina)) {
    return res.status(400).send('Filtros no válidos');
  }

  const pagina = Number(textoPagina);
  const { filas, haySiguiente } = await equipos.listar({
    q, categoria, disponibilidad, orden, pagina
  });

  // Los enlaces de página conservan búsqueda, filtros y orden.
  const enlace = n => '/equipos?' + new URLSearchParams({
    q, categoria, disponibilidad, orden, pagina: String(n)
  });

  res.render('equipos', {
    equipos: filas.map(aVista),
    q, categoria, disponibilidad, orden, pagina,
    anterior: pagina > 1 ? enlace(pagina - 1) : null,
    siguiente: haySiguiente ? enlace(pagina + 1) : null
  });
});

app.get('/equipos/:id', async (req, res) => {
  const fila = await equipos.detalle(req.idRecurso);
  if (!fila) return res.status(404).send('Equipo inexistente');

  const historial = await equipos.historial(req.idRecurso);

  res.render('equipo', {
    equipo: {
      ...aVista(fila),
      usuarioActual: fila.usuario_actual,
      prestamoActivoId: fila.prestamo_activo_id,
      prestamoActivoFecha: fila.prestamo_activo_fecha === null
        ? null
        : fechaTexto(fila.prestamo_activo_fecha)
    },
    prestamos: historial.map(p => ({
      id: p.id,
      usuario: p.usuario,
      prestamo: fechaTexto(p.fecha_prestamo),
      devolucion: fechaTexto(p.fecha_devolucion)
    }))
  });
});

// ---------- API de escritura ----------

app.post('/api/equipos', async (req, res) => {
  if (!datosEquipoValidos(req.body)) {
    return res.status(400).json({ error: 'Datos no válidos' });
  }
  const equipo = await equipos.crear(datosEquipo(req.body));
  res.status(201).location(`/equipos/${equipo.id}`).json(equipo);
});

app.put('/api/equipos/:id', async (req, res) => {
  if (!datosEquipoValidos(req.body)) {
    return res.status(400).json({ error: 'Datos no válidos' });
  }
  const equipo = await equipos.actualizar(req.idRecurso, datosEquipo(req.body));
  if (!equipo) return res.status(404).json({ error: 'Equipo inexistente' });
  res.json(equipo);
});

app.delete('/api/equipos/:id', async (req, res) => {
  try {
    const borrado = await equipos.borrar(req.idRecurso);
    if (!borrado) return res.status(404).json({ error: 'Equipo inexistente' });
    res.status(204).end();
  } catch (error) {
    // 23503: hay préstamos que apuntan a este equipo (histórico incluido).
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'El equipo tiene préstamos registrados'
      });
    }
    throw error;
  }
});

app.post('/api/prestamos', async (req, res) => {
  const { equipoId, usuarioId } = req.body ?? {};
  if (!idValido(equipoId) || !idValido(usuarioId)) {
    return res.status(400).json({ error: 'Datos no válidos' });
  }
  res.status(201).json(await prestamos.prestar(equipoId, usuarioId));
});

app.post('/api/prestamos/:id/devolucion', async (req, res) => {
  res.json(await prestamos.devolver(req.idRecurso));
});

// ---------- Errores ----------

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return responder(req, res, 400, 'JSON no válido');
  }
  if (err.type === 'entity.too.large') {
    return responder(req, res, 413, 'Cuerpo demasiado grande');
  }
  // Errores de dominio del servicio de préstamos.
  if (err.codigo === 'NO_DISPONIBLE') {
    return responder(req, res, 409, 'El equipo no está disponible');
  }
  if (err.codigo === 'NO_ACTIVO') {
    return responder(req, res, 409, 'No hay un préstamo activo con ese id');
  }
  // Restricciones de PostgreSQL, por su código SQLSTATE y no por el texto.
  if (err.code === '23505') {
    return responder(req, res, 409, 'Código de equipo repetido');
  }
  if (err.code === '23503') {
    return responder(req, res, 400, 'Referencia inexistente');
  }
  if (['23502', '23514'].includes(err.code)) {
    return responder(req, res, 400, 'Datos no admitidos');
  }
  console.error('Error en la operación de préstamos');
  responder(req, res, 500, 'No se pudo completar la operación');
});

// ---------- Arranque y cierre ----------

try {
  await pool.query('SELECT 1');
  console.log('Conexión comprobada');
  const servidor = app.listen(
    Number(process.env.PORT ?? 3000),
    '127.0.0.1',
    () => console.log('HTTP preparado en el puerto ' + (process.env.PORT ?? 3000))
  );
  const cerrar = () => servidor.close(async () => { await pool.end(); });
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
} catch {
  console.error('PostgreSQL no disponible');
  await pool.end();
  process.exitCode = 1;
}
