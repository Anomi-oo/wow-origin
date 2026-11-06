(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    adminPassword: '', adminSequence: 0, deleteKey: '',
    apiBase: '', page: 'home', mode: '', platform: 'qq', kugouEdition: 'standard', token: '', timer: null,
    accountQrTimer: null, accountQrSequence: 0, account: null, status: null,
    method: 'qr', qrType: 'qq', loginSequence: 0, phoneToken: '', phoneRetryAt: 0, phoneTimer: null,
    step: 'login-choose'
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
    renderBreadcrumbs();
    if (updateLocation) {
      if (isTauri()) history.replaceState({}, '', page === 'login' ? '#login' : '#home');
      else history.pushState({}, '', page === 'login' ? '/login' : '/');
    }
  }
  function showStep(id) {
    document.querySelectorAll('.login-step').forEach((element) => element.classList.add('hidden'));
    $(id).classList.remove('hidden');
    $('login-error').textContent = '';
    state.step = id;
    updateAccountNavigationActive();
    renderBreadcrumbs();
  }
  /// 手机布局的面包屑：首页（桌面版）› 账号 › 当前步骤；前面的层级可点击回退。
  function renderBreadcrumbs() {
    const list = $('breadcrumb-list');
    const crumbs = [];
    if (isTauri()) crumbs.push({ label: '首页', action: () => navigate('home') });
    if (state.page === 'login') {
      crumbs.push({ label: '账号', action: backToChoose });
      const accountName = state.account?.name || state.account?.accountName || '';
      if (state.step === 'account-config') crumbs.push({ label: accountName || '账号配置' });
      else if (state.step === 'login-scan') {
        if (state.account) crumbs.push({ label: accountName || '账号配置', action: () => showAccount(state.account) });
        crumbs.push({ label: state.mode === 'update' ? '重新登录' : '添加账号' });
      }
    }
    list.replaceChildren();
    crumbs.forEach((crumb, index) => {
      const item = document.createElement('li');
      if (index < crumbs.length - 1 && crumb.action) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'link link-hover';
        button.textContent = crumb.label; button.addEventListener('click', crumb.action); item.append(button);
      } else {
        const current = document.createElement('span'); current.textContent = crumb.label; current.setAttribute('aria-current', 'page'); item.append(current);
      }
      list.append(item);
    });
  }
  function cancelQr(token) { if (token) jsonRequest('/login/api/cancel', 'POST', { token }).catch(() => {}); }
  function stopPolling() {
    cancelQr(state.token);
    $('account-config').removeAttribute('inert'); $('account-config').removeAttribute('aria-busy');
    if (state.timer) clearTimeout(state.timer);
    state.timer = null; state.token = ''; state.loginSequence += 1;
  }
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
    $('kugou-edition-field').classList.toggle('hidden', platform !== 'kugou');
    $('kugou-edition').value = state.kugouEdition;
    $('kugou-edition').disabled = state.mode === 'update';
    $('qq-qr-types').classList.toggle('hidden', platform !== 'qq');
    document.querySelectorAll('#qq-qr-types button').forEach(button => button.classList.toggle('btn-active', state.method === 'qr' && button.dataset.qrType === state.qrType));
    document.querySelectorAll('#platform-switch button').forEach((button) => button.classList.toggle('tab-active', button.dataset.platform === platform));
    $('scan-platform-label').textContent = platformLabel(platform) + (platform === 'kugou' ? ` · ${state.kugouEdition === 'lite' ? '概念版' : '标准版'}` : '');
    document.querySelectorAll('#login-methods button[data-method]').forEach((button) => {
      const method = button.dataset.method;
      // 登录方式页签：只隐藏该平台不支持的方式，当前方式高亮。QQ 扫码时再由二维码下方的 QQ/微信/QQ 音乐 选择扫码 App。
      button.classList.toggle('hidden', (method === 'phone' && platform !== 'kugou') || (platform === 'ytmusic' && method !== 'cookie'));
      button.classList.toggle('tab-active', method === state.method);
    });
    $('phone-country').disabled = platform === 'kugou';
    if (platform === 'kugou') $('phone-country').value = '86';
    $('account-luoxue').disabled = platform === 'ytmusic';
    $('ytmusic-cookie-help').classList.toggle('hidden', platform !== 'ytmusic');
  }
  function platformLabel(platform) { return platform === 'kugou' ? '酷狗音乐' : platform === 'qq' ? 'QQ 音乐' : platform === 'ytmusic' ? 'YouTube Music' : '网易云音乐'; }
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
    $('login-qr').classList.remove('qr-invalid'); $('qr-retry').classList.add('hidden');
    $('login-qr').removeAttribute('src'); $('qr-placeholder').classList.remove('hidden');
    $('scan-message').textContent = '正在生成二维码…';
    $('platform-switch').classList.toggle('locked', state.mode === 'update'); setPlatform(state.platform);
    try {
      const body = loginBody();
      if (state.platform === 'qq') body.qrType = state.qrType;
      if (state.mode === 'update') body.api_access_key = state.account.apiAccessKey;
      const data = await jsonRequest('/login/api/start', 'POST', body);
      if (sequence !== state.loginSequence) { cancelQr(data.token); return; }
      state.token = data.token; state.platform = data.platform; setPlatform(data.platform);
      $('login-qr').src = data.qrImage; $('qr-placeholder').classList.add('hidden');
      $('scan-message').textContent = data.platform === 'qq' ? ({ qq: '请使用手机 QQ 扫码', wx: '请使用微信扫码', mobile: '请使用 QQ 音乐扫码' })[state.qrType] : data.platform === 'kugou' ? `请使用${state.kugouEdition === 'lite' ? '酷狗概念版' : '酷狗音乐标准版'}扫码` : '请使用网易云音乐扫码';
      state.timer = setTimeout(checkLogin, 1500);
    } catch (error) { if (sequence === state.loginSequence) { $('scan-message').textContent = '二维码生成失败'; showError(error); } }
  }
  function invalidateQr() {
    $('login-qr').classList.add('qr-invalid');
    $('qr-retry').classList.remove('hidden');
  }
  async function checkLogin() {
    if (!state.token) return;
    const sequence = state.loginSequence;
    try {
      const data = await jsonRequest('/login/api/check', 'POST', { token: state.token });
      if (sequence !== state.loginSequence) return;
      $('scan-message').textContent = data.message;
      if (['success', 'expired', 'error'].includes(data.status)) state.token = '';
      if (data.status === 'success') { stopPolling(); showAccount(data); }
      else if (data.status === 'expired' || data.status === 'error') { stopPolling(); invalidateQr(); }
      else state.timer = setTimeout(checkLogin, 1500);
    } catch (error) { if (sequence === state.loginSequence) { stopPolling(); invalidateQr(); showError(error); } }
  }

  function loginBody() {
    return { mode: state.mode, platform: state.platform, ...(state.platform === 'kugou' ? { kugouEdition: state.kugouEdition } : {}), ...(state.mode === 'update' ? { api_access_key: state.account.apiAccessKey } : {}) };
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
    stopPolling(); state.account = account; state.mode = 'update'; state.platform = account.platform; state.kugouEdition = account.kugouEdition || 'standard';
    clearLoginInputs();
    setPlatform(account.platform);
    $('delete-account').classList.remove('hidden');
    $('account-platform').textContent = platformLabel(account.platform) + (account.platform === 'kugou' ? ` · ${state.kugouEdition === 'lite' ? '概念版' : '标准版'}` : '');
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
    $('account-add-link').removeAttribute('href');
    try {
      const data = await jsonRequest('/app/api/origin-qr', 'POST', {
        host,
        token: state.account.apiAccessKey,
        name: $('account-name').value.trim()
      });
      if (sequence !== state.accountQrSequence) return;
      image.src = data.qrImage; placeholder.classList.add('hidden');
      // 一键添加链接与二维码同源：host 为当前页面地址（桌面版为所选局域网地址）。
      if (data.addUrl) $('account-add-link').href = data.addUrl;
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
      button.classList.toggle('menu-active', button.dataset.accountKey === activeKey);
    });
  }

  function ensureDesktopAccountNavigation() {
    let navigation = $('desktop-account-navigation');
    if (navigation) return navigation;
    // 顶部导航右侧的下拉菜单：点击“账号列表”回到账号页并刷新列表，菜单项打开对应账号。
    navigation = document.createElement('div'); navigation.id = 'desktop-account-navigation'; navigation.className = 'dropdown dropdown-end';
    const root = document.createElement('button'); root.type = 'button'; root.className = 'nav-item'; root.textContent = '账号列表';
    const list = document.createElement('ul'); list.id = 'desktop-account-list';
    list.className = 'dropdown-content menu z-40 mt-2 max-h-[min(50vh,320px)] w-60 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg';
    root.addEventListener('click', () => { backToChoose(); navigate('login'); loadDesktopAccounts().catch(showError); });
    navigation.append(root, list); $('account-navigation-slot').append(navigation);
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
      list.replaceChildren(accountNavMessage('账号列表读取失败'));
      return;
    }
    list.replaceChildren();
    renderAccountDirectory(accounts);
    if (!accounts.length) {
      list.append(accountNavMessage('暂无账号'));
      return;
    }
    accounts.forEach((account) => {
      const item = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'account-nav-item truncate';
      button.dataset.accountKey = account.apiAccessKey; button.textContent = account.name;
      button.title = `${account.name} · ${platformLabel(account.platform)}${account.platform === 'kugou' ? ` · ${account.kugouEdition === 'lite' ? '概念版' : '标准版'}` : ''}`;
      button.addEventListener('click', () => { document.activeElement?.blur?.(); return openDesktopAccount(account.apiAccessKey); });
      item.append(button); list.append(item);
    });
    updateAccountNavigationActive();
  }
  /// 账号页入口下方的账号目录：名称、平台，点击打开配置；仅管理员或桌面版可见。
  function renderAccountDirectory(accounts) {
    const directory = $('account-directory'); const list = $('account-directory-list');
    directory.classList.toggle('hidden', !isAdmin());
    // 管理员与桌面版直接从目录打开账号，不再需要密钥入口卡。
    $('manage-account-card').classList.toggle('hidden', isAdmin());
    $('account-directory-count').textContent = `${accounts.length} 个`;
    list.replaceChildren();
    if (!accounts.length) {
      const empty = document.createElement('li'); empty.className = 'p-4 text-sm text-base-content/60'; empty.textContent = '暂无账号，先添加一个吧。'; list.append(empty);
      return;
    }
    accounts.forEach((account) => {
      const item = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'list-row account-directory-item';
      button.dataset.accountKey = account.apiAccessKey;
      const name = document.createElement('span'); name.className = 'truncate font-medium'; name.textContent = account.name;
      const platform = document.createElement('span'); platform.className = 'badge badge-ghost badge-sm';
      platform.textContent = platformLabel(account.platform) + (account.platform === 'kugou' ? ` · ${account.kugouEdition === 'lite' ? '概念版' : '标准版'}` : '');
      const chevron = document.createElement('span'); chevron.className = 'text-base-content/40'; chevron.textContent = '›'; chevron.setAttribute('aria-hidden', 'true');
      button.append(name, platform, chevron);
      button.addEventListener('click', () => openDesktopAccount(account.apiAccessKey));
      item.append(button); list.append(item);
    });
  }
  function accountNavMessage(text) {
    const item = document.createElement('li'); item.className = 'menu-disabled';
    const message = document.createElement('span'); message.className = 'account-nav-empty'; message.textContent = text;
    item.append(message); return item;
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
    const row = document.createElement('div'); row.className = 'copy-row';
    const input = document.createElement('input'); input.type = 'url'; input.className = 'input w-full'; input.placeholder = 'https://example.com/source.js'; input.value = isSafeSourceUrl(value) ? value : '';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn'; remove.textContent = '删除';
    remove.addEventListener('click', () => { row.remove(); if (!list.children.length) addSourceInput(); });
    row.append(input, remove); list.append(row);
  }
  async function refreshAuthorization() {
    const button = $('refresh-auth');
    if (button.disabled || !state.account) return;
    const sequence = state.loginSequence;
    const apiAccessKey = state.account.apiAccessKey;
    setBusy(button, true, '正在刷新…');
    $('config-message').textContent = ''; $('config-message').className = 'message';
    try {
      const data = await jsonRequest('/login/api/refresh', 'POST', { api_access_key: apiAccessKey });
      if (sequence !== state.loginSequence || state.account?.apiAccessKey !== apiAccessKey) return;
      $('config-message').textContent = data.message; $('config-message').className = 'message success';
    } catch (error) {
      if (sequence === state.loginSequence && state.account?.apiAccessKey === apiAccessKey) {
        $('config-message').textContent = error.message; $('config-message').className = 'message error';
      }
    } finally { setBusy(button, false); }
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
    $('account-origin-qr').removeAttribute('src'); $('account-add-link').removeAttribute('href'); $('lx-source-list').replaceChildren();
    $('verify-key').value = ''; $('delete-account').classList.add('hidden');
  }
  function leaveAdmin() {
    state.adminSequence += 1; state.adminPassword = ''; state.deleteKey = '';
    clearAccountView();
    $('desktop-account-navigation')?.remove();
    $('account-directory').classList.add('hidden');
    $('manage-account-card').classList.remove('hidden');
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
  $('choose-create').addEventListener('click', () => { state.mode = 'create'; state.platform = 'qq'; state.kugouEdition = 'standard'; state.account = null; startScan(); });
  document.querySelectorAll('.back-choose').forEach((button) => button.addEventListener('click', backToChoose));
  $('verify-submit').addEventListener('click', verifyAccount); $('verify-key').addEventListener('keydown', (event) => { if (event.key === 'Enter') verifyAccount(); });
  document.querySelectorAll('#platform-switch button').forEach((button) => button.addEventListener('click', () => { if (state.mode !== 'update' && state.platform !== button.dataset.platform) { setPlatform(button.dataset.platform); selectLoginMethod(state.method); } }));
  document.querySelectorAll('#login-methods button[data-method]').forEach((button) => button.addEventListener('click', () => selectLoginMethod(button.dataset.method)));
  document.querySelectorAll('#qq-qr-types button').forEach(button => button.addEventListener('click', () => {
    if (state.method !== 'qr' || state.qrType !== button.dataset.qrType) { state.qrType = button.dataset.qrType; startScan(); }
  }));
  $('phone-send').addEventListener('click', sendPhoneCode);
  for (const id of ['phone-number', 'phone-country']) $(id).addEventListener('input', () => { state.phoneToken = ''; state.loginSequence += 1; clearPhoneCaptcha(); });
  $('phone-login-panel').addEventListener('submit', (event) => { event.preventDefault(); submitManualLogin('phone'); });
  $('kugou-edition').addEventListener('change', () => {
    if (state.mode === 'update') return;
    state.kugouEdition = $('kugou-edition').value;
    clearLoginInputs();
    selectLoginMethod(state.method);
  });
  $('cookie-login-panel').addEventListener('submit', (event) => { event.preventDefault(); submitManualLogin('cookie'); });
  $('scan-back').addEventListener('click', () => state.account ? showAccount(state.account) : backToChoose());
  $('regenerate-qr').addEventListener('click', startScan);
  $('qr-retry').addEventListener('click', startScan);
  $('relogin').addEventListener('click', () => selectLoginMethod(state.account?.platform === 'ytmusic' ? 'cookie' : 'qr'));
  $('refresh-auth').addEventListener('click', refreshAuthorization);
  $('add-lx-source').addEventListener('click', () => addSourceInput()); $('save-config').addEventListener('click', saveConfig);
  $('retry-backend').addEventListener('click', async () => { try { await window.__TAURI__.core.invoke('restart_backend'); initializeBackend(); } catch (error) { $('splash-message').textContent = error.message; } });
  initializeBackend();
})();
