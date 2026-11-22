// Conexión con PostgreSQL.
// Solo comprueba la configuración y crea el pool: un pool por proceso,
// no uno por petición (sesión 12).
import pg from 'pg';

for (const clave of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
  if (!process.env[clave]) throw new Error(`Falta ${clave}`);
}

const puerto = Number(process.env.PGPORT);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  throw new Error('PGPORT no es válido');
}

export const pool = new pg.Pool({
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000
});

pool.on('error', () => console.error('Fallo de conexión inactiva'));
