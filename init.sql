-- Práctica DWES UD4: gestión de préstamos de material informático
-- Se pega completo en psql conectado como dwes_app a la base dwes.
-- Reinicia SOLO las tablas de este esquema: permite empezar desde una base vacía
-- y repetir las comprobaciones con un estado conocido.

CREATE SCHEMA IF NOT EXISTS practica_prestamos;

CREATE TABLE IF NOT EXISTS practica_prestamos.equipos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL UNIQUE CHECK (char_length(codigo) BETWEEN 1 AND 20),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80),
  categoria text NOT NULL CHECK (char_length(categoria) BETWEEN 1 AND 40),
  disponible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS practica_prestamos.usuarios (
  id integer PRIMARY KEY,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS practica_prestamos.prestamos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id integer NOT NULL
    REFERENCES practica_prestamos.equipos(id),
  usuario_id integer NOT NULL
    REFERENCES practica_prestamos.usuarios(id),
  fecha_prestamo timestamptz NOT NULL DEFAULT now(),
  fecha_devolucion timestamptz,
  CHECK (fecha_devolucion IS NULL OR fecha_devolucion >= fecha_prestamo)
);

-- Solo puede haber un préstamo activo por equipo: el índice solo incluye
-- las filas sin devolver, así que el histórico admite varios préstamos.
CREATE UNIQUE INDEX IF NOT EXISTS un_prestamo_activo
ON practica_prestamos.prestamos(equipo_id)
WHERE fecha_devolucion IS NULL;

TRUNCATE practica_prestamos.prestamos,
         practica_prestamos.equipos,
         practica_prestamos.usuarios
RESTART IDENTITY;

INSERT INTO practica_prestamos.usuarios VALUES
 (1, 'Ana Gil'),
 (2, 'Luis Soto'),
 (3, 'Marta Ruiz');

INSERT INTO practica_prestamos.equipos(codigo, nombre, categoria) VALUES
 ('PORT01', 'Portátil Aula 1',        'portatil'),
 ('PORT02', 'Portátil Aula 2',        'portatil'),
 ('PORT03', 'Portátil de préstamo',   'portatil'),
 ('TAB01',  'Tableta grafica 10"',    'tableta'),
 ('TAB02',  'Tableta de lectura',     'tableta'),
 ('PRO01',  'Proyector salón de actos','proyector'),
 ('PRO02',  'Proyector portátil',     'proyector'),
 ('MON01',  'Monitor 24 pulgadas',    'monitor'),
 ('MON02',  'Monitor 27 pulgadas',    'monitor'),
 ('CAM01',  'Cámara de vídeo',        'camara'),
 ('AUR01',  'Auriculares con micro',  'audio'),
 ('ALT01',  'Altavoz de aula',        'audio');
