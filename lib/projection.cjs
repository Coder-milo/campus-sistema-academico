'use strict';

const createDomain = require('./domain.cjs');

module.exports = function project(state, actor, audit = []) {
  const domain = createDomain(state, actor);
  if (actor.role === 'Administrador') return { ...state, events: [], audit };

  const projected = Object.fromEntries(Object.keys(state).map(k => [k, Array.isArray(state[k]) ? [] : state[k]]));
  for (const key of ['faculties','programs','subjects','rooms','assignments','curricula','competencies','plans','activities','sessions','grades','sensors']) {
    projected[key] = domain.visible(key);
  }
  const student = actor.role === 'Estudiante';
  const coordinator = actor.role === 'Coordinador';
  const allowedLoads = new Set(domain.visible('load').map(row => row.id));
  projected.load = student ? state.load.filter(row => row.program === domain.myProgram()) : domain.visible('load');
  projected.enrollments = state.enrollments.filter(row => student ? row.student === actor.person : allowedLoads.has(row.load));
  projected.teacherSchedules = state.teacherSchedules.filter(row => !student && allowedLoads.has(row.load));
  if (student) projected.sessions = projected.sessions.filter(row => domain.roster(row).includes(actor.person)).map(({roster, ...row}) => ({...row, roster:[actor.person]}));
  const sessionIds = new Set(projected.sessions.map(row => row.id));
  projected.attendance = state.attendance.filter(row => sessionIds.has(row.session) && (!student || row.student === actor.person));
  const people = new Set([actor.person, ...projected.load.map(row => row.teacher), ...projected.plans.map(row => row.teacher), ...projected.enrollments.map(row => row.student), ...projected.sessions.flatMap(domain.roster)]);
  projected.people = state.people.filter(row => people.has(row.id) || (coordinator && row.program === domain.myProgram())).map(row => {
    if (row.id === actor.person) return row;
    const {id,name,last,role,program,active} = row;
    return {id,name,last,role,program,active};
  });
  return projected;
};
