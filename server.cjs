'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { schema, accounts } = require('./lib/data.cjs');
const createDomain = require('./lib/domain.cjs');
const project = require('./lib/projection.cjs');
const { initialize, transaction, loginAllowed, audit } = require('./lib/store.cjs');
const { token, digest, passwordHash, passwordMatches, validPassword } = require('./lib/security.cjs');

const hours = 8;
const minutes = 30;
const publicPath = path.join(__dirname, 'public');
const operations = {
  saveEntity: {roles:['Administrador','Coordinador'], run:(d,p)=>d.saveEntity(p.table,p.input,p.id)},
  removeEntity: {roles:['Administrador','Coordinador'], run:(d,p)=>d.removeEntity(p.table,p.id)},
  enroll: {roles:['Docente','Estudiante'], run:(d,p)=>d.enroll(p.id,p.remove===true)},
  createSession: {roles:['Docente'], run:(d,p)=>d.createSession(p)},
  attendance: {roles:['Docente'], run:(d,p)=>d.attendance(p,p.sensorMode===true)},
  closeSession: {roles:['Docente'], run:(d,p)=>d.closeSession(p.id)},
  grade: {roles:['Docente'], run:(d,p)=>d.grade(p)},
  progress: {roles:['Docente'], run:(d,p)=>d.progress(p.id,p.status,p.evidence)}
};

function validateOperation(action, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const text = value => typeof value === 'string' && value.length <= 5000;
  if (['saveEntity','removeEntity'].includes(action)) {
    return typeof body.table === 'string' && Object.hasOwn(schema, body.table) &&
      (body.id === undefined || text(body.id)) &&
      (action !== 'saveEntity' || (body.input && typeof body.input === 'object' && !Array.isArray(body.input) && Object.values(body.input).every(text)));
  }
  return Object.values(body).every(value => text(value) || typeof value === 'boolean' || value === null);
}

async function createApp(pool, { origin, secure = false } = {}) {
  const app = express();
  const dummy = await passwordHash(token());
  const cookie = secure ? '__Host-campus' : 'campus_dev';
  const flags = { httpOnly:true, secure, sameSite:'strict', path:'/' };
  const sessionSql = `UPDATE campus_sessions SET touched = now() WHERE hash=$1
    AND touched > now()-interval '${minutes} minutes' AND created > now()-interval '${hours} hours'
    RETURNING username, csrf`;
  const event = (description, actor = null, details = '') => ({
    id: token(), date: new Date().toISOString(), actor:actor?.name || 'Sistema', role:actor?.role || 'Sistema', description, details
  });

  async function startSession(db, res, username) {
    const raw = token(), csrf = token();
    await db.query('INSERT INTO campus_sessions(hash,username,csrf) VALUES($1,$2,$3)', [digest(raw),username,csrf]);
    res.cookie(cookie, raw, { ...flags, maxAge: hours * 3600000 });
    return csrf;
  }

  async function getSnapshot(db, actor, state) {
    const snapshotState = state || (await db.query('SELECT state FROM campus_data WHERE id=1')).rows[0].state;
    const changes = actor.role === 'Administrador' ? (await db.query('SELECT event FROM campus_audit ORDER BY sequence DESC LIMIT 500')).rows.map(row=>row.event) : [];
    return project(snapshotState, actor, changes);
  }

  function sameOrigin(req,res,next) {
    if (req.method !== 'POST') return next();
    const expected = origin || `http://${req.get('host')}`;
    if (req.get('origin') !== expected || !req.is('application/json')) return res.status(403).json({error:'Origen o formato de solicitud inválido.'});
    next();
  }

  async function authenticated(req,res,next) {
    const raw = req.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookie+'='))?.slice(cookie.length+1);
    if (!raw || !/^[\w-]{43}$/.test(raw)) return res.status(401).json({error:'Inicia sesión para continuar.'});
    const hash = digest(raw);
    const session = (await pool.query(sessionSql,[hash])).rows[0];
    if (!session) return res.status(401).json({error:'La sesión terminó.'});
    const actor = accounts.find(account=>account.user===session.username);
    if (!actor) return res.status(401).json({error:'La cuenta no está disponible.'});
    req.campus = {hash,actor,csrf:session.csrf};
    if (req.method === 'POST' && req.get('x-csrf-token') !== session.csrf) return res.status(403).json({error:'La solicitud no coincide con tu sesión.'});
    next();
  }

  app.disable('x-powered-by');
  if (process.env.RENDER === 'true') app.set('trust proxy', 1);
  app.use(helmet({
    strictTransportSecurity: secure ? undefined : false,
    contentSecurityPolicy: { directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:secure?[]:null} },
    referrerPolicy:{policy:'no-referrer'}
  }));
  app.get('/health', async (_req,res)=>{await pool.query('SELECT 1');res.json({status:'ok'});});
  app.get('/schema.js',(_req,res)=>res.type('application/javascript').send(`window.CampusData = { schema: ${JSON.stringify(schema)} };`));
  app.use('/api', (_req,res,next)=>{res.set('Cache-Control','no-store');next();}, sameOrigin, express.json({limit:'24kb'}));

  app.post('/api/login',async(req,res)=>{
    const {username,password} = req.body || {};
    if (typeof username!=='string' || typeof password!=='string' || username.length>64 || Buffer.byteLength(password)>128) return res.status(400).json({error:'Datos de acceso inválidos.'});
    const user = username.trim().toLowerCase();
    const actor = accounts.find(account=>account.user===user);
    const ipKey = digest(req.ip || 'unknown');
    const limits = [[`ip:${ipKey}`,60],[`pair:${ipKey}:${actor?.user || 'unknown'}`,8]];
    if (!await loginAllowed(pool,limits)) return res.status(429).json({error:'Demasiados intentos. Espera 10 minutos.'});
    const found = (await pool.query('SELECT password_hash FROM campus_accounts WHERE username=$1',[user])).rows[0];
    const matches = await passwordMatches(password,found?.password_hash || dummy);
    if (!found || !actor || !matches) {
      await audit(pool,event('Intento de acceso rechazado',null,{user:actor?.user || 'desconocido'}));
      return res.status(401).json({error:'Usuario o contraseña incorrectos.'});
    }
    const result = await transaction(pool,async db=>{
      // Recheck the hash inside the same lock used when rotating credentials.
      const current = (await db.query('SELECT password_hash FROM campus_accounts WHERE username=$1 FOR UPDATE',[user])).rows[0];
      if (current.password_hash !== found.password_hash) return null;
      await db.query("DELETE FROM campus_sessions WHERE created<now()-interval '8 hours' OR touched<now()-interval '30 minutes'");
      const csrf = await startSession(db,res,user);
      await audit(db,event('Ingresó al sistema',actor));
      return {actor,csrf,state:await getSnapshot(db,actor)};
    });
    if (!result) return res.status(401).json({error:'Usuario o contraseña incorrectos.'});
    res.json(result);
  });

  app.get('/api/session',authenticated,async(req,res)=>{
    const {actor,csrf} = req.campus;
    res.json({actor,csrf,state:await getSnapshot(pool,actor)});
  });
  app.post('/api/logout',authenticated,async(req,res)=>{
    const {hash,actor} = req.campus;
    await transaction(pool,async db=>{
      await db.query('DELETE FROM campus_sessions WHERE hash=$1',[hash]);
      await audit(db,event('Cerró sesión',actor));
    });
    res.clearCookie(cookie,flags).json({ok:true});
  });
  app.post('/api/password',authenticated,async(req,res)=>{
    const {actor,hash} = req.campus;
    const {current,next} = req.body || {};
    if (!validPassword(current) || !validPassword(next) || current===next) return res.status(400).json({error:'Usa una contraseña nueva de al menos 14 caracteres.'});
    if (!await loginAllowed(pool,[[`change:${actor.user}`,6]])) return res.status(429).json({error:'Demasiados intentos. Espera 10 minutos.'});
    const found = (await pool.query('SELECT password_hash FROM campus_accounts WHERE username=$1',[actor.user])).rows[0];
    if (!await passwordMatches(current,found.password_hash)) return res.status(400).json({error:'La contraseña actual no es correcta.'});
    const replacement = await passwordHash(next);
    const csrf = await transaction(pool,async db=>{
      const result = await db.query('UPDATE campus_accounts SET password_hash=$1 WHERE username=$2 AND password_hash=$3',[replacement,actor.user,found.password_hash]);
      if (result.rowCount!==1) return null;
      await db.query('DELETE FROM campus_sessions WHERE username=$1',[actor.user]);
      await audit(db,event('Actualizó su contraseña',actor));
      return startSession(db,res,actor.user);
    });
    if (!csrf) return res.status(409).json({error:'La cuenta cambió. Ingresa nuevamente.'});
    res.json({ok:true,csrf});
  });
  app.get('/api/export',authenticated,async(req,res)=>{
    const {actor} = req.campus;
    if (actor.role!=='Administrador') return res.status(403).json({error:'Solo el administrador puede exportar datos.'});
    await audit(pool,event('Exportó datos académicos',actor));
    res.json(await getSnapshot(pool,actor));
  });

  app.post('/api/operation/:name',authenticated,async(req,res)=>{
    const {actor,hash} = req.campus;
    const name = req.params.name;
    const op = Object.hasOwn(operations,name) && operations[name];
    if (!op || !op.roles.includes(actor.role)) {
      await audit(pool,event('Operación no autorizada',actor,{operation:name.slice(0,100)}));
      return res.status(403).json({error:'Tu perfil no tiene permiso para esta operación.'});
    }
    if (!validateOperation(name,req.body)) return res.status(400).json({error:'Datos de operación inválidos.'});
    const outcome = await transaction(pool,async db=>{
      // Lock the current session against logout or rotation until the write commits.
      const active = await db.query('SELECT hash FROM campus_sessions WHERE hash=$1 FOR UPDATE',[hash]);
      if (!active.rowCount) return {status:401,error:'La sesión terminó.'};
      const current = (await db.query('SELECT state FROM campus_data WHERE id=1 FOR UPDATE')).rows[0].state;
      const domain = createDomain(current,actor);
      let result;
      try { result = op.run(domain,req.body); }
      catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) return {status:400,error:'Datos de operación inválidos.'};
        return {status:422,error:error.message};
      }
      const next = domain.state;
      if (next.audit.length) await audit(db,next.audit[0]);
      next.audit = [];
      await db.query('UPDATE campus_data SET state=$1 WHERE id=1',[next]);
      return {status:200,result,state:await getSnapshot(db,actor,next)};
    });
    res.status(outcome.status).json(outcome);
  });
  app.use('/api', (_req,res)=>res.status(404).json({error:'Ruta no disponible.'}));
  app.use(express.static(publicPath,{dotfiles:'deny',index:'index.html'}));
  app.use((err,_req,res,_next)=>{
    if (err.status===400 || err.status===413) return res.status(err.status).json({error:'La solicitud no es válida.'});
    console.error('Operación del servidor no disponible',err.code || err.name);
    res.status(500).json({error:'El servidor no pudo completar la operación.'});
  });
  return app;
}

async function main() {
  const origin = process.env.CAMPUS_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  const secure = process.env.NODE_ENV==='production' || Boolean(origin?.startsWith('https://'));
  if (secure && !origin?.startsWith('https://')) throw Error('Configura el origen HTTPS de producción.');
  const pool = await initialize(process.env.DATABASE_URL,process.env.CAMPUS_BOOTSTRAP);
  const app = await createApp(pool,{origin,secure});
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0',()=>console.log(`Campus disponible en el puerto ${port}`));
}

if (require.main===module) main().catch(error=>{console.error('No se inició Campus:',error.code||error.name);process.exitCode=1;});
module.exports = { createApp };
