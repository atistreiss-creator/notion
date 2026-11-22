'use strict';
(() => {
  const el = id => document.getElementById(id);
  const cards = el('frameCards'), status = el('frameStatus');
  let client, editable, generation = 0;
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
    cards.replaceChildren();
    el('frameUpload').hidden = true;
    if (!client) {
      status.textContent = '협업 보드에 로그인하면 이미지을 볼 수 있어요.';
      return;
    }
    status.textContent = '불러오는 중…';
    const {data,error} = await client.from('styleframes')
      .select('id,name,styleframe_comments(body,created_at)').eq('project',window.progressBoard.getActiveProjectId())
      .order('created_at',{ascending:false}).order('created_at',{referencedTable:'styleframe_comments'});
    if (generation !== token) return;
    if (error) return showError(error);
    el('frameUpload').hidden = !editable;
    status.textContent = data.length ? data.length + '개 시안' : '아직 등록된 이미지가 없어요.';
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
  const input = el('frameFile');
  input.onchange = () => {
    const file = input.files[0];
    input.value = '';
    void upload(file);
  };
  const paste = el('framePaste');
  paste.onclick = () => paste.focus();
  paste.onpaste = event => {
    const file = Array.from(event.clipboardData?.files || []).find(item => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void upload(file);
  };
  async function upload(file) {
    const token = generation;
    if (input.disabled) return;
    if (!file || !client || !editable) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 8*1024*1024) {
      status.textContent = '8MB 이하의 PNG, JPG, WebP 이미지를 선택해 주세요.'; return;
    }
    const project = window.progressBoard.getActiveProjectId(), scene = 1;
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
  }
  el('frameRefresh').onclick = load;
  window.addEventListener('workspace:projectchanged',load);
  window.frameBoard = {connect(db,role) { client = db; editable = ['owner','editor'].includes(role); void load(); }};
})();
