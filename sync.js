'use strict';

(() => {
  // This is a public project URL. NEVER put a Supabase service_role/secret key in this file.
  const PROJECT_URL = 'https://zhoggxeyhowzdrejiazd.supabase.co';
  const KEY_STORAGE = 'lg-u-supabase-publishable-key';
  const board = window.progressBoard;
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
    refresh: el('syncRefresh')
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
    clearTimeout(pushTimer);
    clearTimeout(refreshTimer);
    if (realtimeChannel && client) {
      client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    ui.importArea.hidden = true;
    if (!session?.user?.id || !client) {
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
      .select('user_id').eq('user_id', session.user.id).maybeSingle();
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
    await pullCloud(true);
    if (generation !== authGeneration) return;
    subscribeRealtime();
  }

  async function remoteSnapshot() {
    const [tr, pr] = await Promise.all([
      client.from('progress_tasks').select('id,name,assignee,status,progress').order('id'),
      client.from('progress_people').select('name,color').order('name')
    ]);
    if (tr.error) throw tr.error;
    if (pr.error) throw pr.error;
    return normalize({ tasks: tr.data || [], people: pr.data || [] });
  }

  async function pullCloud(first = false) {
    if (!member || !currentSession || !client) return;
    if (pushRunning || pushTimer) {
      schedulePull();
      return;
    }
    try {
      const cloud = await remoteSnapshot();
      if (!member) return;
      const initialEmpty = first && cloud.tasks.length === 0;
      baseline = clone(cloud);
      if (initialEmpty) {
        ui.importArea.hidden = false;
        status('공유 DB 준비 완료 · 최초 작업 업로드 필요', 'warning');
        return;
      }
      ui.importArea.hidden = true;
      board.applyRemoteSnapshot(cloud);
      status('공유 데이터 자동 동기화 중', 'success');
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
    if (!member || !baseline) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; pushCloud(); }, 650);
    status('변경 사항 저장 중…', 'loading');
  }
  async function pushCloud() {
    if (!member || !baseline || pushRunning) return;
    pushRunning = true;
    const local = normalize(board.getSnapshot());
    const taskDelta = changedRows(local.tasks, baseline.tasks, 'id');
    const peopleDelta = changedRows(local.people, baseline.people, 'name');
    try {
      // Send only changed records so simultaneous edits to different tasks do not overwrite each other.
      if (taskDelta.put.length) {
        const { error } = await client.from('progress_tasks').upsert(taskDelta.put, { onConflict: 'id' });
        if (error) throw error;
      }
      if (taskDelta.removed.length) {
        const { error } = await client.from('progress_tasks').delete().in('id', taskDelta.removed);
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
      baseline = clone(local);
      status('클라우드 저장 완료', 'success');
      // Fetch again to merge any edits other people made during the upload.
      schedulePull();
    } catch (e) {
      status('자동 저장 실패: ' + e.message, 'error');
    } finally {
      pushRunning = false;
      // Handle edits that arrived while the previous request was in flight.
      const now = normalize(board.getSnapshot());
      if (JSON.stringify(now) !== JSON.stringify(local)) schedulePush();
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
        schedulePull)
      .subscribe();
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
    baseline = { tasks: [], people: [] };
    ui.importArea.hidden = true;
    await pushCloud();
  });

  window.addEventListener('progress-board:changed', schedulePush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && member) schedulePull();
  });
  // Realtime is best effort; periodic refresh keeps both browsers in sync as a fallback.
  setInterval(() => {
    if (document.visibilityState === 'visible' && member) schedulePull();
  }, 15000);

  try {
    const saved = localStorage.getItem(KEY_STORAGE);
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
