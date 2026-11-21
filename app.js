'use strict';

const STORAGE_KEY = 'lg-u-progress-board-v1';
const MAX_TASKS = 100;
const DEFAULT_TASKS = [
  '레퍼런스 검토 · 연출 방향 정리',
  '전체 시퀀스 · 씬 연결 설계',
  '모노톤 스타일프레임 · 레이아웃',
  'AE 모션그래픽 · 실사 편집',
  '사운드 디자인 · 타이틀 · 로고',
  '수정 반영 · 최종 검수 · 납품'
].map((name, index) => ({
  id: 'starter-' + index,
  name,
  assignee: '',
  status: '예정',
  progress: 0
}));

const validStatuses = new Set(['예정', '진행 중', '검수 중', '완료']);
const list = document.getElementById('taskList');
const taskTemplate = document.getElementById('taskTemplate');
let tasks = readTasks();

function sanitizeTask(record, index) {
  if (!record || typeof record !== 'object') return null;
  const parsedProgress = Number(record.progress);
  return {
    id: typeof record.id === 'string' && record.id.length <= 100
      ? record.id : 'imported-' + index,
    name: String(record.name ?? '새 작업').trim().slice(0, 100) || '새 작업',
    assignee: String(record.assignee ?? '').slice(0, 60),
    status: validStatuses.has(record.status) ? record.status : '예정',
    progress: Number.isFinite(parsedProgress)
      ? Math.max(0, Math.min(100, Math.round(parsedProgress))) : 0
  };
}

function readTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return structuredClone(DEFAULT_TASKS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > MAX_TASKS) {
      throw new Error('유효하지 않은 저장 데이터');
    }
    return parsed.map(sanitizeTask).filter(Boolean);
  } catch (error) {
    console.warn('작업 목록을 불러올 수 없습니다.', error);
    return structuredClone(DEFAULT_TASKS);
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return true;
  } catch (error) {
    showNotice('브라우저 저장이 차단되어 있습니다. 백업 내보내기로 데이터를 보관하세요.');
    console.warn('저장 실패:', error);
    return false;
  }
}

function showNotice(message) {
  document.getElementById('notice').textContent = message;
}

function updateOverview() {
  const count = tasks.length;
  const average = count ? Math.round(tasks.reduce((acc, task) => acc + task.progress, 0) / count) : 0;
  const complete = tasks.filter(task => task.status === '완료').length;
  document.getElementById('overallValue').textContent = average + '%';
  document.getElementById('overallFill').style.width = average + '%';
  document.getElementById('overallTrack').setAttribute('aria-valuenow', String(average));
  document.getElementById('taskCount').textContent = count + '개 작업';
  document.getElementById('completeCount').textContent = complete + '개 완료';
}

function refreshProgress(card, task) {
  card.querySelector('.progress-value').textContent = task.progress + '%';
  card.querySelector('.slider-fill').style.width = task.progress + '%';
  card.querySelector('.progress-slider').value = String(task.progress);
}

function changeTask(task, key, value, card) {
  task[key] = value;
  if (key === 'progress') refreshProgress(card, task);
  if (key === 'progress' || key === 'status') updateOverview();
  save();
}

function makeCard(task) {
  const node = taskTemplate.content.firstElementChild.cloneNode(true);
  const title = node.querySelector('[data-field="name"]');
  const assignee = node.querySelector('[data-field="assignee"]');
  const status = node.querySelector('[data-field="status"]');
  const slider = node.querySelector('[data-field="progress"]');

  title.value = task.name;
  assignee.value = task.assignee;
  status.value = task.status;
  refreshProgress(node, task);

  title.addEventListener('input', () => {
    task.name = title.value.slice(0, 100);
    save();
  });
  title.addEventListener('blur', () => {
    task.name = title.value.trim() || '새 작업';
    title.value = task.name;
    save();
  });
  assignee.addEventListener('input', () => changeTask(task, 'assignee', assignee.value.slice(0, 60), node));
  status.addEventListener('change', () => changeTask(task, 'status', status.value, node));
  slider.addEventListener('input', () => changeTask(task, 'progress', Number(slider.value), node));
  node.querySelector('[data-action="decrease"]').addEventListener('click', () =>
    changeTask(task, 'progress', Math.max(0, task.progress - 1), node));
  node.querySelector('[data-action="increase"]').addEventListener('click', () =>
    changeTask(task, 'progress', Math.min(100, task.progress + 1), node));
  node.querySelector('[data-action="delete"]').addEventListener('click', () => {
    if (!window.confirm('이 작업을 삭제할까요? 삭제 후 되돌리기는 어렵습니다.')) return;
    tasks = tasks.filter(item => item !== task);
    save();
    render();
    showNotice('작업이 삭제됐습니다.');
  });
  return node;
}

function render() {
  list.replaceChildren();
  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '아직 등록된 작업이 없습니다. 작업 추가 버튼으로 시작하세요.';
    list.appendChild(empty);
  } else {
    const fragment = document.createDocumentFragment();
    tasks.forEach(task => fragment.appendChild(makeCard(task)));
    list.appendChild(fragment);
  }
  updateOverview();
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
}

document.getElementById('addTask').addEventListener('click', () => {
  if (tasks.length >= MAX_TASKS) return showNotice('작업은 최대 100개까지 추가할 수 있습니다.');
  const task = { id: newId(), name: '새 작업', assignee: '', status: '예정', progress: 0 };
  tasks.push(task);
  save();
  render();
  const input = list.lastElementChild?.querySelector('[data-field="name"]');
  if (input) { input.focus(); input.select(); }
  showNotice('작업을 추가했습니다.');
});

document.getElementById('exportData').addEventListener('click', () => {
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'production-progress-backup.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showNotice('백업 파일을 내려받았습니다.');
});

document.getElementById('importData').addEventListener('click', () => document.getElementById('importFile').click());

document.getElementById('importFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 250000) return showNotice('250KB 이하 JSON 파일만 불러올 수 있습니다.');
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.version !== 1 || !Array.isArray(data.tasks) || data.tasks.length > MAX_TASKS) {
      throw new Error('지원하지 않는 백업 파일입니다.');
    }
    const imported = data.tasks.map(sanitizeTask);
    if (imported.some(item => item === null)) throw new Error('작업 형식이 올바르지 않습니다.');
    if (!window.confirm('기존 브라우저 작업 목록을 백업 파일의 내용으로 바꿀까요?')) return;
    tasks = imported;
    save();
    render();
    showNotice(imported.length + '개 작업을 불러왔습니다.');
  } catch (error) {
    showNotice('불러오기에 실패했습니다: ' + error.message);
  }
});

render();
