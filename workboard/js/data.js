'use strict';
// Data layer: everything lives in one object saved to the browser's localStorage.
window.WB = {};
(() => {
  const KEY = 'workboard.state.v1';
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 10);
  const ymd = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const stamp = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  // 'YYYY-MM-DD' alone would be read as UTC, so always pin it to local midnight.
  const toDate = (s) =>
    s ? new Date(s.length === 10 ? s + 'T00:00:00' : s) : null;
  // A deadline without an hour means "end of that day".
  const dueDate = (t) =>
    t.due ? new Date(t.due.length === 10 ? t.due + 'T23:59:59' : t.due) : null;
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );

  const STATUS = {
    todo: { label: 'Cần làm', color: '#8a94a6' },
    doing: { label: 'Đang làm', color: '#2f80ed' },
    review: { label: 'Chờ duyệt', color: '#f2994a' },
    done: { label: 'Hoàn thành', color: '#27ae60' },
    late: { label: 'Hoàn thành muộn', color: '#9b6a00' },
    overdue: { label: 'Quá hạn', color: '#e5484d' },
  };
  const STAGES = {
    plan: { label: 'Đúng kế hoạch', color: '#27ae60' },
    adjust: { label: 'Cần điều chỉnh', color: '#f2994a' },
    urgent: { label: 'Khẩn cấp', color: '#e5484d' },
    closed_done: { label: 'Đã đóng · hoàn thành', color: '#64748b' },
    closed_unfinished: { label: 'Đã đóng · chưa hoàn thành', color: '#64748b' },
    closed_paused: { label: 'Đã đóng · tạm dừng', color: '#64748b' },
  };
  const COLORS = [
    '#2563eb',
    '#e5484d',
    '#27ae60',
    '#f2994a',
    '#8b5cf6',
    '#0891b2',
    '#db2777',
    '#64748b',
  ];

  const blankTask = () => ({
    id: uid(),
    projectId: '',
    tasklistId: '',
    parentId: '',
    name: '',
    desc: '',
    assigneeId: '',
    followerIds: [],
    start: '',
    due: '',
    important: false,
    urgent: false,
    milestoneId: '',
    checklist: [],
    dependsOn: [],
    comments: [],
    result: '',
    status: 'todo',
    doneAt: '',
    submittedAt: '',
    createdBy: '',
    createdAt: stamp(new Date()),
    order: 0,
  });

  function seed() {
    const now = new Date();
    const day = (n) => ymd(addDays(now, n));
    const at = (n, hm) => `${day(n)}T${hm}`;
    const users = [
      ['u1', 'Nguyễn Minh Anh', 'Trưởng phòng Sản phẩm'],
      ['u2', 'Trần Quốc Bảo', 'Lập trình viên'],
      ['u3', 'Lê Thu Hà', 'Thiết kế'],
      ['u4', 'Phạm Đức Long', 'Trưởng phòng Marketing'],
      ['u5', 'Vũ Ngọc Mai', 'Nhân sự'],
      ['u6', 'Đỗ Hoàng Nam', 'Kiểm thử'],
    ].map(([id, name, title], i) => ({
      id,
      name,
      title,
      color: COLORS[i % COLORS.length],
    }));
    const departments = [
      { id: 'd1', name: 'Sản phẩm' },
      { id: 'd2', name: 'Marketing' },
      { id: 'd3', name: 'Nhân sự' },
    ];
    const projects = [
      {
        id: 'p1',
        kind: 'project',
        name: 'Ra mắt website mới',
        deptId: 'd1',
        adminId: 'u1',
        memberIds: ['u1', 'u2', 'u3', 'u6'],
        type: 'internal',
        review: true,
        start: day(-20),
        end: day(25),
        stage: 'plan',
        desc: 'Làm lại website công ty: thiết kế mới, tốc độ nhanh hơn, có trang tuyển dụng.',
        color: COLORS[0],
      },
      {
        id: 'p2',
        kind: 'project',
        name: 'Chiến dịch Tết 2027',
        deptId: 'd2',
        adminId: 'u4',
        memberIds: ['u4', 'u3', 'u1'],
        type: 'customer',
        review: false,
        start: day(-5),
        end: day(40),
        stage: 'adjust',
        desc: 'Chiến dịch quảng cáo dịp Tết cho khách hàng.',
        color: COLORS[1],
      },
      {
        id: 'p3',
        kind: 'team',
        name: 'Việc hằng tuần · Nhân sự',
        deptId: 'd3',
        adminId: 'u5',
        memberIds: ['u5', 'u1'],
        type: 'internal',
        review: false,
        start: '',
        end: '',
        stage: 'plan',
        desc: 'Các việc lặp lại mỗi tuần, mỗi tháng của phòng Nhân sự.',
        color: COLORS[2],
      },
    ];
    const tasklists = [];
    const tasks = [];
    const milestones = [];
    const TL = (projectId, name) => {
      const id = uid();
      tasklists.push({ id, projectId, name, order: tasklists.length });
      return id;
    };
    const MS = (projectId, name, due) => {
      const id = uid();
      milestones.push({ id, projectId, name, due });
      return id;
    };
    const T = (projectId, tasklistId, name, o = {}) => {
      const t = {
        ...blankTask(),
        projectId,
        tasklistId,
        name,
        createdBy: projects.find((p) => p.id === projectId).adminId,
        createdAt: at(-21, '09:00'),
        order: tasks.length,
        ...o,
      };
      tasks.push(t);
      return t.id;
    };
    const done = (n) => ({ status: 'done', doneAt: at(n, '16:00') });

    // Project 1
    const a1 = TL('p1', 'Chuẩn bị');
    const a2 = TL('p1', 'Thiết kế');
    const a3 = TL('p1', 'Lập trình');
    const a4 = TL('p1', 'Kiểm thử & ra mắt');
    const m1 = MS('p1', 'Chốt thiết kế', day(3));
    const m2 = MS('p1', 'Có bản chạy thử', day(14));
    const m3 = MS('p1', 'Ra mắt chính thức', day(25));
    T('p1', a1, 'Họp khởi động dự án', {
      assigneeId: 'u1',
      start: day(-20),
      due: day(-19),
      ...done(-19),
    });
    const k2 = T('p1', a1, 'Liệt kê các trang cần có', {
      assigneeId: 'u1',
      start: day(-18),
      due: day(-15),
      ...done(-13),
      result:
        'Có 8 trang: Trang chủ, Giới thiệu, Sản phẩm, Bảng giá, Tin tức, Tuyển dụng, Liên hệ, Hỗ trợ.',
    });
    const k3 = T('p1', a2, 'Vẽ khung bố cục trang chủ', {
      assigneeId: 'u3',
      start: day(-14),
      due: day(-8),
      milestoneId: m1,
      dependsOn: [k2],
      ...done(-9),
    });
    const k4 = T('p1', a2, 'Thiết kế giao diện trang chủ', {
      assigneeId: 'u3',
      followerIds: ['u1'],
      start: day(-8),
      due: day(-1),
      important: true,
      urgent: true,
      milestoneId: m1,
      dependsOn: [k3],
      status: 'doing',
      desc: 'Bám theo bộ nhận diện mới. Cần bản cho máy tính và điện thoại.',
      checklist: [
        { id: uid(), text: 'Bản máy tính', done: true },
        { id: uid(), text: 'Bản điện thoại', done: false },
        { id: uid(), text: 'Gửi sếp xem', done: false },
      ],
      comments: [
        {
          id: uid(),
          userId: 'u1',
          text: 'Hà ơi phần đầu trang chữ hơi nhỏ, em chỉnh giúp chị nhé.',
          at: at(-2, '10:15'),
        },
        {
          id: uid(),
          userId: 'u3',
          text: 'Dạ em sửa xong trong hôm nay ạ.',
          at: at(-2, '10:40'),
        },
      ],
    });
    T('p1', a2, 'Thiết kế các trang con', {
      assigneeId: 'u3',
      start: day(0),
      due: day(3),
      important: true,
      milestoneId: m1,
      dependsOn: [k4],
    });
    const k6 = T('p1', a3, 'Dựng khung mã nguồn', {
      assigneeId: 'u2',
      start: day(-10),
      due: day(-6),
      milestoneId: m2,
      ...done(-6),
    });
    const k7 = T('p1', a3, 'Lập trình trang chủ', {
      assigneeId: 'u2',
      followerIds: ['u1', 'u3'],
      start: day(-3),
      due: at(4, '17:00'),
      important: true,
      milestoneId: m2,
      dependsOn: [k6],
      status: 'doing',
    });
    T('p1', '', 'Phần đầu trang và thanh menu', {
      parentId: k7,
      tasklistId: a3,
      assigneeId: 'u2',
      ...done(-1),
    });
    T('p1', '', 'Phần giới thiệu sản phẩm', {
      parentId: k7,
      tasklistId: a3,
      assigneeId: 'u2',
      status: 'doing',
    });
    T('p1', '', 'Phần chân trang', {
      parentId: k7,
      tasklistId: a3,
      assigneeId: 'u2',
    });
    T('p1', a3, 'Làm form liên hệ', {
      assigneeId: 'u2',
      start: day(2),
      due: day(7),
      milestoneId: m2,
      status: 'review',
      submittedAt: at(0, '08:30'),
    });
    T('p1', a3, 'Lập trình trang tuyển dụng', {
      assigneeId: 'u2',
      start: day(6),
      due: day(12),
      milestoneId: m2,
    });
    const k10 = T('p1', a4, 'Viết kịch bản kiểm thử', {
      assigneeId: 'u6',
      start: day(5),
      due: day(10),
      milestoneId: m2,
    });
    T('p1', a4, 'Kiểm thử trên điện thoại', {
      assigneeId: 'u6',
      start: day(12),
      due: day(18),
      urgent: true,
      milestoneId: m3,
      dependsOn: [k10],
    });
    T('p1', a4, 'Mua tên miền và máy chủ', {
      assigneeId: 'u1',
      start: day(-4),
      due: day(-2),
      urgent: true,
      milestoneId: m3,
    });
    T('p1', a4, 'Đưa website lên chạy thật', {
      assigneeId: 'u2',
      start: day(22),
      due: day(25),
      important: true,
      milestoneId: m3,
    });

    // Project 2
    const b1 = TL('p2', 'Ý tưởng');
    const b2 = TL('p2', 'Sản xuất nội dung');
    const b3 = TL('p2', 'Chạy quảng cáo');
    const n1 = MS('p2', 'Khách duyệt ý tưởng', day(5));
    const n2 = MS('p2', 'Lên sóng', day(30));
    T('p2', b1, 'Nghiên cứu chiến dịch Tết năm ngoái', {
      assigneeId: 'u4',
      start: day(-5),
      due: day(-3),
      ...done(-3),
    });
    T('p2', b1, 'Đề xuất 3 ý tưởng chính', {
      assigneeId: 'u4',
      followerIds: ['u1'],
      start: day(-2),
      due: day(2),
      important: true,
      milestoneId: n1,
      status: 'doing',
    });
    T('p2', b1, 'Họp với khách chốt ý tưởng', {
      assigneeId: 'u4',
      start: day(4),
      due: at(5, '14:00'),
      important: true,
      urgent: true,
      milestoneId: n1,
    });
    T('p2', b2, 'Viết kịch bản video 30 giây', {
      assigneeId: 'u4',
      start: day(6),
      due: day(12),
      milestoneId: n2,
    });
    T('p2', b2, 'Thiết kế bộ ảnh quảng cáo', {
      assigneeId: 'u3',
      start: day(8),
      due: day(16),
      milestoneId: n2,
    });
    T('p2', b2, 'Duyệt ngân sách sản xuất', {
      assigneeId: 'u1',
      start: day(0),
      due: day(1),
      urgent: true,
    });
    T('p2', b3, 'Lập kế hoạch ngân sách quảng cáo', {
      assigneeId: 'u4',
      start: day(15),
      due: day(20),
      milestoneId: n2,
    });
    T('p2', b3, 'Cài đặt tài khoản quảng cáo', {
      assigneeId: 'u4',
      start: day(20),
      due: day(24),
      milestoneId: n2,
    });

    // Team
    const c1 = TL('p3', 'Tuyển dụng');
    const c2 = TL('p3', 'Chấm công & lương');
    const c3 = TL('p3', 'Đào tạo');
    T('p3', c1, 'Đăng tin tuyển lập trình viên', {
      assigneeId: 'u5',
      due: day(-1),
      ...done(-2),
    });
    T('p3', c1, 'Lọc hồ sơ ứng viên tuần này', {
      assigneeId: 'u5',
      due: day(1),
      status: 'doing',
    });
    T('p3', c1, 'Phỏng vấn ứng viên vòng 2', {
      assigneeId: 'u1',
      followerIds: ['u5'],
      due: at(2, '09:30'),
      important: true,
    });
    T('p3', c2, 'Tổng hợp bảng chấm công', {
      assigneeId: 'u5',
      due: day(-3),
      important: true,
    });
    T('p3', c2, 'Tính lương tháng', {
      assigneeId: 'u5',
      due: day(6),
      important: true,
    });
    T('p3', c3, 'Lên lịch đào tạo nhân viên mới', {
      assigneeId: 'u5',
      due: day(9),
    });

    return {
      users,
      me: 'u1',
      departments,
      projects,
      tasklists,
      tasks,
      milestones,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        WB.state = JSON.parse(raw);
        return;
      }
    } catch (err) {
      console.warn('Không đọc được dữ liệu đã lưu, dùng dữ liệu mẫu.', err);
    }
    WB.state = seed();
    save();
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(WB.state));
      return true;
    } catch (err) {
      console.warn('Không lưu được dữ liệu vào trình duyệt.', err);
      return false;
    }
  }
  function reset() {
    WB.state = seed();
    save();
  }

  const s = () => WB.state;
  const by = (list) => (id) => s()[list].find((x) => x.id === id);
  const user = by('users');
  const project = by('projects');
  const dept = by('departments');
  const tasklist = by('tasklists');
  const task = by('tasks');
  const milestone = by('milestones');
  const me = () => user(s().me) || s().users[0];
  const ordered = (list) => [...list].sort((a, b) => a.order - b.order);
  const tasksOf = (pid) => s().tasks.filter((t) => t.projectId === pid);
  const topTasks = (pid) => ordered(tasksOf(pid).filter((t) => !t.parentId));
  const subs = (tid) => ordered(s().tasks.filter((t) => t.parentId === tid));
  const listsOf = (pid) =>
    ordered(s().tasklists.filter((l) => l.projectId === pid));
  const milestonesOf = (pid) =>
    s().milestones.filter((m) => m.projectId === pid);
  const isAdmin = (p) => p.adminId === s().me;

  function statusOf(t) {
    const due = dueDate(t);
    if (t.status === 'done')
      return due && t.doneAt && new Date(t.doneAt) > due ? 'late' : 'done';
    if (due && due < new Date()) return 'overdue';
    return t.status;
  }
  function counts(tasks) {
    const c = {
      todo: 0,
      doing: 0,
      review: 0,
      done: 0,
      late: 0,
      overdue: 0,
      total: tasks.length,
    };
    tasks.forEach((t) => c[statusOf(t)]++);
    return c;
  }
  function progress(tasks) {
    const done = tasks.filter((t) => t.status === 'done').length;
    return {
      total: tasks.length,
      done,
      pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    };
  }

  function newTask(fields) {
    const t = { ...blankTask(), createdBy: s().me, ...fields };
    t.order = Math.max(0, ...s().tasks.map((x) => x.order)) + 1;
    s().tasks.push(t);
    return t;
  }
  function removeTask(id) {
    const ids = new Set([
      id,
      ...s()
        .tasks.filter((t) => t.parentId === id)
        .map((t) => t.id),
    ]);
    s().tasks = s().tasks.filter((t) => !ids.has(t.id));
    s().tasks.forEach(
      (t) => (t.dependsOn = t.dependsOn.filter((d) => !ids.has(d))),
    );
  }
  function removeTasklist(id) {
    s()
      .tasks.filter((t) => t.tasklistId === id && !t.parentId)
      .forEach((t) => removeTask(t.id));
    s().tasklists = s().tasklists.filter((l) => l.id !== id);
  }
  function removeProject(id) {
    s().tasks = s().tasks.filter((t) => t.projectId !== id);
    s().tasklists = s().tasklists.filter((l) => l.projectId !== id);
    s().milestones = s().milestones.filter((m) => m.projectId !== id);
    s().projects = s().projects.filter((p) => p.id !== id);
  }
  // Would "task depends on dep" create a loop? True when dep already (directly or not) depends on task.
  function wouldCycle(taskId, depId) {
    const seen = new Set();
    const walk = (id) => {
      if (id === taskId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const t = task(id);
      return !!t && t.dependsOn.some(walk);
    };
    return walk(depId);
  }
  const blockers = (t) =>
    t.dependsOn.map(task).filter((d) => d && d.status !== 'done');

  // Tick / untick a task. Returns a short message describing what happened.
  function toggleDone(t) {
    const p = project(t.projectId);
    if (t.status === 'done') {
      t.status = 'doing';
      t.doneAt = '';
      t.submittedAt = '';
      return 'Đã mở lại công việc.';
    }
    if (t.status === 'review') {
      if (!isAdmin(p)) return 'Công việc đang chờ người quản trị dự án duyệt.';
      t.status = 'done';
      t.doneAt = t.submittedAt || stamp(new Date());
      return 'Đã duyệt hoàn thành.';
    }
    if (p.review && !isAdmin(p)) {
      t.status = 'review';
      t.submittedAt = stamp(new Date());
      return 'Đã gửi duyệt cho người quản trị dự án.';
    }
    t.status = 'done';
    t.doneAt = stamp(new Date());
    return 'Đã hoàn thành.';
  }

  function myTasks(tab) {
    const id = s().me;
    return s().tasks.filter((t) =>
      tab === 'following'
        ? t.followerIds.includes(id)
        : tab === 'created'
          ? t.createdBy === id && t.assigneeId !== id
          : t.assigneeId === id,
    );
  }

  Object.assign(WB, {
    uid,
    ymd,
    stamp,
    addDays,
    toDate,
    dueDate,
    esc,
    STATUS,
    STAGES,
    COLORS,
    load,
    save,
    reset,
    user,
    project,
    dept,
    tasklist,
    task,
    milestone,
    me,
    tasksOf,
    topTasks,
    subs,
    listsOf,
    milestonesOf,
    isAdmin,
    statusOf,
    counts,
    progress,
    newTask,
    removeTask,
    removeTasklist,
    removeProject,
    wouldCycle,
    blockers,
    toggleDone,
    myTasks,
  });
})();
