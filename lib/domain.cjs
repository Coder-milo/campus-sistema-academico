'use strict';
const {schema, seed, accounts}=require('./data.cjs');
const {randomUUID}=require('node:crypto');
module.exports=function createDomain(initialState,actor){
const clone=obj=>JSON.parse(JSON.stringify(obj));
let state=clone(initialState);const user=actor;
  const get = (table,id,data=state) => data[table].find(row=>row.id===id);
  const label = (table,id) => {
    const row=get(table,id);
    if (!row) return id || 'Sin asignar';
    if (table==='people') return row.name+' '+row.last;
    if (table==='curricula') return row.id+' · '+label('subjects',row.subject);
    if (table==='plans') return row.id+' · '+label('curricula',row.curriculum);
    if (table==='load') return label('subjects',row.subject)+' · '+row.group+' · '+row.day+' '+row.start;
    return row.name || row.id;
  };
  const myProgram = () => user && get('people',user.person)?.program;
  const ownLoad = row => user?.role==='Administrador' || (user?.role==='Coordinador' && row?.program===myProgram()) || (user?.role==='Docente' && row?.teacher===user.person) || (user?.role==='Estudiante' && state.enrollments.some(e=>e.load===row?.id && e.student===user.person));
  function visible(table) {
    if (!user) return [];
    const all=state[table] || [];
    if (user.role==='Administrador') return all;
    if (['faculties','programs','subjects','rooms','sensors'].includes(table)) return all;
    if (table==='people') return all.filter(p=>p.program===myProgram());
    if (table==='load') return all.filter(ownLoad);
    if (table==='assignments') return all.filter(r=>user.role==='Coordinador'?get('people',r.teacher)?.program===myProgram():r.teacher===user.person);
    if (table==='curricula') return all.filter(r=>user.role==='Coordinador'?r.program===myProgram():user.role==='Docente'?state.load.some(l=>l.teacher===user.person && l.subject===r.subject && l.program===r.program):state.enrollments.some(e=>e.student===user.person && get('load',e.load)?.subject===r.subject && get('load',e.load)?.program===r.program));
    if (table==='competencies') return all.filter(r=>visible('curricula').some(c=>c.id===r.curriculum));
    if (table==='plans') return all.filter(r=>visible('curricula').some(c=>c.id===r.curriculum) && (user.role!=='Docente'||r.teacher===user.person));
    if (table==='activities') return all.filter(r=>visible('plans').some(p=>p.id===r.plan));
    if (table==='sessions') return all.filter(r=>ownLoad(get('load',r.load)));
    if (table==='grades') return all.filter(r=>user.role==='Estudiante'?r.student===user.person:ownLoad(get('load',r.load)));
    if (table==='audit') return [];
    return all;
  }
  function canEdit(table,row) {
    if (!user) return false;
    if (user.role==='Administrador') return ['people','faculties','programs','subjects','rooms','assignments','sensors'].includes(table);
    if (user.role==='Coordinador' && ['load','curricula','competencies','plans','activities','assignments'].includes(table)) return !row || visible(table).some(r=>r.id===row.id);
    return false;
  }
  function transact(description,fn) {
    if (!user) throw Error('Inicia sesión para continuar.');
    const next = clone(state);
    const details = fn(next);
    next.audit.unshift({id:uid('AUD'),date:new Date().toISOString(),actor:user.name,role:user.role,description,details:details || ''});
    next.audit=next.audit.slice(0,500);

    state = next;
  }
  const uid = prefix => prefix+'-'+randomUUID();
  const clash = (a,b) => a.period===b.period && a.day===b.day && a.start<b.end && b.start<a.end;
  function referenced(table,id) {
    for (const [other,def] of Object.entries(schema)) for (const field of def.fields) if (field.source===table && state[other].some(r=>r[field.key]===id)) return def.title;
    const links={people:[['enrollments','student'],['teacherSchedules','teacher'],['attendance','student'],['grades','student']],load:[['enrollments','load'],['teacherSchedules','load'],['sessions','load'],['grades','load']],plans:[['activities','plan']]};
    for (const [t,key] of links[table] || []) if (state[t].some(r=>r[key]===id)) return t==='enrollments'?'Horarios':t==='grades'?'Calificaciones':t==='sessions'?'Asistencia':t;
    if (table==='people' && accounts.some(a=>a.person===id)) return 'Cuentas de demostración';
    return '';
  }
  function saveEntity(table,input,oldId) {
    const def=schema[table], previous=oldId?get(table,oldId):null;
    if (!def || (oldId&&!previous) || !canEdit(table,previous)) throw Error('Tu perfil no puede modificar este registro.');
    const row={};
    for (const field of def.fields) {
      if (field.student && input.role!=='Estudiante') continue;
      const value=String(input[field.key] ?? '').trim();
      if (field.required && !value) throw Error('Completa el campo: '+field.label+'.');
      if (value.length>5000) throw Error(field.label+': el texto es demasiado largo.');
      row[field.key] = value;
      if (!value) continue;
      if (field.type==='number') {
        const n=Number(value);
        if (!Number.isFinite(n)||n<field.min||n>(field.max??Infinity)||(field.step===1&&!Number.isInteger(n))) throw Error('Valor inválido en '+field.label+'.');
        row[field.key]=n;
      }
      if (field.type==='select' && !field.options.includes(value)) throw Error('Opción inválida en '+field.label+'.');
      if (field.type==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw Error('Escribe un correo válido.');
      if (field.type==='date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value)))) throw Error('Fecha inválida en '+field.label+'.');
      if (field.type==='time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('Hora inválida.');
      if (field.type==='ref') {
        const related=get(field.source,value);
        if (!related || (field.role && (related.role!==field.role||related.active!=='Activo'))) throw Error('Selecciona una opción activa en '+field.label+'.');
      }
    }
    if (!/^[\p{L}\p{N}_.-]+$/u.test(row.id)) throw Error('El código solo admite letras, números, guion, punto y guion bajo.');
    if (oldId && row.id!==oldId) throw Error('El código de un registro existente no se puede cambiar.');
    if (state[table].some(r=>r.id.toLowerCase()===row.id.toLowerCase()&&r.id!==oldId)) throw Error('Ya existe un registro con ese código.');
    if (table==='people') {
      if (!row.program) throw Error('Selecciona el programa de la persona.');
      if (row.birth>new Date().toISOString().slice(0,10)) throw Error('La fecha de nacimiento no puede ser futura.');
      if (row.issued && row.issued<row.birth) throw Error('La expedición debe ser posterior al nacimiento.');
      if (accounts.some(a=>a.person===oldId) && (row.role!==previous.role || row.active!=='Activo')) throw Error('Conserva el perfil activo de las cuentas de demostración.');
      if (previous && (row.role!==previous.role||row.program!==previous.program) && referenced(table,oldId)) throw Error('Esta persona ya tiene relaciones académicas. Conserva su perfil y programa.');
    }
    if (table==='programs' && previous && row.faculty!==previous.faculty && referenced(table,oldId)) throw Error('El programa tiene información asociada. Conserva su facultad.');
    if (table==='assignments' && state.assignments.some(r=>r.teacher===row.teacher&&r.subject===row.subject&&r.id!==oldId)) throw Error('Esta materia ya está asociada al docente.');
    if (table==='assignments' && previous && (row.teacher!==previous.teacher||row.subject!==previous.subject) && state.load.some(l=>l.teacher===previous.teacher&&l.subject===previous.subject)) throw Error('La asignación ya se utiliza en la carga académica.');
    if (user.role==='Coordinador') {
      const program = table==='load'||table==='curricula'?row.program:table==='competencies'||table==='plans'?get('curricula',row.curriculum)?.program:table==='activities'?get('curricula',get('plans',row.plan)?.curriculum)?.program:get('people',row.teacher)?.program;
      if (program!==myProgram()) throw Error('Solo puedes gestionar registros de tu programa.');
    }
    if (table==='load') {
      if (row.start>=row.end) throw Error('La hora final debe ser posterior a la inicial.');
      if (!state.assignments.some(a=>a.teacher===row.teacher&&a.subject===row.subject)) throw Error('Primero asocia esa materia al docente en “Materias por docente”.');
      if (state.load.some(l=>l.id!==oldId&&clash(l,row)&&l.teacher===row.teacher)) throw Error('Cruce de horario: el docente ya tiene una clase en ese intervalo.');
      if (state.load.some(l=>l.id!==oldId&&clash(l,row)&&l.room===row.room)) throw Error('Cruce de horario: el aula ya está ocupada en ese intervalo.');
      if (previous && referenced(table,oldId) && ['program','subject','teacher','group','day','start','end','room','period'].some(k=>row[k]!==previous[k])) throw Error('La carga ya tiene horarios o registros asociados. Crea una nueva oferta para conservar el historial.');
    }
    if (table==='curricula') {
      if (row.first+row.second+row.third!==100) throw Error('Los porcentajes de los tres parciales deben sumar 100.');
      if (state.curricula.some(c=>c.id!==oldId&&c.program===row.program&&c.subject===row.subject)) throw Error('Ya existe un microcurrículo para esta materia y programa.');
      if (previous && referenced(table,oldId) && (row.program!==previous.program||row.subject!==previous.subject)) throw Error('Conserva la materia y programa del microcurrículo con planes o competencias.');
    }
    if (table==='plans') {
      if (row.start>row.end) throw Error('La fecha de terminación debe ser posterior o igual al inicio.');
      if (Number(row.start.slice(0,4))!==row.year) throw Error('El año lectivo debe coincidir con el inicio del plan.');
      const c=get('curricula',row.curriculum);
      if (!state.load.some(l=>l.teacher===row.teacher && l.subject===c.subject && l.program===c.program && l.period===row.period)) throw Error('El docente debe tener carga de esta materia, programa y periodo.');
      const acts=state.activities.filter(a=>a.plan===oldId);
      if (acts.some(a=>a.date<row.start||a.date>row.end)||acts.reduce((sum,a)=>sum+a.hours,0)>row.hours) throw Error('El plan debe contener las fechas y horas de todas sus actividades.');
      if (acts.length && (row.curriculum!==previous.curriculum||row.teacher!==previous.teacher||row.period!==previous.period)) throw Error('Conserva la asignación del plan que ya tiene actividades.');
    }
    if (table==='activities') {
      const plan=get('plans',row.plan);
      if (row.date<plan.start||row.date>plan.end) throw Error('La fecha debe estar dentro del periodo del plan.');
      if (state.activities.filter(a=>a.plan===row.plan&&a.id!==oldId).reduce((sum,a)=>sum+a.hours,0)+row.hours>plan.hours) throw Error('Las actividades no pueden superar el total de horas del plan.');
      if (row.status==='Completada'&&!row.evidence) throw Error('Describe la evidencia de la actividad completada.');
    }
    transact((previous?'Actualizó ':'Creó ')+def.single+' '+row.id,d=>{
      if (previous) d[table][d[table].findIndex(r=>r.id===oldId)]=row;
      else d[table].push(row);
      return {before:previous,after:row};
    });
    return row;
  }
  function removeEntity(table,id) {
    const row=get(table,id);
    if (!row||!canEdit(table,row)) throw Error('No puedes eliminar este registro.');
    const dependency=referenced(table,id);
    if (dependency) throw Error('No se puede eliminar: hay registros relacionados en '+dependency+'.');
    if (table==='assignments'&&state.load.some(l=>l.teacher===row.teacher&&l.subject===row.subject)) throw Error('La asignación se utiliza en la carga académica.');
    transact('Eliminó '+schema[table].single+' '+id,d=>{d[table]=d[table].filter(r=>r.id!==id);return {before:row};});
  }
  function enroll(loadId,remove=false) {
    const load=get('load',loadId);
    if (!load||!user||!['Estudiante','Docente'].includes(user.role)) throw Error('No puedes modificar este horario.');
    const student=user.role==='Estudiante',table=student?'enrollments':'teacherSchedules',key=student?'student':'teacher';
    const entries=state[table].filter(e=>e[key]===user.person);
    if (remove) {
      if (student && (state.grades.some(g=>g.student===user.person&&g.load===loadId)||state.sessions.some(s=>s.load===loadId&&(s.roster||[]).includes(user.person))||state.attendance.some(a=>a.student===user.person&&get('sessions',a.session)?.load===loadId))) throw Error('No puedes retirar una materia que ya tiene calificaciones o asistencia.');
      if (!entries.some(e=>e.load===loadId)) throw Error('La materia no está en tu horario.');
      transact('Retiró materia del horario',d=>{d[table]=d[table].filter(e=>!(e[key]===user.person&&e.load===loadId));return {load:loadId};});
      return;
    }
    if (student?load.program!==myProgram():load.teacher!==user.person) throw Error('Esta oferta no corresponde a tu perfil.');
    if (entries.some(e=>e.load===loadId)) throw Error('La materia ya está en tu horario.');
    if (entries.some(e=>{const other=get('load',e.load);return other && (clash(other,load)||(other.subject===load.subject&&other.period===load.period));})) throw Error('Esta materia se cruza con tu horario o ya está inscrita en el mismo periodo.');
    transact('Agregó materia al horario',d=>{d[table].push({id:uid(student?'HE':'HD'),[key]:user.person,load:loadId});return {load:loadId};});
  }
  function createSession(input) {
    const load=get('load',input.load);
    if (user?.role!=='Docente'||load?.teacher!==user.person) throw Error('Solo puedes crear sesiones de tus clases.');
    if (!input.topic?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw Error('Completa el tema, la fecha y la hora.');
    const day=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][new Date(input.date+'T12:00:00').getDay()];
    if (load.day!==day||input.time<load.start||input.time>=load.end) throw Error('La fecha y hora deben coincidir con el día e intervalo de la carga académica.');
    if (state.sessions.some(s=>s.load===input.load&&s.date===input.date&&s.time===input.time)) throw Error('Ya existe una sesión para esa clase, fecha y hora.');
    const roster=state.enrollments.filter(e=>e.load===load.id).map(e=>e.student);
    if (!roster.length) throw Error('La clase todavía no tiene estudiantes inscritos.');
    const row={id:uid('ASI'),load:input.load,topic:input.topic.trim(),date:input.date,time:input.time,status:'Abierta',roster};
    transact('Creó sesión de asistencia',d=>{d.sessions.push(row);return row;});
    return row;
  }
  const roster = session => session.roster || state.enrollments.filter(e=>e.load===session.load).map(e=>e.student);
  function attendance(input,sensorMode=false) {
    const session=get('sessions',input.session),load=session&&get('load',session.load);
    if (user?.role!=='Docente'||!load||load.teacher!==user.person||session.status!=='Abierta') throw Error('Necesitas una sesión abierta de una de tus clases.');
    if (!roster(session).includes(input.student)) throw Error('El estudiante no pertenece a esta sesión.');
    let status=input.status,origin='Manual',reason=String(input.reason||'').trim();
    if (sensorMode) {
      const sensor=get('sensors',input.sensor);
      if (!sensor||sensor.room!==load.room) throw Error('El sensor debe corresponder al aula de la sesión.');
      if (sensor.status!=='Disponible') throw Error('Sensor desconectado. Utiliza el registro manual de contingencia.');
      if (!input.event?.trim()) throw Error('Indica el identificador del evento.');
      if (state.events.some(e=>e.event===input.event.trim())) throw Error('Evento duplicado: esa lectura ya fue procesada.');
      if (state.attendance.some(a=>a.session===session.id&&a.student===input.student)) throw Error('Este estudiante ya tiene un registro. Usa la corrección manual con justificación.');
      status='Presente';origin='Sensor simulado';reason='Lectura simulada '+input.event.trim();
    } else if (!['Presente','Ausente','Justificado','Pendiente'].includes(status)||!reason) throw Error('Selecciona un estado y escribe la justificación.');
    const old=state.attendance.find(a=>a.session===session.id&&a.student===input.student);
    const row={id:old?.id||uid('AT'),session:session.id,student:input.student,status,origin,reason,time:new Date().toISOString()};
    transact(sensorMode?'Registró lectura simulada':'Registró o corrigió asistencia',d=>{
      if (old) d.attendance[d.attendance.findIndex(a=>a.id===old.id)]=row; else d.attendance.push(row);
      if (sensorMode) d.events.push({id:uid('EV'),event:input.event.trim(),session:session.id,student:input.student,sensor:input.sensor});
      return {before:old||null,after:row};
    });
  }
  function closeSession(id) {
    const s=get('sessions',id);
    if (user?.role!=='Docente'||!s||get('load',s.load)?.teacher!==user.person||s.status!=='Abierta') throw Error('No puedes cerrar esta sesión.');
    if (roster(s).some(student=>!state.attendance.some(a=>a.session===id&&a.student===student&&a.status!=='Pendiente'))) throw Error('Resuelve todos los estados pendientes antes de cerrar. La falta de lectura no se convierte automáticamente en ausencia.');
    transact('Cerró sesión de asistencia',d=>{get('sessions',id,d).status='Cerrada';return {session:id};});
  }
  function grade(input) {
    const load=get('load',input.load);
    if (user?.role!=='Docente'||load?.teacher!==user.person||!state.enrollments.some(e=>e.load===load.id&&e.student===input.student)) throw Error('No puedes calificar a este estudiante en esa clase.');
    const row={id:uid('NT'),load:input.load,student:input.student};
    for (const k of ['first','second','third']) {
      row[k]=input[k]===''||input[k]==null?null:Number(input[k]);
      if (row[k]!==null && (!Number.isFinite(row[k])||row[k]<0||row[k]>5)) throw Error('Las notas deben estar entre 0 y 5. Deja vacío un parcial pendiente.');
    }
    if (!String(input.reason||'').trim()) throw Error('Escribe el motivo del registro o corrección.');
    const old=state.grades.find(g=>g.load===row.load&&g.student===row.student);
    if (old) row.id=old.id;
    transact('Registró o corrigió calificaciones',d=>{if(old)d.grades[d.grades.findIndex(g=>g.id===old.id)]=row;else d.grades.push(row);return {before:old||null,after:row,reason:input.reason.trim()};});
  }
  function progress(id,status,evidence) {
    const activity=get('activities',id),plan=activity&&get('plans',activity.plan);
    if (user?.role!=='Docente'||plan?.teacher!==user.person) throw Error('Solo el docente asignado puede registrar el avance.');
    if (!['Pendiente','En curso','Completada'].includes(status)||!evidence.trim()) throw Error('Indica el estado y la evidencia del avance.');
    transact('Actualizó avance del plan',d=>{Object.assign(get('activities',id,d),{status,evidence:evidence.trim(),updated:new Date().toISOString(),responsible:user.name});return {activity:id,before:activity.status,after:status,evidence};});
  }
  function weights(loadId) { const l=get('load',loadId);return state.curricula.find(c=>c.subject===l?.subject&&c.program===l?.program)||{first:30,second:30,third:40}; }
  function finalGrade(g) { if (!g||['first','second','third'].some(k=>g[k]===null||g[k]===undefined)) return null;const w=weights(g.load);return (g.first*w.first+g.second*w.second+g.third*w.third)/100; }

return {get state(){return state;},get user(){return user;},get,label,visible,canEdit,ownLoad,myProgram,saveEntity,removeEntity,enroll,createSession,attendance,closeSession,grade,progress,weights,finalGrade,roster,clash};
};
