'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { initialize } = require('../lib/store.cjs');
const { createApp } = require('../server.cjs');
const { accounts, seed } = require('../lib/data.cjs');
const createDomain = require('../lib/domain.cjs');
const project = require('../lib/projection.cjs');

test('La vista estudiante contiene solo sus notas, asistencias y datos personales', () => {
  const student = accounts.find(a=>a.user==='estudiante');
  const view = project(seed(),student);
  assert.ok(view.grades.length && view.grades.every(g=>g.student===student.person));
  assert.ok(view.attendance.length && view.attendance.every(a=>a.student===student.person));
  assert.ok(view.sessions.every(s=>s.roster.join()===student.person));
  assert.ok(view.people.filter(p=>p.id!==student.person).every(p=>!p.email&&!p.phone&&!p.address));
  assert.equal(view.audit.length,0);
});

test('El dominio impide modificar notas de otro docente y cruces de horario', () => {
  const state=seed(), teacher=accounts.find(a=>a.user==='docente'), coordinator=accounts.find(a=>a.user==='coordinador');
  assert.throws(()=>createDomain(state,teacher).grade({load:'CA-003',student:'EST-001',first:4,reason:'prueba'}),/No puedes/);
  assert.throws(()=>createDomain(state,coordinator).saveEntity('load',{...state.load[0],id:'QA',start:'09:00',end:'11:00'}),/Cruce de horario/);
});

test('API real con PostgreSQL: autenticación, CSRF, roles, concurrencia y auditoría', {skip:!process.env.CAMPUS_TEST_DATABASE_URL}, async t => {
  const passwords = Object.fromEntries(accounts.map(a=>[a.user,randomBytes(21).toString('base64url')]));
  const pool = await initialize(process.env.CAMPUS_TEST_DATABASE_URL,JSON.stringify(passwords));
  const app = await createApp(pool);
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const call=(route,{body,session,source=origin,withCsrf=true}={})=>fetch(origin+'/api/'+route,{
    method:body===undefined?'GET':'POST',
    headers:{...(session?{Cookie:session.cookie}:{}),...(body!==undefined?{'Content-Type':'application/json',Origin:source}:{}),...(session&&withCsrf?{'X-CSRF-Token':session.data.csrf}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  async function login(username,password=passwords[username]) {
    const response=await call('login',{body:{username,password}});
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict/);
    return {cookie:response.headers.get('set-cookie').split(';')[0],data:await response.json()};
  }
  assert.equal((await call('session')).status,401);
  assert.equal((await call('login',{source:'https://otro.example',body:{username:'admin',password:passwords.admin}})).status,403);
  assert.equal((await call('login',{body:{username:'admin',password:'equivocada'}})).status,401);
  const [admin,coordinator,teacher,student]=await Promise.all(accounts.map(a=>login(a.user)));
  assert.equal(student.data.state.grades.length,1);
  assert.equal((await call('export',{session:student})).status,403);
  assert.equal((await call('operation/grade',{session:student,body:{}})).status,403);
  assert.equal((await call('operation/grade',{session:teacher,body:{},withCsrf:false})).status,403);
  const note={load:'CA-001',student:'EST-001',first:'4',second:'4',third:'5',reason:'Prueba de persistencia'};
  assert.equal((await call('operation/grade',{session:teacher,body:note})).status,200);
  const snapshot=await (await call('session',{session:student})).json();
  assert.equal(snapshot.state.grades[0].third,5);
  const change={table:'load',input:{...seed().load[0],id:'QA-1',start:'11:00',end:'12:00'}};
  const responses=await Promise.all([call('operation/saveEntity',{session:coordinator,body:change}),call('operation/saveEntity',{session:coordinator,body:{...change,input:{...change.input,id:'QA-2'}}})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,422]);
  const audited=await (await call('export',{session:admin})).json();
  assert.ok(audited.audit.some(r=>r.description==='Registró o corrigió calificaciones'&&r.details.before.first===4.2));
  const second=await login('docente');
  const next=randomBytes(21).toString('base64url');
  assert.equal((await call('password',{session:teacher,body:{current:passwords.docente,next}})).status,200);
  assert.equal((await call('session',{session:second})).status,401);
  const fresh=await login('docente',next);
  assert.equal((await call('logout',{session:fresh,body:{}})).status,200);
  assert.equal((await call('session',{session:fresh})).status,401);
  const web=await fetch(origin+'/');
  assert.match(web.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal((await fetch(origin+'/lib/data.cjs')).status,404);
});
