# Campus Sistema Académico

Proyecto final de Ingeniería de Software II. El sistema administra comunidad, carga académica, horarios, microcurrículos, planes, asistencia y calificaciones. La interfaz usa HTML, CSS y JavaScript. Express y PostgreSQL sirven la aplicación y conservan la información entre sesiones.

## Preparar el entorno

Usa Node.js 22 o posterior compatible y una base PostgreSQL para este proyecto. Ejecuta `npm ci`, copia `.env.example` como `.env` y configura `DATABASE_URL`. Para el primer inicio, `CAMPUS_BOOTSTRAP` recibe un objeto JSON con las claves `admin`, `coordinador`, `docente` y `estudiante`, cada una con una contraseña distinta de al menos 14 caracteres. Usa `npm start` y abre `http://localhost:3000`.

El servidor crea sus tablas y las cuentas que falten. Las variables de inicio pueden retirarse después de que las cuatro cuentas existan en la base. Las contraseñas de la versión anterior se usaban solo en esa demostración local.

## Desplegar en Render

El repositorio incluye `render.yaml` para crear un servicio web Node y una base PostgreSQL en la misma región. Selecciona el repositorio desde **New → Blueprint** y configura `CAMPUS_BOOTSTRAP` como secreto cuando Render lo solicite. Render incorpora la cadena interna de la base y el origen público HTTPS. La ruta `/health` verifica que el servicio puede consultar la base.

Comparte con el profesor el enlace del despliegue y las credenciales de revisión por la plataforma académica. Conserva las credenciales fuera del código y de los commits. La base gratuita de Render caduca a los 30 días y no incluye copias de seguridad administradas. El servidor gratuito puede despertar con demora después de estar inactivo. Consulta la [documentación de Render](https://render.com/docs/free).

## Acceso y permisos

| Usuario | Permisos principales |
| --- | --- |
| `admin` | Catálogos, comunidad, sensores, consulta general y auditoría |
| `coordinador` | Carga y planeación de su programa |
| `docente` | Horario propio, asistencia, notas y planes de sus clases |
| `estudiante` | Inscripción y consulta de información propia |

El servidor usa scrypt con una sal por contraseña, límites de intentos, cookies HttpOnly y SameSite, cookies Secure en HTTPS, vencimiento de sesión, verificación de origen y token CSRF para escrituras autenticadas. Cambiar una contraseña revoca las sesiones de esa cuenta. La API evalúa permisos y proyecta los datos permitidos por perfil. Los cambios académicos y su auditoría se guardan en una misma transacción. Cada modificación de los datos académicos bloquea la fila de estado mientras se valida y confirma.

Hay cuatro cuentas fijas y datos ficticios. El sensor es simulado. La aplicación permite al administrador exportar datos académicos a JSON. Los objetivos de recuperación del documento de planificación, incluida la retención de 15 minutos y la recuperación en dos horas, requieren un servicio de copias y pruebas de restauración independientes.

## Verificación

`npm run build` verifica la sintaxis. `npm test` comprueba controles de acceso y reglas académicas. La prueba HTTP usa una base de datos PostgreSQL desechable cuando se define `CAMPUS_TEST_DATABASE_URL`. La guía de sustentación está en `/guia.html`.
