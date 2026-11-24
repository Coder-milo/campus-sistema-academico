'use strict';
const { spawnSync } = require('node:child_process');
for (const file of ['server.cjs','lib/data.cjs','lib/domain.cjs','lib/projection.cjs','lib/security.cjs','lib/store.cjs','public/app.js','public/client.js']) {
  const check = spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if (check.status!==0) process.exit(check.status || 1);
}
console.log('Archivos JavaScript verificados.');
