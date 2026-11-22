// Comprobaciones mínimas de la práctica desde Node con fetch.
// Antes de ejecutarlo: volver a pegar init.sql en psql (estado conocido)
// y tener el servidor arrancado en otra terminal.
//   node --env-file=.env src/server.mjs
//   node comprobaciones.mjs

const base = 'http://127.0.0.1:3000';
const resultados = [];

function registrar(caso, peticion, esperado, obtenido) {
  const ok = String(esperado) === String(obtenido);
  resultados.push({ caso, peticion, esperado, obtenido, ok });
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${caso} | ${peticion} | esperado: ${esperado} | obtenido: ${obtenido}`);
}

async function api(metodo, ruta, datos) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: datos === undefined
      ? undefined
      : { 'Content-Type': 'application/json' },
    body: datos === undefined ? undefined : JSON.stringify(datos)
  });
  let cuerpo = null;
  if (r.status !== 204) {
    try { cuerpo = await r.json(); } catch { cuerpo = null; }
  }
  return { estado: r.status, cuerpo, location: r.headers.get('location') };
}

const sino = valor => (valor ? 'sí' : 'no');

async function pagina(ruta) {
  const r = await fetch(base + ruta);
  return { estado: r.status, texto: await r.text() };
}

// 1. Alta y modificación
const alta = await api('POST', '/api/equipos', {
  codigo: 'TEST01', nombre: 'Equipo de prueba', categoria: 'portatil'
});
registrar('Alta de equipo', 'POST /api/equipos', '201, Location sí',
  `${alta.estado}, Location ${sino(alta.location !== null)}`);

const repetido = await api('POST', '/api/equipos', {
  codigo: 'TEST01', nombre: 'Otro equipo', categoria: 'portatil'
});
registrar('Código repetido', 'POST /api/equipos (mismo codigo)', 409, repetido.estado);

const invalido = await api('POST', '/api/equipos', {
  codigo: 'minusculas!', nombre: '', categoria: 'portatil'
});
registrar('Datos no válidos', 'POST /api/equipos (codigo y nombre malos)', 400, invalido.estado);

const cambio = await api('PUT', `/api/equipos/${alta.cuerpo.id}`, {
  codigo: 'TEST01', nombre: 'Equipo de prueba editado', categoria: 'tableta'
});
registrar('Modificación', `PUT /api/equipos/${alta.cuerpo.id}`, '200, tableta',
  `${cambio.estado}, ${cambio.cuerpo?.categoria}`);

const sinDisponible = await api('PUT', `/api/equipos/${alta.cuerpo.id}`, {
  codigo: 'TEST01', nombre: 'Equipo de prueba editado', categoria: 'tableta',
  disponible: false
});
registrar('PUT no cambia disponible', `PUT /api/equipos/${alta.cuerpo.id} con disponible:false`,
  'true', String(sinDisponible.cuerpo?.disponible));

const inexistente = await api('PUT', '/api/equipos/999999', {
  codigo: 'NADA', nombre: 'No existe', categoria: 'portatil'
});
registrar('Modificar id inexistente', 'PUT /api/equipos/999999', 404, inexistente.estado);

// 2. Consulta y filtros
const listado = await pagina('/equipos');
registrar('Listado (5 por página, orden por código)', 'GET /equipos',
  '200, ALT01 sí, PORT01 no',
  `${listado.estado}, ALT01 ${sino(listado.texto.includes('ALT01'))}, PORT01 ${sino(listado.texto.includes('PORT01'))}`);

const busqueda = await pagina('/equipos?q=PORTÁTIL');
registrar('Búsqueda ILIKE', 'GET /equipos?q=PORTÁTIL', '200, PORT01 sí',
  `${busqueda.estado}, PORT01 ${sino(busqueda.texto.includes('PORT01'))}`);

const porCategoria = await pagina('/equipos?categoria=audio');
registrar('Filtro por categoría', 'GET /equipos?categoria=audio',
  '200, AUR01 sí, PORT01 no',
  `${porCategoria.estado}, AUR01 ${sino(porCategoria.texto.includes('AUR01'))}, PORT01 ${sino(porCategoria.texto.includes('PORT01'))}`);

const ordenado = await pagina('/equipos?orden=nombre');
registrar('Orden por nombre', 'GET /equipos?orden=nombre', '200, ALT01 sí',
  `${ordenado.estado}, ALT01 ${sino(ordenado.texto.includes('ALT01'))}`);

const segunda = await pagina('/equipos?pagina=2');
registrar('Segunda página', 'GET /equipos?pagina=2',
  '200, PORT01 sí, ALT01 no',
  `${segunda.estado}, PORT01 ${sino(segunda.texto.includes('PORT01'))}, ALT01 ${sino(segunda.texto.includes('ALT01'))}`);

const filtrosMantenidos = await pagina('/equipos?q=o&orden=nombre&pagina=2');
registrar('Filtros al paginar', 'GET /equipos?q=o&orden=nombre&pagina=2',
  '200, enlace con q y orden sí',
  `${filtrosMantenidos.estado}, enlace con q y orden ${sino(filtrosMantenidos.texto.includes('q=o&amp;categoria=&amp;disponibilidad=&amp;orden=nombre'))}`);

const vacio = await pagina('/equipos?q=zzzz');
registrar('Sin resultados', 'GET /equipos?q=zzzz', '200, aviso sí',
  `${vacio.estado}, aviso ${sino(vacio.texto.includes('No hay equipos'))}`);

const paginaMala = await pagina('/equipos?pagina=0');
registrar('Paginación no válida', 'GET /equipos?pagina=0', 400, paginaMala.estado);

const detalleMalo = await pagina('/equipos/abc');
registrar('Id mal formado', 'GET /equipos/abc', 400, detalleMalo.estado);

const detalleNoExiste = await pagina('/equipos/999999');
registrar('Equipo inexistente', 'GET /equipos/999999', 404, detalleNoExiste.estado);

// 3. Borrado
const borrado = await api('DELETE', `/api/equipos/${alta.cuerpo.id}`);
registrar('Borrado sin historial', `DELETE /api/equipos/${alta.cuerpo.id}`, 204, borrado.estado);

const borradoRepetido = await api('DELETE', `/api/equipos/${alta.cuerpo.id}`);
registrar('Borrado repetido', `DELETE /api/equipos/${alta.cuerpo.id}`, 404, borradoRepetido.estado);

// 4. Préstamo, duplicado y borrado con historial
const prestamo = await api('POST', '/api/prestamos', { equipoId: 1, usuarioId: 1 });
registrar('Préstamo correcto', 'POST /api/prestamos (equipo 1, usuario 1)', 201, prestamo.estado);

const trasPrestar = await pagina('/equipos/1');
registrar('Equipo prestado', 'GET /equipos/1', 'Prestado sí, Ana Gil sí',
  `Prestado ${sino(trasPrestar.texto.includes('Estado: Prestado'))}, Ana Gil ${sino(trasPrestar.texto.includes('Ana Gil'))}`);

const duplicado = await api('POST', '/api/prestamos', { equipoId: 1, usuarioId: 2 });
registrar('Préstamo duplicado', 'POST /api/prestamos (equipo 1 otra vez)', 409, duplicado.estado);

const borrarConHistorial = await api('DELETE', '/api/equipos/1');
registrar('Borrado con préstamos', 'DELETE /api/equipos/1', 409, borrarConHistorial.estado);

// 5. Rollback: usuario inexistente después de escribir disponible=false
const rollback = await api('POST', '/api/prestamos', { equipoId: 2, usuarioId: 999 });
registrar('Rollback (usuario inexistente)', 'POST /api/prestamos (equipo 2, usuario 999)',
  400, rollback.estado);

const trasRollback = await pagina('/equipos/2');
registrar('Estado tras rollback', 'GET /equipos/2', 'Disponible sí, sin préstamos sí',
  `Disponible ${sino(trasRollback.texto.includes('Estado: Disponible'))}, sin préstamos ${sino(trasRollback.texto.includes('no se ha prestado nunca'))}`);

// 6. Devolución
const devolucion = await api('POST', `/api/prestamos/${prestamo.cuerpo.id}/devolucion`);
registrar('Devolución', `POST /api/prestamos/${prestamo.cuerpo.id}/devolucion`,
  '200, fecha_devolucion sí',
  `${devolucion.estado}, fecha_devolucion ${sino(devolucion.cuerpo?.fecha_devolucion != null)}`);

const trasDevolver = await pagina('/equipos/1');
registrar('Equipo devuelto', 'GET /equipos/1', 'Disponible sí',
  `Disponible ${sino(trasDevolver.texto.includes('Estado: Disponible'))}`);

const segundaDevolucion = await api('POST', `/api/prestamos/${prestamo.cuerpo.id}/devolucion`);
registrar('Segunda devolución', `POST /api/prestamos/${prestamo.cuerpo.id}/devolucion`,
  409, segundaDevolucion.estado);

// 7. Simultaneidad: dos préstamos a la vez del mismo equipo
const simultaneos = await Promise.all([
  api('POST', '/api/prestamos', { equipoId: 3, usuarioId: 1 }),
  api('POST', '/api/prestamos', { equipoId: 3, usuarioId: 2 })
]);
registrar('Simultaneidad', 'POST /api/prestamos x2 a la vez (equipo 3)',
  '201,409', simultaneos.map(r => r.estado).sort().join(','));

const trasSimultaneos = await pagina('/equipos/3');
const filasPrestamo = (trasSimultaneos.texto.match(/<tr>/g) ?? []).length - 1;
registrar('Un solo préstamo guardado', 'GET /equipos/3', '1 fila de préstamo',
  `${filasPrestamo} fila de préstamo`);

// Resumen
const fallos = resultados.filter(r => !r.ok).length;
console.log(`\n${resultados.length - fallos} de ${resultados.length} comprobaciones correctas.`);
console.log('\nTabla para el README:\n');
console.log('| Caso | Petición | Resultado esperado | Resultado obtenido |');
console.log('| --- | --- | --- | --- |');
for (const r of resultados) {
  console.log(`| ${r.caso} | \`${r.peticion}\` | ${r.esperado} | ${r.obtenido} |`);
}
if (fallos > 0) process.exitCode = 1;
