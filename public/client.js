(function () {
  'use strict';
  const {schema} = window.CampusData;
  let user = null, csrf = '', state = {}, storageWarning = '';
  const get = (table,id) => state[table]?.find(row=>row.id===id);
  const label = (table,id) => {
    const row=get(table,id);
    if (!row) return id || 'Sin asignar';
    if (table==='people') return row.name+' '+row.last;
    if (table==='curricula') return row.id+' · '+label('subjects',row.subject);
    if (table==='plans') return row.id+' · '+label('curricula',row.curriculum);
    if (table==='load') return label('subjects',row.subject)+' · '+row.group+' · '+row.day+' '+row.start;
    return row.name || row.id;
  };
  const myProgram = () => get('people',user?.person)?.program;
  const ownLoad = row => user?.role==='Administrador' || (user?.role==='Coordinador' && row?.program===myProgram()) || (user?.role==='Docente' && row?.teacher===user.person) || (user?.role==='Estudiante' && state.enrollments.some(e=>e.load===row?.id && e.student===user.person));
  function visible(table) {
    const rows=state[table] || [];
    return table==='load'?rows.filter(ownLoad):rows;
  }
  function canEdit(table,row) {
    if (user?.role==='Administrador') return ['people','faculties','programs','subjects','rooms','assignments','sensors'].includes(table);
    if (user?.role==='Coordinador') return ['load','curricula','competencies','plans','activities','assignments'].includes(table) && (!row || visible(table).some(r=>r.id===row.id));
    return false;
  }
  const roster = session => session.roster || state.enrollments.filter(e=>e.load===session.load).map(e=>e.student);
  function weights(loadId) {
    const load=get('load',loadId);
    return state.curricula.find(c=>c.subject===load?.subject&&c.program===load?.program)||{first:30,second:30,third:40};
  }
  function finalGrade(grade) {
    const keys=['first','second','third'];
    if (!grade||keys.some(k=>grade[k]==null)) return null;
    const proportions=weights(grade.load);
    return keys.reduce((total,k)=>total+grade[k]*proportions[k],0)/100;
  }
  function clearSession() { user=null;csrf='';state={}; }
  async function request(path, body, optionalSession=false) {
    const headers={Accept:'application/json'};
    if (body!==undefined) {
      headers['Content-Type']='application/json';
      if (csrf) headers['X-CSRF-Token']=csrf;
    }
    const res=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
    if (res.status===401 && optionalSession) return null;
    const data=await res.json();
    if (!res.ok) {
      if (res.status===401 && user && path!=='login') {
        clearSession();
        window.dispatchEvent(new Event('campus-session-expired'));
      }
      throw Error(data.error||'La operación no se pudo completar.');
    }
    return data;
  }
  function useSnapshot(data) { if(data){user=data.actor;csrf=data.csrf;state=data.state;} }
  async function init() {
    try { useSnapshot(await request('session',undefined,true)); }
    catch { storageWarning='El servidor no está disponible. Intenta de nuevo en unos minutos.'; }
  }
  async function login(username,password) { useSnapshot(await request('login',{username,password}));storageWarning=''; }
  async function logout(){await request('logout',{});clearSession();}
  async function changePassword(payload){const data=await request('password',payload);csrf=data.csrf;}
  async function operation(name,payload){const data=await request('operation/'+name,payload);state=data.state;return data.result;}
  window.Campus = {
    get state(){return state;}, get user(){return user;}, get storageWarning(){return storageWarning;},
    get,label,myProgram,ownLoad,visible,canEdit,roster,weights,finalGrade,init,login,logout,changePassword,
    uid:prefix=>prefix+'-'+crypto.randomUUID(),
    saveEntity:(table,input,id)=>operation('saveEntity',{table,input,id}),
    removeEntity:(table,id)=>operation('removeEntity',{table,id}),
    enroll:(id,remove=false)=>operation('enroll',{id,remove}),
    createSession:input=>operation('createSession',input),
    attendance:(input,sensorMode=false)=>operation('attendance',{...input,sensorMode}),
    closeSession:id=>operation('closeSession',{id}),
    grade:input=>operation('grade',input),
    progress:(id,status,evidence)=>operation('progress',{id,status,evidence}),
    exportData:()=>request('export')
  };
})();
