'use strict';

const STORAGE_KEY = 'lg-u-progress-board-v1';
const PEOPLE_KEY = 'lg-u-progress-people-v1';
const PROJECT_KEY = 'lg-u-active-project-v1';
const DEFAULT_PROJECT_ID = 'lg-u-dna';
function activeProjectId() {
  try {
    const id = localStorage.getItem(PROJECT_KEY) || DEFAULT_PROJECT_ID;
    return /^[a-z0-9-]{1,64}$/.test(id) ? id : DEFAULT_PROJECT_ID;
  } catch (e) { return DEFAULT_PROJECT_ID; }
}
function taskStorageKey() {
  const id = activeProjectId();
  return id === DEFAULT_PROJECT_ID ? STORAGE_KEY : STORAGE_KEY + ':' + id;
}
const MAX_TASKS = 100;
const MAX_PEOPLE = 50;
const COLORS = new Set(['blue', 'yellow', 'purple', 'teal', 'pink', 'gray']);
const STATUSES = new Set(['예정', '진행 중', '검수 중', '완료']);
const DEFAULT_PEOPLE = [
  { name: '정민수', color: 'blue' },
  { name: '김소영', color: 'yellow' }
];
const DEFAULT_TASKS = [
  '레퍼런스 검토 · 연출 방향 정리',
  '전체 시퀀스 · 씬 연결 설계',
  '모노톤 스타일프레임 · 레이아웃',
  'AE 모션그래픽 · 실사 편집',
  '사운드 디자인 · 타이틀 · 로고',
  '수정 반영 · 최종 검수 · 납품'
].map((name, i) => ({
  id: 'starter-' + i, name, assignee: '', status: '예정', progress: 0
}));

const list = document.getElementById('taskList');
const peopleList = document.getElementById('peopleList');
const template = document.getElementById('taskTemplate');
let tasks = readTasks();
let people = readPeople();
let role = 'local';

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}
function sanitizedPerson(p) {
  if (!p || typeof p !== 'object') return null;
  const name = String(p.name || '').trim().slice(0, 60);
  if (!name) return null;
  return { name, color: COLORS.has(p.color) ? p.color : 'gray' };
}
function sanitizedTask(t, index) {
  if (!t || typeof t !== 'object') return null;
  const n = Number(t.progress);
  return {
    id: typeof t.id === 'string' && t.id.length <= 100 ? t.id : 'import-' + index,
    name: String(t.name ?? '새 작업').trim().slice(0, 100) || '새 작업',
    assignee: encodeAssignees(assigneeNames(t.assignee)),
    status: STATUSES.has(t.status) ? t.status : '예정',
    progress: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0
  };
}
function readTasks() {
  try {
    const raw = localStorage.getItem(taskStorageKey());
    if (raw === null) return activeProjectId() === DEFAULT_PROJECT_ID ? clone(DEFAULT_TASKS) : [];
    const t = JSON.parse(raw);
    if (!Array.isArray(t) || t.length > MAX_TASKS) throw new Error('invalid task data');
    const checked = t.map(sanitizedTask);
    if (checked.some(x => !x)) throw new Error('invalid task record');
    return checked;
  } catch (e) {
    console.warn('작업 기록 복구 실패:', e);
    return clone(DEFAULT_TASKS);
  }
}
function readPeople() {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY);
    if (raw === null) return clone(DEFAULT_PEOPLE);
    const p = JSON.parse(raw);
    if (!Array.isArray(p) || p.length > MAX_PEOPLE) throw new Error('invalid worker list');
    const seen = new Set();
    return p.map(sanitizedPerson).filter(x => {
      if (!x || seen.has(x.name.toLocaleLowerCase())) return false;
      seen.add(x.name.toLocaleLowerCase());
      return true;
    });
  } catch (e) {
    console.warn('작업자 정보 복구 실패:', e);
    return clone(DEFAULT_PEOPLE);
  }
}
function reconcileAssignees() {
  // Keep previously typed assignees from v1; never silently discard names.
  let changed = false;
  tasks.flatMap(task => assigneeNames(task.assignee)).forEach(name => {
    if (name && !people.some(p => p.name === name) && people.length < MAX_PEOPLE) {
      people.push({ name, color: 'gray' });
      changed = true;
    }
  });
  if (changed) savePeople();
}
function saveTasks() {
  try {
    localStorage.setItem(taskStorageKey(), JSON.stringify(tasks));
    window.dispatchEvent(new CustomEvent('progress-board:changed', { detail: { resource: 'tasks', projectId: activeProjectId() } }));
  } catch (e) {
    console.warn('작업 저장 실패:', e);
    notify('저장이 차단된 환경입니다. JSON 백업을 내려받아 주세요.');
  }
}
function savePeople() {
  try {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(people));
    window.dispatchEvent(new CustomEvent('progress-board:changed', { detail: { resource: 'people' } }));
  } catch (e) {
    console.warn('작업자 저장 실패:', e);
    notify('작업자 목록을 저장하지 못했습니다.');
  }
}
function notify(message) {
  document.getElementById('notice').textContent = message;
}
function newId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}
function updateOverview() {
  const avg = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length) : 0;
  const done = tasks.filter(t => t.status === '완료').length;
  document.getElementById('overallValue').textContent = avg + '%';
  document.getElementById('overallFill').style.width = avg + '%';
  document.getElementById('overallTrack').setAttribute('aria-valuenow', String(avg));
  document.getElementById('taskCount').textContent = tasks.length + '개 작업';
  document.getElementById('completeCount').textContent = done + '개 완료';
}
function refreshProgress(card, task) {
  card.querySelector('.progress-value').textContent = task.progress + '%';
  card.querySelector('.slider-fill').style.width = task.progress + '%';
  card.querySelector('.progress-slider').value = String(task.progress);
}
function assigneeNames(value) {
  if (!value || typeof value !== 'string') return [];
  if (value.startsWith('[')) {
    try {
      const names = JSON.parse(value);
      if (Array.isArray(names)) return [...new Set(names.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0,60)))].slice(0, MAX_PEOPLE);
    } catch { /* Legacy single name. */ }
  }
  return [value.trim().slice(0,60)].filter(Boolean);
}
function encodeAssignees(names) {
  return names.length > 1 || names[0]?.startsWith('[') ? JSON.stringify(names) : names[0] || '';
}
function fillAssigneeMenu(menu, task, card) {
  let selected = assigneeNames(task.assignee);
  const summary = menu.querySelector('summary');
  const refresh = () => {
    summary.textContent = selected.join(', ') || '미지정';
    summary.setAttribute('aria-label', '담당자 ' + summary.textContent);
    updateCardAssignee(card, selected[0]);
  };
  refresh();
  for (const name of new Set([...people.map(p => p.name), ...selected])) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.includes(name);
    input.disabled = role === 'viewer';
    input.addEventListener('change', () => {
      selected = selected.filter(x => x !== name);
      if (input.checked) selected.push(name);
      task.assignee = encodeAssignees(selected);
      refresh();
      saveTasks();
    });
    label.append(input, document.createTextNode(name));
    menu.appendChild(label);
  }
}
function updateCardAssignee(card, name) {
  const person = people.find(p => p.name === name);
  card.dataset.assigneeColor = person ? person.color : 'none';
}
function renderPeople() {
  peopleList.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const person of people) {
    const chip = document.createElement('div');
    chip.className = 'person-chip';
    chip.dataset.color = person.color;
    const dot = document.createElement('span');
    dot.className = 'person-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = person.name;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'person-remove';
    del.disabled = role === 'viewer';
    del.textContent = '×';
    del.setAttribute('aria-label', person.name + ' 작업자 삭제');
    del.title = person.name + ' 삭제';
    del.addEventListener('click', () => {
      const assigned = tasks.filter(t => assigneeNames(t.assignee).includes(person.name)).length;
      const message = assigned
        ? person.name + ' 작업자를 삭제할까요? 이 담당자로 지정된 ' + assigned + '개 작업에서 이 이름이 빠집니다.'
        : person.name + ' 작업자를 삭제할까요?';
      if (!window.confirm(message)) return;
      people = people.filter(p => p !== person);
      if (assigned) tasks.forEach(t => { t.assignee = encodeAssignees(assigneeNames(t.assignee).filter(name => name !== person.name)); });
      savePeople();
      saveTasks();
      render();
      notify('작업자 목록을 변경했습니다.');
    });
    chip.append(dot, label, del);
    frag.appendChild(chip);
  }
  peopleList.appendChild(frag);
  if (!people.length) {
    const hint = document.createElement('span');
    hint.className = 'people-empty';
    hint.textContent = '등록된 작업자가 없습니다.';
    peopleList.appendChild(hint);
  }
}
function makeCard(task) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.layoutId = task.id;
  const title = card.querySelector('[data-field="name"]');
  const assignee = card.querySelector('[data-field="assignee"]');
  const status = card.querySelector('[data-field="status"]');
  const slider = card.querySelector('[data-field="progress"]');
  title.value = task.name;
  fillAssigneeMenu(assignee, task, card);
  status.value = task.status;
  card.dataset.status = task.status;
  refreshProgress(card, task);
  if (role === 'viewer') {
    title.disabled = true;
    status.disabled = true;
    slider.disabled = true;
    card.querySelector('[data-action="delete"]').hidden = true;
  }

  title.addEventListener('input', () => {
    task.name = title.value.slice(0, 100);
    saveTasks();
  });
  title.addEventListener('blur', () => {
    task.name = title.value.trim() || '새 작업';
    title.value = task.name;
    saveTasks();
  });
  status.addEventListener('change', () => {
    task.status = status.value;
    card.dataset.status = task.status;
    saveTasks();
    updateOverview();
  });
  slider.addEventListener('input', () => {
    task.progress = Math.round(Number(slider.value));
    refreshProgress(card, task);
    saveTasks();
    updateOverview();
  });
  card.querySelector('[data-action="delete"]').addEventListener('click', () => {
    if (!window.confirm('이 작업을 삭제할까요?')) return;
    tasks = tasks.filter(t => t !== task);
    saveTasks();
    render();
    notify('작업을 삭제했습니다.');
  });
  return card;
}
function render() {
  document.getElementById('addTask').disabled = role === 'viewer';
  document.getElementById('addPersonForm').hidden = role === 'viewer';
  renderPeople();
  list.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '작업이 없습니다. 작업 추가 버튼으로 시작하세요.';
    list.appendChild(empty);
  } else {
    const frag = document.createDocumentFragment();
    tasks.forEach(t => frag.appendChild(makeCard(t)));
    list.appendChild(frag);
  }
  updateOverview();
  window.dispatchEvent(new Event('progress:render'));
}
document.getElementById('addPersonForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('newPersonName');
  const select = document.getElementById('newPersonColor');
  const name = input.value.trim().slice(0, 60);
  if (!name) return;
  if (people.length >= MAX_PEOPLE) return notify('작업자는 최대 50명까지 등록할 수 있어요.');
  if (people.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
    return notify('이미 등록된 작업자 이름이에요.');
  people.push({ name, color: COLORS.has(select.value) ? select.value : 'purple' });
  savePeople();
  render();
  input.value = '';
  input.focus();
  notify(name + ' 작업자를 추가했습니다.');
});
document.getElementById('addTask').addEventListener('click', () => {
  if (tasks.length >= MAX_TASKS) return notify('작업은 최대 100개까지 추가할 수 있습니다.');
  tasks.push({ id: newId(), name: '새 작업', assignee: '', status: '예정', progress: 0 });
  saveTasks();
  render();
  const input = list.lastElementChild?.querySelector('[data-field="name"]');
  if (input) { input.focus(); input.select(); }
  notify('작업을 추가했습니다.');
});
document.getElementById('exportData').addEventListener('click', () => {
  const payload = JSON.stringify({
    version: 2, exportedAt: new Date().toISOString(), tasks, people
  }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'production-progress-backup.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  notify('작업 및 담당자 목록을 백업했습니다.');
});
document.getElementById('importData').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 250000) return notify('250KB 이하 JSON 파일만 불러올 수 있습니다.');
  try {
    const data = JSON.parse(await file.text());
    if (!data || (data.version !== 1 && data.version !== 2) ||
        !Array.isArray(data.tasks) || data.tasks.length > MAX_TASKS)
      throw new Error('지원하지 않는 백업 형식입니다.');
    const nextTasks = data.tasks.map(sanitizedTask);
    if (nextTasks.some(t => !t)) throw new Error('작업 데이터가 올바르지 않습니다.');
    let nextPeople = people;
    if (data.version === 2) {
      if (!Array.isArray(data.people) || data.people.length > MAX_PEOPLE)
        throw new Error('작업자 데이터가 올바르지 않습니다.');
      const seen = new Set();
      nextPeople = data.people.map(sanitizedPerson).filter(p => {
        if (!p || seen.has(p.name.toLocaleLowerCase())) return false;
        seen.add(p.name.toLocaleLowerCase());
        return true;
      });
    }
    if (!window.confirm('기존 작업 목록을 백업 데이터로 교체할까요?')) return;
    tasks = nextTasks;
    people = nextPeople;
    reconcileAssignees();
    saveTasks();
    savePeople();
    render();
    notify(tasks.length + '개 작업을 불러왔습니다.');
  } catch (e) {
    notify('불러오기에 실패했습니다: ' + e.message);
  }
});

// Stable client-side adapter for the optional authenticated cloud synchronization module.
// Cloud downloads never trigger outgoing writes; callers must verify access via Supabase RLS.
window.progressBoard = {
  getActiveProjectId: activeProjectId,
  setRole(value) {
    role = value === 'viewer' ? 'viewer' : 'editor';
    render();
  },
  loadProject() {
    tasks = readTasks();
    reconcileAssignees();
    render();
  },
  getSnapshot() {
    return clone({ tasks, people });
  },
  applyRemoteSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.people))
      throw new Error('Invalid remote progress snapshot');
    if (snapshot.tasks.length > MAX_TASKS || snapshot.people.length > MAX_PEOPLE)
      throw new Error('Remote progress snapshot exceeds limits');
    const nextTasks = snapshot.tasks.map(sanitizedTask);
    const nextPeople = snapshot.people.map(sanitizedPerson);
    if (nextTasks.some(t => !t) || nextPeople.some(p => !p))
      throw new Error('Invalid remote task or worker record');
    // Keep an emergency local copy before the first remote replacement.
    try {
      const key = 'lg-u-before-cloud-' + new Date().toISOString().slice(0, 10);
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ tasks, people }));
    } catch (error) { console.warn('Local backup could not be created:', error); }
    tasks = nextTasks;
    people = nextPeople;
    try {
      localStorage.setItem(taskStorageKey(), JSON.stringify(tasks));
      localStorage.setItem(PEOPLE_KEY, JSON.stringify(people));
    } catch (error) { console.warn('Local cloud snapshot cache unavailable:', error); }
    render();
  },
  setNotice: notify
};

reconcileAssignees();
render();
