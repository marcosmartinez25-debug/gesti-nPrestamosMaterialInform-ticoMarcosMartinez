// Consultas SQL de los equipos. No conoce Express ni códigos HTTP:
// recibe datos ya validados y devuelve filas o null.

export const TAMANO_PAGINA = 5;

// La ordenación la elige el usuario entre dos opciones, pero el fragmento SQL
// lo escribe el programa. Nunca se concatena un nombre de columna recibido.
const ORDENES = {
  codigo: 'e.codigo, e.id',
  nombre: 'e.nombre, e.id'
};

export function crearRepositorioEquipos(pool) {
  return {
    // Listado con búsqueda, filtros, orden y paginación.
    // Se piden TAMANO_PAGINA + 1 filas para saber si hay página siguiente
    // sin hacer una consulta de recuento aparte.
    async listar({ q, categoria, disponibilidad, orden, pagina }) {
      const condiciones = ['e.nombre ILIKE $1'];
      const valores = [`%${q}%`];

      if (categoria !== '') {
        valores.push(categoria);
        condiciones.push(`e.categoria ILIKE $${valores.length}`);
      }
      if (disponibilidad !== '') {
        valores.push(disponibilidad === 'si');
        condiciones.push(`e.disponible = $${valores.length}`);
      }

      valores.push(TAMANO_PAGINA + 1);
      const limite = valores.length;
      valores.push((pagina - 1) * TAMANO_PAGINA);
      const salto = valores.length;

      const r = await pool.query(
        `SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible
           FROM practica_prestamos.equipos AS e
          WHERE ${condiciones.join(' AND ')}
          ORDER BY ${ORDENES[orden]}
          LIMIT $${limite} OFFSET $${salto}`,
        valores
      );

      return {
        filas: r.rows.slice(0, TAMANO_PAGINA),
        haySiguiente: r.rows.length > TAMANO_PAGINA
      };
    },

    // Detalle del equipo y, si lo tiene, el usuario que lo tiene prestado.
    // El LEFT JOIN conserva los equipos sin préstamo activo.
    async detalle(id) {
      const r = await pool.query(
        `SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible,
                p.id AS prestamo_activo_id,
                p.fecha_prestamo AS prestamo_activo_fecha,
                u.nombre AS usuario_actual
           FROM practica_prestamos.equipos AS e
           LEFT JOIN practica_prestamos.prestamos AS p
             ON p.equipo_id = e.id AND p.fecha_devolucion IS NULL
           LEFT JOIN practica_prestamos.usuarios AS u
             ON u.id = p.usuario_id
          WHERE e.id = $1`,
        [id]
      );
      return r.rows[0] ?? null;
    },

    // Préstamos del equipo con el nombre del usuario (INNER JOIN: todo
    // préstamo tiene usuario por clave foránea).
    async historial(id) {
      const r = await pool.query(
        `SELECT p.id, u.nombre AS usuario,
                p.fecha_prestamo, p.fecha_devolucion
           FROM practica_prestamos.prestamos AS p
           INNER JOIN practica_prestamos.usuarios AS u
             ON u.id = p.usuario_id
          WHERE p.equipo_id = $1
          ORDER BY p.fecha_prestamo DESC, p.id DESC`,
        [id]
      );
      return r.rows;
    },

    // RETURNING devuelve el equipo creado sin una segunda consulta.
    // disponible no se envía: lo pone el valor por defecto de la tabla.
    async crear({ codigo, nombre, categoria }) {
      const r = await pool.query(
        `INSERT INTO practica_prestamos.equipos(codigo, nombre, categoria)
         VALUES ($1, $2, $3)
         RETURNING id, codigo, nombre, categoria, disponible`,
        [codigo, nombre, categoria]
      );
      return r.rows[0];
    },

    // No se toca disponible: ese estado solo cambia al prestar o devolver.
    // rowCount = 0 significa que no existe ese id.
    async actualizar(id, { codigo, nombre, categoria }) {
      const r = await pool.query(
        `UPDATE practica_prestamos.equipos
            SET codigo = $1, nombre = $2, categoria = $3
          WHERE id = $4
         RETURNING id, codigo, nombre, categoria, disponible`,
        [codigo, nombre, categoria, id]
      );
      if (r.rowCount === 0) return null;
      return r.rows[0];
    },

    // rowCount distingue "no existe" de "borrado". Si el equipo tiene
    // préstamos, la clave foránea lanza el SQLSTATE 23503 y la ruta
    // lo convierte en 409.
    async borrar(id) {
      const r = await pool.query(
        'DELETE FROM practica_prestamos.equipos WHERE id = $1',
        [id]
      );
      return r.rowCount === 1;
    }
  };
}
