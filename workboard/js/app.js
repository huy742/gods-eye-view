'use strict';
// App shell: routing, drawing the screen, and every click / typing handler.
(() => {
  const V = WB.views;
  const $ = (sel) => document.querySelector(sel);
  const ui = (WB.ui = {
    route: { page: 'my', id: '', view: '' },
    taskId: '',
    modal: null,
    panel: '',
    panelTab: 'notes',
    filter: { q: '', assignee: '', status: '' },
    kanbanGroup: 'tasklist',
    calMonth: WB.today().slice(0, 7),
    period: { unit: 'week', anchor: WB.today() },
    sort: { key: '', dir: 1 },
    myTab: 'assigned',
    sideOpen: false,
    historyOpen: false,
  });
  let ready = false;

  // ---------- drawing ----------
  // A redraw replaces the buttons on screen. If that happens between "mouse down" and
  // "mouse up", the click is lost — so while a pointer is held, the redraw waits.
  let pointerDown = false;
  let pending = '';
  function render(scope = 'all') {
    if (!ready) return;
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
    // Keep what someone is typing, even when a change from another person redraws the screen.
    const active = document.activeElement;
    const focusId = active && active.id;
    let caret = null;
    let typed = null;
    try {
      caret = focusId ? active.selectionStart : null;
    } catch {
      caret = null;
    }
    if (
      focusId &&
      (active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' &&
          /^(text|search|number|)$/.test(active.type))) &&
      active.value !== active.defaultValue
    )
      typed = active.value;
    $('#side').innerHTML = V.side();
    $('#main').innerHTML = V.main();
    if (scope === 'all') {
      $('#drawer').innerHTML = V.drawer();
      $('#modal').innerHTML = V.modal();
      $('#panel').innerHTML = V.panel();
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
      if (el) {
        if (typed != null && el.value !== typed) el.value = typed;
        if (el !== document.activeElement) el.focus();
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
          repeats: 'Việc lặp lại',
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
    if (!msg) return;
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function openModal(m) {
    ui.modal = m;
    render();
    const first =
      $('#modal [autofocus]') ||
      $('#modal input, #modal select, #modal button');
    if (first) first.focus();
  }

  // ---------- routing ----------
  // Addresses are plain words (#projects, #p-<id>-<view>, #member-<id>) so they survive inside a hosted frame.
  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    let page = 'my';
    let id = '';
    let view = '';
    const views = V.VIEW_NAMES.join('|');
    let m;
    if ((m = raw.match(new RegExp(`^p-([0-9a-z-]+?)(?:-(${views}))?$`, 'i'))))
      [page, id, view] = ['p', m[1], m[2] || ''];
    else if ((m = raw.match(/^member-([0-9a-z-]+)$/i)))
      [page, id] = ['members', m[1]];
    else if (['my', 'projects', 'repeats', 'reports', 'members'].includes(raw))
      page = raw;
    const prev = ui.route;
    ui.route = { page, id, view: page === 'p' ? view || 'list' : '' };
    if (page !== prev.page || id !== prev.id) {
      ui.filter = { q: '', assignee: '', status: '' };
      ui.sort = { key: '', dir: 1 };
    }
    ui.sideOpen = false;
  }
  window.addEventListener('hashchange', () => {
    // Sign-in links put tokens in the address; the cloud module reads those itself.
    if (/[=&]/.test(location.hash)) return;
    parseRoute();
    render();
    $('#main').scrollTop = 0;
    window.scrollTo(0, 0);
  });

  // ---------- dialogs ----------
  // A hosted page cannot use the browser's own confirm/prompt boxes (they answer "no" at once),
  // so every question is asked inside the page.
  let dialog = null;
  let confirmed = false;
  function openDialog(d) {
    dialog = d;
    const e = WB.esc;
    $('#dialog').innerHTML =
      `<div class="dialog-back" data-act="dialog-cancel"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label="${e(d.ok || 'Xác nhận')}">
        <p>${e(d.text)}</p>
        ${d.input != null ? `<input class="inp" id="dialog-input" value="${e(d.input)}" aria-label="${e(d.text)}" autocomplete="off" maxlength="200" />` : ''}
        ${d.copy != null ? `<textarea class="inp" id="dialog-copy" readonly aria-label="Bảng dữ liệu">${e(d.copy)}</textarea>` : ''}
        <div class="modal-foot"><span class="grow"></span>
          <button class="btn" data-act="dialog-cancel">${e(d.cancel || 'Hủy')}</button>
          <button class="btn ${d.danger ? 'danger-fill' : 'primary'}" id="dialog-ok" data-act="dialog-ok">${e(d.ok || 'Đồng ý')}</button>
        </div>
      </div>`;
    const input = $('#dialog-input');
    (input || $('#dialog-ok')).focus();
    if (input) input.select();
  }
  function closeDialog() {
    dialog = null;
    $('#dialog').innerHTML = '';
  }
  // Use as: if (!sure('Delete?', () => sameHandlerAgain(), {...})) return;
  // The first call opens the question and returns false; OK runs the handler again, and then it returns true.
  function sure(text, again, opts = {}) {
    if (confirmed) return true;
    openDialog({
      text,
      ...opts,
      onOk() {
        confirmed = true;
        try {
          again();
        } finally {
          confirmed = false;
        }
      },
    });
    return false;
  }
  const ask = (text, value, onOk) =>
    openDialog({ text, input: value || '', ok: 'Lưu', onOk });

  // ---------- saving files ----------
  // A hosted page must ask the host to save a file; a page opened straight from disk can download it.
  const hostSave =
    window.claude && typeof window.claude.use === 'function'
      ? window.claude.use('downloads').catch(() => null)
      : null;
  const XLSX_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const fileName = (s) =>
    s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'cong-viec';
  async function saveTable(name, rows, sheet) {
    const blob = new Blob([XL.writeXlsx(rows, sheet)], { type: XLSX_TYPE });
    const file = `${fileName(name)}.xlsx`;
    if (!hostSave) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    const saver = await hostSave;
    let note = 'Ở đây không tải file trực tiếp được.';
    if (saver) {
      try {
        await saver.save({ filename: file, data: blob });
        return toast('Đã lưu file.');
      } catch (err) {
        const code = err && err.code;
        if (code === 'declined') return;
        if (code === 'rate_limited')
          return toast(
            'Đang có một yêu cầu lưu file khác. Hãy thử lại sau giây lát.',
          );
        if (code === 'extension_not_enabled')
          note = 'Ở đây không lưu được file Excel.';
      }
    }
    // No way to save a file in this view: hand over the table as text that pastes straight into a spreadsheet.
    const table = rows
      .map((r) => r.map((v) => String(v ?? '').replace(/\s+/g, ' ')).join('\t'))
      .join('\n');
    openDialog({
      text: `${note} Hãy sao chép bảng dưới đây rồi dán vào Excel hoặc Google Sheets.`,
      copy: table,
      ok: 'Sao chép',
      cancel: 'Đóng',
      keep: true,
      onOk() {
        const box = $('#dialog-copy');
        const manual = () => {
          box.focus();
          box.select();
          toast('Đã chọn sẵn bảng. Nhấn Ctrl+C (máy Mac: ⌘C) để sao chép.');
        };
        if (!navigator.clipboard) return manual();
        navigator.clipboard
          .writeText(table)
          .then(() => toast('Đã sao chép. Mở Excel rồi dán vào.'), manual);
      },
    });
  }

  // ---------- helpers ----------
  const cur = () => WB.task(ui.taskId);
  const st = () => WB.state;
  const closeMenus = (except) =>
    document
      .querySelectorAll('details.menu[open]')
      .forEach((d) => d !== except && d.removeAttribute('open'));
  function setDue(t, date, time) {
    WB.updateTask(t, { due: date ? date + (time ? 'T' + time : '') : '' });
  }

  // ---------- click handlers ----------
  const acts = {
    'toggle-side'() {
      ui.sideOpen = !ui.sideOpen;
      render('main');
    },
    'toggle-panel'() {
      ui.panel = ui.panel === 'notif' ? '' : 'notif';
      render();
    },
    'close-panel'() {
      ui.panel = '';
      render();
    },
    'panel-tab'(el) {
      ui.panelTab = el.dataset.tab;
      render();
    },
    'read-all'() {
      WB.myNotifications().forEach((n) => (n.read = true));
      commit();
    },
    'open-note'(el) {
      const n = st().notifications.find((x) => x.id === el.dataset.id);
      if (!n) return;
      n.read = true;
      ui.taskId = n.taskId;
      ui.panel = '';
      commit();
    },
    go(el) {
      location.hash = el.dataset.href;
    },
    'my-tab'(el) {
      ui.myTab = el.dataset.tab;
      render('main');
    },
    'open-task'(el) {
      if (!WB.task(el.dataset.id)) return toast('Công việc này không còn nữa.');
      ui.taskId = el.dataset.id;
      ui.panel = '';
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
        // Say what is missing before asking anything else: the task cannot be finished without it.
        const miss = WB.missingRequired(t);
        if (miss.length)
          return toast(
            `Chưa hoàn thành được: hãy điền ${miss.map((m) => `“${m}”`).join(', ')}.`,
          );
        const left = WB.blockers(t);
        if (
          left.length &&
          !sure(
            `Việc này phụ thuộc vào ${left.length} việc chưa xong:\n- ${left.map((b) => b.name).join('\n- ')}\n\nVẫn đánh dấu hoàn thành?`,
            () => acts['toggle-done'](el),
            { ok: 'Vẫn hoàn thành' },
          )
        )
          return;
      }
      const r = WB.toggleDone(t);
      toast(r.msg);
      if (r.ok) commit();
    },
    reject(el) {
      const t = WB.task(el.dataset.id);
      toast(
        WB.setStatus(t, 'doing').msg || 'Đã chuyển công việc về “Đang làm”.',
      );
      commit();
    },
    'del-task'(el) {
      const t = WB.task(el.dataset.id);
      if (!t) return;
      const p = WB.project(t.projectId);
      if (WB.mode === 'cloud' && !WB.isAdmin(p) && t.createdBy !== st().me)
        return toast(
          'Chỉ người giao việc hoặc quản trị dự án mới xóa được công việc này.',
        );
      const n = WB.subs(t.id).length;
      if (
        !sure(
          `Xóa công việc “${t.name}”${n ? ` và ${n} việc con` : ''}? Không khôi phục được.`,
          () => acts['del-task'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      WB.removeTask(t.id);
      ui.taskId = t.parentId || '';
      commit();
    },
    'dup-task'(el) {
      const t = WB.task(el.dataset.id);
      const copy = WB.copyTask(t, {
        projectId: t.projectId,
        tasklistId: t.tasklistId,
        suffix: ' (bản sao)',
      });
      if (t.parentId) copy.parentId = t.parentId;
      ui.taskId = copy.id;
      toast('Đã nhân bản công việc.');
      commit();
    },
    'open-copy-task'(el) {
      openModal({ type: 'copy-task', id: el.dataset.id });
    },
    'open-multi'(el) {
      openModal({ type: 'multi', id: el.dataset.id });
    },
    'toggle-flag'(el) {
      const t = cur();
      WB.updateTask(t, { [el.dataset.flag]: !t[el.dataset.flag] });
      commit();
    },
    'del-check'(el) {
      const t = cur();
      const c = t.checklist.find((x) => x.id === el.dataset.id);
      t.checklist = t.checklist.filter((x) => x.id !== el.dataset.id);
      if (c) WB.log(t, `đã xóa “${c.text}” khỏi danh sách kiểm tra`);
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
      if (!dir) ui.calMonth = WB.today().slice(0, 7);
      else {
        const [y, m] = ui.calMonth.split('-').map(Number);
        ui.calMonth = WB.ymd(new Date(y, m - 1 + dir, 1)).slice(0, 7);
      }
      render('main');
    },
    'period-unit'(el) {
      ui.period.unit = el.dataset.unit;
      render('main');
    },
    'period-move'(el) {
      const dir = +el.dataset.dir;
      const p = ui.period;
      if (!dir) p.anchor = WB.today();
      else if (p.unit === 'week') p.anchor = WB.shiftDate(p.anchor, 7 * dir);
      else {
        const d = WB.toDate(p.anchor);
        p.anchor = WB.ymd(new Date(d.getFullYear(), d.getMonth() + dir, 1));
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
      ask('Tên mới của danh sách việc:', l.name, (v) => {
        l.name = v;
        commit();
      });
    },
    'del-tasklist'(el) {
      const l = WB.tasklist(el.dataset.id);
      const n = st().tasks.filter((t) => t.tasklistId === l.id).length;
      if (
        !sure(
          `Xóa danh sách việc “${l.name}”${n ? ` cùng ${n} công việc bên trong` : ''}? Không khôi phục được.`,
          () => acts['del-tasklist'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      WB.removeTasklist(l.id);
      commit();
    },
    'del-milestone'(el) {
      const m = WB.milestone(el.dataset.id);
      if (
        !sure(
          `Xóa mục tiêu “${m.name}”? Các công việc vẫn giữ nguyên, chỉ bỏ gắn với mục tiêu này.`,
          () => acts['del-milestone'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      WB.removeMilestone(m.id);
      commit();
    },
    'new-project'(el) {
      openModal({ type: 'project', kind: el.dataset.kind });
    },
    'edit-project'(el) {
      openModal({ type: 'project', id: el.dataset.id });
    },
    'del-project'(el) {
      const p = WB.project(el.dataset.id);
      const n = WB.tasksOf(p.id).length;
      if (
        !sure(
          `Xóa “${p.name}” cùng ${n} công việc bên trong? Không khôi phục được.`,
          () => acts['del-project'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      WB.removeProject(p.id);
      ui.modal = null;
      ui.taskId = '';
      WB.save();
      location.hash = '#projects';
      render();
    },
    'new-dept'() {
      openModal({ type: 'dept' });
    },
    'rename-dept'(el) {
      const d = WB.dept(el.dataset.id);
      ask('Tên mới của phòng ban:', d.name, (v) => {
        d.name = v;
        commit();
      });
    },
    'del-dept'(el) {
      const d = WB.dept(el.dataset.id);
      const n = st().projects.filter((p) => p.deptId === d.id).length;
      if (
        !sure(
          `Xóa phòng ban “${d.name}”?${n ? ` ${n} dự án/nhóm bên trong sẽ không bị xóa, chỉ chuyển về “Chưa thuộc phòng ban”.` : ''}`,
          () => acts['del-dept'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      st().projects.forEach((p) => p.deptId === d.id && (p.deptId = ''));
      st().departments = st().departments.filter((x) => x.id !== d.id);
      commit();
    },
    'new-member'() {
      openModal({ type: 'member' });
    },
    'del-member'(el) {
      const u = WB.user(el.dataset.id);
      if (st().users.length < 2)
        return toast('Phải còn ít nhất một thành viên.');
      const owns = st().projects.filter((p) => p.adminId === u.id);
      if (owns.length)
        return toast(
          `${u.name} đang quản trị “${owns[0].name}”. Hãy đổi người quản trị trước.`,
        );
      const n = st().tasks.filter((t) => t.assigneeId === u.id).length;
      if (
        !sure(
          `Xóa thành viên ${u.name}?${n ? ` ${n} công việc của người này sẽ chuyển thành “Chưa giao”.` : ''}`,
          () => acts['del-member'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      st().tasks.forEach((t) => {
        if (t.assigneeId === u.id) t.assigneeId = '';
        t.followerIds = t.followerIds.filter((f) => f !== u.id);
      });
      st().repeats.forEach((r) => {
        if (r.assigneeId === u.id) r.assigneeId = '';
      });
      st().projects.forEach(
        (p) => (p.memberIds = p.memberIds.filter((m) => m !== u.id)),
      );
      st().notifications = st().notifications.filter((x) => x.userId !== u.id);
      st().users = st().users.filter((x) => x.id !== u.id);
      if (st().me === u.id) st().me = st().users[0].id;
      WB.save();
      location.hash = '#members';
      render();
    },
    'close-modal'() {
      ui.modal = null;
      render();
    },
    'new-from-template'() {
      openModal({ type: 'template', wide: true });
    },
    'pick-template'(el) {
      openModal({
        type: 'template',
        wide: !el.dataset.id,
        pick: el.dataset.id,
      });
    },
    'del-template'(el) {
      const tpl = st().templates.find((x) => x.id === el.dataset.id);
      if (!tpl) return;
      if (
        !sure(
          `Xóa mẫu “${tpl.name}”? Các dự án đã tạo từ mẫu này không bị ảnh hưởng.`,
          () => acts['del-template'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      st().templates = st().templates.filter((x) => x.id !== tpl.id);
      commit();
    },
    'open-save-template'(el) {
      openModal({ type: 'save-template', id: el.dataset.id });
    },
    'open-dup-project'(el) {
      openModal({ type: 'dup-project', id: el.dataset.id });
    },
    'open-fields'(el) {
      openModal({ type: 'fields', id: el.dataset.id });
    },
    'move-field'(el) {
      const f = WB.field(el.dataset.id);
      const list = WB.fieldsOf(f.projectId);
      const other = list[list.indexOf(f) + +el.dataset.dir];
      if (!other) return;
      [f.order, other.order] = [other.order, f.order];
      commit();
    },
    'del-field'(el) {
      const f = WB.field(el.dataset.id);
      const used = st().tasks.filter((t) => (t.custom || {})[f.id]).length;
      if (
        !sure(
          `Xóa trường “${f.name}”?${used ? ` Thông tin đã điền ở ${used} công việc cũng bị xóa.` : ''}`,
          () => acts['del-field'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      WB.removeField(f.id);
      commit();
    },
    'new-repeat'(el) {
      if (!WB.visibleProjects().length)
        return toast('Hãy tạo một dự án hoặc nhóm trước.');
      openModal({ type: 'repeat', projectId: el.dataset.project || '' });
    },
    'edit-repeat'(el) {
      openModal({ type: 'repeat', id: el.dataset.id });
    },
    'del-repeat'(el) {
      const r = WB.repeat(el.dataset.id);
      if (
        !sure(
          `Xóa việc lặp lại “${r.name}”? Các công việc đã tạo trước đó vẫn giữ nguyên.`,
          () => acts['del-repeat'](el),
          { ok: 'Xóa', danger: true },
        )
      )
        return;
      st().repeats = st().repeats.filter((x) => x.id !== r.id);
      st().tasks.forEach((t) => {
        if (t.repeatId === r.id) t.repeatId = '';
      });
      commit();
    },
    'open-import'(el) {
      openModal({ type: 'import', id: el.dataset.id, wide: true });
    },
    'import-template'(el) {
      const p = WB.project(el.dataset.id);
      saveTable(
        `Mẫu nhập công việc - ${p.name}`,
        WB.importTemplateRows(p),
        'Công việc',
      );
    },
    'import-reset'(el) {
      openModal({ type: 'import', id: el.dataset.id, wide: true });
    },
    'import-run'(el) {
      const p = WB.project(el.dataset.id);
      const m = ui.modal;
      if (!m || !m.plan) return;
      const n = WB.runImport(p, m.plan);
      ui.modal = null;
      toast(`Đã nhập ${n} công việc.`);
      commit();
    },
    'export-xlsx'(el) {
      const p = WB.project(el.dataset.id);
      saveTable(
        p.name,
        WB.exportRows(WB.tasksOf(p.id), {
          withProject: false,
          fields: WB.fieldsOf(p.id),
        }),
        'Công việc',
      );
    },
    'export-member'(el) {
      const u = WB.user(el.dataset.id);
      saveTable(
        u.name,
        WB.exportRows(WB.visibleTasks().filter((t) => t.assigneeId === u.id)),
        'Công việc',
      );
    },
    'reset-data'() {
      if (
        !sure(
          'Xóa toàn bộ dữ liệu hiện tại và nạp lại dữ liệu mẫu? Không khôi phục được.',
          () => acts['reset-data'](),
          { ok: 'Nạp lại dữ liệu mẫu', danger: true },
        )
      )
        return;
      WB.backend.reset();
      WB.runRepeats();
      WB.save();
      ui.taskId = '';
      ui.modal = null;
      ui.panel = '';
      location.hash = '#my';
      render();
      toast('Đã nạp lại dữ liệu mẫu.');
    },
    'dialog-cancel': closeDialog,
    'dialog-ok'() {
      const d = dialog;
      if (!d) return;
      const input = $('#dialog-input');
      const value = input ? input.value.replace(/\s+/g, ' ').trim() : '';
      if (input && !value) return input.focus();
      if (!d.keep) closeDialog();
      if (d.onOk) d.onOk(value);
    },
  };

  // ---------- "value changed" handlers ----------
  const chgs = {
    'switch-user'(el) {
      st().me = el.value;
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
        WB.updateTask(t, { name });
      } else if (f === 'dueDate') setDue(t, v, t.due.slice(11, 16));
      else if (f === 'dueTime') {
        if (!t.due) {
          el.value = '';
          return toast('Hãy chọn ngày hạn chót trước rồi mới chọn giờ.');
        }
        setDue(t, t.due.slice(0, 10), v);
      } else if (f === 'status') {
        toast(WB.setStatus(t, v).msg);
      } else WB.updateTask(t, { [f]: v });
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
    custom(el) {
      const t = cur();
      const f = WB.field(el.dataset.field);
      if (!t || !f) return;
      let v = el.value.trim();
      if (f.type === 'number' && v && !Number.isFinite(+v)) {
        el.value = (t.custom || {})[f.id] || '';
        return toast(`“${f.name}” phải là một con số.`);
      }
      WB.updateTask(t, { custom: { ...(t.custom || {}), [f.id]: v } });
      commit(f.type === 'text' || f.type === 'textarea' ? 'main' : 'all');
    },
    'toggle-follower'(el) {
      const t = cur();
      WB.updateTask(t, {
        followerIds: el.checked
          ? [...new Set([...t.followerIds, el.value])]
          : t.followerIds.filter((x) => x !== el.value),
      });
      commit('main');
    },
    'toggle-check'(el) {
      const t = cur();
      const c = t.checklist.find((x) => x.id === el.value);
      c.done = el.checked;
      t.checklist = [...t.checklist];
      WB.log(
        t,
        `${c.done ? 'đã đánh dấu xong' : 'đã bỏ đánh dấu'} “${c.text}”`,
      );
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
      t.dependsOn = [...t.dependsOn, el.value];
      WB.log(t, `đã thêm việc phải làm trước “${WB.task(el.value).name}”`);
      commit();
    },
    'repeat-enabled'(el) {
      const r = WB.repeat(el.value);
      r.enabled = el.checked;
      if (r.enabled && (!r.lastRun || r.lastRun < WB.shiftDate(WB.today(), -1)))
        r.lastRun = WB.shiftDate(WB.today(), -1);
      const made = r.enabled ? WB.runRepeats() : [];
      toast(
        r.enabled
          ? `Đã bật “${r.name}”.${made.length ? ` Đã tạo ${made.length} công việc cho hôm nay.` : ''}`
          : `Đã tắt “${r.name}”.`,
      );
      commit();
    },
    'repeat-project'(el) {
      redrawRepeatForm(el.form, { projectId: el.value, tasklistId: '' });
    },
    'repeat-freq'(el) {
      redrawRepeatForm(el.form, { freq: el.value });
    },
    'copy-target'(el) {
      ui.modal = { ...ui.modal, target: el.value };
      render();
    },
    'field-def'(el) {
      const f = WB.field(el.dataset.id);
      const k = el.dataset.key;
      if (k === 'name') {
        const v = el.value.replace(/\s+/g, ' ').trim();
        if (!v) {
          el.value = f.name;
          return toast('Tên trường không được để trống.');
        }
        f.name = v;
      } else if (k === 'type') f.type = el.value;
      else if (k === 'required') f.required = el.checked;
      else if (k === 'options')
        f.options = [
          ...new Set(
            el.value
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        ];
      commit();
    },
    async 'import-file'(el) {
      const p = WB.project(el.dataset.id);
      const file = el.files && el.files[0];
      if (!file) return;
      try {
        const rows = await XL.readTable(file);
        const plan = WB.planImport(p, rows);
        openModal({
          type: 'import',
          id: p.id,
          plan,
          fileName: file.name,
          wide: true,
        });
      } catch (err) {
        openModal({
          type: 'import',
          id: p.id,
          error: err.message || 'Không đọc được file này.',
          wide: true,
        });
      }
    },
  };
  // Re-draw the repeat form when a choice changes what else it shows, keeping what was typed.
  function redrawRepeatForm(form, change) {
    const draft = readRepeatForm(form);
    ui.modal = { ...ui.modal, draft: { ...draft, ...change } };
    render();
  }
  function readRepeatForm(form) {
    const d = new FormData(form);
    const lines = (k) =>
      String(d.get(k) || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    return {
      name: String(d.get('name') || '').trim(),
      projectId: d.get('projectId') || '',
      tasklistId: d.get('tasklistId') || '',
      assigneeId: d.get('assigneeId') || '',
      dueTime: d.get('dueTime') || '',
      every: Math.min(99, Math.max(1, Math.floor(+d.get('every') || 1))),
      freq: d.get('freq') || 'week',
      weekdays: d.getAll('weekdays').map(Number),
      monthDay:
        d.get('monthDay') == null
          ? 1
          : d.get('monthDay') === 'last'
            ? 'last'
            : +d.get('monthDay'),
      start: d.get('start') || WB.today(),
      end: d.get('end') || '',
      desc: String(d.get('desc') || '').trim(),
      checklist: lines('checklist'),
      subtasks: lines('subtasks'),
      important: d.has('important'),
      urgent: d.has('urgent'),
    };
  }

  // ---------- "typed text then pressed Enter" handlers ----------
  const enters = {
    'add-task'(el, text) {
      const d = el.dataset;
      const parent = WB.task(d.parent);
      const t = WB.newTask({
        projectId: d.project,
        tasklistId: d.tasklist,
        parentId: d.parent || '',
        name: text,
        assigneeId: parent ? parent.assigneeId : '',
      });
      if (d.status && d.status !== 'todo') WB.setStatus(t, d.status);
      commit();
    },
    'add-tasklist'(el, text) {
      st().tasklists.push({
        id: WB.uid(),
        projectId: el.dataset.project,
        name: text,
        order: WB.nextOrder(st().tasklists),
      });
      commit();
    },
    'add-check'(el, text) {
      const t = cur();
      t.checklist = [...t.checklist, { id: WB.uid(), text, done: false }];
      WB.log(t, `đã thêm “${text}” vào danh sách kiểm tra`);
      commit();
    },
    'add-comment'(el, text) {
      WB.addComment(cur(), text);
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
        private: data.has('private'),
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
        st().projects.push(p);
        st().tasklists.push({
          id: WB.uid(),
          projectId: p.id,
          name: 'Việc cần làm',
          order: WB.nextOrder(st().tasklists),
        });
      }
      ui.modal = null;
      WB.save();
      if (ui.route.id === p.id) render();
      else location.hash = `#p-${p.id}`;
    },
    'save-dept'(form, data) {
      const name = data.get('name').trim();
      if (!name) return;
      st().departments.push({ id: WB.uid(), name });
      ui.modal = null;
      commit();
    },
    'save-member'(form, data) {
      const name = data.get('name').replace(/\s+/g, ' ').trim();
      if (!name) return;
      st().users.push({
        id: WB.uid(),
        name,
        title: data.get('title').trim(),
        color: WB.COLORS[st().users.length % WB.COLORS.length],
      });
      ui.modal = null;
      commit();
    },
    'add-milestone'(form, data) {
      const name = data.get('name').trim();
      if (!name) return;
      st().milestones.push({
        id: WB.uid(),
        projectId: form.dataset.project,
        name,
        due: data.get('due') || '',
      });
      commit();
    },
    'add-field'(form, data) {
      const name = data.get('name').replace(/\s+/g, ' ').trim();
      if (!name) return;
      const pid = form.dataset.project;
      if (WB.fieldsOf(pid).some((f) => WB.norm(f.name) === WB.norm(name)))
        return toast('Đã có trường cùng tên.');
      st().fields.push({
        id: WB.uid(),
        projectId: pid,
        name,
        type: data.get('type'),
        options: [],
        required: false,
        order: WB.nextOrder(st().fields),
      });
      commit();
      const box = $('#new-field-name');
      if (box) box.focus();
    },
    'save-repeat'(form) {
      const v = readRepeatForm(form);
      if (!v.name) return toast('Hãy nhập tên công việc.');
      if (!WB.project(v.projectId)) return toast('Hãy chọn dự án hoặc nhóm.');
      if (v.end && v.end < v.start)
        return toast('Ngày kết thúc phải sau ngày bắt đầu.');
      if (v.freq === 'week' && !v.weekdays.length)
        return toast('Hãy chọn ít nhất một ngày trong tuần.');
      let r = WB.repeat(form.dataset.id);
      if (r) Object.assign(r, v);
      else {
        r = {
          id: WB.uid(),
          ...v,
          followerIds: [],
          enabled: true,
          lastRun: WB.shiftDate(WB.today(), -1),
          createdBy: st().me,
        };
        if (r.start > WB.today()) r.lastRun = WB.shiftDate(r.start, -1);
        st().repeats.push(r);
      }
      const made = WB.runRepeats();
      ui.modal = null;
      const next = WB.nextOccurrence(
        r,
        WB.shiftDate(WB.today(), made.length ? 1 : 0),
      );
      toast(
        made.length
          ? `Đã lưu. Đã tạo ${made.length} công việc cho hôm nay.`
          : `Đã lưu. Lần tới: ${next ? WB.fmtDate(next) : 'không còn'}.`,
      );
      commit();
    },
    'use-template'(form, data) {
      const tpl = WB.allTemplates().find((x) => x.id === form.dataset.id);
      const name = data.get('name').trim();
      if (!tpl || !name) return;
      const p = WB.projectFromTemplate(tpl, {
        name,
        kind: tpl.kind,
        deptId: data.get('deptId'),
        start: data.get('start') || WB.today(),
      });
      ui.modal = null;
      WB.save();
      location.hash = `#p-${p.id}`;
      toast(`Đã tạo “${p.name}” từ mẫu.`);
    },
    'save-template'(form, data) {
      const p = WB.project(form.dataset.id);
      const name = data.get('name').trim();
      if (!name) return;
      st().templates.push(
        WB.templateFromProject(p, name, data.get('desc').trim()),
      );
      ui.modal = null;
      toast(`Đã lưu mẫu “${name}”. Dùng ở Dự án & Nhóm → + Từ mẫu.`);
      commit();
    },
    'dup-project'(form, data) {
      const p = WB.project(form.dataset.id);
      const name = data.get('name').trim();
      if (!name) return;
      const np = WB.duplicateProject(p, {
        name,
        tasks: data.has('tasks'),
        keepAssignees: data.has('keepAssignees'),
        keepDone: data.has('keepDone'),
      });
      ui.modal = null;
      WB.save();
      location.hash = `#p-${np.id}`;
      toast('Đã nhân bản.');
    },
    'copy-task'(form, data) {
      const t = WB.task(form.dataset.id);
      const projectId = data.get('projectId');
      const tasklistId =
        data.get('tasklistId') || (WB.listsOf(projectId)[0] || {}).id || '';
      const target = WB.project(projectId);
      const keepAssignee = target.memberIds.includes(t.assigneeId);
      const copy = WB.copyTask(t, {
        projectId,
        tasklistId,
        subtasks: data.has('subtasks'),
        checklist: data.has('checklist'),
        keepDone: data.has('keepDone'),
        assigneeId: keepAssignee ? t.assigneeId : '',
      });
      ui.modal = null;
      ui.taskId = copy.id;
      toast(
        `Đã sao chép sang “${target.name}”.${keepAssignee || !t.assigneeId ? '' : ' Người thực hiện không thuộc dự án đó nên để trống.'}`,
      );
      commit();
    },
    'multi-assign'(form, data) {
      const t = WB.task(form.dataset.id);
      const ids = data.getAll('userIds');
      if (!ids.length) return toast('Hãy chọn ít nhất một người.');
      ids.forEach((u) =>
        WB.copyTask(t, {
          projectId: t.projectId,
          tasklistId: t.tasklistId,
          assigneeId: u,
        }),
      );
      ui.modal = null;
      toast(`Đã tạo ${ids.length} bản cho ${ids.length} người.`);
      commit();
    },
  };

  // Extra handlers from the cloud module (sign-in, invitations, roles).
  Object.assign(acts, WB.extraActs || {});
  Object.assign(chgs, WB.extraChgs || {});
  Object.assign(forms, WB.extraForms || {});

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
    const menu = e.target.closest('details.menu');
    closeMenus(menu);
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.closest('.g-bar')) return; // the Gantt bar handles its own clicks
    const fn = acts[el.dataset.act];
    if (fn) {
      if (el.tagName === 'A') e.preventDefault();
      fn(el, e);
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-chg]');
    const fn = el && chgs[el.dataset.chg];
    if (fn) fn(el, e);
  });
  document.addEventListener(
    'toggle',
    (e) => {
      if (e.target.dataset && e.target.dataset.toggle === 'history')
        ui.historyOpen = e.target.open;
    },
    true,
  );
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
    if (dialog && e.key === 'Escape') return closeDialog();
    if (dialog && e.key === 'Enter' && e.target.id === 'dialog-input') {
      e.preventDefault();
      return acts['dialog-ok']();
    }
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
      const open = document.querySelector('details.menu[open]');
      if (open) return open.removeAttribute('open');
      if (ui.modal) acts['close-modal']();
      else if (ui.panel) acts['close-panel']();
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
    const fn = forms[form.dataset.form];
    if (fn) fn(form, new FormData(form));
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
    pointerDown = false;
    const to = col.dataset.drop;
    if (ui.kanbanGroup === 'status') {
      if (t.status === to) return;
      const r = WB.setStatus(t, to);
      toast(r.msg);
      if (!r.ok) return render();
    } else {
      if (t.tasklistId === to) return;
      WB.updateTask(t, { tasklistId: to });
    }
    commit();
  });

  // Gantt: drag a bar to move the task, drag an edge to change its start or deadline.
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest && e.target.closest('.g-bar');
    if (!bar || e.button > 0) return;
    const edge = e.target.dataset && e.target.dataset.edge;
    drag = {
      bar,
      id: bar.dataset.gantt,
      edge: edge || 'move',
      x0: e.clientX,
      left: bar.offsetLeft,
      width: bar.offsetWidth,
      moved: false,
    };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > 3) drag.moved = true;
    const W = V.GANTT_W;
    const snap = Math.round(dx / W) * W;
    if (drag.edge === 'move') drag.bar.style.left = `${drag.left + snap}px`;
    else if (drag.edge === 'due')
      drag.bar.style.width = `${Math.max(W - 4, drag.width + snap)}px`;
    else {
      const w = drag.width - snap;
      if (w >= W - 4) {
        drag.bar.style.left = `${drag.left + snap}px`;
        drag.bar.style.width = `${w}px`;
      }
    }
  });
  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.bar.classList.remove('dragging');
    const t = WB.task(d.id);
    if (!t) return;
    if (!d.moved) {
      ui.taskId = t.id;
      return render();
    }
    const days = Math.round((e.clientX - d.x0) / V.GANTT_W);
    if (!days) return render();
    const start = t.start || t.due.slice(0, 10);
    const due = t.due || t.start;
    const time = t.due.slice(10);
    if (d.edge === 'move')
      WB.updateTask(t, {
        start: t.start ? WB.shiftDate(t.start, days) : '',
        due: t.due ? WB.shiftDate(t.due, days) : '',
      });
    else if (d.edge === 'due') {
      const nd = WB.shiftDate(due.slice(0, 10), days);
      WB.updateTask(t, {
        start: t.start || (nd < start ? '' : start),
        due: (nd < start ? start : nd) + time,
      });
    } else {
      let ns = WB.shiftDate(start, days);
      if (due && ns > due.slice(0, 10)) ns = due.slice(0, 10);
      WB.updateTask(t, { start: ns, due: t.due || ns });
    }
    toast(
      `Đã đổi ngày: ${WB.fmtDate(t.start) || '…'} → ${WB.fmtDate(t.due) || '…'}`,
    );
    commit();
  });

  // Keep several open tabs in step with each other (local mode only).
  window.addEventListener('storage', (e) => {
    if (WB.mode !== 'local' || e.key !== WB.KEY || !e.newValue) return;
    WB.load();
    render();
  });
  // A new day may bring new repeating tasks.
  let lastDay = WB.today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !ready) return;
    if (WB.today() !== lastDay) {
      lastDay = WB.today();
      if (WB.runRepeats().length) commit();
      else render();
    }
  });

  Object.assign(WB, {
    render,
    commit,
    toast,
    openDialog,
    closeDialog,
    sure,
    openModal,
    parseRoute,
  });
  // Called once the data is in place (straight away locally, after sign-in in cloud mode).
  WB.ready = () => {
    ready = true;
    parseRoute();
    render();
  };
  if (WB.mode === 'cloud' && WB.cloud) WB.cloud.start();
  else {
    WB.load();
    if (WB.runRepeats().length) WB.save();
    WB.ready();
  }
})();
