(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    adminPassword: '', adminSequence: 0, deleteKey: '',
    apiBase: '', page: 'home', mode: '', platform: 'qq', token: '', timer: null,
    accountQrTimer: null, accountQrSequence: 0, account: null, status: null,
    method: 'qr', loginSequence: 0, phoneToken: '', phoneRetryAt: 0, phoneTimer: null
  };

  function isAdmin() { return isTauri() || Boolean(state.adminPassword); }
  function adminHeaders(password = state.adminPassword) { return password ? { Authorization: `Bearer ${password}` } : {}; }
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
        $('admin-mode').classList.toggle('hidden', !state.status.adminManagementEnabled);
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
    if (page !== 'login') backToChoose();
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
  function stopPolling() { $('account-config').removeAttribute('inert'); $('account-config').removeAttribute('aria-busy'); if (state.timer) clearTimeout(state.timer); state.timer = null; state.token = ''; state.loginSequence += 1; }
  function clearLoginInputs() {
    state.phoneToken = ''; $('phone-code').value = ''; $('login-cookie').value = '';
    clearPhoneCaptcha();
  }
  function clearPhoneCaptcha() {
    $('phone-captcha').classList.add('hidden');
    $('phone-captcha-frame').removeAttribute('src');
  }
  function backToChoose() { stopPolling(); clearLoginInputs(); state.mode = ''; state.account = null; showStep('login-choose'); }
  function setPlatform(platform) {
    state.platform = platform;
    document.querySelectorAll('#platform-switch button').forEach((button) => button.classList.toggle('active', button.dataset.platform === platform));
    $('scan-platform-label').textContent = platformLabel(platform);
    document.querySelectorAll('#login-methods button').forEach((button) => {
      const method = button.dataset.method;
      button.classList.toggle('hidden', method === state.method || (platform === 'ytmusic' && method !== 'cookie'));
    });
    $('account-luoxue').disabled = platform === 'ytmusic';
    $('ytmusic-cookie-help').classList.toggle('hidden', platform !== 'ytmusic');
  }
  function platformLabel(platform) { return platform === 'qq' ? 'QQ 音乐' : platform === 'ytmusic' ? 'YouTube Music' : '网易云音乐'; }
  function showError(error) { $('login-error').textContent = error.message || String(error); }

  async function verifyAccount() {
    const sequence = state.loginSequence;
    const button = $('verify-submit'); setBusy(button, true, '正在验证…');
    try {
      const account = await jsonRequest('/login/api/verify-key', 'POST', { api_access_key: $('verify-key').value.trim() });
      if (sequence === state.loginSequence) showAccount(account);
    } catch (error) { if (sequence === state.loginSequence) showError(error); } finally { setBusy(button, false); }
  }
  async function startScan() {
    prepareLogin('qr');
    const sequence = state.loginSequence;
    $('login-qr').removeAttribute('src'); $('qr-placeholder').classList.remove('hidden');
    $('scan-message').textContent = '正在生成二维码…';
    $('platform-switch').classList.toggle('locked', state.mode === 'update'); setPlatform(state.platform);
    try {
      const body = { mode: state.mode, platform: state.platform };
      if (state.mode === 'update') body.api_access_key = state.account.apiAccessKey;
      const data = await jsonRequest('/login/api/start', 'POST', body);
      if (sequence !== state.loginSequence) return;
      state.token = data.token; state.platform = data.platform; setPlatform(data.platform);
      $('login-qr').src = data.qrImage; $('qr-placeholder').classList.add('hidden');
      $('scan-message').textContent = data.platform === 'qq' ? '请使用手机 QQ 扫码' : '请使用网易云音乐扫码';
      state.timer = setTimeout(checkLogin, 1500);
    } catch (error) { if (sequence === state.loginSequence) { $('scan-message').textContent = '二维码生成失败'; showError(error); } }
  }
  async function checkLogin() {
    if (!state.token) return;
    const sequence = state.loginSequence;
    try {
      const data = await jsonRequest('/login/api/check', 'POST', { token: state.token });
      if (sequence !== state.loginSequence) return;
      $('scan-message').textContent = data.message;
      if (data.status === 'success') { stopPolling(); showAccount(data); }
      else if (data.status === 'expired' || data.status === 'error') stopPolling();
      else state.timer = setTimeout(checkLogin, 1500);
    } catch (error) { if (sequence === state.loginSequence) { stopPolling(); showError(error); } }
  }

  function loginBody() {
    return { mode: state.mode, platform: state.platform, ...(state.mode === 'update' ? { api_access_key: state.account.apiAccessKey } : {}) };
  }
  function prepareLogin(method) {
    stopPolling();
    state.method = method;
    const accountName = state.account?.name || state.account?.accountName || '';
    $('login-title').textContent = state.mode === 'update'
      ? `重新登录账号${accountName ? ` ${accountName}` : ''}`
      : '登录账号';
    state.phoneToken = '';
    $('phone-code').value = '';
    $('login-cookie').value = '';
    $('phone-message').textContent = '';
    clearPhoneCaptcha();
    showStep('login-scan');
    setPlatform(state.platform);
    $('platform-switch').classList.toggle('locked', state.mode === 'update');
    for (const item of ['qr', 'phone', 'cookie']) $(`${item}-login-panel`).classList.toggle('hidden', item !== method);
    $('regenerate-qr').classList.toggle('hidden', method !== 'qr');
  }
  function selectLoginMethod(method) {
    if (state.platform === 'ytmusic') method = 'cookie';
    if (method === 'qr') startScan(); else prepareLogin(method);
  }
  function updatePhoneCooldown() {
    const seconds = Math.max(0, Math.ceil((state.phoneRetryAt - Date.now()) / 1000));
    $('phone-send').disabled = seconds > 0;
    $('phone-send').textContent = seconds ? `${seconds} 秒后重发` : '获取验证码';
    if (state.phoneTimer) clearTimeout(state.phoneTimer);
    state.phoneTimer = seconds ? setTimeout(updatePhoneCooldown, 1000) : null;
  }
  async function sendPhoneCode() {
    if ($('phone-send').disabled) return;
    if (!$('phone-number').reportValidity() || !$('phone-country').reportValidity()) return;
    const sequence = state.loginSequence;
    const button = $('phone-send'); setBusy(button, true, '发送中…');
    $('login-error').textContent = '';
    try {
      const data = await jsonRequest('/login/api/phone/send', 'POST', {
        ...loginBody(), phone: $('phone-number').value.trim(), countryCode: $('phone-country').value.trim(), token: state.phoneToken,
      });
      if (sequence !== state.loginSequence) return;
      if (data.token) state.phoneToken = data.token;
      state.phoneRetryAt = data.status === 'captcha' ? 0 : Date.now() + (data.retryAfter ?? 60) * 1000;
      $('phone-message').textContent = data.status === 'sent' ? '验证码已发送' : data.status === 'captcha' ? '请先完成 QQ 安全验证' : '发送过于频繁，请稍后重试';
      if (data.status === 'captcha' && /^\/login\/api\/phone\/captcha\?token=/.test(data.securityPath)) {
        $('phone-captcha-frame').src = apiUrl(data.securityPath);
        $('phone-captcha').classList.remove('hidden');
      } else if (data.status !== 'captcha') clearPhoneCaptcha();
    } catch (error) { if (sequence === state.loginSequence) showError(error); }
    finally { setBusy(button, false); updatePhoneCooldown(); }
  }
  async function submitManualLogin(method) {
    const sequence = state.loginSequence;
    const button = $(method === 'phone' ? 'phone-submit' : 'cookie-submit');
    if (button.disabled) return;
    setBusy(button, true, '正在登录…'); $('login-error').textContent = '';
    try {
      if (method === 'phone' && !state.phoneToken) throw new Error('请先获取短信验证码');
      const data = await jsonRequest(method === 'phone' ? '/login/api/phone/check' : '/login/api/cookie', 'POST', {
        ...loginBody(), ...(method === 'phone'
          ? { token: state.phoneToken, code: $('phone-code').value.trim() }
          : { cookie: $('login-cookie').value.trim() }),
      });
      if (sequence !== state.loginSequence) return;
      $('login-cookie').value = ''; $('phone-code').value = ''; state.phoneToken = '';
      showAccount(data);
    } catch (error) { if (sequence === state.loginSequence) showError(error); }
    finally { setBusy(button, false); }
  }

  function showAccount(account) {
    stopPolling(); state.account = account; state.mode = 'update'; state.platform = account.platform;
    clearLoginInputs();
    setPlatform(account.platform);
    $('delete-account').classList.remove('hidden');
    $('account-platform').textContent = platformLabel(account.platform);
    $('account-key').textContent = account.apiAccessKey; $('account-name').value = account.name || account.accountName || '';
    $('account-stateless').checked = Boolean(account.stateless); $('account-luoxue').checked = account.useLuoxue !== false;
    applyRuntimeCapabilities();
    renderSources(Array.isArray(account.lxSource) ? account.lxSource : []); $('config-message').textContent = '';
    showStep('account-config');
    renderAccountQr();
    if (isAdmin()) loadDesktopAccounts().catch(() => {});
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
    if (!isAdmin()) return;
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
    if (!isAdmin()) return;
    ensureDesktopAccountNavigation();
    const list = $('desktop-account-list');
    const sequence = state.adminSequence;
    let accounts;
    try {
      accounts = await request('/app/api/accounts', { headers: adminHeaders() });
      if (sequence !== state.adminSequence || !isAdmin()) return;
    } catch (error) {
      if (sequence !== state.adminSequence || !isAdmin()) return;
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
      button.title = `${account.name} · ${platformLabel(account.platform)}`;
      button.addEventListener('click', () => openDesktopAccount(account.apiAccessKey)); list.append(button);
    });
    updateAccountNavigationActive();
  }
  function applyRuntimeCapabilities() {
    const supported = state.status?.accountLxSources !== false && state.account?.platform !== 'ytmusic';
    $('account-lx-source-settings').classList.toggle('hidden', !supported);
  }

  async function openDesktopAccount(apiAccessKey) {
    if (!isAdmin()) return;
    stopPolling(); clearLoginInputs();
    const sequence = state.loginSequence;
    navigate('login');
    $('account-config').setAttribute('inert', '');
    $('account-config').setAttribute('aria-busy', 'true');
    $('login-error').textContent = '正在加载账号配置…';
    try {
      const account = await jsonRequest('/login/api/verify-key', 'POST', { api_access_key: apiAccessKey });
      if (sequence !== state.loginSequence) return;
      showAccount(account);
    } catch (error) {
      if (sequence === state.loginSequence) {
        $('account-config').removeAttribute('inert');
        $('account-config').removeAttribute('aria-busy');
        showError(error);
      }
    }
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
    const sequence = state.loginSequence;
    const button = $('save-config'); setBusy(button, true, '正在保存…'); $('config-message').className = 'message';
    try {
      const lxSource = state.status?.accountLxSources === false
        ? []
        : state.account?.platform === 'ytmusic' ? []
        : [...document.querySelectorAll('#lx-source-list input')].map((input) => input.value.trim()).filter(Boolean);
      const account = await jsonRequest('/login/api/account/config', 'PUT', {
        api_access_key: state.account.apiAccessKey, name: $('account-name').value.trim(),
        stateless: $('account-stateless').checked, useLuoxue: $('account-luoxue').checked, lxSource
      });
      if (sequence !== state.loginSequence) return;
      state.account = account; $('config-message').textContent = '配置已保存'; $('config-message').className = 'message success';
      renderSources(account.lxSource || []);
      renderAccountQr();
      if (isAdmin()) loadDesktopAccounts();
    } catch (error) { $('config-message').textContent = error.message; $('config-message').className = 'message error'; }
    finally { setBusy(button, false); }
  }

  function clearAccountView() {
    backToChoose();
    state.accountQrSequence += 1;
    clearTimeout(state.accountQrTimer);
    $('account-key').textContent = ''; $('account-name').value = '';
    $('account-origin-qr').removeAttribute('src'); $('lx-source-list').replaceChildren();
    $('verify-key').value = ''; $('delete-account').classList.add('hidden');
  }
  function leaveAdmin() {
    state.adminSequence += 1; state.adminPassword = ''; state.deleteKey = '';
    clearAccountView();
    $('desktop-account-navigation')?.remove();
    document.documentElement.classList.remove('web-admin');
    $('admin-mode').textContent = '管理员模式';
  }
  $('admin-mode').addEventListener('click', () => {
    if (state.adminPassword) { leaveAdmin(); return; }
    $('admin-error').textContent = ''; $('admin-password').value = '';
    $('admin-dialog').showModal(); $('admin-password').focus();
  });
  $('admin-cancel').addEventListener('click', () => { state.adminSequence += 1; $('admin-dialog').close(); });
  $('admin-dialog').addEventListener('close', () => { $('admin-password').value = ''; });
  $('admin-dialog').addEventListener('cancel', () => { state.adminSequence += 1; });
  $('admin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('admin-submit').disabled) return;
    const sequence = ++state.adminSequence;
    const password = $('admin-password').value;
    setBusy($('admin-submit'), true, '正在验证…'); $('admin-error').textContent = '';
    try {
      await request('/app/api/accounts', { headers: adminHeaders(password) });
      if (sequence !== state.adminSequence || !$('admin-dialog').open) return;
      state.adminPassword = password;
      $('admin-dialog').close();
      document.documentElement.classList.add('web-admin');
      $('admin-mode').textContent = '退出管理员模式';
      await loadDesktopAccounts();
      $('delete-account').classList.toggle('hidden', !state.account);
    } catch (error) { if (sequence === state.adminSequence) $('admin-error').textContent = error.message; }
    finally { setBusy($('admin-submit'), false); }
  });
  $('delete-account').addEventListener('click', () => {
    if (!state.account) return;
    state.deleteKey = state.account.apiAccessKey;
    $('delete-description').textContent = `确定删除账号“${state.account.name || state.account.accountName || ''}”吗？此操作无法撤销。`;
    $('delete-error').textContent = ''; $('delete-dialog').showModal();
    $('delete-cancel').focus();
  });
  $('delete-cancel').addEventListener('click', () => $('delete-dialog').close());
  $('delete-dialog').addEventListener('cancel', event => { if ($('delete-confirm').disabled) event.preventDefault(); });
  $('delete-confirm').addEventListener('click', async () => {
    if (!state.deleteKey || $('delete-confirm').disabled) return;
    const sequence = state.adminSequence;
    setBusy($('delete-confirm'), true, '正在删除…'); $('delete-cancel').disabled = true;
    try {
      await request('/app/api/accounts/delete', {
        method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_access_key: state.deleteKey })
      });
      if (sequence !== state.adminSequence) return;
      $('delete-dialog').close(); state.deleteKey = ''; clearAccountView();
      await loadDesktopAccounts();
    } catch (error) { $('delete-error').textContent = error.message; }
    finally { setBusy($('delete-confirm'), false); $('delete-cancel').disabled = false; }
  });

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
  document.querySelectorAll('#platform-switch button').forEach((button) => button.addEventListener('click', () => { if (state.mode !== 'update' && state.platform !== button.dataset.platform) { setPlatform(button.dataset.platform); selectLoginMethod(state.method); } }));
  document.querySelectorAll('#login-methods button').forEach((button) => button.addEventListener('click', () => selectLoginMethod(button.dataset.method)));
  $('phone-send').addEventListener('click', sendPhoneCode);
  for (const id of ['phone-number', 'phone-country']) $(id).addEventListener('input', () => { state.phoneToken = ''; state.loginSequence += 1; clearPhoneCaptcha(); });
  $('phone-login-panel').addEventListener('submit', (event) => { event.preventDefault(); submitManualLogin('phone'); });
  $('cookie-login-panel').addEventListener('submit', (event) => { event.preventDefault(); submitManualLogin('cookie'); });
  $('scan-back').addEventListener('click', () => state.account ? showAccount(state.account) : backToChoose());
  $('regenerate-qr').addEventListener('click', startScan);
  $('relogin').addEventListener('click', () => selectLoginMethod(state.account?.platform === 'ytmusic' ? 'cookie' : 'qr'));
  $('add-lx-source').addEventListener('click', () => addSourceInput()); $('save-config').addEventListener('click', saveConfig);
  $('retry-backend').addEventListener('click', async () => { try { await window.__TAURI__.core.invoke('restart_backend'); initializeBackend(); } catch (error) { $('splash-message').textContent = error.message; } });
  initializeBackend();
})();
