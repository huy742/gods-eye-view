'use strict';
// Views, part 1: building blocks, sidebar, "my tasks", projects and the project views.
// Every function returns an HTML string; nothing here changes data.
(() => {
  const { esc, STATUS, STAGES, fmtDate } = WB;
  const V = (WB.views = WB.views || {});
  const st = () => WB.state;
  const ui = () => WB.ui;
  const DAY = 864e5;

  // ---------- building blocks ----------
  const initial = (name) => {
    const parts = String(name || '?')
      .trim()
      .split(/\s+/);
    return (parts[parts.length - 1][0] || '?').toUpperCase();
  };
  const avatar = (u, cls = '') =>
    u
      ? `<span class="av ${cls}" style="background:${esc(u.color || '#64748b')}" title="${esc(u.name)}">${esc(initial(u.name))}</span>`
      : `<span class="av av-none ${cls}" title="Chưa giao cho ai">?</span>`;
  const pill = (key) =>
    `<span class="pill" style="--c:${STATUS[key].color}">${STATUS[key].label}</span>`;
  const options = (list, selected, empty) =>
    (empty === undefined ? '' : `<option value="">${esc(empty)}</option>`) +
    list
      .map(
        (x) =>
          `<option value="${esc(x.id)}" ${x.id === selected ? 'selected' : ''}>${esc(x.name)}</option>`,
      )
      .join('');
  const flags = (t) =>
    (t.important ? '<span class="flag imp">Quan trọng</span>' : '') +
    (t.urgent ? '<span class="flag urg">Khẩn cấp</span>' : '');
  const svg = (inner, size = 17) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    check: '<path d="M4 12l5 5L20 6"/>',
    board:
      '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="10" rx="1.5"/>',
    chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    people:
      '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    repeat:
      '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  };
  const badges = (t) => {
    const out = [];
    const sub = WB.subs(t.id);
    if (sub.length)
      out.push(
        `<span class="bd" title="Việc con">⑂ ${sub.filter((x) => x.status === 'done').length}/${sub.length}</span>`,
      );
    if (t.checklist.length)
      out.push(
        `<span class="bd" title="Danh sách kiểm tra">☑ ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}</span>`,
      );
    const nc = WB.commentsOf(t.id).length;
    if (nc) out.push(`<span class="bd" title="Bình luận">💬 ${nc}</span>`);
    if (t.repeatId)
      out.push('<span class="bd" title="Tạo từ việc lặp lại">↻</span>');
    if (t.status !== 'done' && WB.blockers(t).length)
      out.push(
        '<span class="bd blocked" title="Còn việc phải làm trước">⛔ Bị chặn</span>',
      );
    return out.join('');
  };
  const checkBtn = (t) => {
    const title =
      t.status === 'done'
        ? 'Mở lại'
        : t.status === 'review'
          ? 'Đang chờ duyệt'
          : 'Đánh dấu hoàn thành';
    const mark = t.status === 'done' ? '✓' : t.status === 'review' ? '…' : '';
    return `<button class="chk ${t.status}" data-act="toggle-done" data-id="${t.id}" title="${title}" aria-label="${title}: ${esc(t.name)}">${mark}</button>`;
  };
  const dueCell = (t) => {
    const s = WB.statusOf(t);
    return t.due
      ? `<span class="due ${s === 'overdue' ? 'red' : ''}">${fmtDate(t.due)}</span>`
      : '<span class="due muted">—</span>';
  };
  const bar = (pct, color = 'var(--accent)') =>
    `<span class="bar" title="${pct}%"><i style="width:${pct}%;background:${color}"></i></span>`;
  const taskRow = (t, { showProject = false, sub = false } = {}) => {
    const p = WB.project(t.projectId);
    return `<div class="trow ${t.status === 'done' ? 'is-done' : ''} ${sub ? 'is-sub' : ''}" data-act="open-task" data-id="${t.id}">
      ${checkBtn(t)}
      <span class="tname">${esc(t.name)}</span>
      <span class="tbadges">${flags(t)}${badges(t)}</span>
      <span class="tmeta">
        ${showProject && p ? `<span class="chip"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span>` : ''}
        ${dueCell(t)}
        ${pill(WB.statusOf(t))}
        ${avatar(WB.user(t.assigneeId))}
      </span>
    </div>`;
  };
  const empty = (text) => `<div class="empty">${text}</div>`;
  const stackBar = (c) => {
    const keys = ['done', 'late', 'doing', 'review', 'todo', 'overdue'];
    if (!c.total) return '<div class="stack empty-stack"></div>';
    return `<div class="stack">${keys
      .filter((k) => c[k])
      .map(
        (k) =>
          `<i style="flex:${c[k]};background:${STATUS[k].color}" title="${STATUS[k].label}: ${c[k]}"></i>`,
      )
      .join('')}</div>
      <div class="legend">${keys
        .map(
          (k) =>
            `<span><i style="background:${STATUS[k].color}"></i>${STATUS[k].label}: <b>${c[k]}</b></span>`,
        )
        .join('')}</div>`;
  };
  Object.assign(V, {
    initial,
    avatar,
    pill,
    options,
    flags,
    svg,
    ICON,
    badges,
    checkBtn,
    dueCell,
    bar,
    taskRow,
    empty,
    stackBar,
  });

  // ---------- sidebar ----------
  V.side = () => {
    const r = ui().route;
    const open = WB.myTasks('assigned').filter(
      (t) => t.status !== 'done',
    ).length;
    const unread = WB.myNotifications().filter((n) => !n.read).length;
    const nav = (page, label, icon, extra = '') =>
      `<a class="nav ${r.page === page ? 'on' : ''}" href="#${page}"><span class="ico">${svg(icon)}</span>${label}${extra}</a>`;
    const projLink = (p) =>
      `<a class="nav sm ${r.page === 'p' && r.id === p.id ? 'on' : ''}" href="#p-${p.id}"><i class="dot" style="background:${esc(p.color)}"></i><span class="ell">${esc(p.name)}</span>${p.private ? '<span class="lock" title="Chỉ thành viên xem được">🔒</span>' : ''}</a>`;
    const projects = WB.visibleProjects();
    return `
      <div class="brand"><span class="logo">W</span><span class="brand-name">WorkBoard</span>
        <button class="bell ${ui().panel === 'notif' ? 'on' : ''}" data-act="toggle-panel" aria-label="Thông báo${unread ? `, ${unread} chưa đọc` : ''}" title="Thông báo">${svg(ICON.bell, 18)}${unread ? `<b class="bell-n">${unread > 99 ? '99+' : unread}</b>` : ''}</button>
        <button class="menu-btn" data-act="toggle-side" aria-label="Mở menu">☰</button></div>
      <nav class="side-body ${ui().sideOpen ? 'open' : ''}">
        ${nav('my', 'Việc của tôi', ICON.check, open ? `<b class="count">${open}</b>` : '')}
        ${nav('projects', 'Dự án & Nhóm', ICON.board)}
        ${nav('repeats', 'Việc lặp lại', ICON.repeat)}
        ${nav('reports', 'Báo cáo', ICON.chart)}
        ${nav('members', 'Thành viên', ICON.people)}
        <div class="side-title">Dự án</div>
        ${
          projects
            .filter((p) => p.kind === 'project')
            .map(projLink)
            .join('') || '<div class="side-empty">Chưa có dự án</div>'
        }
        <div class="side-title">Nhóm</div>
        ${
          projects
            .filter((p) => p.kind === 'team')
            .map(projLink)
            .join('') || '<div class="side-empty">Chưa có nhóm</div>'
        }
        <div class="side-foot">${V.sideFoot()}</div>
      </nav>`;
  };
  V.sideFoot = () => `
    <label class="lbl" for="switch-user">Bạn đang dùng với tên</label>
    <div class="who">${avatar(WB.me())}<select id="switch-user" data-chg="switch-user">${options(st().users, st().me)}</select></div>
    <p class="side-note">Bản này lưu dữ liệu trên trình duyệt của bạn. Đổi tên ở trên để thử vai người khác.</p>
    <button class="link" data-act="reset-data">Khôi phục dữ liệu mẫu</button>`;

  // ---------- page router ----------
  V.main = () => {
    const r = ui().route;
    if (r.page === 'projects') return V.projects();
    if (r.page === 'p') return V.project(r.id, r.view);
    if (r.page === 'repeats') return V.repeats();
    if (r.page === 'reports') return V.reports();
    if (r.page === 'members') return r.id ? V.member(r.id) : V.members();
    return V.my();
  };

  // ---------- my tasks ----------
  V.my = () => {
    const tab = ui().myTab;
    const tabs = [
      ['assigned', 'Tôi thực hiện'],
      ['following', 'Tôi theo dõi'],
      ['created', 'Tôi giao cho người khác'],
    ];
    const all = WB.myTasks(tab);
    const open = all.filter((t) => t.status !== 'done');
    const done = all.filter((t) => t.status === 'done');
    const today = WB.today();
    const week = WB.shiftDate(today, 7);
    const groups = [
      ['Quá hạn', open.filter((t) => WB.statusOf(t) === 'overdue'), 'red'],
      [
        'Hôm nay',
        open.filter(
          (t) => WB.statusOf(t) !== 'overdue' && t.due.slice(0, 10) === today,
        ),
      ],
      [
        '7 ngày tới',
        open.filter(
          (t) => t.due.slice(0, 10) > today && t.due.slice(0, 10) <= week,
        ),
      ],
      ['Sau đó', open.filter((t) => t.due.slice(0, 10) > week)],
      ['Chưa có hạn', open.filter((t) => !t.due)],
    ];
    const sortDue = (a, b) => (a.due || '9').localeCompare(b.due || '9');
    return `
      <header class="page-head">
        <div><h1>Việc của tôi</h1><p class="sub">Xin chào ${esc(WB.me().name)} — bạn còn <b>${WB.myTasks('assigned').filter((t) => t.status !== 'done').length}</b> việc chưa xong.</p></div>
      </header>
      <div class="tabs page-tabs">${tabs
        .map(
          ([k, l]) =>
            `<button class="tab ${tab === k ? 'on' : ''}" data-act="my-tab" data-tab="${k}">${l} <span class="n">${WB.myTasks(k).filter((t) => t.status !== 'done').length}</span></button>`,
        )
        .join('')}</div>
      <section class="panel">
        ${
          groups
            .filter(([, list]) => list.length)
            .map(
              ([title, list, cls]) =>
                `<h3 class="group ${cls || ''}">${title} <span class="n">${list.length}</span></h3>${list
                  .sort(sortDue)
                  .map((t) => taskRow(t, { showProject: true }))
                  .join('')}`,
            )
            .join('') || empty('Không có việc nào đang mở ở mục này.')
        }
        ${
          done.length
            ? `<details class="done-box"><summary>Đã hoàn thành (${done.length})</summary>${done
                .map((t) => taskRow(t, { showProject: true }))
                .join('')}</details>`
            : ''
        }
      </section>`;
  };

  // ---------- projects & teams ----------
  V.projects = () => {
    const card = (p) => {
      const pr = WB.progress(WB.tasksOf(p.id));
      const c = WB.counts(WB.tasksOf(p.id));
      return `<a class="pcard" href="#p-${p.id}" style="--c:${esc(p.color)}">
        <div class="pcard-top"><span class="kind">${p.kind === 'project' ? 'Dự án' : 'Nhóm'}</span>${
          p.kind === 'project'
            ? `<span class="stage" style="--c:${STAGES[p.stage].color}">${STAGES[p.stage].label}</span>`
            : ''
        }${p.private ? '<span class="kind" title="Chỉ thành viên xem được">🔒 Riêng tư</span>' : ''}</div>
        <h3>${esc(p.name)}</h3>
        <p class="muted small">${p.start || p.end ? `${fmtDate(p.start) || '…'} → ${fmtDate(p.end) || '…'}` : 'Công việc lặp lại, không có ngày kết thúc'}</p>
        <div class="pcard-prog">${bar(pr.pct, p.color)}<span>${pr.done}/${pr.total} việc</span></div>
        <div class="pcard-foot"><span class="avs">${p.memberIds
          .slice(0, 5)
          .map((id) => avatar(WB.user(id), 'sm'))
          .join(
            '',
          )}</span>${c.overdue ? `<span class="red small">${c.overdue} quá hạn</span>` : ''}</div>
      </a>`;
    };
    const canManageDepts = WB.mode !== 'cloud' || WB.isWorkspaceAdmin();
    const visible = WB.visibleProjects();
    const section = (d) => {
      const list = visible.filter((p) =>
        d ? p.deptId === d.id : !WB.dept(p.deptId),
      );
      if (!d && !list.length) return '';
      return `<section class="dept">
        <h2>${d ? esc(d.name) : 'Chưa thuộc phòng ban'} <span class="n">${list.length}</span>
          ${d && canManageDepts ? `<button class="icon-btn" data-act="rename-dept" data-id="${d.id}" title="Đổi tên phòng ban" aria-label="Đổi tên phòng ban ${esc(d.name)}">✎</button><button class="icon-btn" data-act="del-dept" data-id="${d.id}" title="Xóa phòng ban" aria-label="Xóa phòng ban ${esc(d.name)}">🗑</button>` : ''}
        </h2>
        <div class="pgrid">${list.map(card).join('') || '<div class="muted small">Phòng ban này chưa có dự án hay nhóm nào.</div>'}</div>
      </section>`;
    };
    const none = !visible.length;
    return `
      <header class="page-head">
        <div><h1>Dự án & Nhóm</h1><p class="sub">Dự án có ngày bắt đầu, ngày kết thúc và mục tiêu. Nhóm dành cho việc lặp lại hằng tuần, hằng tháng.</p></div>
        <div class="actions">
          ${canManageDepts ? '<button class="btn" data-act="new-dept">+ Phòng ban</button>' : ''}
          <button class="btn" data-act="new-from-template">+ Từ mẫu</button>
          <button class="btn" data-act="new-project" data-kind="team">+ Nhóm</button>
          <button class="btn primary" data-act="new-project" data-kind="project">+ Dự án</button>
        </div>
      </header>
      ${none ? `<section class="panel">${empty('Chưa có dự án hay nhóm nào. Bấm <b>+ Dự án</b> để tạo, hoặc <b>+ Từ mẫu</b> để bắt đầu từ một mẫu có sẵn.')}${WB.mode === 'cloud' && WB.cloud && WB.cloud.canSeed() ? '<p class="center"><button class="btn" data-act="cloud-seed">Thêm dữ liệu mẫu để thử</button></p>' : ''}</section>` : ''}
      ${st().departments.map(section).join('')}${section(null)}`;
  };

  // ---------- one project / team ----------
  const VIEWS_PROJECT = [
    ['list', 'Danh sách'],
    ['table', 'Bảng'],
    ['kanban', 'Kanban'],
    ['gantt', 'Gantt'],
    ['calendar', 'Lịch'],
    ['period', 'Theo kỳ'],
    ['stream', 'Hoạt động'],
    ['milestones', 'Mục tiêu'],
  ];
  const VIEWS_TEAM = VIEWS_PROJECT.filter(
    ([k]) => !['gantt', 'milestones'].includes(k),
  );
  V.VIEW_NAMES = VIEWS_PROJECT.map(([k]) => k);
  const applyFilter = (tasks) => {
    const f = ui().filter;
    const q = WB.norm(f.q);
    return tasks.filter(
      (t) =>
        (!q || WB.norm(t.name).includes(q)) &&
        (!f.assignee || t.assigneeId === f.assignee) &&
        (!f.status || WB.statusOf(t) === f.status),
    );
  };
  const quickAdd = (
    id,
    attrs,
    placeholder = '+ Thêm công việc, gõ xong nhấn Enter',
  ) =>
    `<input class="quick" id="${id}" data-enter="add-task" ${attrs} placeholder="${placeholder}" aria-label="Thêm công việc" autocomplete="off" />`;

  V.project = (id, view) => {
    const p = WB.project(id);
    if (!p || !WB.canSee(p))
      return `<header class="page-head"><h1>Không tìm thấy</h1></header>${empty('Dự án này không còn nữa, hoặc bạn không có quyền xem. <a href="#projects">Về danh sách dự án</a>')}`;
    const tabs = p.kind === 'project' ? VIEWS_PROJECT : VIEWS_TEAM;
    if (!tabs.some(([k]) => k === view)) view = 'list';
    const all = WB.tasksOf(id);
    const pr = WB.progress(all);
    const tasks = applyFilter(WB.topTasks(id));
    const f = ui().filter;
    const d = WB.dept(p.deptId);
    const admin = WB.isAdmin(p);
    const body = {
      list: V.list,
      table: V.table,
      kanban: V.kanban,
      gantt: V.gantt,
      calendar: V.calendar,
      period: V.period,
      stream: V.stream,
      milestones: V.milestones,
    }[view](p, tasks);
    const noFilter = ['milestones', 'stream'].includes(view);
    return `
      <header class="page-head proj">
        <div class="grow">
          <div class="crumbs"><a href="#projects">Dự án & Nhóm</a> › ${d ? esc(d.name) : 'Chưa thuộc phòng ban'}</div>
          <h1><i class="dot lg" style="background:${esc(p.color)}"></i>${esc(p.name)}
            <span class="kind">${p.kind === 'project' ? 'Dự án' : 'Nhóm'}</span>
            ${p.kind === 'project' ? `<span class="stage" style="--c:${STAGES[p.stage].color}">${STAGES[p.stage].label}</span>` : ''}
            ${p.review ? '<span class="kind" title="Việc phải được người giao việc hoặc quản trị dự án duyệt mới tính là xong">Có duyệt</span>' : ''}
            ${p.private ? '<span class="kind" title="Chỉ thành viên xem được">🔒 Riêng tư</span>' : ''}
          </h1>
          <div class="proj-meta">
            ${p.start || p.end ? `<span>📅 ${fmtDate(p.start) || '…'} → ${fmtDate(p.end) || '…'}</span>` : ''}
            <span class="avs">${p.memberIds.map((u) => avatar(WB.user(u), 'sm')).join('')}</span>
            <span class="prog">${bar(pr.pct, p.color)} ${pr.pct}% · ${pr.done}/${pr.total} việc</span>
          </div>
        </div>
        <div class="actions">
          <details class="menu">
            <summary class="btn" aria-label="Thêm thao tác">Thêm ▾</summary>
            <div class="menu-list" role="menu">
              <button role="menuitem" data-act="open-import" data-id="${p.id}">Nhập công việc từ Excel…</button>
              <button role="menuitem" data-act="export-xlsx" data-id="${p.id}">Xuất ra Excel</button>
              <button role="menuitem" data-act="open-fields" data-id="${p.id}">Trường tùy chỉnh…</button>
              <button role="menuitem" data-act="new-repeat" data-project="${p.id}">Tạo việc lặp lại…</button>
              <hr />
              <button role="menuitem" data-act="open-dup-project" data-id="${p.id}">Nhân bản ${p.kind === 'project' ? 'dự án' : 'nhóm'}…</button>
              <button role="menuitem" data-act="open-save-template" data-id="${p.id}">Lưu làm mẫu…</button>
            </div>
          </details>
          <button class="btn" data-act="edit-project" data-id="${p.id}">${admin ? 'Cài đặt' : 'Thông tin'}</button>
        </div>
      </header>
      <div class="toolbar">
        <div class="tabs">${tabs.map(([k, l]) => `<a class="tab ${view === k ? 'on' : ''}" href="#p-${p.id}-${k}">${l}</a>`).join('')}</div>
        ${
          noFilter
            ? ''
            : `<div class="filters">
          <input id="f-q" class="inp" data-input="filter-q" value="${esc(f.q)}" placeholder="Tìm công việc…" aria-label="Tìm công việc" />
          <select id="f-assignee" class="inp" data-chg="filter" data-key="assignee" aria-label="Lọc theo người">${options(
            p.memberIds.map(WB.user).filter(Boolean),
            f.assignee,
            'Mọi người',
          )}</select>
          <select id="f-status" class="inp" data-chg="filter" data-key="status" aria-label="Lọc theo trạng thái">${options(
            Object.entries(STATUS).map(([k, v]) => ({ id: k, name: v.label })),
            f.status,
            'Mọi trạng thái',
          )}</select>
        </div>`
        }
      </div>
      ${body}`;
  };

  V.list = (p, tasks) => {
    const lists = WB.listsOf(p.id);
    const filtering = tasks.length !== WB.topTasks(p.id).length;
    const admin = WB.isAdmin(p);
    return `<section class="panel">
      ${lists
        .map((l, i) => {
          const mine = tasks.filter((t) => t.tasklistId === l.id);
          const pr = WB.progress(
            WB.tasksOf(p.id).filter(
              (t) => t.tasklistId === l.id && !t.parentId,
            ),
          );
          return `<div class="tl">
            <h3 class="tl-head"><span class="tl-name">${esc(l.name)}</span> <span class="n">${pr.done}/${pr.total}</span>
              <span class="tl-tools">
                <button class="icon-btn" data-act="move-tasklist" data-id="${l.id}" data-dir="-1" title="Chuyển lên" aria-label="Chuyển “${esc(l.name)}” lên" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="icon-btn" data-act="move-tasklist" data-id="${l.id}" data-dir="1" title="Chuyển xuống" aria-label="Chuyển “${esc(l.name)}” xuống" ${i === lists.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="icon-btn" data-act="rename-tasklist" data-id="${l.id}" title="Đổi tên" aria-label="Đổi tên “${esc(l.name)}”">✎</button>
                ${admin ? `<button class="icon-btn" data-act="del-tasklist" data-id="${l.id}" title="Xóa danh sách việc" aria-label="Xóa “${esc(l.name)}”">🗑</button>` : ''}
              </span></h3>
            ${mine
              .map(
                (t) =>
                  taskRow(t) +
                  WB.subs(t.id)
                    .map((s) => taskRow(s, { sub: true }))
                    .join(''),
              )
              .join('')}
            ${!mine.length && filtering ? '<div class="muted small pad">Không có việc nào khớp bộ lọc.</div>' : ''}
            ${quickAdd(`qa-${l.id}`, `data-project="${p.id}" data-tasklist="${l.id}"`)}
          </div>`;
        })
        .join('')}
      <input class="quick new-tl" id="new-tl" data-enter="add-tasklist" data-project="${p.id}" placeholder="+ Thêm danh sách việc (ví dụ: Thiết kế, Lập trình…), nhấn Enter" aria-label="Thêm danh sách việc" autocomplete="off" />
    </section>`;
  };

  V.table = (p, tasks) => {
    const sort = ui().sort;
    const fields = WB.fieldsOf(p.id);
    const cols = [
      ['name', 'Tên công việc'],
      ['tasklist', 'Danh sách việc'],
      ['assignee', 'Người thực hiện'],
      ['start', 'Bắt đầu'],
      ['due', 'Hạn chót'],
      ['status', 'Trạng thái'],
      ['flags', 'Nhãn'],
      ['milestone', 'Mục tiêu'],
      ...fields.map((f) => ['f:' + f.id, f.name]),
    ].filter(([k]) => p.kind === 'project' || k !== 'milestone');
    const val = {
      name: (t) => WB.norm(t.name),
      tasklist: (t) => (WB.tasklist(t.tasklistId) || {}).name || '',
      assignee: (t) => (WB.user(t.assigneeId) || {}).name || '￿',
      start: (t) => t.start || '9',
      due: (t) => t.due || '9',
      status: (t) => Object.keys(STATUS).indexOf(WB.statusOf(t)),
      flags: (t) => -(t.important * 2 + t.urgent),
      milestone: (t) => (WB.milestone(t.milestoneId) || {}).name || '￿',
    };
    const fieldVal = (t, fid) => {
      const v = (t.custom || {})[fid];
      const f = WB.field(fid);
      if (v == null || v === '')
        return f && f.type === 'number' ? -Infinity : '￿';
      return f && f.type === 'number' ? +v : String(v);
    };
    const rows = [...tasks];
    if (sort.key)
      rows.sort((a, b) => {
        const get = sort.key.startsWith('f:')
          ? (t) => fieldVal(t, sort.key.slice(2))
          : val[sort.key];
        const x = get(a);
        const y = get(b);
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
    const first = WB.listsOf(p.id)[0];
    return `<section class="panel flush"><div class="scroll-x"><table class="tbl">
      <thead><tr><th class="w-chk"><span class="sr">Xong</span></th>${cols
        .map(
          ([k, l]) =>
            `<th><button class="th-btn" data-act="sort" data-key="${esc(k)}">${esc(l)}${sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`,
        )
        .join('')}</tr></thead>
      <tbody>${
        rows
          .map((t) => {
            const u = WB.user(t.assigneeId);
            return `<tr class="${t.status === 'done' ? 'is-done' : ''}" data-act="open-task" data-id="${t.id}">
          <td>${checkBtn(t)}</td>
          <td class="td-name"><span class="tname">${esc(t.name)}</span> ${badges(t)}</td>
          <td>${esc(val.tasklist(t))}</td>
          <td>${u ? `${avatar(u, 'sm')} ${esc(u.name)}` : '<span class="muted">Chưa giao</span>'}</td>
          <td>${fmtDate(t.start) || '<span class="muted">—</span>'}</td>
          <td>${dueCell(t)}</td>
          <td>${pill(WB.statusOf(t))}</td>
          <td>${flags(t)}</td>
          ${p.kind === 'project' ? `<td>${esc((WB.milestone(t.milestoneId) || {}).name || '')}</td>` : ''}
          ${fields.map((f) => `<td>${esc(f.type === 'date' ? fmtDate((t.custom || {})[f.id] || '') : (t.custom || {})[f.id] || '')}</td>`).join('')}
        </tr>`;
          })
          .join('') ||
        `<tr><td colspan="${cols.length + 1}">${empty('Chưa có công việc nào.')}</td></tr>`
      }</tbody>
    </table></div>
    ${first ? quickAdd('qa-table', `data-project="${p.id}" data-tasklist="${first.id}"`, `+ Thêm công việc vào “${esc(first.name)}”, nhấn Enter`) : ''}
    </section>`;
  };

  V.kanban = (p, tasks) => {
    const group = ui().kanbanGroup;
    const cols =
      group === 'status'
        ? ['todo', 'doing', 'review', 'done'].map((k) => ({
            id: k,
            name: STATUS[k].label,
            color: STATUS[k].color,
            tasks: tasks.filter((t) => t.status === k),
          }))
        : WB.listsOf(p.id).map((l) => ({
            id: l.id,
            name: l.name,
            color: p.color,
            tasks: tasks.filter((t) => t.tasklistId === l.id),
          }));
    const card = (
      t,
    ) => `<article class="card ${t.status === 'done' ? 'is-done' : ''}" draggable="true" data-drag="${t.id}" data-act="open-task" data-id="${t.id}">
      <div class="card-top">${checkBtn(t)}<span class="tname">${esc(t.name)}</span></div>
      ${flags(t) || badges(t) ? `<div class="card-tags">${flags(t)}${badges(t)}</div>` : ''}
      <div class="card-foot">${dueCell(t)}${group === 'status' ? '' : pill(WB.statusOf(t))}<span class="grow"></span>${avatar(WB.user(t.assigneeId), 'sm')}</div>
    </article>`;
    const first = WB.listsOf(p.id)[0];
    return `
      <div class="kbar"><label for="kanban-group">Xếp cột theo:</label>
        <select class="inp" id="kanban-group" data-chg="kanban-group">
          <option value="tasklist" ${group === 'tasklist' ? 'selected' : ''}>Danh sách việc</option>
          <option value="status" ${group === 'status' ? 'selected' : ''}>Trạng thái</option>
        </select>
        <span class="muted small">Kéo thẻ sang cột khác để chuyển.</span>
      </div>
      <div class="kanban" data-scroll="kanban:${p.id}:${group}">
        ${cols
          .map(
            (c) => `<section class="kcol" data-drop="${c.id}">
          <h3 style="--c:${esc(c.color)}">${esc(c.name)} <span class="n">${c.tasks.length}</span></h3>
          <div class="kcards">${c.tasks.map(card).join('')}</div>
          ${
            group === 'status'
              ? (c.id === 'todo' || c.id === 'doing') && first
                ? quickAdd(
                    `qa-k-${c.id}`,
                    `data-project="${p.id}" data-tasklist="${first.id}" data-status="${c.id}"`,
                    '+ Thêm công việc',
                  )
                : ''
              : quickAdd(
                  `qa-k-${c.id}`,
                  `data-project="${p.id}" data-tasklist="${c.id}"`,
                  '+ Thêm công việc',
                )
          }
        </section>`,
          )
          .join('')}
        ${cols.length ? '' : empty('Chưa có danh sách việc nào. Hãy thêm ở tab Danh sách.')}
      </div>`;
  };

  V.GANTT_W = 30;
  V.gantt = (p, tasks) => {
    const W = V.GANTT_W;
    const LEFT = 260;
    const day0 = (s) => WB.toDate(s.slice(0, 10));
    const span = (t) => {
      const a = day0(t.start || t.due);
      const b = day0(t.due || t.start);
      return a <= b ? [a, b] : [b, a];
    };
    const items = tasks.filter((t) => t.start || t.due);
    const hidden = tasks.length - items.length;
    const ms = WB.milestonesOf(p.id).filter((m) => m.due);
    const today = day0(WB.today());
    const dates = [today];
    if (p.start) dates.push(day0(p.start));
    if (p.end) dates.push(day0(p.end));
    items.forEach((t) => dates.push(...span(t)));
    ms.forEach((m) => dates.push(day0(m.due)));
    const min = WB.addDays(new Date(Math.min(...dates)), -3);
    const max = WB.addDays(new Date(Math.max(...dates)), 7);
    const off = (d) => Math.round((d - min) / DAY);
    const n = off(max) + 1;
    const months = [];
    let dayCells = '';
    let weekends = '';
    for (let i = 0; i < n; i++) {
      const d = WB.addDays(min, i);
      const key = `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
      if (months.length && months[months.length - 1][0] === key)
        months[months.length - 1][1]++;
      else months.push([key, 1]);
      const we = d.getDay() === 0 || d.getDay() === 6;
      dayCells += `<span class="g-day ${we ? 'we' : ''} ${i === off(today) ? 'today' : ''}">${d.getDate()}</span>`;
      if (we)
        weekends += `<i class="g-we" style="left:${LEFT + i * W}px;width:${W}px"></i>`;
    }
    const track = (inner) =>
      `<div class="g-track" style="width:${n * W}px">${inner}</div>`;
    const row = (t) => {
      const [a, b] = span(t);
      const s = WB.statusOf(t);
      return `<div class="g-row">
        <div class="g-left" data-act="open-task" data-id="${t.id}">${avatar(WB.user(t.assigneeId), 'sm')}<span class="ell ${t.status === 'done' ? 'strike' : ''}">${esc(t.name)}</span></div>
        ${track(`<div class="g-bar" data-gantt="${t.id}" data-min="${WB.ymd(min)}" style="left:${off(a) * W + 2}px;width:${(off(b) - off(a) + 1) * W - 4}px;background:${STATUS[s].color}" title="${esc(t.name)} · ${fmtDate(t.start) || '…'} → ${fmtDate(t.due) || '…'} · ${STATUS[s].label}. Kéo để đổi ngày, kéo mép phải để đổi hạn chót."><i class="g-h l" data-edge="start"></i><span>${esc(t.name)}</span><i class="g-h r" data-edge="due"></i></div>`)}
      </div>`;
    };
    const groups = WB.listsOf(p.id)
      .map((l) => {
        const mine = items.filter((t) => t.tasklistId === l.id);
        if (!mine.length) return '';
        return `<div class="g-row g-group"><div class="g-left">${esc(l.name)} <span class="n">${mine.length}</span></div>${track('')}</div>${mine.map(row).join('')}`;
      })
      .join('');
    return `<p class="muted small hint">Kéo thanh để dời cả công việc, kéo mép trái hoặc mép phải để đổi ngày bắt đầu hoặc hạn chót. Bấm vào thanh để mở chi tiết.</p>
    <section class="panel flush">
      <div class="gantt" data-scroll="gantt:${p.id}" data-today="${off(today) * W}">
        <div class="g-inner" style="width:${LEFT + n * W}px">
          ${weekends}
          <i class="g-today" style="left:${LEFT + off(today) * W + W / 2}px" title="Hôm nay"></i>
          <div class="g-row g-head"><div class="g-left">Công việc</div><div class="g-track" style="width:${n * W}px">
            <div class="g-months">${months.map(([k, c]) => `<span style="width:${c * W}px"><b>${k}</b></span>`).join('')}</div>
            <div class="g-days">${dayCells}</div>
          </div></div>
          ${
            ms.length
              ? `<div class="g-row g-ms"><div class="g-left">◆ Mục tiêu</div>${track(
                  ms
                    .map(
                      (m) =>
                        `<span class="g-diamond" style="left:${off(day0(m.due)) * W + W / 2}px" title="${esc(m.name)} · ${fmtDate(m.due)}"><i></i><b>${esc(m.name)}</b></span>`,
                    )
                    .join(''),
                )}</div>`
              : ''
          }
          ${groups || `<div class="pad">${empty('Chưa có công việc nào có ngày bắt đầu hoặc hạn chót.')}</div>`}
        </div>
      </div>
      ${hidden ? `<div class="muted small pad">${hidden} công việc chưa có ngày nên không hiện trên Gantt.</div>` : ''}
    </section>`;
  };

  V.calendar = (p, tasks) => {
    const [y, m] = ui().calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = WB.addDays(first, -((first.getDay() + 6) % 7));
    const byDay = {};
    tasks.forEach((t) => {
      if (t.due) (byDay[t.due.slice(0, 10)] ||= []).push(t);
    });
    const today = WB.today();
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = WB.addDays(start, i);
      const key = WB.ymd(d);
      const list = byDay[key] || [];
      cells += `<div class="cal-cell ${d.getMonth() !== m - 1 ? 'out' : ''} ${key === today ? 'today' : ''}">
        <span class="cal-num">${d.getDate()}</span>
        ${list
          .slice(0, 4)
          .map(
            (t) =>
              `<button class="cal-task ${t.status === 'done' ? 'strike' : ''}" style="--c:${STATUS[WB.statusOf(t)].color}" data-act="open-task" data-id="${t.id}" title="${esc(t.name)}">${esc(t.name)}</button>`,
          )
          .join('')}
        ${list.length > 4 ? `<span class="muted small">+${list.length - 4} việc nữa</span>` : ''}
      </div>`;
    }
    const noDue = tasks.filter((t) => !t.due).length;
    return `<section class="panel flush">
      <div class="cal-bar">
        <button class="btn" data-act="cal-move" data-dir="-1" aria-label="Tháng trước">‹</button>
        <strong>Tháng ${m}/${y}</strong>
        <button class="btn" data-act="cal-move" data-dir="1" aria-label="Tháng sau">›</button>
        <button class="btn" data-act="cal-move" data-dir="0">Hôm nay</button>
        <span class="muted small">Công việc hiện theo ngày hạn chót.${noDue ? ` ${noDue} việc chưa có hạn nên không hiện.` : ''}</span>
      </div>
      <div class="cal-grid cal-names">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </section>`;
  };

  // Tasks due in one week or one month, grouped by person: for weekly and monthly check-ins.
  V.periodRange = () => {
    const { unit, anchor } = ui().period;
    const a = WB.toDate(anchor);
    if (unit === 'month') {
      const from = new Date(a.getFullYear(), a.getMonth(), 1);
      const to = new Date(a.getFullYear(), a.getMonth() + 1, 0);
      return {
        from: WB.ymd(from),
        to: WB.ymd(to),
        label: `Tháng ${a.getMonth() + 1}/${a.getFullYear()}`,
      };
    }
    const from = WB.addDays(a, 1 - WB.isoDow(a));
    const to = WB.addDays(from, 6);
    return {
      from: WB.ymd(from),
      to: WB.ymd(to),
      label: `Tuần ${fmtDate(WB.ymd(from))} – ${fmtDate(WB.ymd(to))}`,
    };
  };
  V.period = (p, tasks) => {
    const { unit } = ui().period;
    const { from, to, label } = V.periodRange();
    const inRange = tasks.filter(
      (t) => t.due && t.due.slice(0, 10) >= from && t.due.slice(0, 10) <= to,
    );
    const c = WB.counts(inRange);
    const people = [...new Set(inRange.map((t) => t.assigneeId))].sort(
      (a, b) =>
        !a ? 1 : !b ? -1 : WB.userName(a).localeCompare(WB.userName(b), 'vi'),
    );
    const stat = (n, text, cls = '') =>
      `<div class="stat ${cls}"><b>${n}</b><span>${text}</span></div>`;
    return `<section class="panel flush">
      <div class="cal-bar">
        <div class="seg" role="group" aria-label="Độ dài kỳ">
          <button class="${unit === 'week' ? 'on' : ''}" data-act="period-unit" data-unit="week">Tuần</button>
          <button class="${unit === 'month' ? 'on' : ''}" data-act="period-unit" data-unit="month">Tháng</button>
        </div>
        <button class="btn" data-act="period-move" data-dir="-1" aria-label="Kỳ trước">‹</button>
        <strong>${label}</strong>
        <button class="btn" data-act="period-move" data-dir="1" aria-label="Kỳ sau">›</button>
        <button class="btn" data-act="period-move" data-dir="0">Kỳ này</button>
      </div>
    </section>
    <div class="stats">${stat(c.total, 'Việc có hạn trong kỳ')}${stat(c.done + c.late, 'Đã xong', 'green')}${stat(c.todo + c.doing + c.review, 'Chưa xong')}${stat(c.overdue, 'Quá hạn', 'red')}</div>
    ${
      people
        .map((uid) => {
          const mine = inRange
            .filter((t) => t.assigneeId === uid)
            .sort((a, b) => a.due.localeCompare(b.due));
          const k = WB.counts(mine);
          const u = WB.user(uid);
          return `<section class="panel"><h2>${u ? `${avatar(u, 'sm')} ${esc(u.name)}` : 'Chưa giao cho ai'} <span class="n">${k.done + k.late}/${k.total} xong</span>${k.overdue ? ` <span class="red small">${k.overdue} quá hạn</span>` : ''}</h2>${mine.map((t) => taskRow(t)).join('')}</section>`;
        })
        .join('') ||
      `<section class="panel">${empty('Không có việc nào có hạn chót trong kỳ này.')}</section>`
    }`;
  };

  // Everything that happened in the project, newest first.
  V.stream = (p) => {
    const ids = new Set(WB.tasksOf(p.id).map((t) => t.id));
    const items = [
      ...st()
        .activity.filter((a) => ids.has(a.taskId))
        .map((a) => ({ ...a, type: 'act' })),
      ...st()
        .comments.filter((c) => ids.has(c.taskId))
        .map((c) => ({ ...c, type: 'cmt' })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 200);
    const todayStr = WB.today();
    const yest = WB.shiftDate(todayStr, -1);
    let lastDay = '';
    const rows = items
      .map((it) => {
        const t = WB.task(it.taskId);
        const u = WB.user(it.userId);
        const d = it.at.slice(0, 10);
        let head = '';
        if (d !== lastDay) {
          lastDay = d;
          head = `<h3 class="group">${d === todayStr ? 'Hôm nay' : d === yest ? 'Hôm qua' : fmtDate(d)}</h3>`;
        }
        const who = `<b>${esc(u ? u.name : 'Người đã rời đi')}</b>`;
        const link = `<button class="link" data-act="open-task" data-id="${it.taskId}">${esc(t ? t.name : '')}</button>`;
        const what =
          it.type === 'cmt'
            ? `${who} đã bình luận ở ${link}<blockquote>${esc(it.text)}</blockquote>`
            : `${who} ${esc(it.text)} · ${link}`;
        return `${head}<div class="feed">${avatar(u, 'sm')}<div class="feed-body">${what}</div><span class="muted small">${it.at.slice(11, 16)}</span></div>`;
      })
      .join('');
    return `<section class="panel">${rows || empty('Chưa có hoạt động nào trong dự án này.')}${items.length === 200 ? '<p class="muted small">Chỉ hiện 200 hoạt động gần nhất.</p>' : ''}</section>`;
  };

  V.milestones = (p) => {
    const list = [...WB.milestonesOf(p.id)].sort((a, b) =>
      (a.due || '9').localeCompare(b.due || '9'),
    );
    const today = WB.today();
    return `<section class="panel">
      <p class="muted small">Mục tiêu là các mốc quan trọng của dự án. Gắn công việc vào mục tiêu (trong chi tiết công việc) để theo dõi mốc đó xong được bao nhiêu.</p>
      ${
        list
          .map((m) => {
            const linked = WB.tasksOf(p.id).filter(
              (t) => t.milestoneId === m.id,
            );
            const pr = WB.progress(linked);
            const late = m.due && m.due < today && pr.done < pr.total;
            return `<div class="ms">
          <div class="ms-head"><span class="ms-ico">◆</span><strong>${esc(m.name)}</strong>
            <span class="due ${late ? 'red' : ''}">${m.due ? 'Hạn ' + fmtDate(m.due) : 'Chưa có hạn'}</span>
            <span class="grow"></span>${bar(pr.pct)}<span class="small">${pr.done}/${pr.total} việc</span>
            <button class="icon-btn" data-act="del-milestone" data-id="${m.id}" title="Xóa mục tiêu" aria-label="Xóa mục tiêu ${esc(m.name)}">🗑</button></div>
          ${linked.map((t) => taskRow(t)).join('') || '<div class="muted small pad">Chưa có công việc nào gắn với mục tiêu này.</div>'}
        </div>`;
          })
          .join('') || empty('Dự án chưa có mục tiêu nào.')
      }
      <form class="inline-form" data-form="add-milestone" data-project="${p.id}">
        <input class="inp grow" id="ms-name" name="name" required placeholder="Tên mục tiêu mới" aria-label="Tên mục tiêu" />
        <input class="inp" id="ms-due" type="date" name="due" aria-label="Hạn của mục tiêu" />
        <button class="btn primary">Thêm mục tiêu</button>
      </form>
    </section>`;
  };
})();
