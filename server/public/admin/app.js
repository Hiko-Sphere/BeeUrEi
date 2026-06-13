/* BeeUrEi Admin — vanilla SPA, zero runtime deps. Talks to the same-origin API with a Bearer token. */
'use strict';

// ---------------------------------------------------------------- state
const LS = { token: 'beeurei.admin.token', user: 'beeurei.admin.user', lang: 'beeurei.admin.lang', theme: 'beeurei.admin.theme' };
const state = {
  token: localStorage.getItem(LS.token) || null,
  user: safeParse(localStorage.getItem(LS.user)),
  lang: localStorage.getItem(LS.lang) || (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh',
  theme: localStorage.getItem(LS.theme) || 'auto',
  overview: null,
  users: [],
  reports: [],
  recordings: [],
  recConfig: null,
  links: [],
  calls: [],
  blocks: [],
  usersQuery: '', usersRole: 'all', usersStatus: 'all',
  linksQuery: '', callsQuery: '', blocksQuery: '',
  refreshTimer: null,
};
// fix lang init (ternary precedence above): recompute cleanly
state.lang = localStorage.getItem(LS.lang) || ((navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh');

function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// ---------------------------------------------------------------- i18n
const I18N = {
  zh: {
    appName: 'BeeUrEi 管理后台', console: '后台', signInTitle: '管理员登录', signInSub: '请用管理员账号登录后台',
    username: '用户名 / 手机号 / 邮箱', password: '密码', signIn: '登录', signingIn: '登录中…',
    notAdmin: '该账号不是管理员，无权访问后台。', loginFailed: '登录失败，请检查账号密码。',
    dashboard: '总览', users: '用户', reports: '举报', recordings: '录制', logout: '退出登录',
    totalUsers: '用户总数', active: '正常', disabled: '已封禁', online: '在线', onlineHelpers: '在线协助者',
    openReports: '待处理举报', recordingsCount: '录制记录', byRole: '按角色分布', version: '版本', uptime: '运行时长',
    refresh: '刷新', search: '搜索用户名 / 昵称…', allRoles: '全部角色', allStatus: '全部状态',
    role: '角色', status: '状态', created: '注册时间', actions: '操作', lastActive: '在线',
    ban: '封禁', unban: '解封', changeRole: '角色', confirmBan: '确认封禁该用户？封禁后其令牌立即失效、无法登录。',
    confirmUnban: '确认解封该用户？', confirmRole: '确认把该用户的角色改为「%s」？',
    banned: '已封禁', unbanned: '已解封', roleChanged: '角色已更新', noUsers: '没有匹配的用户',
    resolve: '标记已处理', open: '待处理', resolved: '已处理', reportResolved: '举报已处理', noReports: '暂无举报',
    reporter: '举报人', target: '被举报', reason: '原因',
    recPolicy: '录制策略', allowRecording: '允许录制', allowRecordingDesc: '全局开关：关闭时任何端都无法发起录制。',
    requireConsent: '录制需各方同意', requireConsentDesc: '开启后，录制必须取得被录制方的明确同意。',
    retentionDays: '保留天数', retentionDesc: '到期自动删除录制元数据。', days: '天', save: '保存', saved: '已保存',
    recList: '录制记录', deleteRec: '删除', confirmDeleteRec: '确认删除这条录制记录？', noRecordings: '暂无录制记录',
    detail: '用户详情', email: '邮箱', phone: '手机号', language: '语言', verified: '已验证', notVerified: '未验证',
    none: '未设置', appleId: 'Apple ID', linked: '已绑定', notLinked: '未绑定', passkeys: 'Passkey', online2: '在线状态',
    linkedRelations: '绑定关系', blockedRelations: '拉黑记录', recentCalls: '近期通话', noCalls: '暂无通话记录',
    close: '关闭', never: '从未', justNow: '刚刚',
    err_last_admin_protected: '不能操作最后一名管理员', err_cannot_change_own_role: '不能修改自己的角色',
    err_cannot_disable_self: '不能封禁自己', err_not_found: '对象不存在', err_invalid_input: '输入有误',
    err_forbidden: '无权操作', err_unauthorized: '登录已过期，请重新登录', err_network: '网络错误，请重试',
    sessionExpired: '登录已过期，请重新登录', loading: '加载中…',
    relationships: '关系', calls: '通话', owner: '视障用户', member: '协助者 / 亲友', relationCol: '关系',
    emergency: '紧急', exportCsv: '导出 CSV', noLinks: '暂无绑定关系', caller: '主叫', callee: '被叫', time: '时间',
    callCount: '通话记录', searchLinks: '搜索姓名…', searchCalls: '搜索姓名…',
    linkAccepted: '已绑定', linkPending: '待确认', linkDeclined: '已拒绝',
    newUsers7d: '近 7 天新增', newUsers30d: '近 30 天新增', regTrend: '注册趋势（近 30 天）',
    blocks: '拉黑', blocker: '拉黑方', blocked: '被拉黑', noBlocks: '暂无拉黑记录', searchBlocks: '搜索姓名…',
    support: '账号支持', markVerified: '标记邮箱已验证', markUnverified: '撤销邮箱验证', unlinkApple: '解绑 Apple',
    clearPasskeys: '清除 Passkey', forceLogout: '强制下线',
    confirmMarkVerified: '确认将该用户邮箱标记为「已验证」？', confirmMarkUnverified: '确认撤销该用户的邮箱验证状态？',
    confirmUnlinkApple: '确认解绑该用户的 Apple 账号？解绑后该用户需用正确的 Apple 账号重新绑定。',
    confirmClearPasskeys: '确认清除该用户的全部 Passkey？清除后该用户需用密码登录并重新注册 Passkey。',
    confirmForceLogout: '确认强制该用户下线？其所有设备上的登录将立即失效，需重新登录。',
    emailMarkedVerified: '已标记邮箱为已验证', emailMarkedUnverified: '已撤销邮箱验证',
    appleUnlinked: '已解绑 Apple', passkeysCleared: '已清除 Passkey（%s 把）', forcedLogout: '已强制下线',
    err_no_email: '该用户未绑定邮箱', err_not_linked: '该用户未绑定 Apple',
    roles: { blind: '视障用户', helper: '协助者', family: '亲友', admin: '管理员', developer: '开发者' },
    callStatus: { answered: '已接通', declined: '已拒绝', missed: '未接', ended: '已结束', ongoing: '进行中', ringing: '振铃中' },
    dir: { incoming: '呼入', outgoing: '呼出' },
  },
  en: {
    appName: 'BeeUrEi Admin', console: 'Console', signInTitle: 'Admin sign-in', signInSub: 'Sign in with an admin account',
    username: 'Username / phone / email', password: 'Password', signIn: 'Sign in', signingIn: 'Signing in…',
    notAdmin: 'This account is not an admin and cannot access the console.', loginFailed: 'Sign-in failed — check your credentials.',
    dashboard: 'Overview', users: 'Users', reports: 'Reports', recordings: 'Recordings', logout: 'Sign out',
    totalUsers: 'Total users', active: 'Active', disabled: 'Banned', online: 'Online', onlineHelpers: 'Online helpers',
    openReports: 'Open reports', recordingsCount: 'Recordings', byRole: 'By role', version: 'Version', uptime: 'Uptime',
    refresh: 'Refresh', search: 'Search username / name…', allRoles: 'All roles', allStatus: 'All status',
    role: 'Role', status: 'Status', created: 'Joined', actions: 'Actions', lastActive: 'Online',
    ban: 'Ban', unban: 'Unban', changeRole: 'Role', confirmBan: 'Ban this user? Their tokens expire immediately and they cannot sign in.',
    confirmUnban: 'Unban this user?', confirmRole: 'Change this user’s role to “%s”?',
    banned: 'Banned', unbanned: 'Unbanned', roleChanged: 'Role updated', noUsers: 'No matching users',
    resolve: 'Resolve', open: 'Open', resolved: 'Resolved', reportResolved: 'Report resolved', noReports: 'No reports',
    reporter: 'Reporter', target: 'Reported', reason: 'Reason',
    recPolicy: 'Recording policy', allowRecording: 'Allow recording', allowRecordingDesc: 'Master switch: when off, no side can start a recording.',
    requireConsent: 'Require everyone’s consent', requireConsentDesc: 'When on, recording requires the recorded party’s explicit consent.',
    retentionDays: 'Retention', retentionDesc: 'Recording metadata is auto-deleted after this many days.', days: 'days', save: 'Save', saved: 'Saved',
    recList: 'Recordings', deleteRec: 'Delete', confirmDeleteRec: 'Delete this recording record?', noRecordings: 'No recordings',
    detail: 'User detail', email: 'Email', phone: 'Phone', language: 'Language', verified: 'Verified', notVerified: 'Unverified',
    none: 'Not set', appleId: 'Apple ID', linked: 'Linked', notLinked: 'Not linked', passkeys: 'Passkeys', online2: 'Presence',
    linkedRelations: 'Linked relations', blockedRelations: 'Blocks', recentCalls: 'Recent calls', noCalls: 'No calls',
    close: 'Close', never: 'never', justNow: 'just now',
    err_last_admin_protected: 'Can’t act on the last admin', err_cannot_change_own_role: 'Can’t change your own role',
    err_cannot_disable_self: 'Can’t ban yourself', err_not_found: 'Not found', err_invalid_input: 'Invalid input',
    err_forbidden: 'Forbidden', err_unauthorized: 'Session expired — sign in again', err_network: 'Network error, try again',
    sessionExpired: 'Session expired — sign in again', loading: 'Loading…',
    relationships: 'Relations', calls: 'Calls', owner: 'Blind user', member: 'Helper / family', relationCol: 'Relation',
    emergency: 'Emergency', exportCsv: 'Export CSV', noLinks: 'No relationships yet', caller: 'Caller', callee: 'Callee', time: 'Time',
    callCount: 'Call records', searchLinks: 'Search name…', searchCalls: 'Search name…',
    linkAccepted: 'Linked', linkPending: 'Pending', linkDeclined: 'Declined',
    newUsers7d: 'New · 7d', newUsers30d: 'New · 30d', regTrend: 'Registrations (last 30 days)',
    blocks: 'Blocks', blocker: 'Blocker', blocked: 'Blocked', noBlocks: 'No blocks', searchBlocks: 'Search name…',
    support: 'Account support', markVerified: 'Mark email verified', markUnverified: 'Unverify email', unlinkApple: 'Unlink Apple',
    clearPasskeys: 'Clear passkeys', forceLogout: 'Force sign-out',
    confirmMarkVerified: 'Mark this user’s email as verified?', confirmMarkUnverified: 'Revoke this user’s email verification?',
    confirmUnlinkApple: 'Unlink this user’s Apple account? They’ll need to re-link with the correct Apple account.',
    confirmClearPasskeys: 'Clear all of this user’s passkeys? They’ll need to sign in with a password and re-register.',
    confirmForceLogout: 'Force this user to sign out? Sessions on all their devices expire immediately.',
    emailMarkedVerified: 'Email marked verified', emailMarkedUnverified: 'Email verification revoked',
    appleUnlinked: 'Apple unlinked', passkeysCleared: 'Passkeys cleared (%s)', forcedLogout: 'Signed out everywhere',
    err_no_email: 'User has no email', err_not_linked: 'User has no Apple link',
    roles: { blind: 'Blind / low-vision', helper: 'Helper', family: 'Family', admin: 'Admin', developer: 'Developer' },
    callStatus: { answered: 'Answered', declined: 'Declined', missed: 'Missed', ended: 'Ended', ongoing: 'Ongoing', ringing: 'Ringing' },
    dir: { incoming: 'Incoming', outgoing: 'Outgoing' },
  },
};
function t(key) { return I18N[state.lang][key] ?? I18N.zh[key] ?? key; }
function roleName(r) { return (I18N[state.lang].roles[r]) || r; }
function localeCode() { return state.lang === 'en' ? 'en-US' : 'zh-CN'; }

// ---------------------------------------------------------------- dom helpers
const $ = (sel, root = document) => root.querySelector(sel);
const app = () => document.getElementById('app');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  const n = (name || '?').trim();
  return n ? n.slice(0, 1).toUpperCase() : '?';
}
function avatarHTML(u, big) {
  const cls = 'avatar' + (big ? ' lg' : '');
  if (u.avatar) return `<img class="${cls}" src="${esc(u.avatar)}" alt="" />`;
  return `<span class="${cls}" aria-hidden="true">${esc(initials(u.displayName || u.username))}</span>`;
}
function fmtDate(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString(localeCode(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return new Date(ms).toISOString(); }
}
function fmtUptime(sec) {
  if (!sec && sec !== 0) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (state.lang === 'en') return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
  return [d && `${d}天`, h && `${h}小时`, `${m}分`].filter(Boolean).join('');
}

// ---------------------------------------------------------------- toast
function toast(msg, kind = '') {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}
function errText(code) { return I18N[state.lang]['err_' + code] || code || t('err_network'); }

// ---------------------------------------------------------------- api
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && state.token) headers.authorization = 'Bearer ' + state.token;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw { code: 'network' };
  }
  if (res.status === 401 || res.status === 403) {
    if (auth) { logout(true); throw { code: res.status === 403 ? 'forbidden' : 'unauthorized' }; }
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body (204) */ }
  if (!res.ok) throw { code: (data && data.error) || 'network', status: res.status };
  return data;
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  const tm = state.theme;
  if (tm === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', tm);
}
function cycleTheme() {
  state.theme = state.theme === 'auto' ? 'light' : state.theme === 'light' ? 'dark' : 'auto';
  localStorage.setItem(LS.theme, state.theme); applyTheme(); renderChrome();
}
function themeIcon() { return state.theme === 'light' ? '☀️' : state.theme === 'dark' ? '🌙' : '🌗'; }
function toggleLang() { state.lang = state.lang === 'zh' ? 'en' : 'zh'; localStorage.setItem(LS.lang, state.lang); document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-Hans'; render(); }

// ---------------------------------------------------------------- auth
function setAuth(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem(LS.token, token); localStorage.setItem(LS.user, JSON.stringify(user));
}
function logout(silent) {
  state.token = null; state.user = null;
  localStorage.removeItem(LS.token); localStorage.removeItem(LS.user);
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
  if (!silent) toast(t('logout'));
  location.hash = '';
  render();
}

// ---------------------------------------------------------------- login view
function renderLogin(errMsg) {
  applyTheme();
  app().innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm" autocomplete="on">
        <div class="login-brand"><span class="logo" aria-hidden="true">🐝</span><h1>${esc(t('appName'))}</h1></div>
        <p class="login-sub">${esc(t('signInSub'))}</p>
        ${errMsg ? `<div class="err-banner" role="alert">${esc(errMsg)}</div>` : ''}
        <div class="field">
          <label for="u">${esc(t('username'))}</label>
          <input id="u" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required />
        </div>
        <div class="field">
          <label for="p">${esc(t('password'))}</label>
          <input id="p" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn primary block" type="submit" id="loginBtn">${esc(t('signIn'))}</button>
        <div class="login-actions">
          <button class="btn ghost sm" type="button" data-action="lang">${state.lang === 'zh' ? 'English' : '中文'}</button>
          <button class="btn ghost sm" type="button" data-action="theme">${themeIcon()}</button>
        </div>
      </form>
    </div>`;
  $('#loginForm').addEventListener('submit', onLogin);
  app().querySelector('[data-action="lang"]').addEventListener('click', toggleLang);
  app().querySelector('[data-action="theme"]').addEventListener('click', cycleTheme);
  $('#u').focus();
}
async function onLogin(e) {
  e.preventDefault();
  const btn = $('#loginBtn');
  const username = $('#u').value.trim(), password = $('#p').value;
  if (!username || !password) return;
  btn.disabled = true; btn.textContent = t('signingIn');
  try {
    const data = await api('/api/auth/login', { method: 'POST', auth: false, body: { username, password } });
    if (!data || !data.user || data.user.role !== 'admin') { renderLogin(t('notAdmin')); return; }
    setAuth(data.token, data.user);
    location.hash = '#/';
    render();
  } catch (err) {
    btn.disabled = false; btn.textContent = t('signIn');
    renderLogin(err.code === 'network' ? t('err_network') : t('loginFailed'));
  }
}

// ---------------------------------------------------------------- shell + router
const ROUTES = ['', 'users', 'relationships', 'calls', 'blocks', 'reports', 'recordings'];
function currentRoute() { const h = (location.hash || '#/').replace(/^#\/?/, ''); return ROUTES.includes(h) ? h : ''; }

function renderChrome() {
  const route = currentRoute();
  const openReports = state.overview ? state.overview.reports.open : 0;
  const nav = [
    ['', '📊', t('dashboard')],
    ['users', '👤', t('users')],
    ['relationships', '🔗', t('relationships')],
    ['calls', '📞', t('calls')],
    ['blocks', '🚫', t('blocks')],
    ['reports', '🚩', t('reports'), openReports],
    ['recordings', '⏺', t('recordings')],
  ].map(([r, ico, label, badge]) => `
    <button class="nav-item ${r === route ? 'active' : ''}" data-route="${r}">
      <span class="ico" aria-hidden="true">${ico}</span><span>${esc(label)}</span>
      ${badge ? `<span class="badge">${badge}</span>` : ''}
    </button>`).join('');
  const titleMap = { '': t('dashboard'), users: t('users'), relationships: t('relationships'), calls: t('calls'), blocks: t('blocks'), reports: t('reports'), recordings: t('recordings') };
  app().innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="logo" aria-hidden="true">🐝</span>
          <div><div class="name">BeeUrEi</div><div class="tag">${esc(t('console'))}</div></div></div>
        <nav>${nav}</nav>
        <div class="spacer"></div>
        <div class="foot">Hiko Sphere 彦穹科技<br/>v${esc(state.overview ? state.overview.version : '')}</div>
      </aside>
      <main class="main">
        <header class="topbar">
          <button class="btn icon ghost menu-btn" data-action="menu" aria-label="menu">☰</button>
          <h2>${esc(titleMap[route])}</h2>
          <div class="grow"></div>
          <button class="btn ghost sm" data-action="lang" aria-label="language">${state.lang === 'zh' ? 'EN' : '中'}</button>
          <button class="btn ghost sm" data-action="theme" aria-label="theme">${themeIcon()}</button>
          <span class="who">${esc(state.user ? state.user.displayName : '')} · <b>${esc(roleName('admin'))}</b></span>
          <button class="btn sm" data-action="logout">${esc(t('logout'))}</button>
        </header>
        <section class="content" id="view"></section>
      </main>
    </div>`;
  app().querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.route; $('#sidebar')?.classList.remove('open'); }));
  app().querySelector('[data-action="lang"]').addEventListener('click', toggleLang);
  app().querySelector('[data-action="theme"]').addEventListener('click', cycleTheme);
  app().querySelector('[data-action="logout"]').addEventListener('click', () => logout());
  app().querySelector('[data-action="menu"]').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
}

function viewEl() { return document.getElementById('view'); }
function showLoading() { const v = viewEl(); if (v) v.innerHTML = `<div class="loading"><span class="spinner"></span> ${esc(t('loading'))}</div>`; }

// ---------------------------------------------------------------- dashboard
async function loadDashboard() {
  showLoading();
  try {
    state.overview = await api('/api/admin/overview');
    renderChrome();
    renderDashboard();
    if (!state.refreshTimer) state.refreshTimer = setInterval(async () => {
      if (currentRoute() === '') { try { state.overview = await api('/api/admin/overview'); renderDashboard(); } catch {} }
    }, 15000);
  } catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function statCard(k, v, sub, cls) {
  return `<div class="card stat"><div class="k">${esc(k)}</div><div class="v ${cls || ''}">${v}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
}
function renderDashboard() {
  const o = state.overview; if (!o) return;
  const roleOrder = ['blind', 'helper', 'family', 'admin', 'developer'];
  const max = Math.max(1, ...roleOrder.map((r) => o.users.byRole[r] || 0));
  const bars = roleOrder.map((r) => {
    const n = o.users.byRole[r] || 0;
    return `<div class="bar-row"><span>${esc(roleName(r))}</span><span class="bar-track"><span class="bar-fill" data-pct="${Math.round((n / max) * 100)}"></span></span><span class="n">${n}</span></div>`;
  }).join('');
  const g = o.growth || { newUsers7d: 0, newUsers30d: 0, trend: [] };
  const trend = g.trend || [];
  const tmax = Math.max(1, ...trend.map((d) => d.count));
  const cols = trend.map((d) => {
    const h = Math.round((d.count / tmax) * 100);
    return `<span class="col" title="${esc(d.date)} · ${d.count}"><i data-h="${h}"></i></span>`;
  }).join('');
  const trendCard = trend.length ? `
    <div class="section">
      <h3>${esc(t('regTrend'))}</h3>
      <div class="card">
        <div class="trend">${cols}</div>
        <div class="trend-axis"><span>${esc(trend[0].date)}</span><span>${esc(trend[trend.length - 1].date)}</span></div>
      </div>
    </div>` : '';
  viewEl().innerHTML = `
    <div class="cards">
      ${statCard(t('totalUsers'), o.users.total)}
      ${statCard(t('active'), o.users.active, '', 'success')}
      ${statCard(t('disabled'), o.users.disabled, '', o.users.disabled ? 'danger' : '')}
      ${statCard(t('online'), o.online.total, t('onlineHelpers') + ': ' + o.online.helpers)}
      ${statCard(t('newUsers7d'), g.newUsers7d, t('newUsers30d') + ': ' + g.newUsers30d, g.newUsers7d ? 'success' : '')}
      ${statCard(t('openReports'), o.reports.open, (state.lang === 'en' ? 'of ' : '共 ') + o.reports.total, o.reports.open ? 'danger' : '')}
      ${statCard(t('recordingsCount'), o.recordings.total)}
    </div>
    ${trendCard}
    <div class="section">
      <h3>${esc(t('byRole'))}</h3>
      <div class="card"><div class="bars">${bars}</div></div>
    </div>
    <div class="section">
      <h3>${esc(t('version'))} · ${esc(t('uptime'))}</h3>
      <div class="card"><div class="kv"><dt>${esc(t('version'))}</dt><dd>v${esc(o.version)}</dd><dt>${esc(t('uptime'))}</dt><dd>${esc(fmtUptime(o.uptimeSeconds))}</dd></div></div>
    </div>`;
  applyDims(viewEl()); // 动态尺寸经 CSSOM 落定（CSP style-src 'self' 禁内联 style）
}
// 把 data-pct / data-h 落成实际宽高——CSSOM 赋值不受 CSP 内联样式限制。
function applyDims(root) {
  root.querySelectorAll('[data-pct]').forEach((el) => { el.style.width = el.dataset.pct + '%'; });
  root.querySelectorAll('[data-h]').forEach((el) => { el.style.height = el.dataset.h + '%'; });
}

// ---------------------------------------------------------------- users
async function loadUsers() {
  showLoading();
  try { state.users = (await api('/api/admin/users')).users || []; renderUsers(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function filteredUsers() {
  const q = state.usersQuery.trim().toLowerCase();
  return state.users.filter((u) => {
    if (state.usersRole !== 'all' && u.role !== state.usersRole) return false;
    if (state.usersStatus !== 'all' && u.status !== state.usersStatus) return false;
    if (q && !((u.displayName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function rolePill(r) { return `<span class="pill role-${esc(r)}">${esc(roleName(r))}</span>`; }
function renderUsers() {
  const list = filteredUsers();
  const roleOpts = ['all', 'blind', 'helper', 'family', 'admin', 'developer']
    .map((r) => `<option value="${r}" ${state.usersRole === r ? 'selected' : ''}>${r === 'all' ? esc(t('allRoles')) : esc(roleName(r))}</option>`).join('');
  const statusOpts = [['all', t('allStatus')], ['active', t('active')], ['disabled', t('disabled')]]
    .map(([v, l]) => `<option value="${v}" ${state.usersStatus === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const rows = list.map((u) => `
    <tr class="clickable" data-uid="${esc(u.id)}">
      <td><div class="user-cell">${avatarHTML(u)}<div><div class="nm">${esc(u.displayName || '—')}</div><div class="un">@${esc(u.username)}</div></div></div></td>
      <td>${rolePill(u.role)}</td>
      <td>${u.status === 'active' ? `<span class="pill ok">${esc(t('active'))}</span>` : `<span class="pill role-admin">${esc(t('disabled'))}</span>`}</td>
      <td><span class="dot ${u.online ? 'on' : 'gone'}" title="${u.online ? esc(t('online')) : ''}"></span></td>
      <td class="cell-date">${esc(fmtDate(u.createdAt))}</td>
      <td><div class="actions" data-stop="1">
        <select class="sel sm role-select" data-uid="${esc(u.id)}" aria-label="${esc(t('changeRole'))}">
          ${['blind', 'helper', 'family', 'admin', 'developer'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(roleName(r))}</option>`).join('')}
        </select>
        ${u.status === 'active'
          ? `<button class="btn danger sm" data-act="ban" data-uid="${esc(u.id)}">${esc(t('ban'))}</button>`
          : `<button class="btn sm" data-act="unban" data-uid="${esc(u.id)}">${esc(t('unban'))}</button>`}
      </div></td>
    </tr>`).join('');
  viewEl().innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="q" type="search" placeholder="${esc(t('search'))}" value="${esc(state.usersQuery)}" /></div>
      <select class="sel" id="fRole">${roleOpts}</select>
      <select class="sel" id="fStatus">${statusOpts}</select>
      <button class="btn ghost" data-action="reloadUsers">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportUsers" ${list.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    <div class="table-wrap">
      ${list.length ? `<table><thead><tr>
        <th>${esc(t('users'))}</th><th>${esc(t('role'))}</th><th>${esc(t('status'))}</th><th>${esc(t('lastActive'))}</th><th>${esc(t('created'))}</th><th class="ta-end">${esc(t('actions'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">🗂️</div><p>${esc(t('noUsers'))}</p></div>`}
    </div>`;
  $('#q').addEventListener('input', (e) => { state.usersQuery = e.target.value; renderUsers(); $('#q').focus(); });
  $('#fRole').addEventListener('change', (e) => { state.usersRole = e.target.value; renderUsers(); });
  $('#fStatus').addEventListener('change', (e) => { state.usersStatus = e.target.value; renderUsers(); });
  viewEl().querySelector('[data-action="reloadUsers"]').addEventListener('click', loadUsers);
  viewEl().querySelector('[data-action="exportUsers"]').addEventListener('click', () => {
    const yn = (b) => (b ? (state.lang === 'en' ? 'yes' : '是') : (state.lang === 'en' ? 'no' : '否'));
    downloadCSV('beeurei-users.csv', [
      [t('username'), '@', t('role'), t('status'), t('email'), t('verified'), t('phone'), t('appleId'), t('language'), t('online'), t('created')],
      ...filteredUsers().map((u) => [u.displayName || '', u.username, roleName(u.role), u.status === 'active' ? t('active') : t('disabled'), yn(u.hasEmail), yn(u.emailVerified), yn(u.hasPhone), yn(u.appleLinked), u.language || '', yn(u.online), fmtDate(u.createdAt)]),
    ]);
  });
  viewEl().querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return; openUserDrawer(tr.dataset.uid);
  }));
  viewEl().querySelectorAll('.role-select').forEach((s) => s.addEventListener('change', (e) => onRoleChange(e.target.dataset.uid, e.target.value, e.target)));
  viewEl().querySelectorAll('[data-act="ban"]').forEach((b) => b.addEventListener('click', () => onStatus(b.dataset.uid, 'disabled')));
  viewEl().querySelectorAll('[data-act="unban"]').forEach((b) => b.addEventListener('click', () => onStatus(b.dataset.uid, 'active')));
}
async function onRoleChange(uid, role, selectEl) {
  const u = state.users.find((x) => x.id === uid); if (!u || u.role === role) return;
  if (!(await confirmDialog(t('confirmRole').replace('%s', roleName(role))))) { if (selectEl) selectEl.value = u.role; return; }
  try {
    const r = await api(`/api/admin/users/${uid}/role`, { method: 'POST', body: { role } });
    u.role = r.user.role; toast(t('roleChanged'), 'success'); renderUsers();
  } catch (err) { if (selectEl) selectEl.value = u.role; toast(errText(err.code), 'error'); }
}
async function onStatus(uid, status) {
  if (!(await confirmDialog(status === 'disabled' ? t('confirmBan') : t('confirmUnban')))) return;
  try {
    const r = await api(`/api/admin/users/${uid}/status`, { method: 'POST', body: { status } });
    const u = state.users.find((x) => x.id === uid); if (u) u.status = r.user.status;
    toast(status === 'disabled' ? t('banned') : t('unbanned'), 'success'); renderUsers();
  } catch (err) { toast(errText(err.code), 'error'); }
}

// ---------------------------------------------------------------- user drawer
async function openUserDrawer(uid) {
  const mask = document.createElement('div'); mask.className = 'drawer-mask';
  const drawer = document.createElement('aside'); drawer.className = 'drawer'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true');
  drawer.innerHTML = `<div class="drawer-head"><b>${esc(t('detail'))}</b><div class="grow1"></div><button class="btn ghost sm" data-close>${esc(t('close'))}</button></div><div class="drawer-body"><div class="loading"><span class="spinner"></span></div></div>`;
  document.body.appendChild(mask); document.body.appendChild(drawer);
  const close = () => { mask.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  mask.addEventListener('click', close);
  drawer.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  try {
    const d = await api(`/api/admin/users/${uid}`);
    const u = d.user; // 客服操作后就地改写本对象并重绘，避免整页刷新
    const body = drawer.querySelector('.drawer-body');
    const linksHTML = (d.links || []).map((l) => `<div class="mini"><b>${esc(l.otherName)}</b> · ${esc(l.relation || '—')} ${l.isEmergency ? '· ⚠️' : ''} <span class="pill ${l.status === 'accepted' ? 'ok' : 'off'} fr">${esc(l.status === 'accepted' ? (state.lang === 'en' ? 'linked' : '已绑定') : (state.lang === 'en' ? 'pending' : '待确认'))}</span></div>`).join('') || `<div class="mini text-faint">—</div>`;
    const callsHTML = (d.recentCalls || []).map((c) => `<div class="mini">${esc(t('dir')[c.direction] || c.direction)} · ${esc(c.peerName)} · <span class="text-dim">${esc(t('callStatus')[c.status] || c.status)}</span><span class="when">${esc(fmtDate(c.createdAt))}</span></div>`).join('') || `<div class="empty pad"><p>${esc(t('noCalls'))}</p></div>`;
    function supportButtons() {
      const btns = [];
      if (u.email) btns.push(`<button class="btn sm" data-sup="verify">${esc(u.emailVerified ? t('markUnverified') : t('markVerified'))}</button>`);
      if (u.appleLinked) btns.push(`<button class="btn sm" data-sup="unlink">${esc(t('unlinkApple'))}</button>`);
      if (u.passkeys > 0) btns.push(`<button class="btn sm" data-sup="clearpk">${esc(t('clearPasskeys'))}</button>`);
      btns.push(`<button class="btn danger sm" data-sup="logout">${esc(t('forceLogout'))}</button>`);
      return btns.join('');
    }
    function paint() {
      body.innerHTML = `
        <div class="user-cell drawer-user">${avatarHTML(u, true)}<div><div class="nm">${esc(u.displayName || '—')}</div><div class="un">@${esc(u.username)}</div></div></div>
        <dl class="kv">
          <dt>${esc(t('role'))}</dt><dd>${rolePill(u.role)}</dd>
          <dt>${esc(t('status'))}</dt><dd>${u.status === 'active' ? `<span class="pill ok">${esc(t('active'))}</span>` : `<span class="pill role-admin">${esc(t('disabled'))}</span>`}</dd>
          <dt>${esc(t('online2'))}</dt><dd><span class="dot ${u.online ? 'on' : 'gone'}"></span> ${u.online ? esc(t('online')) : '—'}</dd>
          <dt>${esc(t('email'))}</dt><dd>${u.email ? esc(u.email) + (u.emailVerified ? ` <span class="pill ok">${esc(t('verified'))}</span>` : ` <span class="pill off">${esc(t('notVerified'))}</span>`) : `<span class="text-faint">${esc(t('none'))}</span>`}</dd>
          <dt>${esc(t('phone'))}</dt><dd>${u.phone ? esc(u.phone) : `<span class="text-faint">${esc(t('none'))}</span>`}</dd>
          <dt>${esc(t('language'))}</dt><dd>${u.language ? esc(u.language) : '—'}</dd>
          <dt>${esc(t('appleId'))}</dt><dd>${u.appleLinked ? esc(t('linked')) : `<span class="text-faint">${esc(t('notLinked'))}</span>`}</dd>
          <dt>${esc(t('passkeys'))}</dt><dd>${u.passkeys || 0}</dd>
          <dt>${esc(t('blockedRelations'))}</dt><dd>${d.blockedCount || 0}</dd>
          <dt>${esc(t('created'))}</dt><dd>${esc(fmtDate(u.createdAt))}</dd>
        </dl>
        <div class="section"><h3>${esc(t('support'))}</h3><div class="support">${supportButtons()}</div></div>
        <div class="section"><h3>${esc(t('linkedRelations'))} (${(d.links || []).length})</h3><div class="mini-list">${linksHTML}</div></div>
        <div class="section"><h3>${esc(t('recentCalls'))}</h3><div class="mini-list">${callsHTML}</div></div>`;
      body.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', () => onSupport(b.dataset.sup, u, paint)));
    }
    paint();
  } catch (err) {
    drawer.querySelector('.drawer-body').innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`;
  }
}
// 客服操作：确认 → 调接口 → 就地更新内存中的 user 字段 → 重绘抽屉 + 顶部统计/列表保持一致。
async function onSupport(action, u, repaint) {
  try {
    if (action === 'verify') {
      const next = !u.emailVerified;
      if (!(await confirmDialog(next ? t('confirmMarkVerified') : t('confirmMarkUnverified')))) return;
      const r = await api(`/api/admin/users/${u.id}/verify-email`, { method: 'POST', body: { verified: next } });
      u.emailVerified = !!r.emailVerified;
      const su = state.users.find((x) => x.id === u.id); if (su) su.emailVerified = u.emailVerified;
      toast(u.emailVerified ? t('emailMarkedVerified') : t('emailMarkedUnverified'), 'success');
    } else if (action === 'unlink') {
      if (!(await confirmDialog(t('confirmUnlinkApple')))) return;
      await api(`/api/admin/users/${u.id}/unlink-apple`, { method: 'POST' });
      u.appleLinked = false;
      const su = state.users.find((x) => x.id === u.id); if (su) su.appleLinked = false;
      toast(t('appleUnlinked'), 'success');
    } else if (action === 'clearpk') {
      if (!(await confirmDialog(t('confirmClearPasskeys')))) return;
      const r = await api(`/api/admin/users/${u.id}/clear-passkeys`, { method: 'POST' });
      const n = u.passkeys || 0; u.passkeys = r.passkeys || 0;
      toast(t('passkeysCleared').replace('%s', String(r.cleared ?? n)), 'success');
    } else if (action === 'logout') {
      if (!(await confirmDialog(t('confirmForceLogout')))) return;
      await api(`/api/admin/users/${u.id}/force-logout`, { method: 'POST' });
      toast(t('forcedLogout'), 'success');
    }
    if (typeof repaint === 'function') repaint();
    if (currentRoute() === 'users') renderUsers();
  } catch (err) { toast(errText(err.code), 'error'); }
}

// ---------------------------------------------------------------- csv export
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  // 前置 BOM：Excel 据此识别 UTF-8，避免中文乱码。
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- relationships (links)
async function loadLinks() {
  showLoading();
  try { state.links = (await api('/api/admin/links')).links || []; renderLinks(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function filteredLinks() {
  const q = state.linksQuery.trim().toLowerCase();
  const list = q ? state.links.filter((l) => (l.ownerName || '').toLowerCase().includes(q) || (l.memberName || '').toLowerCase().includes(q)) : state.links;
  return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function linkStatusPill(s) {
  const map = { accepted: ['ok', t('linkAccepted')], pending: ['off', t('linkPending')], declined: ['role-admin', t('linkDeclined')] };
  const [cls, label] = map[s] || ['off', s];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}
function renderLinks() {
  const list = filteredLinks();
  const rows = list.map((l) => `
    <tr>
      <td><div class="nm">${esc(l.ownerName)}</div><div class="un">${esc(roleName(l.ownerRole) || '—')}</div></td>
      <td><div class="nm">${esc(l.memberName)}</div><div class="un">${esc(roleName(l.memberRole) || '—')}</div></td>
      <td>${esc(l.relation || '—')}</td>
      <td>${l.isEmergency ? `<span class="pill role-admin">⚠️ ${esc(t('emergency'))}</span>` : '—'}</td>
      <td>${linkStatusPill(l.status)}</td>
      <td class="cell-date">${esc(fmtDate(l.createdAt))}</td>
    </tr>`).join('');
  viewEl().innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="lq" type="search" placeholder="${esc(t('searchLinks'))}" value="${esc(state.linksQuery)}" /></div>
      <button class="btn ghost" data-action="reloadLinks">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportLinks" ${list.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    <div class="table-wrap">
      ${list.length ? `<table><thead><tr>
        <th>${esc(t('owner'))}</th><th>${esc(t('member'))}</th><th>${esc(t('relationCol'))}</th><th>${esc(t('emergency'))}</th><th>${esc(t('status'))}</th><th>${esc(t('created'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">🔗</div><p>${esc(t('noLinks'))}</p></div>`}
    </div>`;
  $('#lq').addEventListener('input', (e) => { state.linksQuery = e.target.value; renderLinks(); $('#lq').focus(); });
  viewEl().querySelector('[data-action="reloadLinks"]').addEventListener('click', loadLinks);
  viewEl().querySelector('[data-action="exportLinks"]').addEventListener('click', () => {
    downloadCSV('beeurei-relationships.csv', [
      [t('owner'), t('role'), t('member'), t('role'), t('relationCol'), t('emergency'), t('status'), t('created')],
      ...filteredLinks().map((l) => [l.ownerName, roleName(l.ownerRole), l.memberName, roleName(l.memberRole), l.relation || '', l.isEmergency ? 'yes' : 'no', l.status, fmtDate(l.createdAt)]),
    ]);
  });
}

// ---------------------------------------------------------------- calls (site-wide)
async function loadCalls() {
  showLoading();
  try { state.calls = (await api('/api/admin/calls?limit=300')).calls || []; renderCalls(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function filteredCalls() {
  const q = state.callsQuery.trim().toLowerCase();
  return q ? state.calls.filter((c) => (c.callerName || '').toLowerCase().includes(q) || (c.calleeName || '').toLowerCase().includes(q)) : state.calls;
}
function callStatusName(s) { return (I18N[state.lang].callStatus[s]) || s; }
function renderCalls() {
  const list = filteredCalls();
  const rows = list.map((c) => `
    <tr>
      <td><div class="nm">${esc(c.callerName)}</div></td>
      <td><span class="arrow">→</span></td>
      <td><div class="nm">${esc(c.calleeName)}</div></td>
      <td>${esc(callStatusName(c.status))}</td>
      <td class="cell-date">${esc(fmtDate(c.createdAt))}</td>
    </tr>`).join('');
  viewEl().innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="cq" type="search" placeholder="${esc(t('searchCalls'))}" value="${esc(state.callsQuery)}" /></div>
      <button class="btn ghost" data-action="reloadCalls">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportCalls" ${list.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    <div class="table-wrap">
      ${list.length ? `<table><thead><tr>
        <th>${esc(t('caller'))}</th><th></th><th>${esc(t('callee'))}</th><th>${esc(t('status'))}</th><th>${esc(t('time'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">📞</div><p>${esc(t('noCalls'))}</p></div>`}
    </div>`;
  $('#cq').addEventListener('input', (e) => { state.callsQuery = e.target.value; renderCalls(); $('#cq').focus(); });
  viewEl().querySelector('[data-action="reloadCalls"]').addEventListener('click', loadCalls);
  viewEl().querySelector('[data-action="exportCalls"]').addEventListener('click', () => {
    downloadCSV('beeurei-calls.csv', [
      [t('caller'), t('callee'), t('status'), t('time')],
      ...filteredCalls().map((c) => [c.callerName, c.calleeName, callStatusName(c.status), fmtDate(c.createdAt)]),
    ]);
  });
}

// ---------------------------------------------------------------- blocks (site-wide)
async function loadBlocks() {
  showLoading();
  try { state.blocks = (await api('/api/admin/blocks')).blocks || []; renderBlocks(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function filteredBlocks() {
  const q = state.blocksQuery.trim().toLowerCase();
  return q ? state.blocks.filter((b) => (b.blockerName || '').toLowerCase().includes(q) || (b.blockedName || '').toLowerCase().includes(q)) : state.blocks;
}
function renderBlocks() {
  const list = filteredBlocks();
  const rows = list.map((b) => `
    <tr>
      <td><div class="nm">${esc(b.blockerName)}</div></td>
      <td><span class="arrow">🚫</span></td>
      <td><div class="nm">${esc(b.blockedName)}</div></td>
      <td class="cell-date">${esc(fmtDate(b.createdAt))}</td>
    </tr>`).join('');
  viewEl().innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="bq" type="search" placeholder="${esc(t('searchBlocks'))}" value="${esc(state.blocksQuery)}" /></div>
      <button class="btn ghost" data-action="reloadBlocks">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportBlocks" ${list.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    <div class="table-wrap">
      ${list.length ? `<table><thead><tr>
        <th>${esc(t('blocker'))}</th><th></th><th>${esc(t('blocked'))}</th><th>${esc(t('time'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">🚫</div><p>${esc(t('noBlocks'))}</p></div>`}
    </div>`;
  $('#bq').addEventListener('input', (e) => { state.blocksQuery = e.target.value; renderBlocks(); $('#bq').focus(); });
  viewEl().querySelector('[data-action="reloadBlocks"]').addEventListener('click', loadBlocks);
  viewEl().querySelector('[data-action="exportBlocks"]').addEventListener('click', () => {
    downloadCSV('beeurei-blocks.csv', [
      [t('blocker'), t('blocked'), t('time')],
      ...filteredBlocks().map((b) => [b.blockerName, b.blockedName, fmtDate(b.createdAt)]),
    ]);
  });
}

// ---------------------------------------------------------------- reports
async function loadReports() {
  showLoading();
  try { state.reports = (await api('/api/admin/reports')).reports || []; renderReports(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function renderReports() {
  const open = state.reports.filter((r) => r.status === 'open');
  const resolved = state.reports.filter((r) => r.status !== 'open');
  const row = (r) => `
    <div class="rep">
      <div class="body">
        <div class="who">${esc(r.reporterName)} <span class="arrow">→</span> ${esc(r.targetName)}</div>
        <div class="reason">${esc(r.reason || '—')}</div>
        <div class="meta">${esc(fmtDate(r.createdAt))}${r.callId ? ' · call ' + esc(r.callId.slice(0, 8)) : ''}</div>
      </div>
      ${r.status === 'open'
        ? `<button class="btn sm primary" data-resolve="${esc(r.id)}">${esc(t('resolve'))}</button>`
        : `<span class="pill ok">${esc(t('resolved'))}</span>`}
    </div>`;
  viewEl().innerHTML = !state.reports.length
    ? `<div class="empty"><div class="ico">✅</div><p>${esc(t('noReports'))}</p></div>`
    : `${open.length ? `<div class="section"><h3>${esc(t('open'))} (${open.length})</h3><div class="table-wrap">${open.map(row).join('')}</div></div>` : ''}
       ${resolved.length ? `<div class="section"><h3>${esc(t('resolved'))} (${resolved.length})</h3><div class="table-wrap">${resolved.map(row).join('')}</div></div>` : ''}`;
  viewEl().querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/admin/reports/${b.dataset.resolve}/resolve`, { method: 'POST' }); toast(t('reportResolved'), 'success'); loadReports(); loadOverviewBadge(); }
    catch (err) { toast(errText(err.code), 'error'); }
  }));
}

// ---------------------------------------------------------------- recordings
async function loadRecordings() {
  showLoading();
  try {
    state.recConfig = await api('/api/recordings/config');
    state.recordings = (await api('/api/recordings')).recordings || [];
    renderRecordings();
  } catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function renderRecordings() {
  const c = state.recConfig || { enabled: false, requireConsent: true, retentionDays: 30 };
  const recRows = state.recordings.map((r) => `
    <div class="rep"><div class="body"><div class="who">call ${esc((r.callId || '').slice(0, 12))}</div>
      <div class="meta">${esc(fmtDate(r.recordedAt))}${r.reason ? ' · ' + esc(r.reason) : ''}</div></div>
      <button class="btn danger sm" data-delrec="${esc(r.id)}">${esc(t('deleteRec'))}</button></div>`).join('');
  viewEl().innerHTML = `
    <div class="section"><h3>${esc(t('recPolicy'))}</h3>
      <div class="card">
        <div class="form-row"><div><div class="lab">${esc(t('allowRecording'))}</div><div class="desc">${esc(t('allowRecordingDesc'))}</div></div>
          <label class="switch"><input type="checkbox" id="cEnabled" ${c.enabled ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="form-row"><div><div class="lab">${esc(t('requireConsent'))}</div><div class="desc">${esc(t('requireConsentDesc'))}</div></div>
          <label class="switch"><input type="checkbox" id="cConsent" ${c.requireConsent ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="form-row"><div><div class="lab">${esc(t('retentionDays'))}</div><div class="desc">${esc(t('retentionDesc'))}</div></div>
          <div><input class="num" type="number" id="cDays" min="1" max="3650" value="${Number(c.retentionDays) || 30}"/> <span class="days-unit">${esc(t('days'))}</span></div></div>
        <div class="save-row"><button class="btn primary" id="saveRec">${esc(t('save'))}</button></div>
      </div>
    </div>
    <div class="section"><h3>${esc(t('recList'))} (${state.recordings.length})</h3>
      <div class="table-wrap">${state.recordings.length ? recRows : `<div class="empty"><div class="ico">⏺</div><p>${esc(t('noRecordings'))}</p></div>`}</div>
    </div>`;
  $('#saveRec').addEventListener('click', async () => {
    const body = { enabled: $('#cEnabled').checked, requireConsent: $('#cConsent').checked, retentionDays: Math.max(1, Math.min(3650, Number($('#cDays').value) || 30)) };
    try { state.recConfig = await api('/api/recordings/config', { method: 'PUT', body }); toast(t('saved'), 'success'); }
    catch (err) { toast(errText(err.code), 'error'); }
  });
  viewEl().querySelectorAll('[data-delrec]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(t('confirmDeleteRec')))) return;
    try { await api(`/api/recordings/${b.dataset.delrec}`, { method: 'DELETE' }); loadRecordings(); }
    catch (err) { toast(errText(err.code), 'error'); }
  }));
}

// keep the reports badge fresh after resolving
async function loadOverviewBadge() { try { state.overview = await api('/api/admin/overview'); renderChrome(); route(); } catch {} }

// ---------------------------------------------------------------- confirm dialog
function confirmDialog(message) {
  return new Promise((resolve) => {
    const mask = document.createElement('div'); mask.className = 'drawer-mask'; mask.style.zIndex = '70';
    const box = document.createElement('div');
    box.className = 'modal-overlay';
    box.innerHTML = `<div class="card confirm-card" role="alertdialog" aria-modal="true">
      <p class="confirm-msg">${esc(message)}</p>
      <div class="confirm-actions">
        <button class="btn" data-no>${esc(state.lang === 'en' ? 'Cancel' : '取消')}</button>
        <button class="btn ink" data-yes>${esc(state.lang === 'en' ? 'Confirm' : '确认')}</button>
      </div></div>`;
    document.body.appendChild(mask); document.body.appendChild(box);
    const done = (v) => { mask.remove(); box.remove(); resolve(v); };
    mask.addEventListener('click', () => done(false));
    box.querySelector('[data-no]').addEventListener('click', () => done(false));
    box.querySelector('[data-yes]').addEventListener('click', () => done(true));
    box.querySelector('[data-yes]').focus();
  });
}

// ---------------------------------------------------------------- router + boot
function route() {
  const r = currentRoute();
  if (r === '') loadDashboard();
  else if (r === 'users') loadUsers();
  else if (r === 'relationships') loadLinks();
  else if (r === 'calls') loadCalls();
  else if (r === 'blocks') loadBlocks();
  else if (r === 'reports') loadReports();
  else if (r === 'recordings') loadRecordings();
}
function render() {
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-Hans';
  applyTheme();
  if (!state.token) { renderLogin(); return; }
  renderChrome();
  route();
}
window.addEventListener('hashchange', () => { if (state.token) { renderChrome(); route(); } });
render();
