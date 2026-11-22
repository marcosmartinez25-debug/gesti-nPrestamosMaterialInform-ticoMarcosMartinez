// Operaciones de préstamo y devolución. Las dos son transaccionales:
// usan un único cliente del pool y confirman o revierten las dos escrituras.

// Error de dominio: lleva "codigo" (el de PostgreSQL llega en "code").
function fallo(codigo) {
  return Object.assign(new Error(codigo), { codigo });
}

export function crearServicioPrestamos(pool) {
  async function transaccion(trabajo) {
    const cliente = await pool.connect();
    let descartar = false;
    try {
      await cliente.query('BEGIN');
      const resultado = await trabajo(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      try {
        await cliente.query('ROLLBACK');
      } catch {
        // Si falla el ROLLBACK, la conexión queda en estado incierto
        // y no debe volver al pool.
        descartar = true;
      }
      throw error;
    } finally {
      cliente.release(descartar);
    }
  }

  return {
    async prestar(equipoId, usuarioId) {
      return transaccion(async cliente => {
        // Actualización condicional: solo pasa a false quien lo encuentra
        // en true. Si dos peticiones llegan a la vez, solo una afecta filas.
        const cambio = await cliente.query(
          `UPDATE practica_prestamos.equipos
              SET disponible = false
            WHERE id = $1 AND disponible = true
           RETURNING id`,
          [equipoId]
        );
        if (cambio.rowCount === 0) throw fallo('NO_DISPONIBLE');

        // Va después a propósito: si el usuario no existe, la clave foránea
        // falla y el ROLLBACK devuelve el equipo a disponible = true.
        const r = await cliente.query(
          `INSERT INTO practica_prestamos.prestamos(equipo_id, usuario_id)
           VALUES ($1, $2)
           RETURNING id, equipo_id, usuario_id, fecha_prestamo`,
          [equipoId, usuarioId]
        );
        return r.rows[0];
      });
    },

    async devolver(prestamoId) {
      return transaccion(async cliente => {
        // Solo se cierra un préstamo que siga activo. Una segunda devolución
        // no afecta filas y no cambia el estado de ningún equipo.
        const r = await cliente.query(
          `UPDATE practica_prestamos.prestamos
              SET fecha_devolucion = now()
            WHERE id = $1 AND fecha_devolucion IS NULL
           RETURNING id, equipo_id, usuario_id,
                     fecha_prestamo, fecha_devolucion`,
          [prestamoId]
        );
        if (!r.rowCount) throw fallo('NO_ACTIVO');

        await cliente.query(
          `UPDATE practica_prestamos.equipos
              SET disponible = true
            WHERE id = $1`,
          [r.rows[0].equipo_id]
        );
        return r.rows[0];
      });
    }
  };
}
