'use strict';
// Views, part 2: task details, pop-up forms, notifications, repeating tasks, reports and members.
(() => {
  const { esc, STATUS, STAGES, fmtDate } = WB;
  const V = WB.views;
  const { avatar, pill, options, taskRow, empty, stackBar, bar, svg, ICON } = V;
  const st = () => WB.state;
  const ui = () => WB.ui;
  const cloud = () => WB.mode === 'cloud';

  // ---------- notifications panel ----------
  V.panel = () => {
    if (ui().panel !== 'notif') return '';
    const tab = ui().panelTab;
    const list = WB.myNotifications().slice(0, 100);
    const unread = list.filter((n) => !n.read).length;
    const mine = WB.myTasks('assigned').filter(
      (t) => t.status !== 'done' && t.due,
    );
    const todayStr = WB.today();
    const tomorrow = WB.shiftDate(todayStr, 1);
    const groups = [
      ['Quá hạn', mine.filter((t) => WB.statusOf(t) === 'overdue'), 'red'],
      [
        'Hôm nay',
        mine.filter(
          (t) =>
            WB.statusOf(t) !== 'overdue' && t.due.slice(0, 10) === todayStr,
        ),
      ],
      ['Ngày mai', mine.filter((t) => t.due.slice(0, 10) === tomorrow)],
    ];
    const reminders = groups.reduce((n, [, l]) => n + l.length, 0);
    const item = (n) => {
      const t = WB.task(n.taskId);
      const a = WB.user(n.actorId);
      return `<button class="note ${n.read ? '' : 'unread'}" data-act="open-note" data-id="${n.id}">
        ${avatar(a, 'sm')}<span class="note-body"><span><b>${esc(a ? a.name : 'Ai đó')}</b> ${esc(WB.NOTE[n.kind] || '')} <b>${esc(t ? t.name : '')}</b></span>${n.text ? `<span class="note-quote">${esc(n.text)}</span>` : ''}<span class="muted small">${esc(WB.ago(n.at))}</span></span>
      </button>`;
    };
    return `<div class="panel-back" data-act="close-panel"></div>
      <aside class="npanel" role="dialog" aria-label="Thông báo">
        <header class="np-head"><h2>Thông báo</h2><span class="grow"></span>
          ${unread ? '<button class="link" data-act="read-all">Đánh dấu đã đọc hết</button>' : ''}
          <button class="icon-btn" data-act="close-panel" aria-label="Đóng thông báo">✕</button></header>
        <div class="tabs np-tabs">
          <button class="tab ${tab === 'notes' ? 'on' : ''}" data-act="panel-tab" data-tab="notes">Mới <span class="n">${unread}</span></button>
          <button class="tab ${tab === 'remind' ? 'on' : ''}" data-act="panel-tab" data-tab="remind">Nhắc việc <span class="n">${reminders}</span></button>
        </div>
        <div class="np-body">
        ${
          tab === 'remind'
            ? groups
                .filter(([, l]) => l.length)
                .map(
                  ([title, l, cls]) =>
                    `<h3 class="group ${cls || ''}">${title} <span class="n">${l.length}</span></h3>${l.map((t) => taskRow(t, { showProject: true })).join('')}`,
                )
                .join('') ||
              empty(
                'Không có việc nào của bạn quá hạn, đến hạn hôm nay hay ngày mai.',
              )
            : list.map(item).join('') ||
              empty(
                'Chưa có thông báo nào. Khi có người giao việc, bình luận hay gửi duyệt cho bạn, thông báo sẽ hiện ở đây.',
              )
        }
        </div>
      </aside>`;
  };

  // ---------- repeating tasks page ----------
  V.repeats = () => {
    const list = st().repeats.filter((r) => WB.canSee(WB.project(r.projectId)));
    const rows = list
      .map((r) => {
        const p = WB.project(r.projectId);
        const next = r.enabled
          ? WB.nextOccurrence(r, WB.shiftDate(WB.today(), 1))
          : '';
        const made = st().tasks.filter((t) => t.repeatId === r.id).length;
        return `<tr>
          <td class="td-name"><strong>${esc(r.name)}</strong>${r.desc ? `<div class="muted small">${esc(r.desc)}</div>` : ''}</td>
          <td>${p ? `<a href="#p-${p.id}"><i class="dot" style="background:${esc(p.color)}"></i> ${esc(p.name)}</a>` : ''}</td>
          <td>${r.assigneeId && WB.user(r.assigneeId) ? `${avatar(WB.user(r.assigneeId), 'sm')} ${esc(WB.userName(r.assigneeId))}` : '<span class="muted">Chưa giao</span>'}</td>
          <td>${esc(WB.describeRepeat(r))}${r.end ? `<div class="muted small">đến ${fmtDate(r.end)}</div>` : ''}</td>
          <td>${next ? fmtDate(next) : '<span class="muted">—</span>'}</td>
          <td>${made}</td>
          <td><label class="switch"><input type="checkbox" id="rep-on-${r.id}" data-chg="repeat-enabled" value="${r.id}" ${r.enabled ? 'checked' : ''} aria-label="Bật việc lặp lại ${esc(r.name)}" /><span></span></label></td>
          <td class="nowrap"><button class="btn sm" data-act="edit-repeat" data-id="${r.id}">Sửa</button>
            <button class="icon-btn" data-act="del-repeat" data-id="${r.id}" title="Xóa" aria-label="Xóa việc lặp lại ${esc(r.name)}">🗑</button></td>
        </tr>`;
      })
      .join('');
    return `
      <header class="page-head">
        <div><h1>Việc lặp lại</h1><p class="sub">Mỗi quy tắc tự tạo một công việc mới vào đúng ngày (hằng ngày, hằng tuần, hằng tháng hoặc hằng năm). Việc được tạo khi có người mở ứng dụng vào ngày đó.</p></div>
        <div class="actions"><button class="btn primary" data-act="new-repeat">+ Việc lặp lại</button></div>
      </header>
      <section class="panel flush"><div class="scroll-x"><table class="tbl">
        <thead><tr><th>Công việc</th><th>Dự án / Nhóm</th><th>Người thực hiện</th><th>Lịch lặp</th><th>Lần tới</th><th>Đã tạo</th><th>Bật</th><th><span class="sr">Thao tác</span></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">${empty('Chưa có việc lặp lại nào. Ví dụ: “Gửi báo cáo tuần” vào thứ 6 hằng tuần.')}</td></tr>`}</tbody>
      </table></div></section>`;
  };

  // ---------- reports ----------
  V.reports = () => {
    const tasks = WB.visibleTasks();
    const c = WB.counts(tasks);
    const visible = WB.visibleProjects();
    const projs = visible.filter((p) => p.kind === 'project');
    const teams = visible.filter((p) => p.kind === 'team');
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
            `<div class="rank"><a href="#member-${x.u.id}">${avatar(x.u, 'sm')} ${esc(x.u.name)}</a><b>${x[key]} ${unit}</b></div>`,
        )
        .join('') || '<div class="muted small">Chưa có dữ liệu.</div>';
    return `
      <header class="page-head"><div><h1>Báo cáo</h1><p class="sub">Tổng hợp các dự án và nhóm bạn xem được, tính từ dữ liệu đang có trong ứng dụng.</p></div></header>
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
        <tbody>${visible
          .map((p) => {
            const k = WB.counts(WB.tasksOf(p.id));
            const pr = WB.progress(WB.tasksOf(p.id));
            return `<tr><td><a href="#p-${p.id}"><i class="dot" style="background:${esc(p.color)}"></i> ${esc(p.name)}</a></td><td>${p.kind === 'project' ? 'Dự án' : 'Nhóm'}</td>
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
  const ROLE = { owner: 'Chủ sở hữu', admin: 'Quản trị', member: 'Thành viên' };
  const memberCounts = (id) => {
    const c = WB.counts(WB.visibleTasks().filter((t) => t.assigneeId === id));
    return {
      todo: c.todo,
      doing: c.doing + c.review,
      done: c.done + c.late,
      overdue: c.overdue,
      total: c.total,
      raw: c,
    };
  };
  V.members = () => {
    const manage = cloud() && WB.isWorkspaceAdmin();
    return `
    <header class="page-head">
      <div><h1>Thành viên</h1><p class="sub">Bấm vào một người để xem báo cáo công việc của người đó.</p></div>
      <div class="actions">${
        cloud()
          ? '<button class="btn primary" data-act="open-invite">+ Mời người vào</button>'
          : '<button class="btn primary" data-act="new-member">+ Thành viên</button>'
      }</div>
    </header>
    <section class="panel flush"><div class="scroll-x"><table class="tbl">
      <thead><tr><th>Thành viên</th><th>Chức danh</th>${cloud() ? '<th>Vai trò</th>' : ''}<th>Cần làm</th><th>Đang làm</th><th>Hoàn thành</th><th>Quá hạn</th><th>Tổng</th></tr></thead>
      <tbody>${st()
        .users.map((u) => {
          const c = memberCounts(u.id);
          let role = '';
          if (cloud()) {
            const canEdit =
              manage &&
              u.role !== 'owner' &&
              u.id !== st().me &&
              (WB.myRole() === 'owner' || u.role !== 'admin');
            role = canEdit
              ? `<td><select class="inp sm" id="role-${u.id}" data-chg="member-role" data-id="${u.id}" aria-label="Vai trò của ${esc(u.name)}">${[
                  'admin',
                  'member',
                ]
                  .map(
                    (r) =>
                      `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE[r]}</option>`,
                  )
                  .join(
                    '',
                  )}</select> <button class="icon-btn" data-act="remove-member" data-id="${u.id}" title="Mời ra khỏi không gian" aria-label="Mời ${esc(u.name)} ra khỏi không gian làm việc">🗑</button></td>`
              : `<td>${ROLE[u.role] || ''}</td>`;
          }
          return `<tr data-act="go" data-href="#member-${u.id}"><td>${avatar(u, 'sm')} <strong>${esc(u.name)}</strong>${u.id === st().me ? ' <span class="kind">Bạn</span>' : ''}</td>
          <td>${esc(u.title || '')}</td>${role}<td>${c.todo}</td><td>${c.doing}</td><td>${c.done}</td><td class="${c.overdue ? 'red' : ''}">${c.overdue}</td><td>${c.total}</td></tr>`;
        })
        .join('')}</tbody>
    </table></div></section>`;
  };

  V.member = (id) => {
    const u = WB.user(id);
    if (!u)
      return '<header class="page-head"><h1>Không tìm thấy thành viên</h1></header>';
    const mine = WB.visibleTasks().filter((t) => t.assigneeId === id);
    const c = memberCounts(id);
    const stat = (n, label, cls = '') =>
      `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
    const groups = WB.visibleProjects()
      .map((p) => [p, mine.filter((t) => t.projectId === p.id)])
      .filter(([, list]) => list.length);
    const self = id === st().me;
    return `
      <header class="page-head">
        <div><div class="crumbs"><a href="#members">Thành viên</a> › Báo cáo</div>
          <h1>${avatar(u)} ${esc(u.name)}</h1><p class="sub">${esc(u.title || '')}</p></div>
        <div class="actions">
          <button class="btn" data-act="export-member" data-id="${u.id}">Xuất ra Excel</button>
          ${cloud() ? (self ? '<button class="btn" data-act="open-profile">Sửa hồ sơ của tôi</button>' : '') : `<button class="btn danger" data-act="del-member" data-id="${u.id}">Xóa thành viên</button>`}
        </div>
      </header>
      <div class="stats">${stat(c.todo, 'Cần làm')}${stat(c.doing, 'Đang làm')}${stat(c.done, 'Hoàn thành', 'green')}${stat(c.overdue, 'Quá hạn', 'red')}</div>
      <section class="panel"><h2>Tỷ lệ công việc</h2>${stackBar(c.raw)}</section>
      ${
        groups
          .map(
            ([p, list]) =>
              `<section class="panel"><h2><a href="#p-${p.id}"><i class="dot" style="background:${esc(p.color)}"></i> ${esc(p.name)}</a> <span class="n">${list.length}</span></h2>${list.map((t) => taskRow(t)).join('')}</section>`,
          )
          .join('') ||
        `<section class="panel">${empty('Người này chưa được giao việc nào.')}</section>`
      }`;
  };

  // ---------- task details (right-hand drawer) ----------
  const fieldInput = (t, f) => {
    const v = (t.custom || {})[f.id] ?? '';
    const id = `cf-${f.id}`;
    const attrs = `id="${id}" data-chg="custom" data-field="${f.id}" aria-label="${esc(f.name)}"`;
    if (f.type === 'textarea')
      return `<textarea class="inp area sm-area" ${attrs}>${esc(v)}</textarea>`;
    if (f.type === 'select')
      return `<select class="inp" ${attrs}><option value="">—</option>${f.options
        .map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`)
        .join('')}</select>`;
    if (f.type === 'number')
      return `<input class="inp" type="number" step="any" inputmode="decimal" ${attrs} value="${esc(v)}" />`;
    if (f.type === 'date')
      return `<input class="inp" type="date" ${attrs} value="${esc(v)}" />`;
    return `<input class="inp wide" ${attrs} value="${esc(v)}" />`;
  };
  V.drawer = () => {
    const t = WB.task(ui().taskId);
    if (!t) return '';
    const p = WB.project(t.projectId);
    if (!p) return '';
    const parent = WB.task(t.parentId);
    const s = WB.statusOf(t);
    const approver = WB.canApprove(t);
    const members = p.memberIds.map(WB.user).filter(Boolean);
    if (
      t.assigneeId &&
      !members.some((u) => u.id === t.assigneeId) &&
      WB.user(t.assigneeId)
    )
      members.push(WB.user(t.assigneeId));
    const sub = WB.subs(t.id);
    const blockers = WB.blockers(t);
    const candidates = WB.tasksOf(p.id).filter(
      (x) => x.id !== t.id && !x.parentId && !t.dependsOn.includes(x.id),
    );
    const fields = WB.fieldsOf(p.id);
    const missing = WB.missingRequired(t);
    const comments = WB.commentsOf(t.id);
    const history = WB.activityOf(t.id);
    const rep = WB.repeat(t.repeatId);
    let main;
    if (t.status === 'done')
      main = `<button class="btn" data-act="toggle-done" data-id="${t.id}">↺ Mở lại</button>`;
    else if (t.status === 'review')
      main = approver
        ? `<button class="btn primary" data-act="toggle-done" data-id="${t.id}">✓ Duyệt hoàn thành</button><button class="btn" data-act="reject" data-id="${t.id}">Trả lại làm tiếp</button>`
        : `<button class="btn" data-act="reject" data-id="${t.id}">Rút lại yêu cầu duyệt</button>`;
    else
      main = `<button class="btn primary" data-act="toggle-done" data-id="${t.id}">✓ ${p.review && !approver ? 'Gửi duyệt hoàn thành' : 'Hoàn thành'}</button>`;
    const row = (label, html, forId = '') =>
      `<div class="frow"><label ${forId ? `for="${forId}"` : ''}>${label}</label><div class="fval">${html}</div></div>`;
    return `
      <div class="drawer-back" data-act="close-drawer"></div>
      <aside class="drawer" role="dialog" aria-label="Chi tiết công việc">
        <div class="drawer-top">${main}${V.pill(s)}<span class="grow"></span>
          <details class="menu right">
            <summary class="icon-btn" aria-label="Thêm thao tác với công việc" title="Thêm">${svg(ICON.dots, 18)}</summary>
            <div class="menu-list" role="menu">
              <button role="menuitem" data-act="dup-task" data-id="${t.id}">Nhân bản</button>
              ${
                parent
                  ? ''
                  : `<button role="menuitem" data-act="open-copy-task" data-id="${t.id}">Sao chép sang dự án khác…</button>
              <button role="menuitem" data-act="open-multi" data-id="${t.id}">Giao cho nhiều người…</button>`
              }
              <hr />
              <button role="menuitem" class="danger-text" data-act="del-task" data-id="${t.id}">Xóa công việc</button>
            </div>
          </details>
          <button class="icon-btn" data-act="close-drawer" title="Đóng (Esc)" aria-label="Đóng chi tiết">✕</button></div>
        <div class="drawer-body" data-scroll="drawer:${t.id}">
          <div class="crumbs"><a href="#p-${p.id}" data-act="close-drawer-soft"><i class="dot" style="background:${esc(p.color)}"></i> ${esc(p.name)}</a>${
            parent
              ? ` › <button class="link" data-act="open-task" data-id="${parent.id}">${esc(parent.name)}</button>`
              : ''
          }</div>
          <textarea class="title-inp" id="t-name" rows="1" data-chg="field" data-field="name" aria-label="Tên công việc">${esc(t.name)}</textarea>
          ${rep ? `<div class="info">↻ Tạo tự động từ việc lặp lại “${esc(rep.name)}” ngày ${fmtDate(t.repeatDate)}. <a href="#repeats">Xem quy tắc</a></div>` : ''}
          ${
            blockers.length
              ? `<div class="warn">⛔ Còn ${blockers.length} việc phải làm xong trước: ${blockers.map((b) => `<button class="link" data-act="open-task" data-id="${b.id}">${esc(b.name)}</button>`).join(', ')}</div>`
              : ''
          }
          ${missing.length && t.status !== 'done' ? `<div class="warn">Cần điền trước khi hoàn thành: ${missing.map((m) => `“${esc(m)}”`).join(', ')}.</div>` : ''}
          ${row('Người thực hiện', `<select class="inp" id="t-assignee" data-chg="field" data-field="assigneeId">${options(members, t.assigneeId, 'Chưa giao')}</select>`, 't-assignee')}
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
          ${parent ? '' : row('Danh sách việc', `<select class="inp" id="t-list" data-chg="field" data-field="tasklistId">${options(WB.listsOf(p.id), t.tasklistId)}</select>`, 't-list')}
          ${row('Ngày bắt đầu', `<input class="inp" type="date" id="t-start" data-chg="field" data-field="start" value="${esc(t.start)}" />`, 't-start')}
          ${row(
            'Hạn chót',
            `<input class="inp" type="date" id="t-due" data-chg="field" data-field="dueDate" value="${esc(t.due.slice(0, 10))}" />
             <input class="inp" type="time" id="t-due-time" data-chg="field" data-field="dueTime" value="${esc(t.due.slice(11, 16))}" title="Giờ (không bắt buộc)" aria-label="Giờ hạn chót" />`,
            't-due',
          )}
          ${
            t.status === 'done' || t.status === 'review'
              ? ''
              : row(
                  'Trạng thái',
                  `<select class="inp" id="t-status" data-chg="field" data-field="status"><option value="todo" ${t.status === 'todo' ? 'selected' : ''}>Cần làm</option><option value="doing" ${t.status === 'doing' ? 'selected' : ''}>Đang làm</option></select>`,
                  't-status',
                )
          }
          ${row(
            'Nhãn',
            `<button class="toggle imp ${t.important ? 'on' : ''}" data-act="toggle-flag" data-flag="important" aria-pressed="${t.important}">Quan trọng</button>
             <button class="toggle urg ${t.urgent ? 'on' : ''}" data-act="toggle-flag" data-flag="urgent" aria-pressed="${t.urgent}">Khẩn cấp</button>`,
          )}
          ${p.kind === 'project' ? row('Mục tiêu', `<select class="inp" id="t-ms" data-chg="field" data-field="milestoneId">${options(WB.milestonesOf(p.id), t.milestoneId, 'Không gắn')}</select>`, 't-ms') : ''}
          ${t.doneAt ? row('Xong lúc', `<span>${fmtDate(t.doneAt)}</span>`) : ''}
          ${row('Người giao việc', `<span>${t.createdBy ? esc(WB.userName(t.createdBy)) : '—'}</span>`)}

          ${
            fields.length
              ? `<h4>Thông tin thêm</h4>${fields
                  .map((f) =>
                    row(
                      `${esc(f.name)}${f.required ? ' <b class="req" title="Bắt buộc">*</b>' : ''}`,
                      fieldInput(t, f),
                      `cf-${f.id}`,
                    ),
                  )
                  .join('')}`
              : ''
          }

          <h4><label for="t-desc">Mô tả</label></h4>
          <textarea class="inp area" id="t-desc" data-chg="field" data-field="desc" placeholder="Viết thêm chi tiết về công việc…">${esc(t.desc)}</textarea>

          <h4>Danh sách kiểm tra <span class="n">${t.checklist.filter((c) => c.done).length}/${t.checklist.length}</span></h4>
          ${t.checklist
            .map(
              (c) =>
                `<div class="check ${c.done ? 'is-done' : ''}"><label><input type="checkbox" data-chg="toggle-check" value="${c.id}" ${c.done ? 'checked' : ''} /> <span>${esc(c.text)}</span></label><button class="icon-btn" data-act="del-check" data-id="${c.id}" title="Xóa dòng này" aria-label="Xóa “${esc(c.text)}”">✕</button></div>`,
            )
            .join('')}
          <input class="quick" id="add-check" data-enter="add-check" placeholder="+ Thêm một dòng kiểm tra, nhấn Enter" aria-label="Thêm dòng kiểm tra" autocomplete="off" />

          ${
            parent
              ? ''
              : `<h4>Việc con <span class="n">${sub.filter((x) => x.status === 'done').length}/${sub.length}</span></h4>
          ${sub.map((x) => taskRow(x)).join('')}
          <input class="quick" id="add-sub" data-enter="add-task" data-project="${p.id}" data-tasklist="${t.tasklistId}" data-parent="${t.id}" placeholder="+ Thêm việc con, nhấn Enter" aria-label="Thêm việc con" autocomplete="off" />

          <h4>Phụ thuộc <span class="muted small">— việc này chỉ nên làm sau khi các việc dưới đây xong</span></h4>
          ${t.dependsOn
            .map(WB.task)
            .filter(Boolean)
            .map(
              (d) =>
                `<div class="dep"><button class="link" data-act="open-task" data-id="${d.id}">${esc(d.name)}</button>${V.pill(WB.statusOf(d))}<span class="grow"></span><button class="icon-btn" data-act="del-dep" data-id="${d.id}" title="Bỏ phụ thuộc" aria-label="Bỏ phụ thuộc vào ${esc(d.name)}">✕</button></div>`,
            )
            .join('')}
          <select class="inp wide" id="add-dep" data-chg="add-dep" aria-label="Thêm việc phải làm trước">${options(candidates, '', '+ Chọn một việc phải làm trước…')}</select>`
          }

          <h4><label for="t-result">Kết quả</label></h4>
          <textarea class="inp area" id="t-result" data-chg="field" data-field="result" placeholder="Ghi lại kết quả khi làm xong (đường dẫn, số liệu, ghi chú…)">${esc(t.result)}</textarea>

          <h4>Bình luận <span class="n">${comments.length}</span></h4>
          ${comments
            .map((c) => {
              const u = WB.user(c.userId);
              return `<div class="cmt">${avatar(u, 'sm')}<div><b>${esc(u ? u.name : 'Người đã rời đi')}</b> <span class="muted small">${fmtDate(c.at)}</span><p>${esc(c.text)}</p></div></div>`;
            })
            .join('')}
          <input class="quick" id="add-comment" data-enter="add-comment" placeholder="Viết bình luận, nhấn Enter để gửi. Gõ @tên để nhắc ai đó." aria-label="Viết bình luận" autocomplete="off" />

          <details class="history" ${ui().historyOpen ? 'open' : ''} data-toggle="history">
            <summary>Lịch sử thay đổi (${history.length})</summary>
            ${
              history
                .map((a) => {
                  const u = WB.user(a.userId);
                  return `<div class="hist"><span class="muted small">${fmtDate(a.at)}</span> <b>${esc(u ? u.name : 'Người đã rời đi')}</b> ${esc(a.text)}</div>`;
                })
                .join('') ||
              '<p class="muted small">Chưa có thay đổi nào được ghi lại.</p>'
            }
          </details>
        </div>
      </aside>`;
  };

  // ---------- pop-up forms ----------
  const foot = (left, okLabel) =>
    `<div class="modal-foot">${left || ''}<span class="grow"></span><button type="button" class="btn" data-act="close-modal">Hủy</button><button class="btn primary">${okLabel}</button></div>`;
  const projectOptions = (selected, filter = () => true) =>
    options(WB.visibleProjects().filter(filter), selected);
  const M = {};

  M.project = (m) => {
    const p = m.id ? WB.project(m.id) : null;
    const kind = p ? p.kind : m.kind;
    const word = kind === 'project' ? 'dự án' : 'nhóm';
    const canEdit = !p || WB.isAdmin(p);
    const v = p || {
      name: '',
      deptId: '',
      adminId: st().me,
      memberIds: [st().me],
      type: 'internal',
      review: false,
      private: false,
      start: '',
      end: '',
      stage: 'plan',
      desc: '',
      color: WB.COLORS[st().projects.length % WB.COLORS.length],
    };
    const dis = canEdit ? '' : 'disabled';
    return [
      p
        ? canEdit
          ? `Cài đặt ${word}`
          : `Thông tin ${word}`
        : `Tạo ${word} mới`,
      `<form data-form="save-project" data-id="${p ? p.id : ''}" data-kind="${kind}">
        ${canEdit ? '' : `<p class="info">Chỉ người quản trị ${word} (${esc(WB.userName(v.adminId))})${cloud() ? ' hoặc quản trị không gian làm việc' : ''} mới đổi được cài đặt.</p>`}
        <fieldset ${dis} class="plain">
        <label class="fld">Tên ${word}<input class="inp" id="pj-name" name="name" required maxlength="200" value="${esc(v.name)}" autofocus /></label>
        <div class="two">
          <label class="fld">Phòng ban<select class="inp" id="pj-dept" name="deptId">${options(st().departments, v.deptId, 'Chưa thuộc phòng ban')}</select></label>
          <label class="fld">Người quản trị<select class="inp" id="pj-admin" name="adminId">${options(st().users, v.adminId)}</select></label>
        </div>
        <fieldset class="fld"><legend>Thành viên</legend><div class="checks">${st()
          .users.map(
            (u) =>
              `<label class="opt"><input type="checkbox" name="memberIds" value="${u.id}" ${v.memberIds.includes(u.id) ? 'checked' : ''} /> ${esc(u.name)}</label>`,
          )
          .join('')}</div></fieldset>
        <div class="two">
          <label class="fld">Phân loại<select class="inp" id="pj-type" name="type"><option value="internal" ${v.type === 'internal' ? 'selected' : ''}>Nội bộ</option><option value="customer" ${v.type === 'customer' ? 'selected' : ''}>Làm cho khách hàng</option></select></label>
          <div class="fld opt-col">
            <label class="opt"><input type="checkbox" name="review" ${v.review ? 'checked' : ''} /> Việc phải được duyệt mới tính là xong</label>
            <label class="opt"><input type="checkbox" name="private" ${v.private ? 'checked' : ''} /> Riêng tư: chỉ thành viên xem được</label>
          </div>
        </div>
        <details class="adv" ${p ? 'open' : ''}><summary>Cài đặt nâng cao</summary>
          ${
            kind === 'project'
              ? `<div class="two">
            <label class="fld">Ngày bắt đầu<input class="inp" id="pj-start" type="date" name="start" value="${esc(v.start)}" /></label>
            <label class="fld">Ngày kết thúc<input class="inp" id="pj-end" type="date" name="end" value="${esc(v.end)}" /></label>
          </div>
          <label class="fld">Tình trạng<select class="inp" id="pj-stage" name="stage">${options(
            Object.entries(STAGES).map(([k, s]) => ({ id: k, name: s.label })),
            v.stage,
          )}</select></label>`
              : ''
          }
          <label class="fld">Mô tả<textarea class="inp area" id="pj-desc" name="desc">${esc(v.desc)}</textarea></label>
          <fieldset class="fld"><legend>Màu</legend><div class="colors">${WB.COLORS.map(
            (c) =>
              `<label><input type="radio" name="color" value="${c}" ${v.color === c ? 'checked' : ''} aria-label="Màu ${c}" /><i style="background:${c}"></i></label>`,
          ).join('')}</div></fieldset>
        </details>
        </fieldset>
        ${
          canEdit
            ? foot(
                p
                  ? `<button type="button" class="btn danger" data-act="del-project" data-id="${p.id}">Xóa ${word}</button>`
                  : '',
                p ? 'Lưu' : `Tạo ${word}`,
              )
            : '<div class="modal-foot"><span class="grow"></span><button type="button" class="btn" data-act="close-modal">Đóng</button></div>'
        }
      </form>`,
    ];
  };
  M.dept = () => [
    'Tạo phòng ban',
    `<form data-form="save-dept"><label class="fld">Tên phòng ban<input class="inp" id="dept-name" name="name" required maxlength="120" autofocus /></label>${foot('', 'Tạo')}</form>`,
  ];
  M.member = () => [
    'Thêm thành viên',
    `<form data-form="save-member">
      <label class="fld">Họ và tên<input class="inp" id="mem-name" name="name" required maxlength="120" autofocus /></label>
      <label class="fld">Chức danh<input class="inp" id="mem-title" name="title" maxlength="120" placeholder="Ví dụ: Kế toán" /></label>
      ${foot('', 'Thêm')}</form>`,
  ];
  M.fields = (m) => {
    const p = WB.project(m.id);
    const list = WB.fieldsOf(p.id);
    const canEdit = WB.isAdmin(p);
    const dis = canEdit ? '' : 'disabled';
    return [
      `Trường tùy chỉnh · ${esc(p.name)}`,
      `<p class="muted small">Thêm ô thông tin riêng cho công việc của ${p.kind === 'project' ? 'dự án' : 'nhóm'} này, ví dụ “Chi phí”, “Khách hàng”, “Độ khó”. Trường đánh dấu bắt buộc phải điền thì công việc mới hoàn thành được.</p>
      ${canEdit ? '' : '<p class="info">Chỉ người quản trị mới thêm hoặc sửa trường được.</p>'}
      <div class="fields-list">${
        list
          .map(
            (f, i) => `<div class="field-row">
          <input class="inp grow" id="fd-name-${f.id}" data-chg="field-def" data-id="${f.id}" data-key="name" value="${esc(f.name)}" aria-label="Tên trường" ${dis} />
          <select class="inp" id="fd-type-${f.id}" data-chg="field-def" data-id="${f.id}" data-key="type" aria-label="Kiểu dữ liệu" ${dis}>${Object.entries(
            WB.FIELD_TYPES,
          )
            .map(
              ([k, l]) =>
                `<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`,
            )
            .join('')}</select>
          <label class="opt small"><input type="checkbox" data-chg="field-def" data-id="${f.id}" data-key="required" ${f.required ? 'checked' : ''} ${dis} /> Bắt buộc</label>
          <span class="nowrap">
            <button type="button" class="icon-btn" data-act="move-field" data-id="${f.id}" data-dir="-1" ${i === 0 || !canEdit ? 'disabled' : ''} aria-label="Chuyển ${esc(f.name)} lên">↑</button>
            <button type="button" class="icon-btn" data-act="move-field" data-id="${f.id}" data-dir="1" ${i === list.length - 1 || !canEdit ? 'disabled' : ''} aria-label="Chuyển ${esc(f.name)} xuống">↓</button>
            <button type="button" class="icon-btn" data-act="del-field" data-id="${f.id}" ${dis} aria-label="Xóa trường ${esc(f.name)}">🗑</button>
          </span>
          ${f.type === 'select' ? `<input class="inp opts" id="fd-opts-${f.id}" data-chg="field-def" data-id="${f.id}" data-key="options" value="${esc(f.options.join(', '))}" placeholder="Các lựa chọn, cách nhau bằng dấu phẩy" aria-label="Các lựa chọn của ${esc(f.name)}" ${dis} />` : ''}
        </div>`,
          )
          .join('') || '<p class="muted">Chưa có trường nào.</p>'
      }</div>
      ${
        canEdit
          ? `<form class="inline-form" data-form="add-field" data-project="${p.id}">
        <input class="inp grow" id="new-field-name" name="name" required maxlength="80" placeholder="Tên trường mới" aria-label="Tên trường mới" autofocus />
        <select class="inp" id="new-field-type" name="type" aria-label="Kiểu dữ liệu">${Object.entries(
          WB.FIELD_TYPES,
        )
          .map(([k, l]) => `<option value="${k}">${l}</option>`)
          .join('')}</select>
        <button class="btn primary">Thêm trường</button>
      </form>`
          : ''
      }
      <div class="modal-foot"><span class="grow"></span><button type="button" class="btn" data-act="close-modal">Xong</button></div>`,
    ];
  };
  M.repeat = (m) => {
    const r = m.id ? WB.repeat(m.id) : null;
    const pid = r
      ? r.projectId
      : m.projectId || (WB.visibleProjects()[0] || {}).id || '';
    const p = WB.project(pid);
    const v = r || {
      name: '',
      desc: '',
      projectId: pid,
      tasklistId: '',
      assigneeId: st().me,
      followerIds: [],
      freq: 'week',
      every: 1,
      weekdays: [WB.isoDow(new Date())],
      monthDay: new Date().getDate(),
      start: WB.today(),
      end: '',
      dueTime: '17:00',
      important: false,
      urgent: false,
      checklist: [],
      subtasks: [],
      enabled: true,
    };
    const draft = { ...v, ...(m.draft || {}) };
    const members = p ? p.memberIds.map(WB.user).filter(Boolean) : st().users;
    const freq = draft.freq;
    return [
      r ? 'Sửa việc lặp lại' : 'Tạo việc lặp lại',
      `<form data-form="save-repeat" data-id="${r ? r.id : ''}">
        <label class="fld">Tên công việc<input class="inp" id="rp-name" name="name" required maxlength="200" value="${esc(draft.name)}" autofocus /></label>
        <div class="two">
          <label class="fld">Dự án / Nhóm<select class="inp" id="rp-project" name="projectId" data-chg="repeat-project">${projectOptions(draft.projectId)}</select></label>
          <label class="fld">Danh sách việc<select class="inp" id="rp-list" name="tasklistId">${options(p ? WB.listsOf(p.id) : [], draft.tasklistId)}</select></label>
        </div>
        <div class="two">
          <label class="fld">Người thực hiện<select class="inp" id="rp-assignee" name="assigneeId">${options(members, draft.assigneeId, 'Chưa giao')}</select></label>
          <label class="fld">Giờ hạn chót (không bắt buộc)<input class="inp" id="rp-time" type="time" name="dueTime" value="${esc(draft.dueTime)}" /></label>
        </div>
        <fieldset class="fld"><legend>Lặp lại</legend>
          <div class="repeat-line">
            <span>Cứ</span><input class="inp num" id="rp-every" type="number" min="1" max="99" name="every" value="${esc(draft.every)}" aria-label="Số lần cách nhau" />
            <select class="inp" id="rp-freq" name="freq" data-chg="repeat-freq" aria-label="Đơn vị">${[
              ['day', 'ngày'],
              ['week', 'tuần'],
              ['month', 'tháng'],
              ['year', 'năm'],
            ]
              .map(
                ([k, l]) =>
                  `<option value="${k}" ${freq === k ? 'selected' : ''}>${l}</option>`,
              )
              .join('')}</select><span>một lần</span>
          </div>
          ${
            freq === 'week'
              ? `<div class="weekdays">${WB.WEEKDAYS.map(
                  (d, i) =>
                    `<label class="wd"><input type="checkbox" name="weekdays" value="${i + 1}" ${(draft.weekdays || []).includes(i + 1) ? 'checked' : ''} /><span>${d}</span></label>`,
                ).join('')}</div>`
              : ''
          }
          ${
            freq === 'month'
              ? `<label class="fld inline">Vào ngày<select class="inp" id="rp-mday" name="monthDay">${[
                  ...Array(31),
                ]
                  .map(
                    (_, i) =>
                      `<option value="${i + 1}" ${String(draft.monthDay) === String(i + 1) ? 'selected' : ''}>${i + 1}</option>`,
                  )
                  .join(
                    '',
                  )}<option value="last" ${draft.monthDay === 'last' ? 'selected' : ''}>Ngày cuối tháng</option></select></label>
                <p class="muted small">Tháng nào không có ngày này (ví dụ ngày 31) thì bỏ qua.</p>`
              : ''
          }
          ${freq === 'year' ? '<p class="muted small">Lặp vào đúng ngày và tháng của “Bắt đầu từ”.</p>' : ''}
        </fieldset>
        <div class="two">
          <label class="fld">Bắt đầu từ<input class="inp" id="rp-start" type="date" name="start" required value="${esc(draft.start)}" /></label>
          <label class="fld">Kết thúc (không bắt buộc)<input class="inp" id="rp-end" type="date" name="end" value="${esc(draft.end)}" /></label>
        </div>
        <details class="adv" ${draft.desc || draft.checklist.length || draft.subtasks.length ? 'open' : ''}><summary>Thêm chi tiết</summary>
          <label class="fld">Mô tả<textarea class="inp area" id="rp-desc" name="desc">${esc(draft.desc)}</textarea></label>
          <label class="fld">Danh sách kiểm tra (mỗi dòng một mục)<textarea class="inp area" id="rp-check" name="checklist">${esc(draft.checklist.join('\n'))}</textarea></label>
          <label class="fld">Việc con (mỗi dòng một việc)<textarea class="inp area" id="rp-subs" name="subtasks">${esc(draft.subtasks.join('\n'))}</textarea></label>
          <div class="fld opt-col"><label class="opt"><input type="checkbox" name="important" ${draft.important ? 'checked' : ''} /> Quan trọng</label>
          <label class="opt"><input type="checkbox" name="urgent" ${draft.urgent ? 'checked' : ''} /> Khẩn cấp</label></div>
        </details>
        <p class="muted small">Lần tới: <b id="rp-next">${esc(WB.nextOccurrence({ ...draft, every: draft.every || 1 }, WB.today()) ? fmtDate(WB.nextOccurrence({ ...draft, every: draft.every || 1 }, WB.today())) : '—')}</b> · ${esc(WB.describeRepeat({ ...draft, every: draft.every || 1 }))}</p>
        ${foot('', r ? 'Lưu' : 'Tạo')}
      </form>`,
    ];
  };
  M.template = (m) => {
    const list = WB.allTemplates();
    const pick = m.pick ? list.find((x) => x.id === m.pick) : null;
    if (!pick)
      return [
        'Tạo từ mẫu',
        `<p class="muted small">Chọn một mẫu để có sẵn danh sách việc, công việc và mục tiêu. Ngày tháng sẽ tính từ ngày bắt đầu bạn chọn.</p>
        <div class="tpl-grid">${list
          .map((x) => {
            const nTasks = (x.data.lists || []).reduce(
              (n, l) => n + (l.tasks || []).length,
              0,
            );
            return `<div class="tpl"><button class="tpl-pick" data-act="pick-template" data-id="${esc(x.id)}"><b>${esc(x.name)}</b><span class="muted small">${esc(x.desc || '')}</span><span class="small">${x.kind === 'team' ? 'Nhóm' : 'Dự án'} · ${(x.data.lists || []).length} danh sách · ${nTasks} việc${x.builtin ? ' · Mẫu có sẵn' : ''}</span></button>${
              x.builtin
                ? ''
                : `<button class="icon-btn" data-act="del-template" data-id="${esc(x.id)}" aria-label="Xóa mẫu ${esc(x.name)}">🗑</button>`
            }</div>`;
          })
          .join('')}</div>
        <div class="modal-foot"><span class="grow"></span><button type="button" class="btn" data-act="close-modal">Đóng</button></div>`,
      ];
    return [
      `Tạo từ mẫu “${esc(pick.name)}”`,
      `<form data-form="use-template" data-id="${esc(pick.id)}">
        <label class="fld">Tên ${pick.kind === 'team' ? 'nhóm' : 'dự án'}<input class="inp" id="tp-name" name="name" required maxlength="200" value="${esc(pick.name)}" autofocus /></label>
        <div class="two">
          <label class="fld">Phòng ban<select class="inp" id="tp-dept" name="deptId">${options(st().departments, '', 'Chưa thuộc phòng ban')}</select></label>
          <label class="fld">${pick.kind === 'team' ? 'Tính hạn chót từ ngày' : 'Ngày bắt đầu'}<input class="inp" id="tp-start" type="date" name="start" required value="${WB.today()}" /></label>
        </div>
        ${foot('<button type="button" class="btn" data-act="pick-template" data-id="">‹ Chọn mẫu khác</button>', 'Tạo')}
      </form>`,
    ];
  };
  M['save-template'] = (m) => {
    const p = WB.project(m.id);
    return [
      'Lưu làm mẫu',
      `<form data-form="save-template" data-id="${p.id}">
        <p class="muted small">Mẫu giữ lại danh sách việc, công việc, việc con, danh sách kiểm tra, mục tiêu và trường tùy chỉnh. Không giữ người thực hiện, bình luận và trạng thái. Ngày tháng được lưu theo khoảng cách tới ngày bắt đầu.</p>
        <label class="fld">Tên mẫu<input class="inp" id="st-name" name="name" required maxlength="120" value="${esc(p.name)}" autofocus /></label>
        <label class="fld">Mô tả ngắn<input class="inp" id="st-desc" name="desc" maxlength="200" value="${esc(p.desc || '')}" /></label>
        ${foot('', 'Lưu mẫu')}
      </form>`,
    ];
  };
  M['dup-project'] = (m) => {
    const p = WB.project(m.id);
    const word = p.kind === 'project' ? 'dự án' : 'nhóm';
    return [
      `Nhân bản ${word}`,
      `<form data-form="dup-project" data-id="${p.id}">
        <label class="fld">Tên ${word} mới<input class="inp" id="dp-name" name="name" required maxlength="200" value="${esc(`Bản sao của ${p.name}`)}" autofocus /></label>
        <div class="fld opt-col">
          <label class="opt"><input type="checkbox" name="tasks" checked /> Sao chép cả công việc (bỏ chọn thì chỉ có danh sách việc, mục tiêu và trường)</label>
          <label class="opt"><input type="checkbox" name="keepAssignees" checked /> Giữ người thực hiện và người theo dõi</label>
          <label class="opt"><input type="checkbox" name="keepDone" /> Giữ trạng thái hoàn thành</label>
        </div>
        <p class="muted small">Bình luận và lịch sử thay đổi không được sao chép.</p>
        ${foot('', 'Nhân bản')}
      </form>`,
    ];
  };
  M['copy-task'] = (m) => {
    const t = WB.task(m.id);
    const target = WB.project(m.target || t.projectId);
    return [
      'Sao chép công việc',
      `<form data-form="copy-task" data-id="${t.id}">
        <p class="muted small">Tạo một bản sao của “${esc(t.name)}” ở dự án hoặc nhóm khác. Bình luận và lịch sử không được sao chép.</p>
        <div class="two">
          <label class="fld">Sang dự án / nhóm<select class="inp" id="ct-project" name="projectId" data-chg="copy-target">${projectOptions(target.id)}</select></label>
          <label class="fld">Danh sách việc<select class="inp" id="ct-list" name="tasklistId">${options(WB.listsOf(target.id), '')}</select></label>
        </div>
        <div class="fld opt-col">
          <label class="opt"><input type="checkbox" name="subtasks" checked /> Kèm việc con</label>
          <label class="opt"><input type="checkbox" name="checklist" checked /> Kèm danh sách kiểm tra</label>
          <label class="opt"><input type="checkbox" name="keepDone" /> Giữ trạng thái hoàn thành</label>
        </div>
        ${foot('', 'Sao chép')}
      </form>`,
    ];
  };
  M.multi = (m) => {
    const t = WB.task(m.id);
    const p = WB.project(t.projectId);
    const people = p.memberIds
      .map(WB.user)
      .filter((u) => u && u.id !== t.assigneeId);
    return [
      'Giao cho nhiều người',
      `<form data-form="multi-assign" data-id="${t.id}">
        <p class="muted small">Mỗi người được chọn sẽ nhận một bản riêng của “${esc(t.name)}” (kèm việc con và danh sách kiểm tra), để ai làm phần nấy và tự đánh dấu xong.</p>
        <fieldset class="fld"><legend>Chọn người</legend><div class="checks">${
          people
            .map(
              (u) =>
                `<label class="opt"><input type="checkbox" name="userIds" value="${u.id}" /> ${esc(u.name)}</label>`,
            )
            .join('') ||
          '<p class="muted">Không còn thành viên nào khác trong dự án này.</p>'
        }</div></fieldset>
        ${foot('', 'Tạo các bản')}
      </form>`,
    ];
  };
  M.import = (m) => {
    const p = WB.project(m.id);
    const plan = m.plan;
    let body;
    if (!plan)
      body = `<ol class="steps">
          <li><button type="button" class="btn" data-act="import-template" data-id="${p.id}">Tải file mẫu (.xlsx)</button> <span class="muted small">Có sẵn tên cột. Mỗi dòng là một công việc.</span></li>
          <li><label class="fld">Chọn file đã điền (.xlsx hoặc .csv)<input class="inp" type="file" id="import-file" data-chg="import-file" data-id="${p.id}" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></label></li>
        </ol>
        <p class="muted small">Tên người thực hiện phải viết đúng như trong danh sách thành viên. Ngày viết dạng 20/11/2026 hoặc 2026-11-20, có thể kèm giờ 17:00. Việc con: điền tên công việc cha vào cột “Thuộc công việc”, hoặc thêm dấu # trước tên.</p>
        ${m.error ? `<p class="warn">${esc(m.error)}</p>` : ''}
        <div class="modal-foot"><span class="grow"></span><button type="button" class="btn" data-act="close-modal">Đóng</button></div>`;
    else {
      const shown = plan.items.slice(0, 8);
      body = `<p>File <b>${esc(m.fileName)}</b>: tìm thấy <b>${plan.items.length}</b> công việc.</p>
        ${
          plan.warnings.length
            ? `<div class="warn"><b>Cần xem lại (${plan.warnings.length}):</b><ul>${plan.warnings
                .slice(0, 12)
                .map((w) => `<li>${esc(w)}</li>`)
                .join(
                  '',
                )}</ul>${plan.warnings.length > 12 ? `<p class="small">…và ${plan.warnings.length - 12} lưu ý khác.</p>` : ''}</div>`
            : ''
        }
        ${
          shown.length
            ? `<div class="scroll-x"><table class="tbl small-tbl"><thead><tr><th>Dòng</th><th>Danh sách</th><th>Công việc</th><th>Người thực hiện</th><th>Hạn chót</th></tr></thead><tbody>${shown
                .map(
                  (it) =>
                    `<tr><td>${it.line}</td><td>${esc(it.listName || 'Việc cần làm')}</td><td>${it.parentName ? '↳ ' : ''}${esc(it.name)}</td><td>${esc(it.assigneeId ? WB.userName(it.assigneeId) : '—')}</td><td>${esc(fmtDate(it.due))}</td></tr>`,
                )
                .join(
                  '',
                )}</tbody></table></div>${plan.items.length > shown.length ? `<p class="muted small">…và ${plan.items.length - shown.length} dòng nữa.</p>` : ''}`
            : ''
        }
        <div class="modal-foot"><button type="button" class="btn" data-act="import-reset" data-id="${p.id}">Chọn file khác</button><span class="grow"></span><button type="button" class="btn" data-act="close-modal">Hủy</button>
        ${plan.ok ? `<button type="button" class="btn primary" data-act="import-run" data-id="${p.id}">Nhập ${plan.items.length} công việc</button>` : ''}</div>`;
    }
    return [`Nhập công việc từ Excel · ${esc(p.name)}`, body];
  };

  V.modal = () => {
    const m = ui().modal;
    if (!m) return '';
    const make = M[m.type] || (WB.cloudModals && WB.cloudModals[m.type]);
    if (!make) return '';
    const [title, body] = make(m);
    return `<div class="modal-back" data-act="close-modal"></div>
      <div class="modal ${m.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}"><div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-act="close-modal" title="Đóng" aria-label="Đóng">✕</button></div>${body}</div>`;
  };
})();
