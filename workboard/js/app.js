'use strict';
// App shell: routing, drawing the screen, and every click / typing handler.
(() => {
  const V = WB.views;
  const $ = (sel) => document.querySelector(sel);
  const ui = (WB.ui = {
    route: { page: 'my', id: '', view: '' },
    taskId: '',
    modal: null,
    filter: { q: '', assignee: '', status: '' },
    kanbanGroup: 'tasklist',
    calMonth: WB.ymd(new Date()).slice(0, 7),
    sort: { key: '', dir: 1 },
    myTab: 'assigned',
    sideOpen: false,
  });

  // ---------- drawing ----------
  // A redraw replaces the buttons on screen. If that happens between "mouse down" and
  // "mouse up", the click is lost — so while a pointer is held, the redraw waits.
  let pointerDown = false;
  let pending = '';
  function render(scope = 'all') {
    if (pointerDown) {
      pending = pending === 'all' || scope === 'all' ? 'all' : scope;
      return;
    }
    const scrolls = {};
    document
      .querySelectorAll('[data-scroll]')
      .forEach(
        (el) => (scrolls[el.dataset.scroll] = [el.scrollLeft, el.scrollTop]),
      );
    const active = document.activeElement;
    const focusId = active && active.id;
    let caret = null;
    try {
      caret = focusId ? active.selectionStart : null;
    } catch {
      caret = null;
    }
    $('#side').innerHTML = V.side();
    $('#main').innerHTML = V.main();
    if (scope === 'all') {
      $('#drawer').innerHTML = V.drawer();
      $('#modal').innerHTML = V.modal();
    }
    document.querySelectorAll('[data-scroll]').forEach((el) => {
      const saved = scrolls[el.dataset.scroll];
      if (saved) [el.scrollLeft, el.scrollTop] = saved;
      else if (el.dataset.today) {
        // First time the Gantt chart is shown: bring today into view, about a third of the way across.
        const left = el.querySelector('.g-left').offsetWidth;
        el.scrollLeft = Math.max(
          0,
          +el.dataset.today - (el.clientWidth - left) / 3,
        );
      }
    });
    document.querySelectorAll('textarea.title-inp').forEach(autoGrow);
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el && el !== document.activeElement) {
        el.focus();
        try {
          if (caret != null) el.setSelectionRange(caret, caret);
        } catch {
          /* this kind of field has no text cursor */
        }
      }
    }
    document.title = pageTitle();
  }
  function pageTitle() {
    const r = ui.route;
    const p = r.page === 'p' && WB.project(r.id);
    const name = p
      ? p.name
      : {
          my: 'Việc của tôi',
          projects: 'Dự án & Nhóm',
          reports: 'Báo cáo',
          members: 'Thành viên',
        }[r.page] || 'Việc của tôi';
    return `${name} — WorkBoard`;
  }
  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }
  function commit(scope = 'all') {
    if (!WB.save())
      toast(
        'Không lưu được vào trình duyệt. Thay đổi sẽ mất khi tải lại trang.',
      );
    render(scope);
  }
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function modalOpened() {
    const first = $('#modal [autofocus]');
    if (first) first.focus();
  }

  // ---------- routing ----------
  function parseRoute() {
    const [page = 'my', id = '', view = ''] = location.hash
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean);
    const prev = ui.route;
    ui.route = { page, id, view: page === 'p' ? view || 'list' : '' };
    if (page !== prev.page || id !== prev.id) {
      ui.filter = { q: '', assignee: '', status: '' };
      ui.sort = { key: '', dir: 1 };
    }
    ui.sideOpen = false;
  }
  window.addEventListener('hashchange', () => {
    parseRoute();
    render();
    $('#main').scrollTop = 0;
  });

  // ---------- helpers for handlers ----------
  const cur = () => WB.task(ui.taskId);
  const ask = (text, value = '') => {
    const v = prompt(text, value);
    return v == null ? null : v.trim();
  };
  function download(name, rows) {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function taskRows(tasks) {
    const name = (x) => (x ? x.name : '');
    return [
      [
        'Dự án / Nhóm',
        'Danh sách việc',
        'Công việc',
        'Thuộc công việc',
        'Người thực hiện',
        'Bắt đầu',
        'Hạn chót',
        'Trạng thái',
        'Quan trọng',
        'Khẩn cấp',
        'Mục tiêu',
        'Xong lúc',
        'Kết quả',
      ],
      ...tasks.map((t) => [
        name(WB.project(t.projectId)),
        name(WB.tasklist(t.tasklistId)),
        t.name,
        name(WB.task(t.parentId)),
        name(WB.user(t.assigneeId)),
        t.start,
        t.due.replace('T', ' '),
        WB.STATUS[WB.statusOf(t)].label,
        t.important ? 'Có' : '',
        t.urgent ? 'Có' : '',
        name(WB.milestone(t.milestoneId)),
        t.doneAt.replace('T', ' '),
        t.result,
      ]),
    ];
  }
  const fileName = (s) =>
    s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'cong-viec';

  // ---------- click handlers ----------
  const acts = {
    'toggle-side'() {
      ui.sideOpen = !ui.sideOpen;
      render('main');
    },
    go(el) {
      location.hash = el.dataset.href;
    },
    'my-tab'(el) {
      ui.myTab = el.dataset.tab;
      render('main');
    },
    'open-task'(el) {
      ui.taskId = el.dataset.id;
      render();
    },
    'close-drawer'() {
      ui.taskId = '';
      render();
    },
    'close-drawer-soft'() {
      ui.taskId = '';
      render();
    },
    'toggle-done'(el) {
      const t = WB.task(el.dataset.id);
      if (!t) return;
      if (t.status !== 'done' && t.status !== 'review') {
        const left = WB.blockers(t);
        if (
          left.length &&
          !confirm(
            `Việc này phụ thuộc vào ${left.length} việc chưa xong:\n- ${left.map((b) => b.name).join('\n- ')}\n\nVẫn đánh dấu hoàn thành?`,
          )
        )
          return;
      }
      toast(WB.toggleDone(t));
      commit();
    },
    reject(el) {
      const t = WB.task(el.dataset.id);
      t.status = 'doing';
      t.submittedAt = '';
      toast('Đã chuyển công việc về “Đang làm”.');
      commit();
    },
    'del-task'(el) {
      const t = WB.task(el.dataset.id);
      const n = WB.subs(t.id).length;
      if (
        !confirm(
          `Xóa công việc “${t.name}”${n ? ` và ${n} công việc con` : ''}? Không khôi phục được.`,
        )
      )
        return;
      WB.removeTask(t.id);
      ui.taskId = t.parentId || '';
      commit();
    },
    'toggle-flag'(el) {
      const t = cur();
      t[el.dataset.flag] = !t[el.dataset.flag];
      commit();
    },
    'del-check'(el) {
      const t = cur();
      t.checklist = t.checklist.filter((c) => c.id !== el.dataset.id);
      commit();
    },
    'del-dep'(el) {
      const t = cur();
      t.dependsOn = t.dependsOn.filter((d) => d !== el.dataset.id);
      commit();
    },
    sort(el) {
      const k = el.dataset.key;
      ui.sort =
        ui.sort.key === k
          ? ui.sort.dir > 0
            ? { key: k, dir: -1 }
            : { key: '', dir: 1 }
          : { key: k, dir: 1 };
      render('main');
    },
    'cal-move'(el) {
      const dir = +el.dataset.dir;
      if (!dir) ui.calMonth = WB.ymd(new Date()).slice(0, 7);
      else {
        const [y, m] = ui.calMonth.split('-').map(Number);
        ui.calMonth = WB.ymd(new Date(y, m - 1 + dir, 1)).slice(0, 7);
      }
      render('main');
    },
    'move-tasklist'(el) {
      const l = WB.tasklist(el.dataset.id);
      const lists = WB.listsOf(l.projectId);
      const i = lists.indexOf(l);
      const other = lists[i + +el.dataset.dir];
      if (!other) return;
      [l.order, other.order] = [other.order, l.order];
      commit();
    },
    'rename-tasklist'(el) {
      const l = WB.tasklist(el.dataset.id);
      const v = ask('Tên mới của danh sách việc:', l.name);
      if (!v) return;
      l.name = v;
      commit();
    },
    'del-tasklist'(el) {
      const l = WB.tasklist(el.dataset.id);
      const n = WB.state.tasks.filter((t) => t.tasklistId === l.id).length;
      if (
        !confirm(
          `Xóa danh sách việc “${l.name}”${n ? ` cùng ${n} công việc bên trong` : ''}? Không khôi phục được.`,
        )
      )
        return;
      WB.removeTasklist(l.id);
      commit();
    },
    'del-milestone'(el) {
      const m = WB.milestone(el.dataset.id);
      if (
        !confirm(
          `Xóa mục tiêu “${m.name}”? Các công việc vẫn giữ nguyên, chỉ bỏ gắn với mục tiêu này.`,
        )
      )
        return;
      WB.state.tasks.forEach(
        (t) => t.milestoneId === m.id && (t.milestoneId = ''),
      );
      WB.state.milestones = WB.state.milestones.filter((x) => x.id !== m.id);
      commit();
    },
    'new-project'(el) {
      ui.modal = { type: 'project', kind: el.dataset.kind };
      render();
      modalOpened();
    },
    'edit-project'(el) {
      ui.modal = { type: 'project', id: el.dataset.id };
      render();
      modalOpened();
    },
    'del-project'(el) {
      const p = WB.project(el.dataset.id);
      const n = WB.tasksOf(p.id).length;
      if (
        !confirm(
          `Xóa “${p.name}” cùng ${n} công việc bên trong? Không khôi phục được.`,
        )
      )
        return;
      WB.removeProject(p.id);
      ui.modal = null;
      ui.taskId = '';
      WB.save();
      location.hash = '#/projects';
      render();
    },
    'new-dept'() {
      ui.modal = { type: 'dept' };
      render();
      modalOpened();
    },
    'rename-dept'(el) {
      const d = WB.dept(el.dataset.id);
      const v = ask('Tên mới của phòng ban:', d.name);
      if (!v) return;
      d.name = v;
      commit();
    },
    'del-dept'(el) {
      const d = WB.dept(el.dataset.id);
      const n = WB.state.projects.filter((p) => p.deptId === d.id).length;
      if (
        !confirm(
          `Xóa phòng ban “${d.name}”?${n ? ` ${n} dự án/nhóm bên trong sẽ không bị xóa, chỉ chuyển về “Chưa thuộc phòng ban”.` : ''}`,
        )
      )
        return;
      WB.state.projects.forEach((p) => p.deptId === d.id && (p.deptId = ''));
      WB.state.departments = WB.state.departments.filter((x) => x.id !== d.id);
      commit();
    },
    'new-member'() {
      ui.modal = { type: 'member' };
      render();
      modalOpened();
    },
    'del-member'(el) {
      const u = WB.user(el.dataset.id);
      if (WB.state.users.length < 2)
        return toast('Phải còn ít nhất một thành viên.');
      const owns = WB.state.projects.filter((p) => p.adminId === u.id);
      if (owns.length)
        return toast(
          `${u.name} đang quản trị “${owns[0].name}”. Hãy đổi người quản trị trước.`,
        );
      const n = WB.state.tasks.filter((t) => t.assigneeId === u.id).length;
      if (
        !confirm(
          `Xóa thành viên ${u.name}?${n ? ` ${n} công việc của người này sẽ chuyển thành “Chưa giao”.` : ''}`,
        )
      )
        return;
      WB.state.tasks.forEach((t) => {
        if (t.assigneeId === u.id) t.assigneeId = '';
        t.followerIds = t.followerIds.filter((f) => f !== u.id);
      });
      WB.state.projects.forEach(
        (p) => (p.memberIds = p.memberIds.filter((m) => m !== u.id)),
      );
      WB.state.users = WB.state.users.filter((x) => x.id !== u.id);
      if (WB.state.me === u.id) WB.state.me = WB.state.users[0].id;
      WB.save();
      location.hash = '#/members';
      render();
    },
    'close-modal'() {
      ui.modal = null;
      render();
    },
    'export-csv'(el) {
      const p = WB.project(el.dataset.id);
      download(`${fileName(p.name)}.csv`, taskRows(WB.tasksOf(p.id)));
    },
    'export-member'(el) {
      const u = WB.user(el.dataset.id);
      download(
        `${fileName(u.name)}.csv`,
        taskRows(WB.state.tasks.filter((t) => t.assigneeId === u.id)),
      );
    },
    print() {
      window.print();
    },
    'reset-data'() {
      if (
        !confirm(
          'Xóa toàn bộ dữ liệu hiện tại và nạp lại dữ liệu mẫu? Không khôi phục được.',
        )
      )
        return;
      WB.reset();
      ui.taskId = '';
      ui.modal = null;
      location.hash = '#/my';
      render();
      toast('Đã nạp lại dữ liệu mẫu.');
    },
  };

  // ---------- "value changed" handlers ----------
  const chgs = {
    'switch-user'(el) {
      WB.state.me = el.value;
      commit();
    },
    filter(el) {
      ui.filter[el.dataset.key] = el.value;
      render('main');
    },
    'kanban-group'(el) {
      ui.kanbanGroup = el.value;
      render('main');
    },
    field(el) {
      const t = cur();
      if (!t) return;
      const f = el.dataset.field;
      const v = el.value;
      if (f === 'name') {
        const name = v.replace(/\s+/g, ' ').trim();
        if (!name) {
          el.value = t.name;
          return toast('Tên công việc không được để trống.');
        }
        t.name = name;
      } else if (f === 'dueDate')
        t.due = v ? v + (t.due.length > 10 ? t.due.slice(10) : '') : '';
      else if (f === 'dueTime') {
        if (!t.due) {
          el.value = '';
          return toast('Hãy chọn ngày hạn chót trước rồi mới chọn giờ.');
        }
        t.due = t.due.slice(0, 10) + (v ? 'T' + v : '');
      } else if (f === 'tasklistId') {
        t.tasklistId = v;
        WB.subs(t.id).forEach((s) => (s.tasklistId = v));
      } else t[f] = v;
      if (
        (f === 'start' || f === 'dueDate') &&
        t.start &&
        t.due &&
        t.start > t.due.slice(0, 10)
      )
        toast('Lưu ý: ngày bắt đầu đang sau hạn chót.');
      // Free-text boxes keep the drawer as it is, so the cursor does not jump while moving between fields.
      commit(['name', 'desc', 'result'].includes(f) ? 'main' : 'all');
    },
    'toggle-follower'(el) {
      const t = cur();
      t.followerIds = el.checked
        ? [...new Set([...t.followerIds, el.value])]
        : t.followerIds.filter((x) => x !== el.value);
      commit('main');
    },
    'toggle-check'(el) {
      const c = cur().checklist.find((x) => x.id === el.value);
      c.done = el.checked;
      commit();
    },
    'add-dep'(el) {
      const t = cur();
      if (!el.value) return;
      if (WB.wouldCycle(t.id, el.value)) {
        el.value = '';
        return toast(
          'Không thêm được: hai việc này sẽ phụ thuộc vòng tròn vào nhau.',
        );
      }
      t.dependsOn.push(el.value);
      commit();
    },
  };

  // ---------- "typed text then pressed Enter" handlers ----------
  const enters = {
    'add-task'(el, text) {
      const d = el.dataset;
      const t = WB.newTask({
        projectId: d.project,
        tasklistId: d.tasklist,
        parentId: d.parent || '',
        name: text,
        status: d.status || 'todo',
      });
      const parent = WB.task(t.parentId);
      if (parent) t.assigneeId = parent.assigneeId;
      commit();
    },
    'add-tasklist'(el, text) {
      const order = Math.max(-1, ...WB.state.tasklists.map((l) => l.order)) + 1;
      WB.state.tasklists.push({
        id: WB.uid(),
        projectId: el.dataset.project,
        name: text,
        order,
      });
      commit();
    },
    'add-check'(el, text) {
      cur().checklist.push({ id: WB.uid(), text, done: false });
      commit();
    },
    'add-comment'(el, text) {
      cur().comments.push({
        id: WB.uid(),
        userId: WB.state.me,
        text,
        at: WB.stamp(new Date()),
      });
      commit();
    },
  };

  // ---------- form handlers ----------
  const forms = {
    'save-project'(form, data) {
      const name = data.get('name').trim();
      if (!name) return;
      const adminId = data.get('adminId');
      const fields = {
        name,
        deptId: data.get('deptId'),
        adminId,
        memberIds: [...new Set([adminId, ...data.getAll('memberIds')])],
        type: data.get('type'),
        review: data.has('review'),
        start: data.get('start') || '',
        end: data.get('end') || '',
        stage: data.get('stage') || 'plan',
        desc: data.get('desc') || '',
        color: data.get('color') || WB.COLORS[0],
      };
      if (fields.start && fields.end && fields.start > fields.end)
        return toast('Ngày kết thúc phải sau ngày bắt đầu.');
      let p = WB.project(form.dataset.id);
      if (p) Object.assign(p, fields);
      else {
        p = { id: WB.uid(), kind: form.dataset.kind, ...fields };
        WB.state.projects.push(p);
        const order =
          Math.max(-1, ...WB.state.tasklists.map((l) => l.order)) + 1;
        WB.state.tasklists.push({
          id: WB.uid(),
          projectId: p.id,
          name: 'Việc cần làm',
          order,
        });
      }
      ui.modal = null;
      WB.save();
      if (location.hash === `#/p/${p.id}` || ui.route.id === p.id) render();
      else location.hash = `#/p/${p.id}`;
    },
    'save-dept'(form, data) {
      const name = data.get('name').trim();
      if (!name) return;
      WB.state.departments.push({ id: WB.uid(), name });
      ui.modal = null;
      commit();
    },
    'save-member'(form, data) {
      const name = data.get('name').replace(/\s+/g, ' ').trim();
      if (!name) return;
      WB.state.users.push({
        id: WB.uid(),
        name,
        title: data.get('title').trim(),
        color: WB.COLORS[WB.state.users.length % WB.COLORS.length],
      });
      ui.modal = null;
      commit();
    },
    'add-milestone'(form, data) {
      const name = data.get('name').trim();
      if (!name) return;
      WB.state.milestones.push({
        id: WB.uid(),
        projectId: form.dataset.project,
        name,
        due: data.get('due') || '',
      });
      commit();
    },
  };

  // ---------- wiring ----------
  document.addEventListener('pointerdown', () => (pointerDown = true), true);
  const release = () => {
    pointerDown = false;
    if (!pending) return;
    const scope = pending;
    pending = '';
    setTimeout(() => render(scope), 0);
  };
  ['pointerup', 'pointercancel', 'dragend', 'drop'].forEach((ev) =>
    document.addEventListener(ev, release, true),
  );
  window.addEventListener('blur', release);

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = acts[el.dataset.act];
    if (fn) fn(el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-chg]');
    const fn = el && chgs[el.dataset.chg];
    if (fn) fn(el, e);
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('textarea.title-inp')) autoGrow(el);
    if (el.dataset.input === 'filter-q') {
      ui.filter.q = el.value;
      render('main');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      const el = e.target;
      if (el.matches('textarea.title-inp')) {
        e.preventDefault();
        el.blur();
        return;
      }
      const fn = el.matches('input[data-enter]') && enters[el.dataset.enter];
      if (!fn) return;
      e.preventDefault();
      const text = el.value.replace(/\s+/g, ' ').trim();
      if (!text) return;
      el.value = '';
      fn(el, text);
    } else if (e.key === 'Escape') {
      if (ui.modal) acts['close-modal']();
      else if (ui.taskId) {
        // Let a half-typed field save itself first.
        if (
          document.activeElement &&
          $('#drawer').contains(document.activeElement)
        )
          document.activeElement.blur();
        acts['close-drawer']();
      }
    }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    forms[form.dataset.form](form, new FormData(form));
  });

  // Kanban drag and drop
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest && e.target.closest('[data-drag]');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.drag);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  document.addEventListener('dragend', (e) => {
    if (e.target.classList) e.target.classList.remove('dragging');
    document
      .querySelectorAll('.kcol.over')
      .forEach((c) => c.classList.remove('over'));
  });
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest && e.target.closest('[data-drop]');
    if (!col) return;
    e.preventDefault();
    document
      .querySelectorAll('.kcol.over')
      .forEach((c) => c !== col && c.classList.remove('over'));
    col.classList.add('over');
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest && e.target.closest('[data-drop]');
    const t = WB.task(e.dataTransfer.getData('text/plain'));
    if (!col || !t) return;
    e.preventDefault();
    const to = col.dataset.drop;
    if (ui.kanbanGroup === 'status') {
      if (t.status === to) return;
      const p = WB.project(t.projectId);
      if (to === 'done' && p.review && !WB.isAdmin(p)) {
        // Same rule as the tick button: only the project admin can mark work as finished.
        t.status = 'review';
        t.submittedAt = t.submittedAt || WB.stamp(new Date());
        toast(
          'Dự án này cần duyệt: công việc đã được chuyển sang “Chờ duyệt”.',
        );
      } else if (to === 'done') {
        t.status = 'done';
        t.doneAt = t.submittedAt || WB.stamp(new Date());
      } else {
        t.status = to;
        t.doneAt = '';
        t.submittedAt = to === 'review' ? WB.stamp(new Date()) : '';
      }
    } else {
      if (t.tasklistId === to) return;
      t.tasklistId = to;
      WB.subs(t.id).forEach((s) => (s.tasklistId = to));
    }
    pointerDown = false;
    commit();
  });

  // Keep several open tabs in step with each other.
  window.addEventListener('storage', (e) => {
    if (e.key !== 'workboard.state.v1' || !e.newValue) return;
    WB.load();
    render();
  });

  WB.load();
  parseRoute();
  render();
})();
