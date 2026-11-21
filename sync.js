'use strict';

(() => {
  // This is a public project URL. NEVER put a Supabase service_role/secret key in this file.
  const PROJECT_URL = 'https://zhoggxeyhowzdrejiazd.supabase.co';
  const KEY_STORAGE = 'lg-u-supabase-publishable-key';
  const board = window.progressBoard;
  const workspace = window.workspaceBoard;
  const DEFAULT_PROJECT = 'lg-u-dna';
  const el = id => document.getElementById(id);
  const ui = {
    status: el('syncStatus'),
    keyForm: el('syncKeyForm'),
    keyInput: el('syncPublishableKey'),
    authArea: el('syncAuthArea'),
    emailForm: el('syncEmailForm'),
    emailInput: el('syncEmail'),
    memberArea: el('syncMemberArea'),
    memberLabel: el('syncMemberLabel'),
    importArea: el('syncImportArea'),
    importButton: el('syncImportLocal'),
    signOut: el('syncSignOut'),
    refresh: el('syncRefresh'),
    copyTeamLink: el('copyTeamLink')
  };

  let client = null;
  let member = false;
  let currentSession = null;
  let baseline = null;
  let pushTimer = null;
  let pushRunning = false;
  let refreshTimer = null;
  let realtimeChannel = null;
  let authGeneration = 0;
  let cloudUpgraded = false;
  let memberRole = 'local';
  let baselineProjectId = null;
  let contentBaseline = [];
  let projectBaseline = [];

  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = snapshot => ({
    tasks: snapshot.tasks.map(t => ({
      id: t.id, name: t.name, assignee: t.assignee ?? '',
      status: t.status, progress: Number(t.progress)
    })),
    people: snapshot.people.map(p => ({ name: p.name, color: p.color }))
  });
  function status(text, kind = 'idle') {
    ui.status.textContent = text;
    ui.status.dataset.state = kind;
    const label = el('modeLabel');
    const desc = el('storageDescription');
    if (label) label.textContent = kind === 'success' && member
      ? (cloudUpgraded ? '팀 공유 모드' : '작업 공유 모드')
      : member ? '동기화 확인 중' : '로컬 저장 모드';
    if (desc) desc.textContent = kind === 'success' && member
      ? (cloudUpgraded
        ? '프로젝트별 작업과 자료는 Supabase에 자동 저장됩니다.'
        : '작업 진행률은 자동 동기화됩니다. 프로젝트 자료는 아직 브라우저에 저장됩니다.')
      : '공유 연결 전에는 현재 브라우저에 자동 저장됩니다. JSON 백업을 권장합니다.';
  }
  function keyIsPublic(raw) {
    const key = raw.trim();
    if (key.startsWith('sb_secret_') || key.startsWith('sb_service_')) return false;
    if (key.startsWith('sb_publishable_')) return true;
    if (key.startsWith('eyJ') && key.split('.').length === 3) {
      try {
        const p = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const data = JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)));
        return data.role === 'anon';
      } catch (e) { return false; }
    }
    return false;
  }

  async function connect(key) {
    if (!keyIsPublic(key)) {
      status('공개용 Publishable / anon 키만 사용할 수 있어요.', 'error');
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      status('클라우드 라이브러리가 로드되지 않았어요. 새로고침해 주세요.', 'error');
      return;
    }
    if (client) return;
    try {
      client = window.supabase.createClient(PROJECT_URL, key.trim(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      localStorage.setItem(KEY_STORAGE, key.trim());
      ui.keyForm.hidden = true;
      ui.authArea.hidden = false;
      status('로그인 확인 중…', 'loading');

      client.auth.onAuthStateChange((_event, session) => {
        // Supabase recommends deferring API calls out of this callback.
        setTimeout(() => handleSession(session), 0);
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await handleSession(data.session);
    } catch (e) {
      client = null;
      ui.keyForm.hidden = false;
      ui.authArea.hidden = true;
      status('연결 실패: ' + e.message, 'error');
    }
  }

  async function handleSession(session) {
    const generation = ++authGeneration;
    currentSession = session;
    member = false;
    baseline = null;
    baselineProjectId = null;
    contentBaseline = [];
    clearTimeout(pushTimer);
    clearTimeout(refreshTimer);
    if (realtimeChannel && client) {
      client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    ui.importArea.hidden = true;
    if (!session?.user?.id || !client) {
      memberRole = 'local';
      board.setRole('local');
      workspace?.setRole('local');
      ui.emailForm.hidden = false;
      ui.memberArea.hidden = true;
      status('협업자 로그인 필요', 'idle');
      return;
    }
    ui.emailForm.hidden = true;
    ui.memberArea.hidden = false;
    ui.memberLabel.textContent = session.user.email || '로그인됨';
    status('접근 권한 확인 중…', 'loading');
    const { data, error } = await client.from('progress_members')
      .select('user_id,role').eq('user_id', session.user.id).maybeSingle();
    if (generation !== authGeneration) return;
    if (error) {
      status('공유 DB 연결 대기: ' + error.message, 'error');
      return;
    }
    if (!data) {
      status('이메일 로그인 성공 · 작업 권한 승인 필요', 'warning');
      ui.memberLabel.textContent = (session.user.email || '로그인됨') + ' · 접근 승인 대기';
      return;
    }
    member = true;
    memberRole = data.role === 'viewer' ? 'viewer' : data.role === 'owner' ? 'owner' : 'editor';
    board.setRole(memberRole);
    workspace?.setRole(memberRole);
    const schemaProbe = await client.from('progress_projects').select('id').limit(1);
    cloudUpgraded = !schemaProbe.error;
    await pullCloud(true);
    if (generation !== authGeneration) return;
    subscribeRealtime();
  }

  async function remoteSnapshot(projectId) {
    let taskQuery = client.from('progress_tasks')
      .select('id,name,assignee,status,progress').order('id');
    if (cloudUpgraded) taskQuery = taskQuery.eq('project_id', projectId);
    const [tr, pr] = await Promise.all([
      taskQuery,
      client.from('progress_people').select('name,color').order('name')
    ]);
    if (tr.error) throw tr.error;
    if (pr.error) throw pr.error;
    return normalize({ tasks: tr.data || [], people: pr.data || [] });
  }
  async function remoteWorkspace(projectId) {
    if (!cloudUpgraded || !workspace) return { projects: [], content: [] };
    const [p, c] = await Promise.all([
      client.from('progress_projects').select('id,name').order('created_at'),
      client.from('progress_content')
        .select('id,kind,title,url,body,category,completed,sort_order')
        .eq('project_id', projectId).order('sort_order')
    ]);
    if (p.error) throw p.error;
    if (c.error) throw c.error;
    return { projects: p.data || [], content: c.data || [] };
  }

  async function pullCloud(first = false) {
    if (!member || !currentSession || !client) return;
    const projectId = board.getActiveProjectId();
    const generation = authGeneration;
    if (!cloudUpgraded && projectId !== DEFAULT_PROJECT) {
      baseline = null;
      baselineProjectId = null;
      status('다른 프로젝트는 현재 브라우저에만 저장돼요 · 공유 DB 확장 필요', 'warning');
      return;
    }
    if (pushRunning || pushTimer) {
      schedulePull();
      return;
    }
    try {
      const [cloud, extras] = await Promise.all([
        remoteSnapshot(projectId),
        remoteWorkspace(projectId)
      ]);
      if (!member || projectId !== board.getActiveProjectId() || generation !== authGeneration) return;
      baseline = clone(cloud);
      baselineProjectId = projectId;
      contentBaseline = clone(extras.content);
      projectBaseline = clone(extras.projects);
      if (cloudUpgraded && workspace) {
        workspace.loadCloudProjects(extras.projects);
        const localContent = workspace.getSnapshot();
        if (extras.content.length || localContent.length === 0) {
          workspace.applyRemoteContent(extras.content);
        }
      }
      const hasLocalTasks = board.getSnapshot().tasks.length > 0;
      const hasLocalContent = !!workspace?.getSnapshot().length;
      const needsTaskImport = cloud.tasks.length === 0 && hasLocalTasks;
      const needsContentImport = cloudUpgraded && extras.content.length === 0 && hasLocalContent;
      if (needsTaskImport || needsContentImport) {
        ui.importArea.hidden = false;
        status('공유 데이터 준비 완료 · 브라우저 작업 이전 가능', 'warning');
        if (!needsTaskImport) board.applyRemoteSnapshot(cloud);
        return;
      }
      ui.importArea.hidden = true;
      board.applyRemoteSnapshot(cloud);
      status(cloudUpgraded
        ? '프로젝트 작업·자료 자동 동기화 중'
        : '작업 진행률 동기화 중 · 자료실은 현재 브라우저에 저장', 'success');
    } catch (e) {
      status('공유 데이터 불러오기 실패: ' + e.message, 'error');
    }
  }

  function changedRows(localRows, originalRows, idKey) {
    const before = new Map(originalRows.map(x => [x[idKey], x]));
    const after = new Set(localRows.map(x => x[idKey]));
    return {
      put: localRows.filter(x => JSON.stringify(x) !== JSON.stringify(before.get(x[idKey]))),
      removed: originalRows.filter(x => !after.has(x[idKey])).map(x => x[idKey])
    };
  }
  function schedulePush() {
    if (!member || memberRole === 'viewer' || !baseline ||
        baselineProjectId !== board.getActiveProjectId()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; pushCloud(); }, 650);
    status('변경 사항 저장 중…', 'loading');
  }
  async function pushCloud() {
    if (!member || memberRole === 'viewer' || !baseline || pushRunning) return;
    const projectId = board.getActiveProjectId();
    if (baselineProjectId !== projectId || (!cloudUpgraded && projectId !== DEFAULT_PROJECT)) return;
    pushRunning = true;
    const local = normalize(board.getSnapshot());
    const localContent = cloudUpgraded && workspace ? workspace.getSnapshot() : [];
    const taskDelta = changedRows(local.tasks, baseline.tasks, 'id');
    const peopleDelta = changedRows(local.people, baseline.people, 'name');
    const contentDelta = changedRows(localContent, contentBaseline, 'id');
    try {
      if (cloudUpgraded && workspace) {
        const project = workspace.getProjects().find(p => p.id === projectId);
        if (!project) throw new Error('현재 프로젝트를 찾을 수 없습니다.');
        const result = await client.from('progress_projects').upsert(project, { onConflict: 'id' });
        if (result.error) throw result.error;
      }
      // Diff updates avoid overwriting unrelated tasks edited by another collaborator.
      if (taskDelta.put.length) {
        const rows = cloudUpgraded
          ? taskDelta.put.map(t => ({ ...t, project_id: projectId }))
          : taskDelta.put;
        const { error } = await client.from('progress_tasks').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      if (taskDelta.removed.length) {
        let query = client.from('progress_tasks').delete().in('id', taskDelta.removed);
        if (cloudUpgraded) query = query.eq('project_id', projectId);
        const { error } = await query;
        if (error) throw error;
      }
      if (peopleDelta.put.length) {
        const { error } = await client.from('progress_people').upsert(peopleDelta.put, { onConflict: 'name' });
        if (error) throw error;
      }
      if (peopleDelta.removed.length) {
        const { error } = await client.from('progress_people').delete().in('name', peopleDelta.removed);
        if (error) throw error;
      }
      if (cloudUpgraded) {
        if (contentDelta.put.length) {
          const rows = contentDelta.put.map(item => ({ ...item, project_id: projectId }));
          const { error } = await client.from('progress_content').upsert(rows, { onConflict: 'id' });
          if (error) throw error;
        }
        if (contentDelta.removed.length) {
          const { error } = await client.from('progress_content')
            .delete().eq('project_id', projectId).in('id', contentDelta.removed);
          if (error) throw error;
        }
      }
      if (board.getActiveProjectId() === projectId) {
        baseline = clone(local);
        contentBaseline = clone(localContent);
      }
      status('클라우드 저장 완료', 'success');
      schedulePull();
    } catch (e) {
      status('자동 저장 실패: ' + e.message, 'error');
    } finally {
      pushRunning = false;
      if (board.getActiveProjectId() === projectId) {
        const now = normalize(board.getSnapshot());
        const currentContent = cloudUpgraded && workspace ? workspace.getSnapshot() : [];
        if (JSON.stringify(now) !== JSON.stringify(local) ||
            JSON.stringify(currentContent) !== JSON.stringify(localContent)) schedulePush();
      }
    }
  }
  function schedulePull() {
    if (!member) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      pullCloud();
    }, 1200);
  }
  function subscribeRealtime() {
    if (!client || !member || realtimeChannel) return;
    realtimeChannel = client.channel('lg-u-progress-board')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'progress_tasks' },
        schedulePull)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'progress_people' },
        schedulePull);
    if (cloudUpgraded) {
      realtimeChannel
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'progress_content' },
          schedulePull)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'progress_projects' },
          schedulePull);
    }
    realtimeChannel.subscribe();
  }

  ui.keyForm.addEventListener('submit', async event => {
    event.preventDefault();
    await connect(ui.keyInput.value);
  });
  ui.emailForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return;
    const email = ui.emailInput.value.trim();
    status('이메일 로그인 링크 발송 중…', 'loading');
    const redirect = window.location.origin + window.location.pathname;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect, shouldCreateUser: false }
    });
    status(error ? '링크 발송 실패: ' + error.message : '로그인 링크를 이메일로 보냈어요.', error ? 'error' : 'success');
  });
  ui.copyTeamLink?.addEventListener('click', async () => {
    const key = localStorage.getItem(KEY_STORAGE) || '';
    if (!keyIsPublic(key) || !member) return;
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('key', key);
    try {
      await navigator.clipboard.writeText(url.href);
      status('팀 접속 링크를 복사했습니다. 초대된 이메일만 로그인할 수 있어요.', 'success');
    } catch (e) {
      window.prompt('팀 접속 링크 복사', url.href);
    }
  });
  ui.refresh.addEventListener('click', async () => {
    if (!client) return;
    const { data } = await client.auth.getSession();
    if (!member) await handleSession(data.session);
    else await pullCloud();
  });
  ui.signOut.addEventListener('click', async () => {
    if (client) await client.auth.signOut();
    await handleSession(null);
  });
  ui.importButton.addEventListener('click', async () => {
    if (!member || !client) return;
    if (!window.confirm('현재 브라우저의 작업 데이터를 팀 공유 데이터베이스에 업로드할까요?')) return;
    // Use the latest cloud snapshot as baseline to avoid overwriting
    // existing shared records while uploading only missing local records.
    if (!baseline || baselineProjectId !== board.getActiveProjectId()) {
      status('공유 데이터를 먼저 새로고침해 주세요.', 'warning');
      return;
    }
    ui.importArea.hidden = true;
    await pushCloud();
  });

  window.addEventListener('progress-board:changed', schedulePush);
  window.addEventListener('workspace:changed', schedulePush);
  window.addEventListener('workspace:projectchanged', () => {
    clearTimeout(pushTimer);
    clearTimeout(refreshTimer);
    baseline = null;
    baselineProjectId = null;
    contentBaseline = [];
    ui.importArea.hidden = true;
    if (member) void pullCloud(true);
  });
  window.addEventListener('workspace:projects-changed', event => {
    if (!cloudUpgraded || !member || memberRole === 'viewer') return;
    const project = event.detail?.project;
    if (!project?.id || !project?.name) return;
    // Project creation/renames are small, independent updates.
    void client.from('progress_projects').upsert(
      { id: project.id, name: project.name }, { onConflict: 'id' }
    ).then(({ error }) => {
      if (error) status('프로젝트 저장 실패: ' + error.message, 'error');
      else schedulePull();
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && member) schedulePull();
  });
  // Realtime is best effort; periodic refresh keeps both browsers in sync as a fallback.
  setInterval(() => {
    if (document.visibilityState === 'visible' && member) schedulePull();
  }, 15000);

  try {
    const params = new URLSearchParams(window.location.search);
    const inviteKey = params.get('key');
    const saved = inviteKey && keyIsPublic(inviteKey)
      ? inviteKey : localStorage.getItem(KEY_STORAGE);
    if (inviteKey) {
      params.delete('key');
      window.history.replaceState({}, '', window.location.pathname +
        (params.toString() ? '?' + params.toString() : '') + window.location.hash);
    }
    if (saved) {
      ui.keyInput.value = saved;
      void connect(saved);
    } else {
      status('Supabase 연결 설정 필요');
    }
  } catch (e) {
    status('공용 저장소 연결 준비 중');
  }
})();
