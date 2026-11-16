'use strict';
// Views: each function returns an HTML string. No state is changed here.
(() => {
  const { esc, STATUS, STAGES } = WB;
  const V = (WB.views = {});
  const st = () => WB.state;
  const ui = () => WB.ui;
  const DAY = 864e5;

  // ---------- small building blocks ----------
  const initial = (name) => {
    const parts = name.trim().split(/\s+/);
    return (parts[parts.length - 1][0] || '?').toUpperCase();
  };
  const avatar = (u, cls = '') =>
    u
      ? `<span class="av ${cls}" style="background:${u.color}" title="${esc(u.name)}">${esc(initial(u.name))}</span>`
      : `<span class="av av-none ${cls}" title="Chưa giao cho ai">?</span>`;
  const pill = (key) =>
    `<span class="pill" style="--c:${STATUS[key].color}">${STATUS[key].label}</span>`;
  const fmtDate = (s) => {
    if (!s) return '';
    const [d, t] = s.split('T');
    const [y, m, dd] = d.split('-');
    const yr = +y === new Date().getFullYear() ? '' : '/' + y;
    return `${dd}/${m}${yr}${t ? ' ' + t : ''}`;
  };
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
  const badges = (t) => {
    const out = [];
    const sub = WB.subs(t.id);
    if (sub.length)
      out.push(
        `<span class="bd" title="Công việc con">⑂ ${sub.filter((x) => x.status === 'done').length}/${sub.length}</span>`,
      );
    if (t.checklist.length)
      out.push(
        `<span class="bd" title="Danh sách kiểm tra">☑ ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}</span>`,
      );
    if (t.comments.length)
      out.push(
        `<span class="bd" title="Bình luận">💬 ${t.comments.length}</span>`,
      );
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
    return `<button class="chk ${t.status}" data-act="toggle-done" data-id="${t.id}" title="${title}" aria-label="${title}">${mark}</button>`;
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
        ${showProject && p ? `<span class="chip"><i style="background:${p.color}"></i>${esc(p.name)}</span>` : ''}
        ${dueCell(t)}
        ${pill(WB.statusOf(t))}
        ${avatar(WB.user(t.assigneeId))}
      </span>
    </div>`;
  };
  const svg = (inner) =>
    `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
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
      <div class="legend">${keys.map((k) => `<span><i style="background:${STATUS[k].color}"></i>${STATUS[k].label}: <b>${c[k]}</b></span>`).join('')}</div>`;
  };

  // ---------- sidebar ----------
  V.side = () => {
    const r = ui().route;
    const open = WB.myTasks('assigned').filter(
      (t) => t.status !== 'done',
    ).length;
    const nav = (page, label, icon, extra = '') =>
      `<a class="nav ${r.page === page ? 'on' : ''}" href="#/${page}"><span class="ico">${icon}</span>${label}${extra}</a>`;
    const projLink = (p) =>
      `<a class="nav sm ${r.page === 'p' && r.id === p.id ? 'on' : ''}" href="#/p/${p.id}"><i class="dot" style="background:${p.color}"></i><span class="ell">${esc(p.name)}</span></a>`;
    return `
      <div class="brand"><span class="logo">W</span>WorkBoard<button class="menu-btn" data-act="toggle-side" aria-label="Mở menu">☰</button></div>
      <nav class="side-body ${ui().sideOpen ? 'open' : ''}">
        ${nav('my', 'Việc của tôi', svg('<path d="M4 12l5 5L20 6"/>'), open ? `<b class="count">${open}</b>` : '')}
        ${nav('projects', 'Dự án & Nhóm', svg('<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="10" rx="1.5"/>'))}
        ${nav('reports', 'Báo cáo', svg('<path d="M5 20V10M12 20V4M19 20v-7"/>'))}
        ${nav('members', 'Thành viên', svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'))}
        <div class="side-title">Dự án</div>
        ${
          st()
            .projects.filter((p) => p.kind === 'project')
            .map(projLink)
            .join('') || '<div class="side-empty">Chưa có dự án</div>'
        }
        <div class="side-title">Nhóm</div>
        ${
          st()
            .projects.filter((p) => p.kind === 'team')
            .map(projLink)
            .join('') || '<div class="side-empty">Chưa có nhóm</div>'
        }
        <div class="side-foot">
          <label class="lbl">Bạn đang dùng với tên</label>
          <div class="who">${avatar(WB.me())}<select data-chg="switch-user" aria-label="Đổi người dùng">${options(st().users, st().me)}</select></div>
          <button class="link" data-act="reset-data">Khôi phục dữ liệu mẫu</button>
        </div>
      </nav>`;
  };

  // ---------- page router ----------
  V.main = () => {
    const r = ui().route;
    if (r.page === 'projects') return V.projects();
    if (r.page === 'p') return V.project(r.id, r.view);
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
    const today = WB.ymd(new Date());
    const week = WB.ymd(WB.addDays(new Date(), 7));
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
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-act="my-tab" data-tab="${k}">${l} <span class="n">${WB.myTasks(k).filter((t) => t.status !== 'done').length}</span></button>`).join('')}</div>
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
            ? `<details class="done-box"><summary>Đã hoàn thành (${done.length})</summary>${done.map((t) => taskRow(t, { showProject: true })).join('')}</details>`
            : ''
        }
      </section>`;
  };

  // ---------- projects & teams ----------
  V.projects = () => {
    const card = (p) => {
      const pr = WB.progress(WB.tasksOf(p.id));
      const c = WB.counts(WB.tasksOf(p.id));
      return `<a class="pcard" href="#/p/${p.id}" style="--c:${p.color}">
        <div class="pcard-top"><span class="kind">${p.kind === 'project' ? 'Dự án' : 'Nhóm'}</span>${
          p.kind === 'project'
            ? `<span class="stage" style="--c:${STAGES[p.stage].color}">${STAGES[p.stage].label}</span>`
            : ''
        }</div>
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
    const section = (d) => {
      const list = st().projects.filter((p) => p.deptId === (d ? d.id : ''));
      if (!d && !list.length) return '';
      return `<section class="dept">
        <h2>${d ? esc(d.name) : 'Chưa thuộc phòng ban'} <span class="n">${list.length}</span>
          ${d ? `<button class="icon-btn" data-act="rename-dept" data-id="${d.id}" title="Đổi tên phòng ban">✎</button><button class="icon-btn" data-act="del-dept" data-id="${d.id}" title="Xóa phòng ban">🗑</button>` : ''}
        </h2>
        <div class="pgrid">${list.map(card).join('') || '<div class="muted small">Phòng ban này chưa có dự án hay nhóm nào.</div>'}</div>
      </section>`;
    };
    return `
      <header class="page-head">
        <div><h1>Dự án & Nhóm</h1><p class="sub">Dự án có ngày bắt đầu, ngày kết thúc và mục tiêu. Nhóm dành cho việc lặp lại hằng tuần, hằng tháng.</p></div>
        <div class="actions">
          <button class="btn" data-act="new-dept">+ Phòng ban</button>
          <button class="btn" data-act="new-project" data-kind="team">+ Nhóm</button>
          <button class="btn primary" data-act="new-project" data-kind="project">+ Dự án</button>
        </div>
      </header>
      ${st().departments.map(section).join('')}${section(null)}`;
  };

  // ---------- one project / team ----------
  const applyFilter = (tasks) => {
    const f = ui().filter;
    const q = f.q.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        (!q || t.name.toLowerCase().includes(q)) &&
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
    if (!p)
      return `<header class="page-head"><h1>Không tìm thấy</h1></header>${empty('Dự án này không còn nữa. <a href="#/projects">Về danh sách dự án</a>')}`;
    const tabs =
      p.kind === 'project'
        ? [
            ['list', 'Danh sách'],
            ['table', 'Bảng'],
            ['kanban', 'Kanban'],
            ['gantt', 'Gantt'],
            ['calendar', 'Lịch'],
            ['milestones', 'Mục tiêu'],
          ]
        : [
            ['list', 'Danh sách'],
            ['kanban', 'Kanban'],
            ['calendar', 'Lịch'],
          ];
    if (!tabs.some(([k]) => k === view)) view = 'list';
    const all = WB.tasksOf(id);
    const pr = WB.progress(all);
    const tasks = applyFilter(WB.topTasks(id));
    const f = ui().filter;
    const d = WB.dept(p.deptId);
    const body = {
      list: V.list,
      table: V.table,
      kanban: V.kanban,
      gantt: V.gantt,
      calendar: V.calendar,
      milestones: V.milestones,
    }[view](p, tasks);
    return `
      <header class="page-head proj">
        <div class="grow">
          <div class="crumbs"><a href="#/projects">Dự án & Nhóm</a> › ${d ? esc(d.name) : 'Chưa thuộc phòng ban'}</div>
          <h1><i class="dot lg" style="background:${p.color}"></i>${esc(p.name)}
            <span class="kind">${p.kind === 'project' ? 'Dự án' : 'Nhóm'}</span>
            ${p.kind === 'project' ? `<span class="stage" style="--c:${STAGES[p.stage].color}">${STAGES[p.stage].label}</span>` : ''}
            ${p.review ? '<span class="kind" title="Việc phải được người quản trị duyệt mới tính là xong">Có duyệt</span>' : ''}
          </h1>
          <div class="proj-meta">
            ${p.start || p.end ? `<span>📅 ${fmtDate(p.start) || '…'} → ${fmtDate(p.end) || '…'}</span>` : ''}
            <span class="avs">${p.memberIds.map((u) => avatar(WB.user(u), 'sm')).join('')}</span>
            <span class="prog">${bar(pr.pct, p.color)} ${pr.pct}% · ${pr.done}/${pr.total} việc</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn" data-act="export-csv" data-id="${p.id}" title="Tải file mở được bằng Excel">Xuất Excel (CSV)</button>
          <button class="btn" data-act="edit-project" data-id="${p.id}">Cài đặt</button>
        </div>
      </header>
      <div class="toolbar">
        <div class="tabs">${tabs.map(([k, l]) => `<a class="tab ${view === k ? 'on' : ''}" href="#/p/${p.id}/${k}">${l}</a>`).join('')}</div>
        ${
          view === 'milestones'
            ? ''
            : `<div class="filters">
          <input id="f-q" class="inp" data-input="filter-q" value="${esc(f.q)}" placeholder="Tìm công việc…" aria-label="Tìm công việc" />
          <select class="inp" data-chg="filter" data-key="assignee" aria-label="Lọc theo người">${options(
            p.memberIds.map(WB.user).filter(Boolean),
            f.assignee,
            'Mọi người',
          )}</select>
          <select class="inp" data-chg="filter" data-key="status" aria-label="Lọc theo trạng thái">${options(
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
                <button class="icon-btn" data-act="move-tasklist" data-id="${l.id}" data-dir="-1" title="Chuyển lên" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="icon-btn" data-act="move-tasklist" data-id="${l.id}" data-dir="1" title="Chuyển xuống" ${i === lists.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="icon-btn" data-act="rename-tasklist" data-id="${l.id}" title="Đổi tên">✎</button>
                <button class="icon-btn" data-act="del-tasklist" data-id="${l.id}" title="Xóa danh sách việc">🗑</button>
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
    const cols = [
      ['name', 'Tên công việc'],
      ['tasklist', 'Danh sách việc'],
      ['assignee', 'Người thực hiện'],
      ['start', 'Bắt đầu'],
      ['due', 'Hạn chót'],
      ['status', 'Trạng thái'],
      ['flags', 'Nhãn'],
      ['milestone', 'Mục tiêu'],
    ];
    const val = {
      name: (t) => t.name.toLowerCase(),
      tasklist: (t) => (WB.tasklist(t.tasklistId) || {}).name || '',
      assignee: (t) => (WB.user(t.assigneeId) || {}).name || '￿',
      start: (t) => t.start || '9',
      due: (t) => t.due || '9',
      status: (t) => Object.keys(STATUS).indexOf(WB.statusOf(t)),
      flags: (t) => -(t.important * 2 + t.urgent),
      milestone: (t) => (WB.milestone(t.milestoneId) || {}).name || '￿',
    };
    const rows = [...tasks];
    if (sort.key)
      rows.sort((a, b) => {
        const x = val[sort.key](a);
        const y = val[sort.key](b);
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
    return `<section class="panel flush"><div class="scroll-x"><table class="tbl">
      <thead><tr><th class="w-chk"></th>${cols
        .map(
          ([k, l]) =>
            `<th><button class="th-btn" data-act="sort" data-key="${k}">${l}${sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`,
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
          <td>${esc((WB.milestone(t.milestoneId) || {}).name || '')}</td>
        </tr>`;
          })
          .join('') ||
        `<tr><td colspan="9">${empty('Chưa có công việc nào.')}</td></tr>`
      }</tbody>
    </table></div>
    ${WB.listsOf(p.id)[0] ? quickAdd('qa-table', `data-project="${p.id}" data-tasklist="${WB.listsOf(p.id)[0].id}"`, `+ Thêm công việc vào “${esc(WB.listsOf(p.id)[0].name)}”, nhấn Enter`) : ''}
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
    return `
      <div class="kbar">Xếp cột theo:
        <select class="inp" data-chg="kanban-group" aria-label="Xếp cột theo">
          <option value="tasklist" ${group === 'tasklist' ? 'selected' : ''}>Danh sách việc</option>
          <option value="status" ${group === 'status' ? 'selected' : ''}>Trạng thái</option>
        </select>
        <span class="muted small">Kéo thẻ sang cột khác để chuyển.</span>
      </div>
      <div class="kanban" data-scroll="kanban:${p.id}:${group}">
        ${cols
          .map(
            (c) => `<section class="kcol" data-drop="${c.id}">
          <h3 style="--c:${c.color}">${esc(c.name)} <span class="n">${c.tasks.length}</span></h3>
          <div class="kcards">${c.tasks.map(card).join('')}</div>
          ${
            group === 'status'
              ? c.id === 'todo' || c.id === 'doing'
                ? WB.listsOf(p.id)[0]
                  ? quickAdd(
                      `qa-k-${c.id}`,
                      `data-project="${p.id}" data-tasklist="${WB.listsOf(p.id)[0].id}" data-status="${c.id}"`,
                      '+ Thêm công việc',
                    )
                  : ''
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

  V.gantt = (p, tasks) => {
    const W = 30;
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
    const today = day0(WB.ymd(new Date()));
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
        ${track(`<div class="g-bar" data-act="open-task" data-id="${t.id}" style="left:${off(a) * W + 2}px;width:${(off(b) - off(a) + 1) * W - 4}px;background:${STATUS[s].color}" title="${esc(t.name)} · ${fmtDate(t.start) || '…'} → ${fmtDate(t.due) || '…'} · ${STATUS[s].label}"><span>${esc(t.name)}</span></div>`)}
      </div>`;
    };
    const groups = WB.listsOf(p.id)
      .map((l) => {
        const mine = items.filter((t) => t.tasklistId === l.id);
        if (!mine.length) return '';
        return `<div class="g-row g-group"><div class="g-left">${esc(l.name)} <span class="n">${mine.length}</span></div>${track('')}</div>${mine.map(row).join('')}`;
      })
      .join('');
    return `<section class="panel flush">
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
    const today = WB.ymd(new Date());
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

  V.milestones = (p) => {
    const list = [...WB.milestonesOf(p.id)].sort((a, b) =>
      (a.due || '9').localeCompare(b.due || '9'),
    );
    const today = WB.ymd(new Date());
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
            <button class="icon-btn" data-act="del-milestone" data-id="${m.id}" title="Xóa mục tiêu">🗑</button></div>
          ${linked.map((t) => taskRow(t)).join('') || '<div class="muted small pad">Chưa có công việc nào gắn với mục tiêu này.</div>'}
        </div>`;
          })
          .join('') || empty('Dự án chưa có mục tiêu nào.')
      }
      <form class="inline-form" data-form="add-milestone" data-project="${p.id}">
        <input class="inp grow" name="name" required placeholder="Tên mục tiêu mới" aria-label="Tên mục tiêu" />
        <input class="inp" type="date" name="due" aria-label="Hạn của mục tiêu" />
        <button class="btn primary">Thêm mục tiêu</button>
      </form>
    </section>`;
  };

  // ---------- reports ----------
  V.reports = () => {
    const tasks = st().tasks;
    const c = WB.counts(tasks);
    const projs = st().projects.filter((p) => p.kind === 'project');
    const teams = st().projects.filter((p) => p.kind === 'team');
    const open = tasks.filter((t) => t.status !== 'done');
    const quad = [
      [
        'Quan trọng & Khẩn cấp',
        'Làm ngay',
        (t) => t.important && t.urgent,
        '#e5484d',
      ],
      [
        'Quan trọng, không khẩn cấp',
        'Lên lịch để làm',
        (t) => t.important && !t.urgent,
        '#2f80ed',
      ],
      [
        'Khẩn cấp, không quan trọng',
        'Giao cho người khác nếu được',
        (t) => !t.important && t.urgent,
        '#f2994a',
      ],
      [
        'Không quan trọng, không khẩn cấp',
        'Làm sau',
        (t) => !t.important && !t.urgent,
        '#8a94a6',
      ],
    ];
    const days = [...Array(7)].map((_, i) => {
      const d = WB.addDays(new Date(), i - 6);
      const key = WB.ymd(d);
      return {
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        n: tasks.filter(
          (t) => t.status === 'done' && t.doneAt.slice(0, 10) === key,
        ).length,
      };
    });
    const maxDay = Math.max(1, ...days.map((d) => d.n));
    const perUser = st().users.map((u) => {
      const mine = tasks.filter((t) => t.assigneeId === u.id);
      const k = WB.counts(mine);
      return {
        u,
        onTime: k.done,
        slow: k.overdue + k.late,
        total: mine.length,
      };
    });
    const top = [...perUser]
      .sort((a, b) => b.onTime - a.onTime)
      .filter((x) => x.onTime);
    const slow = [...perUser]
      .sort((a, b) => b.slow - a.slow)
      .filter((x) => x.slow);
    const reviewing = tasks.filter((t) => t.status === 'review');
    const stat = (n, label, cls = '') =>
      `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
    const rank = (list, key, unit) =>
      list
        .slice(0, 5)
        .map(
          (x) =>
            `<div class="rank"><a href="#/members/${x.u.id}">${avatar(x.u, 'sm')} ${esc(x.u.name)}</a><b>${x[key]} ${unit}</b></div>`,
        )
        .join('') || '<div class="muted small">Chưa có dữ liệu.</div>';
    return `
      <header class="page-head"><div><h1>Báo cáo</h1><p class="sub">Tổng hợp toàn bộ dự án và nhóm, tính từ dữ liệu đang có trong ứng dụng.</p></div></header>
      <div class="stats">
        ${stat(projs.length, 'Dự án')}${stat(teams.length, 'Nhóm')}${stat(c.total, 'Công việc')}${stat(st().users.length, 'Thành viên')}
        ${stat(c.overdue, 'Việc quá hạn', 'red')}${stat(c.review, 'Việc chờ duyệt', 'amber')}
      </div>
      <div class="grid2">
        <section class="panel"><h2>Công việc theo trạng thái</h2>${stackBar(c)}</section>
        <section class="panel"><h2>Việc hoàn thành 7 ngày qua</h2>
          <div class="cols">${days.map((d) => `<div class="col"><b>${d.n}</b><i style="height:${(d.n / maxDay) * 90 + 2}px"></i><span>${d.label}</span></div>`).join('')}</div>
        </section>
      </div>
      <section class="panel"><h2>Ma trận ưu tiên (việc chưa xong)</h2>
        <div class="quad">${quad
          .map(([title, hint, test, color]) => {
            const list = open.filter(test);
            return `<div class="q" style="--c:${color}"><h3>${title} <span class="n">${list.length}</span></h3><p class="muted small">${hint}</p>
            ${list
              .slice(0, 5)
              .map(
                (t) =>
                  `<button class="q-task" data-act="open-task" data-id="${t.id}">${esc(t.name)}</button>`,
              )
              .join('')}
            ${list.length > 5 ? `<span class="muted small">+${list.length - 5} việc nữa</span>` : ''}</div>`;
          })
          .join('')}</div>
      </section>
      <section class="panel flush"><h2 class="pad-h">Theo từng dự án / nhóm</h2><div class="scroll-x"><table class="tbl">
        <thead><tr><th>Tên</th><th>Loại</th><th>Tình trạng</th><th>Tổng việc</th><th>Xong</th><th>Quá hạn</th><th>Chờ duyệt</th><th>Tiến độ</th></tr></thead>
        <tbody>${st()
          .projects.map((p) => {
            const k = WB.counts(WB.tasksOf(p.id));
            const pr = WB.progress(WB.tasksOf(p.id));
            return `<tr><td><a href="#/p/${p.id}"><i class="dot" style="background:${p.color}"></i> ${esc(p.name)}</a></td><td>${p.kind === 'project' ? 'Dự án' : 'Nhóm'}</td>
            <td>${p.kind === 'project' ? `<span class="stage" style="--c:${STAGES[p.stage].color}">${STAGES[p.stage].label}</span>` : '—'}</td>
            <td>${k.total}</td><td>${k.done + k.late}</td><td class="${k.overdue ? 'red' : ''}">${k.overdue}</td><td>${k.review}</td><td>${bar(pr.pct, p.color)} ${pr.pct}%</td></tr>`;
          })
          .join('')}</tbody></table></div>
      </section>
      <div class="grid3">
        <section class="panel"><h2>Hoàn thành đúng hạn nhiều nhất</h2>${rank(top, 'onTime', 'việc')}</section>
        <section class="panel"><h2>Trễ hạn nhiều nhất</h2><p class="muted small">Tính cả việc đang quá hạn và việc xong muộn.</p>${rank(slow, 'slow', 'việc')}</section>
        <section class="panel"><h2>Việc đang chờ duyệt</h2>${reviewing.map((t) => taskRow(t)).join('') || '<div class="muted small">Không có việc nào chờ duyệt.</div>'}</section>
      </div>`;
  };

  // ---------- members ----------
  const memberCounts = (id) => {
    const c = WB.counts(st().tasks.filter((t) => t.assigneeId === id));
    return {
      todo: c.todo,
      doing: c.doing + c.review,
      done: c.done + c.late,
      overdue: c.overdue,
      total: c.total,
      raw: c,
    };
  };
  V.members = () => `
    <header class="page-head">
      <div><h1>Thành viên</h1><p class="sub">Bấm vào một người để xem báo cáo công việc của người đó.</p></div>
      <div class="actions"><button class="btn primary" data-act="new-member">+ Thành viên</button></div>
    </header>
    <section class="panel flush"><div class="scroll-x"><table class="tbl">
      <thead><tr><th>Thành viên</th><th>Chức danh</th><th>Cần làm</th><th>Đang làm</th><th>Hoàn thành</th><th>Quá hạn</th><th>Tổng</th></tr></thead>
      <tbody>${st()
        .users.map((u) => {
          const c = memberCounts(u.id);
          return `<tr data-act="go" data-href="#/members/${u.id}"><td>${avatar(u, 'sm')} <strong>${esc(u.name)}</strong>${u.id === st().me ? ' <span class="kind">Bạn</span>' : ''}</td>
          <td>${esc(u.title || '')}</td><td>${c.todo}</td><td>${c.doing}</td><td>${c.done}</td><td class="${c.overdue ? 'red' : ''}">${c.overdue}</td><td>${c.total}</td></tr>`;
        })
        .join('')}</tbody>
    </table></div></section>`;

  V.member = (id) => {
    const u = WB.user(id);
    if (!u)
      return `<header class="page-head"><h1>Không tìm thấy thành viên</h1></header>`;
    const mine = st().tasks.filter((t) => t.assigneeId === id);
    const c = memberCounts(id);
    const stat = (n, label, cls = '') =>
      `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
    const groups = st()
      .projects.map((p) => [p, mine.filter((t) => t.projectId === p.id)])
      .filter(([, list]) => list.length);
    return `
      <header class="page-head">
        <div><div class="crumbs"><a href="#/members">Thành viên</a> › Báo cáo</div>
          <h1>${avatar(u)} ${esc(u.name)}</h1><p class="sub">${esc(u.title || '')}</p></div>
        <div class="actions no-print">
          <button class="btn" data-act="export-member" data-id="${u.id}">Xuất Excel (CSV)</button>
          <button class="btn" data-act="print">In báo cáo</button>
          <button class="btn danger" data-act="del-member" data-id="${u.id}">Xóa thành viên</button>
        </div>
      </header>
      <div class="stats">${stat(c.todo, 'Cần làm')}${stat(c.doing, 'Đang làm')}${stat(c.done, 'Hoàn thành', 'green')}${stat(c.overdue, 'Quá hạn', 'red')}</div>
      <section class="panel"><h2>Tỷ lệ công việc</h2>${stackBar(c.raw)}</section>
      ${
        groups
          .map(
            ([p, list]) =>
              `<section class="panel"><h2><a href="#/p/${p.id}"><i class="dot" style="background:${p.color}"></i> ${esc(p.name)}</a> <span class="n">${list.length}</span></h2>${list.map((t) => taskRow(t)).join('')}</section>`,
          )
          .join('') ||
        `<section class="panel">${empty('Người này chưa được giao việc nào.')}</section>`
      }`;
  };

  // ---------- task detail (right-hand drawer) ----------
  V.drawer = () => {
    const t = WB.task(ui().taskId);
    if (!t) return '';
    const p = WB.project(t.projectId);
    const parent = WB.task(t.parentId);
    const s = WB.statusOf(t);
    const admin = WB.isAdmin(p);
    const members = p.memberIds.map(WB.user).filter(Boolean);
    const sub = WB.subs(t.id);
    const blockers = WB.blockers(t);
    const candidates = WB.tasksOf(p.id).filter(
      (x) => x.id !== t.id && !x.parentId && !t.dependsOn.includes(x.id),
    );
    let main;
    if (t.status === 'done')
      main = `<button class="btn" data-act="toggle-done" data-id="${t.id}">↺ Mở lại</button>`;
    else if (t.status === 'review')
      main = admin
        ? `<button class="btn primary" data-act="toggle-done" data-id="${t.id}">✓ Duyệt hoàn thành</button><button class="btn" data-act="reject" data-id="${t.id}">Trả lại làm tiếp</button>`
        : `<button class="btn" data-act="reject" data-id="${t.id}">Rút lại yêu cầu duyệt</button>`;
    else
      main = `<button class="btn primary" data-act="toggle-done" data-id="${t.id}">✓ ${p.review && !admin ? 'Gửi duyệt hoàn thành' : 'Hoàn thành'}</button>`;
    const row = (label, html) =>
      `<div class="frow"><label>${label}</label><div class="fval">${html}</div></div>`;
    return `
      <div class="drawer-back" data-act="close-drawer"></div>
      <aside class="drawer" role="dialog" aria-label="Chi tiết công việc">
        <div class="drawer-top">${main}${pill(s)}<span class="grow"></span>
          <button class="icon-btn" data-act="del-task" data-id="${t.id}" title="Xóa công việc">🗑</button>
          <button class="icon-btn" data-act="close-drawer" title="Đóng (Esc)">✕</button></div>
        <div class="drawer-body" data-scroll="drawer:${t.id}">
          <div class="crumbs"><a href="#/p/${p.id}" data-act="close-drawer-soft"><i class="dot" style="background:${p.color}"></i> ${esc(p.name)}</a>${
            parent
              ? ` › <button class="link" data-act="open-task" data-id="${parent.id}">${esc(parent.name)}</button>`
              : ''
          }</div>
          <textarea class="title-inp" rows="1" data-chg="field" data-field="name" aria-label="Tên công việc">${esc(t.name)}</textarea>
          ${
            blockers.length
              ? `<div class="warn">⛔ Còn ${blockers.length} việc phải làm xong trước: ${blockers.map((b) => `<button class="link" data-act="open-task" data-id="${b.id}">${esc(b.name)}</button>`).join(', ')}</div>`
              : ''
          }
          ${row('Người thực hiện', `<select class="inp" data-chg="field" data-field="assigneeId">${options(members, t.assigneeId, 'Chưa giao')}</select>`)}
          ${row(
            'Người theo dõi',
            `<details class="multi"><summary>${
              t.followerIds.map((id) => avatar(WB.user(id), 'sm')).join('') ||
              '<span class="muted">Chưa có — bấm để chọn</span>'
            }</summary>${members
              .map(
                (u) =>
                  `<label class="opt"><input type="checkbox" data-chg="toggle-follower" value="${u.id}" ${t.followerIds.includes(u.id) ? 'checked' : ''} /> ${esc(u.name)}</label>`,
              )
              .join('')}</details>`,
          )}
          ${
            parent
              ? ''
              : row(
                  'Danh sách việc',
                  `<select class="inp" data-chg="field" data-field="tasklistId">${options(WB.listsOf(p.id), t.tasklistId)}</select>`,
                )
          }
          ${row('Ngày bắt đầu', `<input class="inp" type="date" data-chg="field" data-field="start" value="${esc(t.start)}" />`)}
          ${row(
            'Hạn chót',
            `<input class="inp" type="date" data-chg="field" data-field="dueDate" value="${esc(t.due.slice(0, 10))}" />
             <input class="inp" type="time" data-chg="field" data-field="dueTime" value="${esc(t.due.slice(11))}" title="Giờ (không bắt buộc)" aria-label="Giờ hạn chót" />`,
          )}
          ${
            t.status === 'done' || t.status === 'review'
              ? ''
              : row(
                  'Trạng thái',
                  `<select class="inp" data-chg="field" data-field="status"><option value="todo" ${t.status === 'todo' ? 'selected' : ''}>Cần làm</option><option value="doing" ${t.status === 'doing' ? 'selected' : ''}>Đang làm</option></select>`,
                )
          }
          ${row(
            'Nhãn',
            `<button class="toggle imp ${t.important ? 'on' : ''}" data-act="toggle-flag" data-flag="important">Quan trọng</button>
             <button class="toggle urg ${t.urgent ? 'on' : ''}" data-act="toggle-flag" data-flag="urgent">Khẩn cấp</button>`,
          )}
          ${
            p.kind === 'project'
              ? row(
                  'Mục tiêu',
                  `<select class="inp" data-chg="field" data-field="milestoneId">${options(WB.milestonesOf(p.id), t.milestoneId, 'Không gắn')}</select>`,
                )
              : ''
          }
          ${t.doneAt ? row('Xong lúc', `<span>${fmtDate(t.doneAt)}</span>`) : ''}

          <h4>Mô tả</h4>
          <textarea class="inp area" data-chg="field" data-field="desc" placeholder="Viết thêm chi tiết về công việc…">${esc(t.desc)}</textarea>

          <h4>Danh sách kiểm tra <span class="n">${t.checklist.filter((c) => c.done).length}/${t.checklist.length}</span></h4>
          ${t.checklist
            .map(
              (c) =>
                `<div class="check ${c.done ? 'is-done' : ''}"><label><input type="checkbox" data-chg="toggle-check" value="${c.id}" ${c.done ? 'checked' : ''} /> <span>${esc(c.text)}</span></label><button class="icon-btn" data-act="del-check" data-id="${c.id}" title="Xóa dòng này">✕</button></div>`,
            )
            .join('')}
          <input class="quick" id="add-check" data-enter="add-check" placeholder="+ Thêm một dòng kiểm tra, nhấn Enter" aria-label="Thêm dòng kiểm tra" autocomplete="off" />

          ${
            parent
              ? ''
              : `<h4>Công việc con <span class="n">${sub.filter((x) => x.status === 'done').length}/${sub.length}</span></h4>
          ${sub.map((x) => taskRow(x)).join('')}
          ${quickAdd('add-sub', `data-project="${p.id}" data-tasklist="${t.tasklistId}" data-parent="${t.id}"`, '+ Thêm công việc con, nhấn Enter')}

          <h4>Phụ thuộc <span class="muted small">— việc này chỉ nên làm sau khi các việc dưới đây xong</span></h4>
          ${t.dependsOn
            .map(WB.task)
            .filter(Boolean)
            .map(
              (d) =>
                `<div class="dep"><button class="link" data-act="open-task" data-id="${d.id}">${esc(d.name)}</button>${pill(WB.statusOf(d))}<span class="grow"></span><button class="icon-btn" data-act="del-dep" data-id="${d.id}" title="Bỏ phụ thuộc">✕</button></div>`,
            )
            .join('')}
          <select class="inp wide" data-chg="add-dep" aria-label="Thêm việc phải làm trước">${options(candidates, '', '+ Chọn một việc phải làm trước…')}</select>`
          }

          <h4>Kết quả</h4>
          <textarea class="inp area" data-chg="field" data-field="result" placeholder="Ghi lại kết quả khi làm xong (đường dẫn, số liệu, ghi chú…)">${esc(t.result)}</textarea>

          <h4>Bình luận <span class="n">${t.comments.length}</span></h4>
          ${t.comments
            .map((c) => {
              const u = WB.user(c.userId);
              return `<div class="cmt">${avatar(u, 'sm')}<div><b>${esc(u ? u.name : 'Người đã xóa')}</b> <span class="muted small">${fmtDate(c.at)}</span><p>${esc(c.text)}</p></div></div>`;
            })
            .join('')}
          <input class="quick" id="add-comment" data-enter="add-comment" placeholder="Viết bình luận, nhấn Enter để gửi" aria-label="Viết bình luận" autocomplete="off" />
        </div>
      </aside>`;
  };

  // ---------- pop-up forms ----------
  V.modal = () => {
    const m = ui().modal;
    if (!m) return '';
    let title = '';
    let body = '';
    if (m.type === 'project') {
      const p = m.id ? WB.project(m.id) : null;
      const kind = p ? p.kind : m.kind;
      const word = kind === 'project' ? 'dự án' : 'nhóm';
      const v = p || {
        name: '',
        deptId: '',
        adminId: st().me,
        memberIds: [st().me],
        type: 'internal',
        review: false,
        start: '',
        end: '',
        stage: 'plan',
        desc: '',
        color: WB.COLORS[st().projects.length % WB.COLORS.length],
      };
      title = p ? `Cài đặt ${word}` : `Tạo ${word} mới`;
      body = `<form data-form="save-project" data-id="${p ? p.id : ''}" data-kind="${kind}">
        <label class="fld">Tên ${word}<input class="inp" name="name" required value="${esc(v.name)}" autofocus /></label>
        <div class="two">
          <label class="fld">Phòng ban<select class="inp" name="deptId">${options(st().departments, v.deptId, 'Chưa thuộc phòng ban')}</select></label>
          <label class="fld">Người quản trị<select class="inp" name="adminId">${options(st().users, v.adminId)}</select></label>
        </div>
        <fieldset class="fld"><legend>Thành viên</legend><div class="checks">${st()
          .users.map(
            (u) =>
              `<label class="opt"><input type="checkbox" name="memberIds" value="${u.id}" ${v.memberIds.includes(u.id) ? 'checked' : ''} /> ${esc(u.name)}</label>`,
          )
          .join('')}</div></fieldset>
        <div class="two">
          <label class="fld">Phân loại<select class="inp" name="type"><option value="internal" ${v.type === 'internal' ? 'selected' : ''}>Nội bộ</option><option value="customer" ${v.type === 'customer' ? 'selected' : ''}>Làm cho khách hàng</option></select></label>
          <label class="fld opt-line"><input type="checkbox" name="review" ${v.review ? 'checked' : ''} /> Việc phải được người quản trị duyệt mới tính là xong</label>
        </div>
        <details class="adv" ${p ? 'open' : ''}><summary>Cài đặt nâng cao</summary>
          ${
            kind === 'project'
              ? `<div class="two">
            <label class="fld">Ngày bắt đầu<input class="inp" type="date" name="start" value="${esc(v.start)}" /></label>
            <label class="fld">Ngày kết thúc<input class="inp" type="date" name="end" value="${esc(v.end)}" /></label>
          </div>
          <label class="fld">Tình trạng<select class="inp" name="stage">${options(
            Object.entries(STAGES).map(([k, s]) => ({ id: k, name: s.label })),
            v.stage,
          )}</select></label>`
              : ''
          }
          <label class="fld">Mô tả<textarea class="inp area" name="desc">${esc(v.desc)}</textarea></label>
          <fieldset class="fld"><legend>Màu</legend><div class="colors">${WB.COLORS.map(
            (c) =>
              `<label><input type="radio" name="color" value="${c}" ${v.color === c ? 'checked' : ''} /><i style="background:${c}"></i></label>`,
          ).join('')}</div></fieldset>
        </details>
        <div class="modal-foot">
          ${p ? `<button type="button" class="btn danger" data-act="del-project" data-id="${p.id}">Xóa ${word}</button>` : ''}
          <span class="grow"></span>
          <button type="button" class="btn" data-act="close-modal">Hủy</button>
          <button class="btn primary">${p ? 'Lưu' : `Tạo ${word}`}</button>
        </div>
      </form>`;
    } else if (m.type === 'dept') {
      title = 'Tạo phòng ban';
      body = `<form data-form="save-dept">
        <label class="fld">Tên phòng ban<input class="inp" name="name" required autofocus /></label>
        <div class="modal-foot"><span class="grow"></span><button type="button" class="btn" data-act="close-modal">Hủy</button><button class="btn primary">Tạo</button></div>
      </form>`;
    } else if (m.type === 'member') {
      title = 'Thêm thành viên';
      body = `<form data-form="save-member">
        <label class="fld">Họ và tên<input class="inp" name="name" required autofocus /></label>
        <label class="fld">Chức danh<input class="inp" name="title" placeholder="Ví dụ: Kế toán" /></label>
        <div class="modal-foot"><span class="grow"></span><button type="button" class="btn" data-act="close-modal">Hủy</button><button class="btn primary">Thêm</button></div>
      </form>`;
    }
    return `<div class="modal-back" data-act="close-modal"></div>
      <div class="modal" role="dialog" aria-label="${title}"><div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-act="close-modal" title="Đóng">✕</button></div>${body}</div>`;
  };
})();
