'use strict';
(() => {
  const el = id => document.getElementById(id);
  const scenes = el('frameScene'), cards = el('frameCards'), status = el('frameStatus');
  let client, editable, generation = 0;
  for (let i = 1; i <= 10; i++) scenes.add(new Option('SC' + String(i).padStart(2, '0'), i));
  const nameForm = el('sceneNameForm'), nameInput = el('sceneNameInput'), nameStatus = el('sceneNameStatus');
  function displayNames(rows) {
    const names = new Map(rows.map(row => [row.scene, row.name]));
    for (const option of scenes.options) {
      const code = 'SC' + option.value.padStart(2,'0');
      const name = names.get(Number(option.value));
      option.textContent = name ? code + ' · ' + name : code;
    }
    nameInput.value = names.get(Number(scenes.value)) || '';
  }
  async function loadNames(token) {
    nameForm.hidden = true;
    nameStatus.textContent = '';
    displayNames([]);
    if (!client) return;
    const {data,error} = await client.from('styleframe_scene_names').select('scene,name')
      .eq('project',window.progressBoard.getActiveProjectId());
    if (token !== generation) return;
    if (error) {
      nameStatus.textContent = ['PGRST205','42P01'].includes(error.code)
        ? '씬 이름 저장소 설정이 필요해요.' : error.message;
      return;
    }
    displayNames(data);
    nameForm.hidden = !editable;
  }
  nameForm.onsubmit = async event => {
    event.preventDefault();
    if (!client || !editable || nameForm.hidden) return;
    const token = generation, button = nameForm.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const name = nameInput.value.trim(), scene = Number(scenes.value);
      const project = window.progressBoard.getActiveProjectId();
      const {error} = await client.from('styleframe_scene_names')
        .upsert({project,scene,name},{onConflict:'project,scene'});
      if (token !== generation) return;
      if (error) { nameStatus.textContent = error.message; return; }
      const option = scenes.selectedOptions[0];
      option.textContent = 'SC' + option.value.padStart(2,'0') + (name ? ' · ' + name : '');
      nameInput.value = name;
      nameStatus.textContent = '씬 이름을 저장했어요.';
    } finally { button.disabled = false; }
  };
  function element(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }
  function showError(error) {
    status.textContent = ['PGRST205','42P01'].includes(error.code)
      ? '공유 저장소 설정이 필요해요. 관리자가 Supabase에서 sql/styleframes.sql을 실행해 주세요.'
      : '처리 중 오류가 발생했어요. ' + error.message;
  }
  async function load() {
    const token = ++generation;
    void loadNames(token);
    cards.replaceChildren();
    el('frameUpload').hidden = true;
    if (!client) {
      status.textContent = '협업 보드에 로그인하면 씬별 시안을 볼 수 있어요.';
      return;
    }
    status.textContent = '불러오는 중…';
    const {data,error} = await client.from('styleframes')
      .select('id,name,styleframe_comments(body,created_at)').eq('project',window.progressBoard.getActiveProjectId())
      .eq('scene',Number(scenes.value)).order('created_at').order('created_at',{referencedTable:'styleframe_comments'});
    if (generation !== token) return;
    if (error) return showError(error);
    el('frameUpload').hidden = !editable;
    status.textContent = data.length ? data.length + '개 시안' : '이 씬에 등록된 시안이 없어요.';
    for (const frame of data) {
      const card = element('article','');
      card.append(element('h3',frame.name));
      const image = document.createElement('img');
      image.alt = frame.name;
      image.style.cssText = 'display:block;max-width:100%;max-height:65vh;object-fit:contain';
      card.append(image);
      const observer = new IntersectionObserver(async entries => {
        if (token !== generation) return observer.disconnect();
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        const result = await client.from('styleframes').select('image').eq('id',frame.id).single();
        if (token !== generation) return;
        if (result.error) return showError(result.error);
        image.src = result.data.image;
      });
      for (const comment of frame.styleframe_comments) card.append(element('p',comment.body));
      if (editable) {
        const form = document.createElement('form');
        const input = document.createElement('input');
        input.className = 'meta-input'; input.placeholder = '이 시안에 코멘트 남기기';
        input.setAttribute('aria-label',input.placeholder);
        input.maxLength = 2000; input.required = true;
        const button = element('button','코멘트 등록');
        button.className = 'button button-outline';
        form.append(input,button); card.append(form);
        form.onsubmit = async event => {
          event.preventDefault();
          if (!input.value.trim() || button.disabled) return;
          button.disabled = true;
          const result = await client.from('styleframe_comments').insert({frame_id:frame.id,body:input.value.trim()});
          if (token !== generation) return;
          button.disabled = false;
          if (result.error) return showError(result.error);
          await load();
        };
      }
      cards.append(card); observer.observe(image.parentElement);
    }
  }
  el('frameFile').onchange = async event => {
    const input = event.target, file = input.files[0], token = generation;
    input.value = '';
    if (!file || !client || !editable) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 8*1024*1024) {
      status.textContent = '8MB 이하의 PNG, JPG, WebP 이미지를 선택해 주세요.'; return;
    }
    const project = window.progressBoard.getActiveProjectId(), scene = Number(scenes.value);
    input.disabled = true;
    status.textContent = '이미지 저장 중…';
    try {
      const reader = new FileReader();
      const image = await new Promise((resolve,reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (token !== generation) return;
      const result = await client.from('styleframes').insert({project,scene,name:file.name.slice(0,255),image});
      if (token !== generation) return;
      if (result.error) return showError(result.error);
      await load();
    } catch (error) { if (token === generation) showError(error); }
    finally { input.disabled = false; }
  };
  scenes.onchange = load;
  el('frameRefresh').onclick = load;
  window.addEventListener('workspace:projectchanged',load);
  window.frameBoard = {connect(db,role) { client = db; editable = ['owner','editor'].includes(role); void load(); }};
})();
