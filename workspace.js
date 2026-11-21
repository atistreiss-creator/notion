'use strict';
(() => {
  const PROJECTS_KEY = 'lg-u-project-list-v1';
  const ACTIVE_KEY = 'lg-u-active-project-v1';
  const CONTENT_KEY = 'lg-u-project-content-v1:';
  const DEFAULT_ID = 'lg-u-dna';
  const MAX_PROJECTS = 30;
  const MAX_ITEMS = 250;
  const TYPES = ['resource', 'checklist', 'feedback', 'reference'];
  const ids = Object.fromEntries(TYPES.map(type => [type, {
    list: document.getElementById(type + 'List'),
    form: document.getElementById(type + 'Form'),
    count: document.getElementById(type + 'Count')
  }]));
  const projectSelect = document.getElementById('projectSelect');
  const count = document.getElementById('workspaceCount');
  let projects = loadProjects();
  let activeId = readActiveId();
  let items = loadItems(activeId);
  let role = 'local';
  let editing = null;

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function activeStorageKey(id) { return CONTENT_KEY + id; }
  function readActiveId() {
    try {
      const id = localStorage.getItem(ACTIVE_KEY) || DEFAULT_ID;
      return /^[a-z0-9-]{1,64}$/.test(id) ? id : DEFAULT_ID;
    } catch (e) { return DEFAULT_ID; }
  }
  function loadProjects() {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      if (!raw) return [{ id: DEFAULT_ID, name: 'LG U+ 1등 DNA 시상식' }];
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) throw new Error('Invalid projects');
      const valid = entries.filter(p =>
        p && /^[a-z0-9-]{1,64}$/.test(p.id) && typeof p.name === 'string'
      ).map(p => ({ id: p.id, name: p.name.trim().slice(0, 100) }));
      if (!valid.some(p => p.id === DEFAULT_ID))
        valid.unshift({ id: DEFAULT_ID, name: 'LG U+ 1등 DNA 시상식' });
      return valid.slice(0, MAX_PROJECTS);
    } catch (e) { return [{ id: DEFAULT_ID, name: 'LG U+ 1등 DNA 시상식' }]; }
  }
  function sanitizeUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value).trim());
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.href.slice(0, 1500);
    } catch (e) { return ''; }
  }
  function sanitizeItem(value, index = 0) {
    if (!value || typeof value !== 'object' || !TYPES.includes(value.kind)) return null;
    const title = String(value.title ?? '').trim().slice(0, 160);
    if (!title) return null;
    const id = String(value.id ?? '');
    return {
      id: /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : 'import-' + index + '-' + newId(),
      kind: value.kind, title,
      url: sanitizeUrl(value.url),
      body: String(value.body ?? '').slice(0, 1500),
      category: String(value.category ?? '').slice(0, 60),
      completed: value.completed === true,
      sort_order: Number.isFinite(Number(value.sort_order)) ? Math.max(0, Math.min(9999, Math.round(Number(value.sort_order)))) : index
    };
  }
  function loadItems(projectId) {
    try {
      const raw = localStorage.getItem(activeStorageKey(projectId));
      if (!raw) return [];
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.length > MAX_ITEMS) throw new Error('Invalid content list');
      return rows.map(sanitizeItem).filter(Boolean);
    } catch (e) {
      console.warn('프로젝트 기록 불러오기 실패:', e);
      return [];
    }
  }
  function newId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function persist(notify = true) {
    try {
      localStorage.setItem(activeStorageKey(activeId), JSON.stringify(items));
      if (notify) window.dispatchEvent(new CustomEvent('workspace:changed', { detail: { projectId: activeId } }));
    } catch (e) { alert('로컬 저장에 실패했습니다. 자료 백업을 내려받아 주세요.'); }
  }
  function saveProjects() {
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); } catch (e) { console.warn(e); }
  }
  function setActive(id) {
    if (!projects.some(p => p.id === id) || id === activeId) return;
    activeId = id;
    localStorage.setItem(ACTIVE_KEY, id);
    items = loadItems(id);
    editing = null;
    render();
    window.progressBoard?.loadProject();
    window.dispatchEvent(new CustomEvent('workspace:projectchanged', { detail: { id } }));
  }
  function addText(node, text, className = '') {
    const el = document.createElement('span');
    if (className) el.className = className;
    el.textContent = text;
    node.appendChild(el);
    return el;
  }
  function makeButton(title, text, fn) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-small-button';
    button.textContent = text;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', fn);
    return button;
  }
  function editItem(item) {
    editing = item.id;
    const form = ids[item.kind].form;
    for (const name of ['title', 'body', 'url', 'category']) {
      if (form.elements.namedItem(name)) form.elements.namedItem(name).value = item[name] || '';
    }
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.textContent = '수정 저장';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    form.elements.namedItem('title')?.focus();
  }
  function renderItem(item) {
    const row = document.createElement('div');
    row.className = 'workspace-item';
    const main = document.createElement('div');
    main.className = 'workspace-item-main';
    if (item.kind === 'checklist') {
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'workspace-check';
      check.checked = !!item.completed;
      check.disabled = role === 'viewer';
      check.setAttribute('aria-label', item.title);
      check.addEventListener('change', () => {
        item.completed = check.checked;
        persist();
        render();
      });
      main.appendChild(check);
      if (item.category) addText(main, item.category, 'workspace-category');
    }
    const content = document.createElement('div');
    content.className = 'workspace-item-copy';
    if (item.url) {
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'workspace-link';
      link.textContent = item.title;
      content.appendChild(link);
    } else addText(content, item.title, 'workspace-item-title');
    if (item.body) {
      const description = document.createElement('p');
      description.textContent = item.body;
      content.appendChild(description);
    }
    main.appendChild(content);
    const controls = document.createElement('div');
    controls.className = 'workspace-item-actions';
    if (role !== 'viewer') {
      controls.appendChild(makeButton(item.title + ' 수정', '수정', () => editItem(item)));
      controls.appendChild(makeButton(item.title + ' 삭제', '×', () => {
        if (!confirm('이 항목을 삭제할까요?')) return;
        items = items.filter(x => x.id !== item.id);
        persist(); render();
      }));
    }
    row.append(main, controls);
    return row;
  }
  function render() {
    if (!projects.some(p => p.id === activeId)) activeId = DEFAULT_ID;
    projectSelect.replaceChildren();
    for (const project of projects) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      projectSelect.appendChild(option);
    }
    projectSelect.value = activeId;
    count.textContent = items.length + '개 항목';
    document.getElementById('createProject').disabled = role === 'viewer';
    document.getElementById('renameProject').disabled = role === 'viewer';
    for (const kind of TYPES) {
      const { list, form, count } = ids[kind];
      list.replaceChildren();
      const rows = items.filter(item => item.kind === kind);
      count.textContent = rows.length + '개';
      rows.forEach(item => list.appendChild(renderItem(item)));
      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'workspace-empty';
        empty.textContent = '등록된 항목이 없습니다.';
        list.appendChild(empty);
      }
      form.hidden = role === 'viewer';
      if (editing && !rows.some(item => item.id === editing)) resetForm(form);
    }
  }
  function resetForm(form) {
    editing = null;
    form.reset();
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      const labels = {
        resource: '+ 자료 추가', checklist: '+ 할 일 추가',
        feedback: '+ 피드백 추가', reference: '+ 레퍼런스 추가'
      };
      button.textContent = labels[form.id.replace('Form','')] || '+ 추가';
    }
  }
  for (const kind of TYPES) {
    ids[kind].form.addEventListener('submit', event => {
      event.preventDefault();
      if (role === 'viewer') return;
      const form = ids[kind].form;
      const obj = Object.fromEntries(new FormData(form));
      const val = sanitizeItem({
        ...obj, kind,
        id: editing || newId(),
        completed: editing ? items.find(x => x.id === editing)?.completed : false,
        sort_order: editing ? items.find(x => x.id === editing)?.sort_order : items.length
      });
      if (!val) return;
      if (['resource', 'reference'].includes(kind) && !val.url) {
        alert('http 또는 https 링크를 입력해주세요.');
        return;
      }
      if (editing) items = items.map(x => x.id === editing ? val : x);
      else if (items.length < MAX_ITEMS) items.push(val);
      else { alert('프로젝트당 최대 ' + MAX_ITEMS + '개 항목을 등록할 수 있어요.'); return; }
      resetForm(form);
      persist(); render();
    });
  }
  projectSelect.addEventListener('change', () => setActive(projectSelect.value));
  document.getElementById('createProject').addEventListener('click', () => {
    if (role === 'viewer') return;
    if (projects.length >= MAX_PROJECTS) return alert('최대 30개 프로젝트까지 추가할 수 있어요.');
    const name = prompt('새 프로젝트 이름을 입력하세요.');
    if (!name?.trim()) return;
    const id = 'project-' + newId().toLowerCase();
    const project = { id, name: name.trim().slice(0, 100) };
    projects.push(project);
    saveProjects();
    window.dispatchEvent(new CustomEvent('workspace:projects-changed', { detail: { project } }));
    setActive(id);
  });
  document.getElementById('renameProject').addEventListener('click', () => {
    if (role === 'viewer') return;
    const project = projects.find(p => p.id === activeId);
    if (!project) return;
    const name = prompt('프로젝트 이름', project.name);
    if (!name?.trim()) return;
    project.name = name.trim().slice(0, 100);
    saveProjects();
    window.dispatchEvent(new CustomEvent('workspace:projects-changed', { detail: { project: copy(project) } }));
    render();
  });
  document.getElementById('exportWorkspace').addEventListener('click', () => {
    const name = projects.find(p => p.id === activeId)?.name || activeId;
    const blob = new Blob([JSON.stringify({ version: 1, project: { id: activeId, name }, items }, null, 2)],
      { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'project-materials-backup.json';
    document.body.appendChild(a);
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 750);
  });
  document.getElementById('importWorkspace').addEventListener('click', () => {
    if (role === 'viewer') return;
    document.getElementById('workspaceImportFile').click();
  });
  document.getElementById('workspaceImportFile').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || role === 'viewer') return;
    if (file.size > 300000) return alert('자료 파일은 300KB 이하여야 해요.');
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.version !== 1 || !Array.isArray(data.items) ||
          data.items.length > MAX_ITEMS) throw new Error('유효하지 않은 자료 파일입니다.');
      const imported = data.items.map(sanitizeItem);
      if (imported.some(x => !x)) throw new Error('지원하지 않는 항목 형식입니다.');
      if (!confirm('이 프로젝트에 ' + imported.length + '개 자료를 가져올까요? 기존 자료는 보존합니다.')) return;
      const byId = new Map(items.map(x => [x.id, x]));
      imported.forEach(x => {
        if (!byId.has(x.id)) byId.set(x.id, x);
      });
      items = Array.from(byId.values()).slice(0, MAX_ITEMS);
      persist(); render();
      alert(imported.length + '개 항목을 확인해 가져왔습니다.');
    } catch (error) { alert('가져오기에 실패했습니다: ' + error.message); }
  });

  window.workspaceBoard = {
    getProjectId: () => activeId,
    getProjects: () => copy(projects),
    getSnapshot: () => copy(items),
    setRole(next) { role = next; render(); },
    loadCloudProjects(remote) {
      if (!Array.isArray(remote)) return;
      const seen = new Set();
      const next = remote.filter(p => p && /^[a-z0-9-]{1,64}$/.test(p.id) &&
        typeof p.name === 'string' && !seen.has(p.id) && seen.add(p.id))
        .map(p => ({ id: p.id, name: p.name.slice(0, 100) }));
      if (!next.some(p => p.id === DEFAULT_ID))
        next.unshift({ id: DEFAULT_ID, name: 'LG U+ 1등 DNA 시상식' });
      projects = next.slice(0, MAX_PROJECTS);
      saveProjects();
      if (!projects.some(p => p.id === activeId)) setActive(DEFAULT_ID);
      render();
    },
    applyRemoteContent(remote) {
      if (!Array.isArray(remote) || remote.length > MAX_ITEMS) throw new Error('Invalid remote content');
      const checked = remote.map(sanitizeItem);
      if (checked.some(x => !x)) throw new Error('Invalid remote content record');
      const key = activeStorageKey(activeId);
      try {
        const backupKey = key + ':backup:' + new Date().toISOString().slice(0, 10);
        if (!localStorage.getItem(backupKey))
          localStorage.setItem(backupKey, JSON.stringify(items));
      } catch (e) { console.warn(e); }
      items = checked;
      persist(false);
      render();
    }
  };
  render();
})();
