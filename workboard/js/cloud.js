'use strict';
// Shared (online) version: sign-in, workspaces, saving to Supabase and live updates
// from other people. It switches itself on only when config.js has a Supabase address and key;
// otherwise the app keeps everything in this browser, as before.
(() => {
  const cfg = window.WB_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return;
  WB.mode = 'cloud';

  const LIB =
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
  const LIB_SRI =
    'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
  const LAST_WS = 'workboard.cloud.workspace';
  const PENDING_JOIN = 'workboard.cloud.join';
  const esc = WB.esc;
  const $ = (s) => document.querySelector(s);
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {
        /* private window: nothing to remember */
      }
    },
  };

  let sb = null; // the Supabase client
  let session = null;
  let ws = null; // { id, name, invite_code, role }
  let workspaces = []; // [{ id, name, role }]
  let channel = null;
  let base = {}; // table key -> Map(id -> row as the server has it)
  let queue = Promise.resolve();
  let started = false;
  let recovering = false;
  let lastLoad = 0;
  let renderTimer = 0;
  let status = { state: 'ok', text: '' };
  const inflight = new Map();
  const deferred = new Map();
  const generated = new Set();

  // ---------- table <-> app object ----------
  const iso = (s) => (s ? new Date(s).toISOString() : null);
  const local = (v) => (v ? WB.stamp(new Date(v)) : '');
  const TABLES = [
    {
      key: 'departments',
      table: 'departments',
      to: (x) => ({ id: x.id, workspace_id: ws.id, name: x.name }),
      from: (r) => ({ id: r.id, name: r.name }),
    },
    {
      key: 'projects',
      table: 'projects',
      to: (x) => ({
        id: x.id,
        workspace_id: ws.id,
        kind: x.kind,
        name: x.name,
        dept_id: x.deptId || null,
        admin_id: x.adminId || null,
        member_ids: x.memberIds || [],
        type: x.type || 'internal',
        review: !!x.review,
        private: !!x.private,
        start_date: x.start || null,
        end_date: x.end || null,
        stage: x.stage || 'plan',
        description: x.desc || '',
        color: x.color,
      }),
      from: (r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        deptId: r.dept_id || '',
        adminId: r.admin_id || '',
        memberIds: r.member_ids || [],
        type: r.type,
        review: r.review,
        private: r.private,
        start: r.start_date || '',
        end: r.end_date || '',
        stage: r.stage,
        desc: r.description || '',
        color: r.color,
      }),
    },
    {
      key: 'tasklists',
      table: 'tasklists',
      to: (x) => ({
        id: x.id,
        workspace_id: ws.id,
        project_id: x.projectId,
        name: x.name,
        position: x.order || 0,
      }),
      from: (r) => ({
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        order: r.position,
      }),
    },
    {
      key: 'milestones',
      table: 'milestones',
      to: (x) => ({
        id: x.id,
        workspace_id: ws.id,
        project_id: x.projectId,
        name: x.name,
        due_date: x.due || null,
      }),
      from: (r) => ({
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        due: r.due_date || '',
      }),
    },
    {
      key: 'fields',
      table: 'custom_fields',
      to: (x) => ({
        id: x.id,
        workspace_id: ws.id,
        project_id: x.projectId,
        name: x.name,
        type: x.type,
        options: x.options || [],
        required: !!x.required,
        position: x.order || 0,
      }),
      from: (r) => ({
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        type: r.type,
        options: r.options || [],
        required: r.required,
        order: r.position,
      }),
    },
    {
      key: 'repeats',
      table: 'repeat_rules',
      to: (x) => ({
        id: x.id,
        workspace_id: ws.id,
        project_id: x.projectId,
        tasklist_id: x.tasklistId || null,
        name: x.name,
        description: x.desc || '',
        assignee_id: x.assigneeId || null,
        follower_ids: x.followerIds || [],
        freq: x.freq,
        every: +x.every || 1,
        weekdays: (x.weekdays || []).map(Number),
        month_day: String(x.monthDay || 1),
        start_date: x.start,
        end_date: x.end || null,
        due_time: x.dueTime || null,
        important: !!x.important,
        urgent: !!x.urgent,
        checklist: x.checklist || [],
        subtasks: x.subtasks || [],
        enabled: !!x.enabled,
        last_run: x.lastRun || null,
        created_by: x.createdBy || null,
      }),
      from: (r) => ({
        id: r.id,
        projectId: r.project_id,
        tasklistId: r.tasklist_id || '',
        name: r.name,
        desc: r.description || '',
        assigneeId: r.assignee_id || '',
        followerIds: r.follower_ids || [],
        freq: r.freq,
        every: r.every,
        weekdays: r.weekdays || [],
        monthDay: r.month_day === 'last' ? 'last' : +r.month_day,
        start: r.start_date,
        end: r.end_date || '',
        dueTime: r.due_time ? r.due_time.slice(0, 5) : '',
        important: r.important,
        urgent: r.urgent,
        checklist: r.checklist || [],
        subtasks: r.subtasks || [],
        enabled: r.enabled,
        lastRun: r.last_run || '',
        createdBy: r.created_by || '',
      }),
    },
    {
      key: 'tasks',
      table: 'tasks',
      to: (t) => ({
        id: t.id,
        workspace_id: ws.id,
        project_id: t.projectId,
        tasklist_id: t.tasklistId || null,
        parent_id: t.parentId || null,
        name: t.name,
        description: t.desc || '',
        assignee_id: t.assigneeId || null,
        follower_ids: t.followerIds || [],
        start_date: t.start || null,
        due_date: t.due ? t.due.slice(0, 10) : null,
        due_time: t.due && t.due.length > 10 ? t.due.slice(11, 16) : null,
        important: !!t.important,
        urgent: !!t.urgent,
        milestone_id: t.milestoneId || null,
        checklist: t.checklist || [],
        depends_on: t.dependsOn || [],
        result: t.result || '',
        status: t.status,
        done_at: iso(t.doneAt),
        submitted_at: iso(t.submittedAt),
        created_by: t.createdBy || null,
        created_at: iso(t.createdAt),
        position: t.order || 0,
        custom: t.custom || {},
        repeat_id: t.repeatId || null,
        repeat_date: t.repeatDate || null,
      }),
      from: (r) => ({
        ...WB.blankTask(),
        id: r.id,
        projectId: r.project_id,
        tasklistId: r.tasklist_id || '',
        parentId: r.parent_id || '',
        name: r.name,
        desc: r.description || '',
        assigneeId: r.assignee_id || '',
        followerIds: r.follower_ids || [],
        start: r.start_date || '',
        due: r.due_date
          ? r.due_date + (r.due_time ? 'T' + r.due_time.slice(0, 5) : '')
          : '',
        important: r.important,
        urgent: r.urgent,
        milestoneId: r.milestone_id || '',
        checklist: r.checklist || [],
        dependsOn: r.depends_on || [],
        result: r.result || '',
        status: r.status,
        doneAt: local(r.done_at),
        submittedAt: local(r.submitted_at),
        createdBy: r.created_by || '',
        createdAt: local(r.created_at),
        order: r.position,
        custom: r.custom || {},
        repeatId: r.repeat_id || '',
        repeatDate: r.repeat_date || '',
      }),
    },
    {
      key: 'comments',
      table: 'comments',
      to: (c) => ({
        id: c.id,
        workspace_id: ws.id,
        task_id: c.taskId,
        user_id: c.userId,
        body: c.text,
        created_at: iso(c.at),
      }),
      from: (r) => ({
        id: r.id,
        taskId: r.task_id,
        userId: r.user_id || '',
        text: r.body,
        at: local(r.created_at),
      }),
    },
    {
      key: 'activity',
      table: 'activity',
      to: (a) => ({
        id: a.id,
        workspace_id: ws.id,
        task_id: a.taskId,
        user_id: a.userId,
        text: a.text,
        created_at: iso(a.at),
      }),
      from: (r) => ({
        id: r.id,
        taskId: r.task_id,
        userId: r.user_id || '',
        text: r.text,
        at: local(r.created_at),
      }),
    },
    {
      key: 'notifications',
      table: 'notifications',
      to: (n) => ({
        id: n.id,
        workspace_id: ws.id,
        user_id: n.userId,
        actor_id: n.actorId || null,
        task_id: n.taskId,
        kind: n.kind,
        text: n.text || '',
        read: !!n.read,
        created_at: iso(n.at),
      }),
      from: (r) => ({
        id: r.id,
        userId: r.user_id,
        actorId: r.actor_id || '',
        taskId: r.task_id,
        kind: r.kind,
        text: r.text || '',
        at: local(r.created_at),
        read: r.read,
      }),
    },
    {
      key: 'templates',
      table: 'templates',
      to: (x) => ({
        id: x.id,
        workspace_id: ws.id,
        name: x.name,
        description: x.desc || '',
        kind: x.kind || 'project',
        data: x.data || {},
        created_by: x.createdBy || session.user.id,
      }),
      from: (r) => ({
        id: r.id,
        name: r.name,
        desc: r.description || '',
        kind: r.kind,
        data: r.data || {},
        createdBy: r.created_by || '',
      }),
    },
  ];
  const byTable = Object.fromEntries(TABLES.map((d) => [d.table, d]));
  // Changes to these are only ever added, never edited, so they go out as plain inserts.
  const INSERT_ONLY = new Set(['comments', 'activity', 'notifications']);

  // ---------- messages ----------
  function message(err) {
    const m =
      (err && (err.message || err.error_description || err.msg)) ||
      String(err || '');
    const code = err && err.code;
    if (code === '42501' && !/[À-ỹ]/.test(m))
      return 'Bạn không có quyền làm việc này.';
    if (/row-level security|permission denied/i.test(m))
      return 'Bạn không có quyền làm việc này.';
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m))
      return 'Mất kết nối mạng. Hãy kiểm tra Internet rồi thử lại.';
    if (/Invalid login credentials/i.test(m))
      return 'Email hoặc mật khẩu không đúng.';
    if (/Email not confirmed/i.test(m))
      return 'Email chưa được xác nhận. Hãy mở email và bấm vào đường link xác nhận trước.';
    if (/already registered|already been registered/i.test(m))
      return 'Email này đã có tài khoản. Hãy đăng nhập.';
    if (/Password should be at least/i.test(m))
      return 'Mật khẩu quá ngắn. Hãy dùng ít nhất 6 ký tự.';
    if (/weak.?password|pwned/i.test(m))
      return 'Mật khẩu quá dễ đoán. Hãy chọn mật khẩu khác.';
    if (/rate limit|too many|429/i.test(m))
      return 'Có quá nhiều yêu cầu trong thời gian ngắn. Hãy thử lại sau ít phút.';
    if (/not authorized/i.test(m))
      return 'Hệ thống chưa gửi được email tới địa chỉ này: máy chủ email của Supabase chưa được cài đặt cho mọi người.';
    if (/Unable to validate email|invalid format|invalid email/i.test(m))
      return 'Email không hợp lệ.';
    if (/Signups not allowed|signup.*disabled/i.test(m))
      return 'Đăng ký tài khoản mới đang bị tắt.';
    if (/expired|invalid.*(link|token|otp)/i.test(m))
      return 'Đường link đã hết hạn hoặc đã được dùng. Hãy yêu cầu lại.';
    if (/JWT|session/i.test(m))
      return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
    return m || 'Có lỗi xảy ra.';
  }
  async function check(promise) {
    const res = await promise;
    if (res.error) throw res.error;
    return res;
  }

  // ---------- sign-in screens ----------
  function authBox() {
    let box = $('#auth');
    if (!box) {
      box = document.createElement('div');
      box.id = 'auth';
      document.body.append(box);
    }
    return box;
  }
  let authView = { name: 'loading' };
  function showAuth(name, opts = {}) {
    authView = { name, ...opts };
    document.body.classList.add('auth-on');
    const box = authBox();
    const err = opts.error
      ? `<p class="warn" role="alert">${esc(opts.error)}</p>`
      : '';
    const note = opts.note
      ? `<p class="info" role="status">${esc(opts.note)}</p>`
      : '';
    const brand =
      '<div class="auth-brand"><span class="logo">W</span> WorkBoard</div>';
    const link = (view, text) =>
      `<button type="button" class="link" data-act="auth-view" data-view="${view}">${text}</button>`;
    let body = '';
    if (name === 'loading')
      body = `<p class="muted">${esc(opts.text || 'Đang tải…')}</p>`;
    else if (name === 'fatal')
      body = `<h1>Chưa mở được ứng dụng</h1>${err}<p class="muted small">Nếu bạn là người cài đặt: kiểm tra địa chỉ và khóa Supabase trong file config.js.</p><button class="btn" data-act="auth-retry">Thử lại</button>`;
    else if (name === 'signin')
      body = `<h1>Đăng nhập</h1>${err}${note}
        <form data-form="signin" class="auth-form">
          <label class="fld">Email<input class="inp" id="in-email" name="email" type="email" autocomplete="email" required value="${esc(opts.email || '')}" autofocus /></label>
          <label class="fld">Mật khẩu<input class="inp" id="in-pass" name="password" type="password" autocomplete="current-password" required /></label>
          <button class="btn primary wide-btn">Đăng nhập</button>
        </form>
        <p class="auth-links">${link('signup', 'Chưa có tài khoản? Đăng ký')} · ${link('forgot', 'Quên mật khẩu?')}</p>`;
    else if (name === 'signup')
      body = `<h1>Tạo tài khoản</h1>${err}
        <form data-form="signup" class="auth-form">
          <label class="fld">Họ và tên<input class="inp" id="up-name" name="name" required maxlength="120" autocomplete="name" autofocus /></label>
          <label class="fld">Email<input class="inp" id="up-email" name="email" type="email" autocomplete="email" required /></label>
          <label class="fld">Mật khẩu (ít nhất 6 ký tự)<input class="inp" id="up-pass" name="password" type="password" minlength="6" autocomplete="new-password" required /></label>
          <button class="btn primary wide-btn">Tạo tài khoản</button>
        </form>
        <p class="auth-links">${link('signin', 'Đã có tài khoản? Đăng nhập')}</p>`;
    else if (name === 'forgot')
      body = `<h1>Quên mật khẩu</h1>${err}${note}
        <form data-form="forgot" class="auth-form">
          <label class="fld">Email của bạn<input class="inp" id="fg-email" name="email" type="email" autocomplete="email" required autofocus /></label>
          <button class="btn primary wide-btn">Gửi đường link đặt lại mật khẩu</button>
        </form>
        <p class="auth-links">${link('signin', '‹ Quay lại đăng nhập')}</p>`;
    else if (name === 'newpass')
      body = `<h1>Đặt mật khẩu mới</h1>${err}
        <form data-form="newpass" class="auth-form">
          <label class="fld">Mật khẩu mới (ít nhất 6 ký tự)<input class="inp" id="np-pass" name="password" type="password" minlength="6" autocomplete="new-password" required autofocus /></label>
          <button class="btn primary wide-btn">Lưu mật khẩu</button>
        </form>`;
    else if (name === 'workspaces') {
      const code = opts.code || store.get(PENDING_JOIN) || '';
      body = `<h1>Không gian làm việc</h1>${err}${note}
        ${
          workspaces.length
            ? `<div class="ws-list">${workspaces
                .map(
                  (w) =>
                    `<button class="ws-pick" data-act="open-ws" data-id="${w.id}"><b>${esc(w.name)}</b><span class="muted small">${w.role === 'owner' ? 'Bạn là chủ sở hữu' : w.role === 'admin' ? 'Bạn là quản trị' : 'Thành viên'}</span></button>`,
                )
                .join('')}</div>`
            : '<p class="muted">Bạn chưa thuộc không gian làm việc nào. Hãy tạo mới, hoặc nhập mã mời mà người quản lý gửi cho bạn.</p>'
        }
        <form data-form="join-ws" class="auth-form inline-auth">
          <label class="fld">Có mã mời?<input class="inp" id="ws-code" name="code" required maxlength="40" value="${esc(code)}" placeholder="Ví dụ: 7F3A9C01B2D4" autocomplete="off" /></label>
          <button class="btn">Tham gia</button>
        </form>
        <form data-form="create-ws" class="auth-form inline-auth">
          <label class="fld">Hoặc tạo không gian mới<input class="inp" id="ws-name" name="name" required maxlength="120" placeholder="Tên công ty hoặc nhóm của bạn" /></label>
          <button class="btn primary">Tạo</button>
        </form>
        <p class="auth-links">Đang đăng nhập: ${esc(session && session.user ? session.user.email : '')} · <button type="button" class="link" data-act="sign-out">Đăng xuất</button></p>`;
    }
    box.innerHTML = `<div class="auth-card" role="main">${brand}${body}</div>`;
    const first = box.querySelector('[autofocus]');
    if (first) first.focus();
  }
  function hideAuth() {
    document.body.classList.remove('auth-on');
    authBox().innerHTML = '';
  }
  function busy(form, on) {
    if (!form) return;
    form.querySelectorAll('button, input').forEach((el) => (el.disabled = on));
  }

  // ---------- loading the library and the session ----------
  function loadLib() {
    if (window.supabase && window.supabase.createClient)
      return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.integrity = LIB_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () =>
        reject(
          new Error(
            'Không tải được thư viện Supabase. Hãy kiểm tra kết nối mạng rồi thử lại.',
          ),
        );
      document.head.append(s);
    });
  }
  // An invitation link looks like …#join-CODE. Keep the code until the person is signed in.
  function captureInvite() {
    const m = location.hash.match(/^#join-([A-Za-z0-9]{6,40})$/);
    if (m) {
      store.set(PENDING_JOIN, m[1].toUpperCase());
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
  function readLinkError() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const q = new URLSearchParams(location.search);
    const desc = h.get('error_description') || q.get('error_description');
    if (desc || h.get('error') || q.get('error')) {
      history.replaceState(null, '', location.pathname);
      return message({
        message: (desc || '').replace(/\+/g, ' ') || 'invalid link',
      });
    }
    return '';
  }

  async function start() {
    if (started) return;
    started = true;
    showAuth('loading');
    try {
      await loadLib();
    } catch (err) {
      started = false;
      return showAuth('fatal', { error: err.message });
    }
    captureInvite();
    const linkError = readLinkError();
    recovering = /type=recovery/.test(location.hash);
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    });
    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      // Run follow-up calls outside this callback, as the library asks.
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') {
          recovering = true;
          showAuth('newpass');
        } else if (event === 'SIGNED_OUT') signedOut();
      }, 0);
    });
    let res;
    try {
      res = await sb.auth.getSession();
    } catch (err) {
      return showAuth('signin', { error: message(err) });
    }
    session = res.data.session;
    if (/access_token|refresh_token/.test(location.hash))
      history.replaceState(null, '', location.pathname);
    if (recovering && session) return showAuth('newpass');
    if (!session)
      return showAuth('signin', {
        error: linkError,
        note: store.get(PENDING_JOIN)
          ? 'Hãy đăng nhập hoặc tạo tài khoản để vào không gian làm việc bạn được mời.'
          : '',
      });
    await afterSignIn();
  }

  async function loadWorkspaces() {
    const { data } = await check(
      sb
        .from('workspace_members')
        .select('role, workspaces(id, name, invite_code)')
        .eq('user_id', session.user.id),
    );
    workspaces = data
      .filter((r) => r.workspaces)
      .map((r) => ({
        id: r.workspaces.id,
        name: r.workspaces.name,
        invite_code: r.workspaces.invite_code,
        role: r.role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  async function afterSignIn() {
    showAuth('loading', { text: 'Đang mở không gian làm việc…' });
    try {
      await loadWorkspaces();
      const code = store.get(PENDING_JOIN);
      if (code) {
        store.set(PENDING_JOIN, null);
        try {
          const { data: id } = await check(
            sb.rpc('join_workspace', { p_code: code }),
          );
          await loadWorkspaces();
          return openWorkspace(
            id,
            'Bạn đã vào không gian làm việc qua đường link mời.',
          );
        } catch (err) {
          return showAuth('workspaces', { error: message(err), code });
        }
      }
      const last = store.get(LAST_WS);
      const pick =
        workspaces.find((w) => w.id === last) ||
        (workspaces.length === 1 ? workspaces[0] : null);
      if (pick) return openWorkspace(pick.id);
      showAuth('workspaces');
    } catch (err) {
      showAuth('fatal', { error: message(err) });
    }
  }

  // ---------- loading a workspace ----------
  async function fetchAll(table, build) {
    const out = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data } = await check(
        build(sb.from(table).select('*')).range(from, from + size - 1),
      );
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }
  async function fetchMembers() {
    const { data } = await check(
      sb
        .from('workspace_members')
        .select('user_id, role, profiles(id, name, title, color)')
        .eq('workspace_id', ws.id),
    );
    return data.map((r) => ({
      id: r.user_id,
      name: (r.profiles && r.profiles.name) || 'Chưa đặt tên',
      title: (r.profiles && r.profiles.title) || '',
      color: (r.profiles && r.profiles.color) || '#64748b',
      role: r.role,
    }));
  }
  async function loadData() {
    const me = session.user.id;
    const rows = await Promise.all(
      TABLES.map((d) => {
        if (d.key === 'notifications')
          return fetchAll(d.table, (q) =>
            q
              .eq('workspace_id', ws.id)
              .eq('user_id', me)
              .order('created_at', { ascending: false })
              .limit(500),
          );
        if (d.key === 'activity')
          return fetchAll(d.table, (q) =>
            q
              .eq('workspace_id', ws.id)
              .order('created_at', { ascending: false }),
          );
        return fetchAll(d.table, (q) =>
          q.eq('workspace_id', ws.id).order('id'),
        );
      }),
    );
    const users = await fetchMembers();
    const state = WB.blankState();
    state.users = users;
    state.me = me;
    base = {};
    TABLES.forEach((d, i) => {
      state[d.key] = rows[i].map(d.from);
      base[d.key] = new Map();
    });
    WB.state = state;
    TABLES.forEach((d) =>
      state[d.key].forEach((x) => base[d.key].set(x.id, d.to(x))),
    );
    lastLoad = Date.now();
  }
  async function openWorkspace(id, note) {
    const w = workspaces.find((x) => x.id === id);
    if (!w)
      return showAuth('workspaces', {
        error: 'Không tìm thấy không gian làm việc này.',
      });
    unsubscribe();
    ws = { ...w };
    store.set(LAST_WS, ws.id);
    showAuth('loading', { text: `Đang tải “${w.name}”…` });
    try {
      await loadData();
    } catch (err) {
      return showAuth('workspaces', { error: message(err) });
    }
    subscribe();
    hideAuth();
    const made = WB.runRepeats();
    if (made.length) push();
    WB.ui.taskId = '';
    WB.ui.modal = null;
    WB.ready();
    if (note) WB.toast(note);
  }
  async function reload() {
    if (!ws) return;
    try {
      const prev = WB.ui.taskId;
      await loadData();
      if (!WB.task(prev)) WB.ui.taskId = '';
      WB.render();
    } catch (err) {
      setStatus('error', message(err));
    }
  }
  function signedOut() {
    unsubscribe();
    ws = null;
    workspaces = [];
    WB.state = WB.blankState();
    showAuth('signin');
  }

  // ---------- saving changes ----------
  function setStatus(state, text = '') {
    status = { state, text };
    const el = $('#sync-state');
    if (el) {
      el.className = `sync ${state}`;
      el.textContent = statusText();
    }
  }
  const statusText = () =>
    status.state === 'saving'
      ? 'Đang lưu…'
      : status.state === 'error'
        ? `Chưa lưu được: ${status.text}`
        : status.state === 'offline'
          ? 'Mất kết nối, đang thử lại…'
          : 'Đã lưu';

  // Compare what the app holds with what the server has, and send only the differences.
  function push() {
    if (!ws || !session) return true;
    const plan = [];
    let any = false;
    for (const d of TABLES) {
      const old = base[d.key];
      const cur = new Map();
      WB.state[d.key].forEach((x) => cur.set(x.id, d.to(x)));
      const inserts = [];
      const updates = [];
      const deletes = [];
      cur.forEach((row, id) => {
        const prev = old.get(id);
        if (!prev) return inserts.push(row);
        const patch = {};
        let n = 0;
        for (const k of Object.keys(row))
          if (JSON.stringify(row[k]) !== JSON.stringify(prev[k])) {
            patch[k] = row[k];
            n++;
          }
        if (n) updates.push([id, patch]);
      });
      old.forEach((_, id) => !cur.has(id) && deletes.push(id));
      base[d.key] = cur;
      if (inserts.length || updates.length || deletes.length) {
        any = true;
        plan.push({ d, inserts, updates, deletes });
      }
    }
    if (!any) return true;
    const ids = plan.flatMap((p) => [
      ...p.inserts.map((r) => r.id),
      ...p.updates.map((u) => u[0]),
      ...p.deletes,
    ]);
    ids.forEach((id) => inflight.set(id, (inflight.get(id) || 0) + 1));
    setStatus('saving');
    queue = queue.then(() => send(plan, ids));
    return true;
  }
  async function send(plan, ids) {
    const regen = [];
    try {
      for (const { d, inserts } of plan) {
        if (!inserts.length) continue;
        const gen = inserts.filter((r) => generated.has(r.id));
        const normal = inserts.filter((r) => !generated.has(r.id));
        if (d.key === 'tasks')
          normal.sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0));
        for (let i = 0; i < normal.length; i += 500)
          await check(sb.from(d.table).insert(normal.slice(i, i + 500)));
        if (gen.length) {
          // Made by a repeat rule: another device may have made the same one already.
          await check(
            sb
              .from(d.table)
              .upsert(gen, { onConflict: 'id', ignoreDuplicates: true }),
          );
          regen.push([d, gen.map((r) => r.id)]);
        }
      }
      for (const { d, updates } of plan) {
        if (!updates.length) continue;
        if (INSERT_ONLY.has(d.key) && d.key !== 'notifications') continue;
        await Promise.all(
          updates.map(async ([id, patch]) => {
            const { data } = await check(
              sb.from(d.table).update(patch).eq('id', id).select('id'),
            );
            if (!data.length && d.key !== 'notifications')
              throw new Error(
                'Bạn không có quyền sửa mục này, hoặc nó đã bị người khác xóa.',
              );
          }),
        );
      }
      for (const { d, deletes } of [...plan].reverse()) {
        if (!deletes.length) continue;
        for (let i = 0; i < deletes.length; i += 200)
          await check(
            sb
              .from(d.table)
              .delete()
              .in('id', deletes.slice(i, i + 200)),
          );
      }
      for (const [d, list] of regen) {
        const { data } = await check(
          sb.from(d.table).select('*').in('id', list),
        );
        data.forEach((r) => applyRow(d, 'UPDATE', r));
        list.forEach((id) => generated.delete(id));
      }
      if (regen.length) scheduleRender();
      setStatus('ok');
    } catch (err) {
      const text = message(err);
      setStatus('error', text);
      WB.toast(`Chưa lưu được: ${text} Đang tải lại dữ liệu mới nhất…`);
      await reload();
    } finally {
      ids.forEach((id) => {
        const n = (inflight.get(id) || 1) - 1;
        if (n > 0) inflight.set(id, n);
        else {
          inflight.delete(id);
          const later = deferred.get(id);
          if (later) {
            deferred.delete(id);
            onChange(later);
          }
        }
      });
    }
  }

  // ---------- live updates ----------
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => WB.render(), 120);
  }
  function applyRow(d, type, row) {
    const list = WB.state[d.key];
    const i = list.findIndex((x) => x.id === row.id);
    if (type === 'DELETE') {
      if (i >= 0) list.splice(i, 1);
      base[d.key].delete(row.id);
      return;
    }
    const obj = d.from(row);
    if (i >= 0) list[i] = obj;
    else list.push(obj);
    base[d.key].set(row.id, d.to(obj));
  }
  async function onChange(payload) {
    if (!ws) return;
    const { table, eventType } = payload;
    const row = eventType === 'DELETE' ? payload.old : payload.new;
    if (!row) return;
    const me = session.user.id;
    if (table === 'workspace_members') {
      if (row.workspace_id && row.workspace_id !== ws.id) return;
      if (eventType === 'DELETE' && row.user_id === me) {
        WB.toast('Bạn không còn là thành viên của không gian làm việc này.');
        store.set(LAST_WS, null);
        unsubscribe();
        ws = null;
        await loadWorkspaces();
        return showAuth('workspaces');
      }
      WB.state.users = await fetchMembers();
      if (row.user_id === me) ws.role = (WB.me() || {}).role || ws.role;
      return scheduleRender();
    }
    if (table === 'profiles') {
      const u = WB.user(row.id);
      if (u && eventType !== 'DELETE')
        Object.assign(u, {
          name: row.name || u.name,
          title: row.title || '',
          color: row.color || u.color,
        });
      return scheduleRender();
    }
    if (table === 'workspaces') {
      if (row.id !== ws.id) return;
      if (eventType === 'DELETE') {
        store.set(LAST_WS, null);
        signedOutOfWorkspace('Không gian làm việc này đã bị xóa.');
        return;
      }
      ws.name = row.name;
      ws.invite_code = row.invite_code || ws.invite_code;
      return scheduleRender();
    }
    const d = byTable[table];
    if (!d) return;
    if (eventType !== 'DELETE' && row.workspace_id !== ws.id) return;
    if (
      table === 'notifications' &&
      eventType !== 'DELETE' &&
      row.user_id !== me
    )
      return;
    if (inflight.get(row.id)) {
      deferred.set(row.id, payload);
      return;
    }
    if (eventType === 'DELETE' && !base[d.key].has(row.id)) return;
    applyRow(d, eventType, row);
    scheduleRender();
  }
  async function signedOutOfWorkspace(text) {
    unsubscribe();
    ws = null;
    await loadWorkspaces();
    showAuth('workspaces', { error: text });
  }
  function subscribe() {
    channel = sb
      .channel(`workboard-${ws.id}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, (p) =>
        onChange(p),
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          if (status.state === 'offline') setStatus('ok');
          // Changes made while the connection was down are fetched again.
          if (Date.now() - lastLoad > 5000) reload();
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT')
          setStatus('offline');
      });
  }
  function unsubscribe() {
    if (channel) sb.removeChannel(channel);
    channel = null;
  }
  // Coming back to the tab after a while: fetch again in case something was missed.
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      ws &&
      Date.now() - lastLoad > 120000
    )
      reload();
  });
  window.addEventListener('online', () => ws && reload());

  // ---------- views that only exist in the shared version ----------
  const V = WB.views;
  V.sideFoot = () => {
    const me = WB.me();
    const role =
      { owner: 'Chủ sở hữu', admin: 'Quản trị', member: 'Thành viên' }[
        me.role
      ] || '';
    return `
      <label class="lbl" for="switch-ws">Không gian làm việc</label>
      <select id="switch-ws" class="ws-select" data-chg="switch-ws">${workspaces
        .map(
          (w) =>
            `<option value="${w.id}" ${ws && w.id === ws.id ? 'selected' : ''}>${esc(w.name)}</option>`,
        )
        .join(
          '',
        )}<option value="__manage">Tạo mới hoặc tham gia…</option></select>
      <div class="who">${V.avatar(me)}<span class="who-name"><b>${esc(me.name)}</b><span>${role}</span></span></div>
      <div class="side-actions">
        <button class="link" data-act="open-invite">Mời người</button>
        <button class="link" data-act="open-profile">Hồ sơ</button>
        <button class="link" data-act="sign-out">Đăng xuất</button>
      </div>
      <p id="sync-state" class="sync ${status.state}" role="status">${esc(statusText())}</p>`;
  };
  const inviteLink = () =>
    `${location.origin}${location.pathname}#join-${ws.invite_code}`;
  WB.cloudModals = {
    invite: () => [
      'Mời người vào không gian làm việc',
      `<p>Gửi đường link này cho người cần mời. Họ mở link, tạo tài khoản (hoặc đăng nhập) là vào được “${esc(ws.name)}”.</p>
       <label class="fld">Đường link mời<input class="inp" id="invite-link" readonly value="${esc(inviteLink())}" /></label>
       <label class="fld">Hoặc mã mời<input class="inp" id="invite-code" readonly value="${esc(ws.invite_code)}" /></label>
       <p class="muted small">Ai có link hoặc mã đều vào được. Nếu lỡ gửi nhầm, ${WB.isWorkspaceAdmin() ? 'bấm “Đổi mã mời” để link cũ hết dùng được.' : 'nhờ quản trị đổi mã mời.'}</p>
       <div class="modal-foot">${WB.isWorkspaceAdmin() ? '<button type="button" class="btn" data-act="reset-invite">Đổi mã mời</button>' : ''}<span class="grow"></span>
         <button type="button" class="btn" data-act="close-modal">Đóng</button><button type="button" class="btn primary" data-act="copy-invite">Sao chép link</button></div>`,
    ],
    profile: () => {
      const me = WB.me();
      return [
        'Hồ sơ của tôi',
        `<form data-form="save-profile">
          <label class="fld">Họ và tên<input class="inp" id="pf-name" name="name" required maxlength="120" value="${esc(me.name)}" autofocus /></label>
          <label class="fld">Chức danh<input class="inp" id="pf-title" name="title" maxlength="120" value="${esc(me.title || '')}" /></label>
          <fieldset class="fld"><legend>Màu</legend><div class="colors">${WB.COLORS.map(
            (c) =>
              `<label><input type="radio" name="color" value="${c}" ${me.color === c ? 'checked' : ''} aria-label="Màu ${c}" /><i style="background:${c}"></i></label>`,
          ).join('')}</div></fieldset>
          <p class="muted small">Email: ${esc(session.user.email || '')}</p>
          <div class="modal-foot">${me.role !== 'owner' ? '<button type="button" class="btn danger" data-act="leave-ws">Rời không gian này</button>' : ''}<span class="grow"></span><button type="button" class="btn" data-act="close-modal">Hủy</button><button class="btn primary">Lưu</button></div>
        </form>`,
      ];
    },
  };
  WB.cloud = {
    start,
    canSeed: () => WB.isWorkspaceAdmin() && WB.state.projects.length === 0,
    status: () => status,
    client: () => sb,
  };

  // ---------- handlers ----------
  const act = (fn) => fn;
  WB.extraActs = {
    'auth-view': act((el) => showAuth(el.dataset.view)),
    'auth-retry': act(() => start()),
    'open-ws': act((el) => openWorkspace(el.dataset.id)),
    'sign-out': act(async () => {
      try {
        await sb.auth.signOut();
      } catch {
        /* signed out locally anyway */
      }
      store.set(LAST_WS, null);
      signedOut();
    }),
    'open-invite': act(() => WB.openModal({ type: 'invite' })),
    'copy-invite': act(() => {
      const box = $('#invite-link');
      const done = () => WB.toast('Đã sao chép đường link mời.');
      const manual = () => {
        box.focus();
        box.select();
        WB.toast(
          'Đã chọn sẵn đường link. Nhấn Ctrl+C (máy Mac: ⌘C) để sao chép.',
        );
      };
      if (!navigator.clipboard) return manual();
      navigator.clipboard.writeText(box.value).then(done, manual);
    }),
    'reset-invite': act(() => {
      if (
        !WB.sure(
          'Đổi mã mời? Đường link mời cũ sẽ không dùng được nữa.',
          () => WB.extraActs['reset-invite'](),
          { ok: 'Đổi mã' },
        )
      )
        return;
      (async () => {
        try {
          const { data } = await check(
            sb.rpc('reset_invite_code', { p_workspace: ws.id }),
          );
          ws.invite_code = data;
          const w = workspaces.find((x) => x.id === ws.id);
          if (w) w.invite_code = data;
          WB.openModal({ type: 'invite' });
          WB.toast('Đã đổi mã mời.');
        } catch (err) {
          WB.toast(message(err));
        }
      })();
    }),
    'open-profile': act(() => WB.openModal({ type: 'profile' })),
    'leave-ws': act(() => {
      if (
        !WB.sure(
          `Rời khỏi “${ws.name}”? Bạn sẽ không xem được dữ liệu ở đây nữa, trừ khi được mời lại.`,
          () => WB.extraActs['leave-ws'](),
          { ok: 'Rời đi', danger: true },
        )
      )
        return;
      (async () => {
        try {
          await check(
            sb
              .from('workspace_members')
              .delete()
              .eq('workspace_id', ws.id)
              .eq('user_id', session.user.id),
          );
          WB.ui.modal = null;
          store.set(LAST_WS, null);
          signedOutOfWorkspace('');
        } catch (err) {
          WB.toast(message(err));
        }
      })();
    }),
    'remove-member': act((el) => {
      const u = WB.user(el.dataset.id);
      if (!u) return;
      if (
        !WB.sure(
          `Mời ${u.name} ra khỏi “${ws.name}”? Công việc của người này vẫn giữ nguyên.`,
          () => WB.extraActs['remove-member'](el),
          { ok: 'Mời ra', danger: true },
        )
      )
        return;
      (async () => {
        try {
          await check(
            sb
              .from('workspace_members')
              .delete()
              .eq('workspace_id', ws.id)
              .eq('user_id', u.id),
          );
          WB.state.users = WB.state.users.filter((x) => x.id !== u.id);
          WB.render();
          WB.toast(`Đã mời ${u.name} ra khỏi không gian làm việc.`);
        } catch (err) {
          WB.toast(message(err));
        }
      })();
    }),
    'cloud-seed': act(() => {
      const me = session.user.id;
      const sample = WB.seed({
        id: () => WB.uid(),
        who: (k) => (k === 'u1' ? me : ''),
      });
      for (const k of [
        'departments',
        'projects',
        'tasklists',
        'milestones',
        'fields',
        'tasks',
        'comments',
        'activity',
        'repeats',
      ])
        WB.state[k].push(...sample[k]);
      WB.runRepeats();
      WB.commit();
      WB.toast(
        'Đã thêm dữ liệu mẫu. Bạn có thể xóa từng dự án mẫu trong Cài đặt của dự án đó.',
      );
    }),
  };
  WB.extraChgs = {
    'switch-ws'(el) {
      if (el.value === '__manage') {
        el.value = ws ? ws.id : '';
        unsubscribe();
        ws = null;
        return showAuth('workspaces');
      }
      openWorkspace(el.value);
    },
    async 'member-role'(el) {
      try {
        await check(
          sb
            .from('workspace_members')
            .update({ role: el.value })
            .eq('workspace_id', ws.id)
            .eq('user_id', el.dataset.id)
            .select('user_id'),
        );
        const u = WB.user(el.dataset.id);
        if (u) u.role = el.value;
        WB.toast('Đã đổi vai trò.');
        WB.render();
      } catch (err) {
        WB.toast(message(err));
        WB.render();
      }
    },
  };
  WB.extraForms = {
    async signin(form, data) {
      busy(form, true);
      const email = String(data.get('email')).trim();
      try {
        const { data: res } = await check(
          sb.auth.signInWithPassword({ email, password: data.get('password') }),
        );
        session = res.session;
        await afterSignIn();
      } catch (err) {
        showAuth('signin', { error: message(err), email });
      }
    },
    async signup(form, data) {
      busy(form, true);
      const email = String(data.get('email')).trim();
      try {
        const { data: res } = await check(
          sb.auth.signUp({
            email,
            password: data.get('password'),
            options: {
              data: { name: String(data.get('name')).trim() },
              emailRedirectTo: location.origin + location.pathname,
            },
          }),
        );
        if (res.session) {
          session = res.session;
          return afterSignIn();
        }
        showAuth('signin', {
          email,
          note: `Đã tạo tài khoản. Hãy mở email ${email}, bấm vào đường link xác nhận, rồi quay lại đây đăng nhập. Nếu không thấy email, xem cả thư mục Spam.`,
        });
      } catch (err) {
        showAuth('signup', { error: message(err) });
      }
    },
    async forgot(form, data) {
      busy(form, true);
      const email = String(data.get('email')).trim();
      try {
        await check(
          sb.auth.resetPasswordForEmail(email, {
            redirectTo: location.origin + location.pathname,
          }),
        );
        showAuth('forgot', {
          note: `Nếu ${email} có tài khoản, một email có đường link đặt lại mật khẩu vừa được gửi đi. Hãy kiểm tra cả thư mục Spam.`,
        });
      } catch (err) {
        showAuth('forgot', { error: message(err) });
      }
    },
    async newpass(form, data) {
      busy(form, true);
      try {
        await check(sb.auth.updateUser({ password: data.get('password') }));
        recovering = false;
        WB.toast('Đã đổi mật khẩu.');
        await afterSignIn();
      } catch (err) {
        showAuth('newpass', { error: message(err) });
      }
    },
    async 'create-ws'(form, data) {
      busy(form, true);
      try {
        const { data: id } = await check(
          sb.rpc('create_workspace', {
            p_name: String(data.get('name')).trim(),
          }),
        );
        await loadWorkspaces();
        await openWorkspace(
          id,
          'Đã tạo không gian làm việc. Bấm “Mời người” ở góc dưới bên trái để mời đồng nghiệp.',
        );
      } catch (err) {
        showAuth('workspaces', { error: message(err) });
      }
    },
    async 'join-ws'(form, data) {
      busy(form, true);
      const code = String(data.get('code')).trim();
      try {
        const { data: id } = await check(
          sb.rpc('join_workspace', { p_code: code }),
        );
        await loadWorkspaces();
        await openWorkspace(id, 'Bạn đã vào không gian làm việc.');
      } catch (err) {
        showAuth('workspaces', { error: message(err), code });
      }
    },
    async 'save-profile'(form, data) {
      const patch = {
        name: String(data.get('name')).replace(/\s+/g, ' ').trim(),
        title: String(data.get('title') || '').trim(),
        color: data.get('color') || WB.me().color,
      };
      if (!patch.name) return WB.toast('Hãy nhập họ và tên.');
      try {
        await check(
          sb
            .from('profiles')
            .update(patch)
            .eq('id', session.user.id)
            .select('id'),
        );
        Object.assign(WB.me(), patch);
        WB.ui.modal = null;
        WB.render();
        WB.toast('Đã lưu hồ sơ.');
      } catch (err) {
        WB.toast(message(err));
      }
    },
  };

  // Repeat rules may create the same task on two devices: those rows are sent as
  // "add if missing" and then read back.
  const runRepeats = WB.runRepeats;
  WB.runRepeats = (...args) => {
    const made = runRepeats(...args);
    made.forEach((id) => {
      generated.add(id);
      generated.add(WB.detId(`${id}|a`));
    });
    return made;
  };
  WB.backend = {
    load() {},
    save: push,
    reset() {},
  };
})();
