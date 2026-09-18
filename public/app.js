(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    apiBase: '', page: 'home', mode: '', platform: 'qq', token: '', timer: null,
    accountQrTimer: null, accountQrSequence: 0, account: null, status: null
  };

  function isTauri() { return Boolean(window.__TAURI__?.core?.invoke); }
  document.documentElement.classList.toggle('tauri', isTauri());
  function initialPage() {
    if (!isTauri()) return 'login';
    return location.pathname === '/login' || location.hash === '#login' ? 'login' : 'home';
  }
  function apiUrl(path) { return `${state.apiBase}${path}`; }
  async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 200) throw new Error(payload.message || `请求失败 (${response.status})`);
    return payload.data;
  }
  async function jsonRequest(path, method, body) {
    return request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (busy) { button.dataset.label = button.textContent; button.textContent = label; }
    else if (button.dataset.label) { button.textContent = button.dataset.label; delete button.dataset.label; }
  }
  async function copyText(value, button) {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
      document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
    }
    const old = button.textContent; button.textContent = '已复制'; setTimeout(() => { button.textContent = old; }, 1200);
  }

  async function initializeBackend() {
    $('retry-backend').classList.add('hidden');
    $('splash-message').textContent = isTauri() ? '正在启动本地代理…' : '正在加载登录页面…';
    try {
      if (isTauri()) {
        let backend;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          backend = await window.__TAURI__.core.invoke('backend_status');
          if (backend.state === 'ready') break;
          if (backend.state === 'failed') throw new Error(backend.error || '本地代理启动失败');
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!backend || backend.state !== 'ready') throw new Error('本地代理启动超时');
        state.apiBase = backend.baseUrl;
        state.status = await request('/app/api/status');
        renderHome();
        await loadDesktopAccounts();
      } else {
        state.status = await request('/app/api/status');
        applyRuntimeCapabilities();
      }
      $('splash').classList.add('hidden');
      $('app-shell').classList.remove('hidden');
      navigate(initialPage(), false);
    } catch (error) {
      $('splash-message').textContent = error.message || '启动失败';
      if (isTauri()) $('retry-backend').classList.remove('hidden');
    }
  }

  function renderHome() {
    const select = $('address-select');
    select.replaceChildren();
    state.status.addresses.forEach((address, index) => {
      const option = document.createElement('option'); option.value = String(index); option.textContent = address.ip; select.append(option);
    });
    $('port-value').textContent = state.status.port;
    select.value = '0';
    renderSelectedAddress();
  }
  function renderSelectedAddress() {
    const address = state.status.addresses[Number($('address-select').value) || 0];
    if (!address) return;
    $('host-value').textContent = address.host;
    $('network-warning').classList.toggle('hidden', !address.isLoopback);
    if (state.account) renderAccountQr();
  }

  function navigate(page, updateLocation = true) {
    if (!isTauri() && page === 'home') page = 'login';
    state.page = page;
    document.body.dataset.page = page;
    $('home-page').classList.toggle('hidden', page !== 'home');
    $('login-page').classList.toggle('hidden', page !== 'login');
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
    updateAccountNavigationActive();
    if (updateLocation) {
      if (isTauri()) history.replaceState({}, '', page === 'login' ? '#login' : '#home');
      else history.pushState({}, '', page === 'login' ? '/login' : '/');
    }
  }
  function showStep(id) {
    document.querySelectorAll('.login-step').forEach((element) => element.classList.add('hidden'));
    $(id).classList.remove('hidden');
    $('login-error').textContent = '';
    updateAccountNavigationActive();
  }
  function stopPolling() { if (state.timer) clearInterval(state.timer); state.timer = null; }
  function backToChoose() { stopPolling(); state.mode = ''; state.token = ''; state.account = null; showStep('login-choose'); }
  function setPlatform(platform) {
    state.platform = platform;
    document.querySelectorAll('#platform-switch button').forEach((button) => button.classList.toggle('active', button.dataset.platform === platform));
    $('scan-platform-label').textContent = platform === 'qq' ? 'QQ 音乐' : '网易云音乐';
  }
  function showError(error) { $('login-error').textContent = error.message || String(error); }

  async function verifyAccount() {
    const button = $('verify-submit'); setBusy(button, true, '正在验证…');
    try {
      const account = await jsonRequest('/login/api/verify-key', 'POST', { api_access_key: $('verify-key').value.trim() });
      showAccount(account);
    } catch (error) { showError(error); } finally { setBusy(button, false); }
  }
  async function startScan() {
    stopPolling(); showStep('login-scan');
    $('login-qr').removeAttribute('src'); $('qr-placeholder').classList.remove('hidden');
    $('scan-message').textContent = '正在生成二维码…';
    $('platform-switch').classList.toggle('locked', state.mode === 'update'); setPlatform(state.platform);
    try {
      const body = { mode: state.mode, platform: state.platform };
      if (state.mode === 'update') body.api_access_key = state.account.apiAccessKey;
      const data = await jsonRequest('/login/api/start', 'POST', body);
      state.token = data.token; state.platform = data.platform; setPlatform(data.platform);
      $('login-qr').src = data.qrImage; $('qr-placeholder').classList.add('hidden');
      $('scan-message').textContent = data.platform === 'qq' ? '请使用手机 QQ 扫码' : '请使用网易云音乐扫码';
      state.timer = setInterval(checkLogin, 1000);
    } catch (error) { $('scan-message').textContent = '二维码生成失败'; showError(error); }
  }
  async function checkLogin() {
    if (!state.token) return;
    try {
      const data = await jsonRequest('/login/api/check', 'POST', { token: state.token });
      $('scan-message').textContent = data.message;
      if (data.status === 'success') { stopPolling(); showAccount(data); }
      else if (data.status === 'expired' || data.status === 'error') stopPolling();
    } catch (error) { stopPolling(); showError(error); }
  }

  function showAccount(account) {
    stopPolling(); state.account = account; state.mode = 'update'; state.platform = account.platform;
    $('account-platform').textContent = account.platform === 'qq' ? 'QQ 音乐' : '网易云音乐';
    $('account-key').textContent = account.apiAccessKey; $('account-name').value = account.name || account.accountName || '';
    $('account-stateless').checked = Boolean(account.stateless); $('account-luoxue').checked = account.useLuoxue !== false;
    applyRuntimeCapabilities();
    renderSources(Array.isArray(account.lxSource) ? account.lxSource : []); $('config-message').textContent = '';
    showStep('account-config');
    renderAccountQr();
    if (isTauri()) loadDesktopAccounts().catch(() => {});
  }

  function selectedOriginHost() {
    if (!isTauri()) return window.location.origin;
    const address = state.status?.addresses[Number($('address-select').value) || 0];
    return address?.host || '';
  }

  async function renderAccountQr() {
    if (!state.account) return;
    const host = selectedOriginHost();
    if (!host) return;
    const sequence = ++state.accountQrSequence;
    const image = $('account-origin-qr');
    const placeholder = $('account-qr-placeholder');
    image.removeAttribute('src'); placeholder.classList.remove('hidden'); placeholder.textContent = '正在生成二维码…';
    try {
      const data = await jsonRequest('/app/api/origin-qr', 'POST', {
        host,
        token: state.account.apiAccessKey,
        name: $('account-name').value.trim()
      });
      if (sequence !== state.accountQrSequence) return;
      image.src = data.qrImage; placeholder.classList.add('hidden');
    } catch (error) {
      if (sequence !== state.accountQrSequence) return;
      placeholder.textContent = error.message || '二维码生成失败';
    }
  }

  function scheduleAccountQr() {
    if (state.accountQrTimer) clearTimeout(state.accountQrTimer);
    state.accountQrTimer = setTimeout(renderAccountQr, 250);
  }

  function updateAccountNavigationActive() {
    if (!isTauri()) return;
    const activeKey = state.page === 'login' && !$('account-config').classList.contains('hidden')
      ? state.account?.apiAccessKey
      : '';
    document.querySelectorAll('.account-nav-item').forEach((button) => {
      button.classList.toggle('active', button.dataset.accountKey === activeKey);
    });
  }

  function ensureDesktopAccountNavigation() {
    let navigation = $('desktop-account-navigation');
    if (navigation) return navigation;
    navigation = document.createElement('div'); navigation.id = 'desktop-account-navigation'; navigation.className = 'account-navigation';
    const root = document.createElement('button'); root.type = 'button'; root.className = 'nav-item'; root.textContent = '账号列表';
    const list = document.createElement('div'); list.id = 'desktop-account-list'; list.className = 'account-subnav';
    root.addEventListener('click', () => { backToChoose(); navigate('login'); loadDesktopAccounts().catch(showError); });
    navigation.append(root, list); $('main-navigation').append(navigation);
    return navigation;
  }

  async function loadDesktopAccounts() {
    if (!isTauri()) return;
    ensureDesktopAccountNavigation();
    const list = $('desktop-account-list');
    let accounts;
    try {
      accounts = await request('/app/api/accounts');
    } catch (error) {
      list.replaceChildren();
      const message = document.createElement('span'); message.className = 'account-nav-empty'; message.textContent = '账号列表读取失败'; list.append(message);
      return;
    }
    list.replaceChildren();
    if (!accounts.length) {
      const empty = document.createElement('span'); empty.className = 'account-nav-empty'; empty.textContent = '暂无账号'; list.append(empty);
      return;
    }
    accounts.forEach((account) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'account-nav-item';
      button.dataset.accountKey = account.apiAccessKey; button.textContent = account.name;
      button.title = `${account.name} · ${account.platform === 'qq' ? 'QQ 音乐' : '网易云音乐'}`;
      button.addEventListener('click', () => openDesktopAccount(account.apiAccessKey)); list.append(button);
    });
    updateAccountNavigationActive();
  }
  function applyRuntimeCapabilities() {
    const supported = state.status?.accountLxSources !== false;
    $('account-lx-source-settings').classList.toggle('hidden', !supported);
  }

  async function openDesktopAccount(apiAccessKey) {
    if (!isTauri()) return;
    navigate('login'); showStep('login-choose'); $('login-error').textContent = '正在加载账号配置…';
    try {
      const account = await jsonRequest('/login/api/verify-key', 'POST', { api_access_key: apiAccessKey });
      showAccount(account);
    } catch (error) { showError(error); }
  }
  function renderSources(sources) {
    const list = $('lx-source-list'); list.replaceChildren();
    (sources.length ? sources : ['']).forEach((source) => addSourceInput(source));
  }
  function isSafeSourceUrl(value) { return value === '' || /^https?:\/\//i.test(value); }
  function addSourceInput(value = '') {
    const list = $('lx-source-list'); if (list.children.length >= 10) return;
    const row = document.createElement('div'); row.className = 'source-row';
    const input = document.createElement('input'); input.type = 'url'; input.placeholder = 'https://example.com/source.js'; input.value = isSafeSourceUrl(value) ? value : '';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button'; remove.textContent = '删除';
    remove.addEventListener('click', () => { row.remove(); if (!list.children.length) addSourceInput(); });
    row.append(input, remove); list.append(row);
  }
  async function saveConfig() {
    const button = $('save-config'); setBusy(button, true, '正在保存…'); $('config-message').className = 'message';
    try {
      const lxSource = state.status?.accountLxSources === false
        ? []
        : [...document.querySelectorAll('#lx-source-list input')].map((input) => input.value.trim()).filter(Boolean);
      const account = await jsonRequest('/login/api/account/config', 'PUT', {
        api_access_key: state.account.apiAccessKey, name: $('account-name').value.trim(),
        stateless: $('account-stateless').checked, useLuoxue: $('account-luoxue').checked, lxSource
      });
      state.account = account; $('config-message').textContent = '配置已保存'; $('config-message').className = 'message success';
      renderSources(account.lxSource || []);
      renderAccountQr();
      if (isTauri()) loadDesktopAccounts();
    } catch (error) { $('config-message').textContent = error.message; $('config-message').className = 'message error'; }
    finally { setBusy(button, false); }
  }

  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
  window.addEventListener('popstate', () => navigate(initialPage(), false));
  $('address-select').addEventListener('change', renderSelectedAddress);
  $('copy-host').addEventListener('click', () => copyText($('host-value').textContent, $('copy-host')));
  $('copy-key').addEventListener('click', () => copyText($('account-key').textContent, $('copy-key')));
  $('account-name').addEventListener('input', scheduleAccountQr);
  $('choose-create').addEventListener('click', () => { state.mode = 'create'; state.platform = 'qq'; state.account = null; startScan(); });
  $('choose-update').addEventListener('click', () => showStep('login-verify'));
  document.querySelectorAll('.back-choose').forEach((button) => button.addEventListener('click', backToChoose));
  $('verify-submit').addEventListener('click', verifyAccount); $('verify-key').addEventListener('keydown', (event) => { if (event.key === 'Enter') verifyAccount(); });
  document.querySelectorAll('#platform-switch button').forEach((button) => button.addEventListener('click', () => { if (state.platform !== button.dataset.platform) { setPlatform(button.dataset.platform); startScan(); } }));
  $('scan-back').addEventListener('click', () => state.account ? showAccount(state.account) : backToChoose());
  $('regenerate-qr').addEventListener('click', startScan); $('relogin').addEventListener('click', startScan);
  $('add-lx-source').addEventListener('click', () => addSourceInput()); $('save-config').addEventListener('click', saveConfig);
  $('retry-backend').addEventListener('click', async () => { try { await window.__TAURI__.core.invoke('restart_backend'); initializeBackend(); } catch (error) { $('splash-message').textContent = error.message; } });
  initializeBackend();
})();
