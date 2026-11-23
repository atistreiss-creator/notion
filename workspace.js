'use strict';
(() => {
  const PROJECTS_KEY = 'lg-u-project-list-v1';
  const ACTIVE_KEY = 'lg-u-active-project-v1';
  const CONTENT_KEY = 'lg-u-project-content-v1:';
  const DEFAULT_ID = 'lg-u-dna';
  const MAX_PROJECTS = 30;
  const MAX_ITEMS = 250;
  const TYPES = ['note', 'resource', 'checklist', 'feedback', 'reference'];
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
  let role = 'viewer'; // Require verified membership before editing team content.
  let editing = null;

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function activeStorageKey(id) { return CONTENT_KEY + id; }
  function readActiveId() {
    try {
      const id = new URL(location.href).searchParams.get('project') || localStorage.getItem(ACTIVE_KEY) || DEFAULT_ID;
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
      ).map(p => ({ id: p.id, name: projectName(p.name) }));
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
    // Existing drafts remain in this browser. Never embed private project URLs in
    // a public GitHub Pages JavaScript bundle; shared materials load after login.
    try {
      const raw = localStorage.getItem(activeStorageKey(projectId));
      const rows = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(rows) || rows.length > MAX_ITEMS) throw new Error('Invalid content list');
      return rows.map(sanitizeItem).filter(Boolean);
    } catch (error) {
      console.warn('프로젝트 기록 불러오기 실패:', error);
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
  function projectName(value) {
    const input = value.trim();
    if (input.length <= 100) return input;
    const parts = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(input)
      : Array.from(input);
    let result = '';
    for (const part of parts) {
      const character = typeof part === 'string' ? part : part.segment;
      if (result.length + character.length > 100) break;
      result += character;
    }
    return result;
  }
  function saveProjects() {
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); } catch (e) { console.warn(e); }
  }
  function setActive(id) {
    if (!projects.some(p => p.id === id) || id === activeId) return;
    activeId = id;
    const url = new URL(location.href);
    url.searchParams.set('project', id);
    history.replaceState(null, '', url);
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
  let inlineForm = null;
  function closeInline() {
    inlineForm?.remove();
    inlineForm = null;
    editing = null;
  }
  function editItem(item, row) {
    const closing = editing === item.id;
    closeInline();
    if (!closing) {
      editing = item.id;
      inlineForm = ids[item.kind].form.cloneNode(true);
      inlineForm.id = item.kind + 'InlineForm';
      inlineForm.classList.add('inline-editor');
      for (const field of ['title','url','body','category']) {
        const input = inlineForm.elements.namedItem(field);
        if (input) input.value = item[field] || '';
      }
      inlineForm.querySelector('button[type="submit"]').textContent = '수정 저장';
      inlineForm.addEventListener('submit', event => saveItem(event, item.kind, item.id));
      row.after(inlineForm);
    }
    syncEditorButtons();
  }
  function renderItem(item) {
    const row = document.createElement('div');
    row.className = 'workspace-item';
    row.dataset.layoutId = item.id;
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
      const editButton = makeButton(item.title + ' 수정', '수정', () => editItem(item, row));
      editButton.dataset.item = item.id;
      editButton.dataset.title = item.title;
      editButton.setAttribute('aria-controls', ids[item.kind].form.id);
      controls.appendChild(editButton);
      controls.appendChild(makeButton(item.title + ' 삭제', '×', () => {
        if (!confirm('이 항목을 삭제할까요?')) return;
        items = items.filter(x => x.id !== item.id);
        persist(); render();
      }));
    }
    row.append(main, controls);
    return row;
  }
  function syncEditorButtons() {
    for (const kind of TYPES) {
      const {list, form} = ids[kind];
      const panel = form.parentElement;
      for (const button of list.querySelectorAll('[data-item]')) {
        const active = editing === button.dataset.item;
        button.textContent = active ? '닫기' : '수정';
        button.setAttribute('aria-expanded', String(active));
        if (active) button.setAttribute('aria-controls', inlineForm.id);
        else button.removeAttribute('aria-controls');
        button.setAttribute('aria-label', button.dataset.title + ' ' + button.textContent);
      }
    }
  }
  const headerId = 'project-masthead';
  const headerFields = [...document.querySelectorAll('.masthead-copy > .eyebrow, .masthead-copy > h1, .masthead-copy > p')];
  const defaultHeader = headerFields.map(el => el.textContent);
  const headerForm = document.getElementById('headerForm');
  const editHeader = document.getElementById('editHeader');
  function closeHeader() {
    headerForm.hidden = true;
    editHeader.textContent = '헤드타이틀 수정';
    editHeader.setAttribute('aria-expanded', 'false');
  }
  editHeader.addEventListener('click', () => {
    if (role !== 'owner') return;
    if (!headerForm.hidden) return closeHeader();
    ['label','title','body'].forEach((key,i) => headerForm.elements[key].value = headerFields[i].textContent);
    headerForm.hidden = false;
    headerForm.dataset.project = activeId;
    editHeader.textContent = '닫기';
    editHeader.setAttribute('aria-expanded', 'true');
  });
  headerForm.addEventListener('submit', event => {
    event.preventDefault();
    if (role !== 'owner' || headerForm.dataset.project !== activeId) return;
    const values = new FormData(headerForm);
    const row = sanitizeItem({id:headerId,kind:'note',title:values.get('title'),category:values.get('label'),body:values.get('body')});
    if (!row) return;
    const pos = items.findIndex(x => x.id === headerId);
    if (pos >= 0) items[pos] = row;
    else if (items.length < MAX_ITEMS) items.push(row);
    else return alert('자료실이 가득 차서 저장할 수 없어요.');
    closeHeader(); persist(); render();
  });
  function render() {
    if (role === 'viewer' || !items.some(x => x.id === editing)) closeInline();
    const header = items.find(x => x.id === headerId);
    const values = header ? [header.category, header.title, header.body] : defaultHeader;
    headerFields.forEach((el,i) => el.textContent = values[i]);
    editHeader.hidden = role !== 'owner';
    if (editHeader.hidden || headerForm.dataset.project !== activeId) closeHeader();
    const title = document.getElementById('currentProjectName');
    if (title) title.textContent = projects.find(p => p.id === activeId)?.name || '프로젝트 확인 중';
    projectSelect.replaceChildren();
    for (const project of projects) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      projectSelect.appendChild(option);
    }
    projectSelect.value = activeId;
    count.textContent = (items.length - Number(!!header)) + '개 항목';
    document.getElementById('createProject').disabled = role === 'viewer';
    document.getElementById('renameProject').disabled = role === 'viewer';
    for (const kind of TYPES) {
      const { list, form, count } = ids[kind];
      list.replaceChildren();
      const rows = items.filter(item => item.kind === kind && item.id !== headerId);
      count.textContent = rows.length + '개';
      rows.forEach(item => {
        list.appendChild(renderItem(item));
        if (editing === item.id && inlineForm) list.appendChild(inlineForm);
      });
      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'workspace-empty';
        empty.textContent = '등록된 항목이 없습니다.';
        list.appendChild(empty);
      }
      form.parentElement.hidden = role === 'viewer';
      if (editing && !items.some(item => item.id === editing)) resetForm(form);
    }
    syncEditorButtons();
    window.dispatchEvent(new Event('workspace:render'));
  }
  function resetForm(form) {
    editing = null;
    form.parentElement.open = false;
    form.reset();
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      const labels = {
        note: '+ 메모 추가', resource: '+ 자료 추가', checklist: '+ 할 일 추가',
        feedback: '+ 피드백 추가', reference: '+ 레퍼런스 추가'
      };
      button.textContent = labels[form.id.replace('Form','')] || '+ 추가';
    }
  }
  function saveItem(event, kind, itemId) {
    event.preventDefault();
    if (role === 'viewer') return;
    const form = event.currentTarget;
    const previous = itemId ? items.find(x => x.id === itemId && x.kind === kind) : null;
    if (itemId && !previous) return;
    const formValues = new FormData(form);
    const suppliedUrl = String(formValues.get('url') ?? '').trim();
    // A shared resource can start as a note, with its URL added later.
    // Reference links remain required. Non-empty malformed links are rejected.
    if (['resource','reference'].includes(kind)) {
      if (suppliedUrl && !sanitizeUrl(suppliedUrl)) {
        return alert('올바른 http 또는 https 링크를 입력해 주세요.');
      }
      if (kind === 'reference' && !suppliedUrl) {
        return alert('레퍼런스 링크를 입력해 주세요.');
      }
    }
    const val = sanitizeItem({...previous, ...Object.fromEntries(formValues), kind,
      id: itemId || newId(), sort_order: previous?.sort_order ?? items.length});
    if (!val) return;
    if (previous) items = items.map(x => x.id === itemId ? val : x);
    else if (items.length < MAX_ITEMS) items.push(val);
    else return alert('프로젝트당 최대 ' + MAX_ITEMS + '개 항목을 등록할 수 있어요.');
    if (previous) closeInline();
    else { form.reset(); form.parentElement.open = false; }
    persist(); render();
  }
  for (const kind of TYPES) {
    ids[kind].form.addEventListener('submit', event => saveItem(event, kind, null));
  }
  projectSelect.addEventListener('change', () => { if (role === 'owner') setActive(projectSelect.value); });
  document.getElementById('createProject').addEventListener('click', () => {
    if (role !== 'owner') return;
    if (projects.length >= MAX_PROJECTS) return alert('최대 30개 프로젝트까지 추가할 수 있어요.');
    const name = prompt('새 프로젝트 이름을 입력하세요.');
    if (!name?.trim()) return;
    const id = 'project-' + newId().toLowerCase();
    const project = { id, name: projectName(name) };
    projects.push(project);
    saveProjects();
    window.dispatchEvent(new CustomEvent('workspace:projects-changed', { detail: { project } }));
    setActive(id);
  });
  document.getElementById('renameProject').addEventListener('click', () => {
    if (role !== 'owner') return;
    const project = projects.find(p => p.id === activeId);
    if (!project) return;
    const name = prompt('프로젝트 이름을 입력하세요. 이모지도 붙여넣을 수 있어요.\n예: 🎬 MULTRA Brand Film', project.name);
    if (!name?.trim()) return;
    project.name = projectName(name);
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
  function stripMarkup(value) {
    return String(value || '').replace(/<[^>]*>/g, '')
      .replace(/\*\*/g, '').replace(/\\\\~/g, '~').trim();
  }
  function stableImportId(kind, title, url = '') {
    let hash = 2166136261;
    const value = kind + '\0' + title + '\0' + url;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return 'notion-' + kind + '-' + (hash >>> 0).toString(16);
  }
  function parseNotionMarkdown(raw) {
    const result = [];
    let part = '', category = '', brief = [];
    function add(kind, title, url = '', body = '', categoryValue = '', completed = false) {
      const cleanedTitle = stripMarkup(title).slice(0, 160);
      if (!cleanedTitle) return;
      const safe = sanitizeItem({
        id: stableImportId(kind, cleanedTitle, url),
        kind, title: cleanedTitle, url, body: stripMarkup(body).slice(0, 1500),
        category: categoryValue, completed, sort_order: result.length
      }, result.length);
      if (safe && !result.some(x => x.id === safe.id)) result.push(safe);
    }
    const lines = String(raw).split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      const header = trimmed.match(/^#{1,6}\s+(.+)$/);
      const text = stripMarkup(header ? header[1] : trimmed);
      if (/^(?:0?[1-5])\.\s/.test(text)) {
        part = text.match(/^0?([1-5])\./)[1];
        category = '';
        continue;
      }
      if (header && part === '4' &&
          /^(협업 준비|연출·제작|최종 검수|기타)/.test(text)) {
        category = text; continue;
      }
      if (part === '1') {
        const link = trimmed.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
        if (link && !/notion\.so|app\.notion\.com/.test(link[2])) {
          const prefix = stripMarkup(trimmed.slice(0, link.index))
            .replace(/^[-*]\s*/, '').replace(/:$/, '').trim();
          add('resource', prefix ? prefix + ' · ' + link[1] : link[1], link[2]);
        }
      } else if (part === '4') {
        const check = trimmed.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/);
        if (check) add('checklist', check[2], '', '', category || '기타',
          check[1].toLowerCase() === 'x');
      } else if (part === '5') {
        const reference = trimmed.match(/^\d+\.\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*(?:[—–-]\s*(.*))?/);
        if (reference) add('reference', reference[1], reference[2], reference[3] || '');
        else if (trimmed && !header && !/^---|^<p\s*\/>/.test(trimmed)) {
          brief.push(text);
        }
      } else if (part === '3' && trimmed.startsWith('|')) {
        const cells = trimmed.split('|').slice(1,-1).map(stripMarkup);
        if (cells.length >= 4 && cells[1] && !/^-+$/.test(cells[1]) && cells[1] !== '안건') {
          add('feedback', cells[1], '', [cells[0], cells[2], cells[3]]
            .filter(Boolean).join(' · '));
        }
      }
    }
    if (brief.length) add('note', '노션에서 가져온 프로젝트 연출 브리프', '', brief.join('\n'));
    return result;
  }
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
      const text = await file.text();
      let imported;
      if (/\.(?:md|markdown|txt)$/i.test(file.name) && !text.trimStart().startsWith('{')) {
        imported = parseNotionMarkdown(text);
      } else {
        const data = JSON.parse(text);
        if (!data || data.version !== 1 || !Array.isArray(data.items) ||
            data.items.length > MAX_ITEMS) throw new Error('유효하지 않은 자료 파일입니다.');
        imported = data.items.map(sanitizeItem);
        if (imported.some(x => !x)) throw new Error('지원하지 않는 항목 형식입니다.');
      }
      if (!imported.length) throw new Error('가져올 노션 자료를 찾지 못했습니다. 전체 페이지를 Markdown으로 내보내 주세요.');
      if (!confirm('이 프로젝트에 ' + imported.length + '개 자료를 가져올까요? 기존 자료는 보존합니다.')) return;
      const byId = new Map(items.map(x => [x.id, x]));
      const uniqueItems = new Set(items.map(x => x.kind + '|' + x.title + '|' + x.url));
      imported.forEach(x => {
        const key = x.kind + '|' + x.title + '|' + x.url;
        if (!byId.has(x.id) && !uniqueItems.has(key) && byId.size < MAX_ITEMS) {
          byId.set(x.id, x);
          uniqueItems.add(key);
        }
      });
      const added = byId.size - items.length;
      items = Array.from(byId.values()).slice(0, MAX_ITEMS);
      persist(); render();
      alert(added + '개 새 자료를 가져왔습니다. 기존 자료는 유지했습니다.');
    } catch (error) { alert('가져오기에 실패했습니다: ' + error.message); }
  });

  window.workspaceBoard = {
    getProjectId: () => activeId,
    getProjects: () => copy(projects),
    getSnapshot: () => copy(items),
    setRole(next) { role = ['owner','editor'].includes(next) ? next : 'viewer'; render(); },
    loadCloudProjects(remote) {
      if (!Array.isArray(remote)) return;
      const seen = new Set();
      const next = remote.filter(p => p && /^[a-z0-9-]{1,64}$/.test(p.id) &&
        typeof p.name === 'string' && !seen.has(p.id) && seen.add(p.id))
        .map(p => ({ id: p.id, name: projectName(p.name) }));
      if (!next.some(p => p.id === DEFAULT_ID))
        next.unshift({ id: DEFAULT_ID, name: 'LG U+ 1등 DNA 시상식' });
      // Preserve projects created in this browser until an editor can upload them.
      const merged = new Map(projects.map(p => [p.id, p]));
      next.forEach(p => merged.set(p.id, p)); // Cloud names take precedence.
      projects = Array.from(merged.values()).slice(0, MAX_PROJECTS);
      saveProjects();
      
      render();
    },
    applyRemoteContent(remote) {
      if (!Array.isArray(remote) || remote.length > MAX_ITEMS) throw new Error('Invalid remote content');
      const checked = remote.map(sanitizeItem);
      if (checked.some(x => !x)) throw new Error('Invalid remote content record');
      const key = activeStorageKey(activeId);
      // Every differing local draft gets its own backup before remote cache replaces it.
      // A once-per-day backup can miss later edits within the same day.
      if (JSON.stringify(items) !== JSON.stringify(checked) && items.length) {
        const backupKey = key + ':backup:' + Date.now().toString(36) + '-' + newId();
        try {
          localStorage.setItem(backupKey, JSON.stringify(items));
        } catch (error) {
          throw new Error('이 브라우저의 기존 자료를 백업하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도하세요.');
        }
      }
      items = checked;
      persist(false);
      render();
    }
  };
  render();
})();
