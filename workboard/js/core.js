'use strict';
// Core: data, business rules and the local storage backend.
// Views (views*.js) only read from here; handlers (app.js) change data through the functions here.
window.WB = window.WB || {};
(() => {
  const KEY = 'workboard.state.v1'; // kept from version 1 so data saved by older versions carries over
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- ids ----------
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return hexId(b);
  }
  function hexId(bytes) {
    const h = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }
  // The same text always gives the same id. Tasks made by a repeat rule use it,
  // so two devices opening the app on the same day never create the same task twice.
  function detId(text) {
    const out = new Uint8Array(16);
    for (let k = 0; k < 4; k++) {
      let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      h ^= h >>> 16;
      h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      out[k * 4] = h >>> 24;
      out[k * 4 + 1] = (h >>> 16) & 255;
      out[k * 4 + 2] = (h >>> 8) & 255;
      out[k * 4 + 3] = h & 255;
    }
    out[6] = (out[6] & 0x0f) | 0x50;
    out[8] = (out[8] & 0x3f) | 0x80;
    return hexId(out);
  }

  // ---------- dates ----------
  // Dates are kept as text: 'YYYY-MM-DD', or 'YYYY-MM-DDTHH:MM' for a moment in local time.
  const ymd = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const stamp = (d = new Date()) =>
    `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = () => ymd(new Date());
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
  const dayDiff = (a, b) =>
    Math.round((toDate(b.slice(0, 10)) - toDate(a.slice(0, 10))) / 864e5);
  // Move a date by n days, keeping any time part.
  const shiftDate = (s, n) =>
    s ? ymd(addDays(toDate(s.slice(0, 10)), n)) + s.slice(10) : s;
  const isoDow = (d) => ((d.getDay() + 6) % 7) + 1; // 1 = Monday … 7 = Sunday
  function fmtDate(s) {
    if (!s) return '';
    const [d, t] = s.split('T');
    const [y, m, dd] = d.split('-');
    const yr = +y === new Date().getFullYear() ? '' : '/' + y;
    return `${dd}/${m}${yr}${t ? ' ' + t.slice(0, 5) : ''}`;
  }
  function ago(s) {
    if (!s) return '';
    const mins = Math.round((Date.now() - toDate(s)) / 6e4);
    if (mins < 1) return 'vừa xong';
    if (mins < 60) return `${mins} phút trước`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)} giờ trước`;
    if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)} ngày trước`;
    return fmtDate(s);
  }

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
  // Lower case, no Vietnamese accents: used to match names typed in a spreadsheet.
  const norm = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------- fixed lists ----------
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
  const FIELD_TYPES = {
    text: 'Chữ ngắn',
    textarea: 'Đoạn văn',
    number: 'Số',
    date: 'Ngày',
    select: 'Chọn một',
  };
  const FREQS = {
    day: 'Theo ngày',
    week: 'Theo tuần',
    month: 'Theo tháng',
    year: 'Theo năm',
  };
  const WEEKDAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];
  const NOTE = {
    assign: 'đã giao cho bạn',
    comment: 'đã bình luận ở',
    mention: 'đã nhắc đến bạn ở',
    review: 'đã gửi duyệt',
    approved: 'đã duyệt hoàn thành',
    returned: 'đã trả lại để làm tiếp',
    done: 'đã hoàn thành',
  };

  // ---------- empty records ----------
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
    result: '',
    status: 'todo',
    doneAt: '',
    submittedAt: '',
    createdBy: '',
    createdAt: stamp(),
    order: 0,
    custom: {},
    repeatId: '',
    repeatDate: '',
  });
  const blankState = () => ({
    v: 2,
    users: [],
    me: '',
    departments: [],
    projects: [],
    tasklists: [],
    milestones: [],
    fields: [],
    tasks: [],
    comments: [],
    activity: [],
    notifications: [],
    repeats: [],
    templates: [],
  });

  // Bring any saved state up to the current shape (version 1 kept comments inside each task).
  function upgrade(s) {
    const out = { ...blankState(), ...s };
    for (const k of Object.keys(blankState()))
      if (Array.isArray(blankState()[k]) && !Array.isArray(out[k])) out[k] = [];
    if (!s.v || s.v < 2) {
      out.tasks.forEach((t) => {
        (t.comments || []).forEach((c) =>
          out.comments.push({
            id: c.id || uid(),
            taskId: t.id,
            userId: c.userId,
            text: c.text,
            at: c.at,
          }),
        );
        delete t.comments;
      });
    }
    out.tasks = out.tasks.map((t) => ({ ...blankTask(), ...t }));
    out.projects.forEach((p) => {
      if (p.private == null) p.private = false;
      if (!Array.isArray(p.memberIds)) p.memberIds = [];
    });
    out.v = 2;
    return out;
  }

  // ---------- sample data ----------
  // `id` turns a short key ('p1') into the id used for storage: the key itself locally,
  // a fresh random id when sample data is added to a shared workspace.
  // `who` turns a sample person key ('u1') into a real member id (or '' for nobody).
  function seed({ id = (k) => k, who = null } = {}) {
    const now = new Date();
    const day = (n) => ymd(addDays(now, n));
    const at = (n, hm) => `${day(n)}T${hm}`;
    const people = [
      ['u1', 'Nguyễn Minh Anh', 'Trưởng phòng Sản phẩm'],
      ['u2', 'Trần Quốc Bảo', 'Lập trình viên'],
      ['u3', 'Lê Thu Hà', 'Thiết kế'],
      ['u4', 'Phạm Đức Long', 'Trưởng phòng Marketing'],
      ['u5', 'Vũ Ngọc Mai', 'Nhân sự'],
      ['u6', 'Đỗ Hoàng Nam', 'Kiểm thử'],
    ];
    const U = who || ((k) => k);
    const ids = new Map();
    const I = (k) => {
      if (!ids.has(k)) ids.set(k, id(k));
      return ids.get(k);
    };
    const s = blankState();
    if (!who) {
      s.users = people.map(([k, name, title], i) => ({
        id: k,
        name,
        title,
        color: COLORS[i % COLORS.length],
      }));
      s.me = 'u1';
    }
    s.departments = [
      { id: I('d1'), name: 'Sản phẩm' },
      { id: I('d2'), name: 'Marketing' },
      { id: I('d3'), name: 'Nhân sự' },
    ];
    const members = (...ks) => [...new Set(ks.map(U).filter(Boolean))];
    s.projects = [
      {
        id: I('p1'),
        kind: 'project',
        name: 'Ra mắt website mới',
        deptId: I('d1'),
        adminId: U('u1'),
        memberIds: members('u1', 'u2', 'u3', 'u6'),
        type: 'internal',
        review: true,
        private: false,
        start: day(-20),
        end: day(25),
        stage: 'plan',
        desc: 'Làm lại website công ty: thiết kế mới, tốc độ nhanh hơn, có trang tuyển dụng.',
        color: COLORS[0],
      },
      {
        id: I('p2'),
        kind: 'project',
        name: 'Chiến dịch Tết 2027',
        deptId: I('d2'),
        adminId: U('u4') || U('u1'),
        memberIds: members('u4', 'u3', 'u1'),
        type: 'customer',
        review: false,
        private: false,
        start: day(-5),
        end: day(40),
        stage: 'adjust',
        desc: 'Chiến dịch quảng cáo dịp Tết cho khách hàng.',
        color: COLORS[1],
      },
      {
        id: I('p3'),
        kind: 'team',
        name: 'Việc hằng tuần · Nhân sự',
        deptId: I('d3'),
        adminId: U('u5') || U('u1'),
        memberIds: members('u5', 'u1'),
        type: 'internal',
        review: false,
        private: false,
        start: '',
        end: '',
        stage: 'plan',
        desc: 'Các việc lặp lại mỗi tuần, mỗi tháng của phòng Nhân sự.',
        color: COLORS[2],
      },
    ];
    const admin = (pk) => s.projects.find((p) => p.id === I(pk)).adminId;
    let n = 0;
    const TL = (pk, name) => {
      const tid = I('l' + ++n);
      s.tasklists.push({
        id: tid,
        projectId: I(pk),
        name,
        order: s.tasklists.length,
      });
      return tid;
    };
    const MS = (pk, name, due) => {
      const mid = I('m' + ++n);
      s.milestones.push({ id: mid, projectId: I(pk), name, due });
      return mid;
    };
    const F = (pk, name, type, o = {}) => {
      const fid = I('f' + ++n);
      s.fields.push({
        id: fid,
        projectId: I(pk),
        name,
        type,
        options: [],
        required: false,
        order: s.fields.length,
        ...o,
      });
      return fid;
    };
    const T = (pk, tl, name, o = {}) => {
      const t = {
        ...blankTask(),
        id: I('t' + ++n),
        projectId: I(pk),
        tasklistId: tl,
        name,
        createdBy: admin(pk),
        createdAt: at(-21, '09:00'),
        order: s.tasks.length,
        ...o,
      };
      if (o.assigneeId !== undefined) t.assigneeId = U(o.assigneeId) || '';
      t.followerIds = (o.followerIds || []).map(U).filter(Boolean);
      s.tasks.push(t);
      return t.id;
    };
    const done = (d) => ({ status: 'done', doneAt: at(d, '16:00') });
    const C = (taskId, userKey, text, when) => {
      const u = U(userKey);
      if (u)
        s.comments.push({
          id: I('c' + ++n),
          taskId,
          userId: u,
          text,
          at: when,
        });
    };
    const A = (taskId, userKey, text, when) => {
      const u = U(userKey);
      if (u)
        s.activity.push({
          id: I('a' + ++n),
          taskId,
          userId: u,
          text,
          at: when,
        });
    };
    const ck = (text, isDone = false) => ({
      id: I('k' + ++n),
      text,
      done: isDone,
    });

    // Project 1
    const a1 = TL('p1', 'Chuẩn bị');
    const a2 = TL('p1', 'Thiết kế');
    const a3 = TL('p1', 'Lập trình');
    const a4 = TL('p1', 'Kiểm thử & ra mắt');
    const m1 = MS('p1', 'Chốt thiết kế', day(3));
    const m2 = MS('p1', 'Có bản chạy thử', day(14));
    const m3 = MS('p1', 'Ra mắt chính thức', day(25));
    const fLevel = F('p1', 'Độ khó', 'select', {
      options: ['Dễ', 'Vừa', 'Khó'],
    });
    const fHours = F('p1', 'Số giờ ước tính', 'number');
    F('p1', 'Đường dẫn bản thiết kế', 'text');
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
      custom: { [fLevel]: 'Vừa', [fHours]: '16' },
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
        ck('Bản máy tính', true),
        ck('Bản điện thoại'),
        ck('Gửi sếp xem'),
      ],
      custom: { [fLevel]: 'Khó', [fHours]: '24' },
    });
    C(
      k4,
      'u1',
      'Hà ơi phần đầu trang chữ hơi nhỏ, em chỉnh giúp chị nhé.',
      at(-2, '10:15'),
    );
    C(k4, 'u3', 'Dạ em sửa xong trong hôm nay ạ.', at(-2, '10:40'));
    A(k4, 'u1', 'đã tạo công việc', at(-21, '09:00'));
    A(k4, 'u1', 'đã giao cho Lê Thu Hà', at(-21, '09:00'));
    A(k4, 'u3', 'đã chuyển sang “Đang làm”', at(-8, '08:30'));
    A(k4, 'u3', 'đã đánh dấu xong “Bản máy tính”', at(-3, '17:10'));
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
      custom: { [fLevel]: 'Khó', [fHours]: '40' },
    });
    A(k7, 'u2', 'đã chuyển sang “Đang làm”', at(-3, '09:05'));
    T('p1', a3, 'Phần đầu trang và thanh menu', {
      parentId: k7,
      assigneeId: 'u2',
      ...done(-1),
    });
    T('p1', a3, 'Phần giới thiệu sản phẩm', {
      parentId: k7,
      assigneeId: 'u2',
      status: 'doing',
    });
    T('p1', a3, 'Phần chân trang', { parentId: k7, assigneeId: 'u2' });
    const k8 = T('p1', a3, 'Làm form liên hệ', {
      assigneeId: 'u2',
      start: day(2),
      due: day(7),
      milestoneId: m2,
      status: 'review',
      submittedAt: at(0, '08:30'),
    });
    A(k8, 'u2', 'đã gửi duyệt hoàn thành', at(0, '08:30'));
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
    const dow = isoDow(now);
    s.repeats = [
      {
        id: I('r1'),
        projectId: I('p3'),
        tasklistId: c2,
        name: 'Gửi bảng chấm công tuần',
        desc: 'Gửi bảng chấm công của cả phòng cho kế toán.',
        assigneeId: U('u5') || '',
        followerIds: [],
        freq: 'week',
        every: 1,
        weekdays: [5],
        monthDay: 1,
        start: day(-30),
        end: '',
        dueTime: '17:00',
        important: false,
        urgent: false,
        checklist: ['Kiểm tra ngày nghỉ phép', 'Gửi kế toán'],
        subtasks: [],
        enabled: true,
        lastRun: day(-1),
        createdBy: admin('p3'),
      },
      {
        id: I('r2'),
        projectId: I('p3'),
        tasklistId: c1,
        name: 'Họp giao ban phòng Nhân sự',
        desc: '',
        assigneeId: U('u5') || '',
        followerIds: members('u1'),
        freq: 'week',
        every: 1,
        weekdays: [dow],
        monthDay: 1,
        start: day(-14),
        end: '',
        dueTime: '09:00',
        important: false,
        urgent: false,
        checklist: [],
        subtasks: [],
        enabled: true,
        lastRun: day(-1),
        createdBy: admin('p3'),
      },
      {
        id: I('r3'),
        projectId: I('p3'),
        tasklistId: c2,
        name: 'Chốt lương tháng',
        desc: '',
        assigneeId: U('u5') || '',
        followerIds: [],
        freq: 'month',
        every: 1,
        weekdays: [],
        monthDay: 25,
        start: day(-60),
        end: '',
        dueTime: '',
        important: true,
        urgent: false,
        checklist: [],
        subtasks: ['Tổng hợp ngày công', 'Gửi bảng lương cho giám đốc duyệt'],
        enabled: true,
        lastRun: day(-1),
        createdBy: admin('p3'),
      },
    ];
    const me = U('u1');
    if (me) {
      const note = (actor, kind, taskId, text, when, read = false) => {
        const a = U(actor);
        if (a && a !== me)
          s.notifications.push({
            id: I('n' + ++n),
            userId: me,
            actorId: a,
            taskId,
            kind,
            text,
            at: when,
            read,
          });
      };
      note('u2', 'review', k8, '', at(0, '08:30'));
      note(
        'u3',
        'comment',
        k4,
        'Dạ em sửa xong trong hôm nay ạ.',
        at(-2, '10:40'),
        true,
      );
    }
    return s;
  }

  // ---------- built-in templates ----------
  // Offsets (s = start, d = deadline) are days from the project's start date.
  const BUILTIN_TEMPLATES = [
    {
      id: 'builtin-launch',
      builtin: true,
      name: 'Ra mắt sản phẩm',
      desc: 'Từ lên kế hoạch tới ngày ra mắt, khoảng 6 tuần.',
      kind: 'project',
      data: {
        days: 42,
        lists: [
          {
            name: 'Chuẩn bị',
            tasks: [
              { name: 'Chốt mục tiêu ra mắt', s: 0, d: 2, imp: true },
              { name: 'Lập kế hoạch truyền thông', s: 2, d: 7 },
            ],
          },
          {
            name: 'Sản xuất',
            tasks: [
              { name: 'Hoàn thiện sản phẩm', s: 7, d: 28, imp: true },
              {
                name: 'Kiểm thử trước khi ra mắt',
                s: 24,
                d: 32,
                checklist: [
                  'Kiểm thử trên máy tính',
                  'Kiểm thử trên điện thoại',
                ],
              },
            ],
          },
          {
            name: 'Ra mắt',
            tasks: [
              { name: 'Viết thông cáo báo chí', s: 30, d: 35 },
              { name: 'Ra mắt chính thức', s: 40, d: 40, imp: true, urg: true },
            ],
          },
        ],
        milestones: [
          { name: 'Chốt kế hoạch', d: 7 },
          { name: 'Ngày ra mắt', d: 40 },
        ],
        fields: [
          {
            name: 'Kênh truyền thông',
            type: 'select',
            options: ['Website', 'Mạng xã hội', 'Báo chí'],
          },
        ],
      },
    },
    {
      id: 'builtin-hiring',
      builtin: true,
      name: 'Tuyển dụng một vị trí',
      desc: 'Đăng tin, lọc hồ sơ, phỏng vấn và đón người mới, khoảng 4 tuần.',
      kind: 'project',
      data: {
        days: 28,
        lists: [
          {
            name: 'Chuẩn bị',
            tasks: [
              { name: 'Viết mô tả công việc', s: 0, d: 2 },
              { name: 'Đăng tin tuyển dụng', s: 2, d: 3 },
            ],
          },
          {
            name: 'Sàng lọc',
            tasks: [
              { name: 'Lọc hồ sơ', s: 3, d: 10 },
              { name: 'Phỏng vấn vòng 1', s: 10, d: 14 },
              { name: 'Phỏng vấn vòng 2', s: 14, d: 18, imp: true },
            ],
          },
          {
            name: 'Chốt và đón người mới',
            tasks: [
              { name: 'Gửi thư mời nhận việc', s: 18, d: 20, urg: true },
              {
                name: 'Chuẩn bị ngày đầu đi làm',
                s: 21,
                d: 27,
                checklist: ['Máy tính', 'Tài khoản email', 'Thẻ nhân viên'],
              },
            ],
          },
        ],
        milestones: [{ name: 'Chốt ứng viên', d: 18 }],
        fields: [{ name: 'Số ứng viên', type: 'number' }],
      },
    },
    {
      id: 'builtin-event',
      builtin: true,
      name: 'Tổ chức sự kiện',
      desc: 'Lên kế hoạch, chuẩn bị và tổng kết một buổi sự kiện.',
      kind: 'project',
      data: {
        days: 30,
        lists: [
          {
            name: 'Lên kế hoạch',
            tasks: [
              { name: 'Chốt ngày và địa điểm', s: 0, d: 3, imp: true },
              { name: 'Lập ngân sách', s: 0, d: 5 },
            ],
          },
          {
            name: 'Chuẩn bị',
            tasks: [
              { name: 'Gửi thư mời khách', s: 6, d: 12 },
              { name: 'Đặt tiệc', s: 10, d: 15 },
              { name: 'In ấn tài liệu', s: 15, d: 22 },
            ],
          },
          {
            name: 'Sau sự kiện',
            tasks: [
              { name: 'Gửi thư cảm ơn', s: 26, d: 27 },
              { name: 'Tổng kết chi phí', s: 26, d: 30 },
            ],
          },
        ],
        milestones: [{ name: 'Ngày diễn ra sự kiện', d: 25 }],
        fields: [{ name: 'Chi phí (đồng)', type: 'number' }],
      },
    },
    {
      id: 'builtin-team',
      builtin: true,
      name: 'Việc thường xuyên của phòng',
      desc: 'Nhóm cho các việc lặp lại hằng tuần, hằng tháng.',
      kind: 'team',
      data: {
        days: null,
        lists: [
          {
            name: 'Hằng tuần',
            tasks: [
              { name: 'Họp giao ban', s: null, d: 0 },
              { name: 'Báo cáo tuần', s: null, d: 4 },
            ],
          },
          {
            name: 'Hằng tháng',
            tasks: [
              { name: 'Báo cáo tháng', s: null, d: 27 },
              { name: 'Đánh giá kết quả công việc', s: null, d: 29 },
            ],
          },
        ],
        milestones: [],
        fields: [],
      },
    },
  ];

  // ---------- state access ----------
  const s = () => WB.state;
  const by = (list) => (id) =>
    id ? s()[list].find((x) => x.id === id) : undefined;
  const user = by('users');
  const project = by('projects');
  const dept = by('departments');
  const tasklist = by('tasklists');
  const task = by('tasks');
  const milestone = by('milestones');
  const field = by('fields');
  const repeat = by('repeats');
  const me = () =>
    user(s().me) || s().users[0] || { id: '', name: 'Bạn', color: COLORS[0] };
  const userName = (id) => (user(id) ? user(id).name : 'Người đã rời đi');
  const ordered = (list) => [...list].sort((a, b) => a.order - b.order);
  const myRole = () =>
    me().role ? me().role : WB.mode === 'cloud' ? 'member' : 'owner';
  const isWorkspaceAdmin = () =>
    WB.mode === 'cloud' && ['owner', 'admin'].includes(myRole());
  const isAdmin = (p) => !!p && (p.adminId === s().me || isWorkspaceAdmin());
  const canSee = (p) =>
    !!p &&
    (!p.private ||
      p.adminId === s().me ||
      p.memberIds.includes(s().me) ||
      isWorkspaceAdmin());
  const visibleProjects = () => s().projects.filter(canSee);
  const tasksOf = (pid) => s().tasks.filter((t) => t.projectId === pid);
  const topTasks = (pid) => ordered(tasksOf(pid).filter((t) => !t.parentId));
  const subs = (tid) => ordered(s().tasks.filter((t) => t.parentId === tid));
  const listsOf = (pid) =>
    ordered(s().tasklists.filter((l) => l.projectId === pid));
  const milestonesOf = (pid) =>
    s().milestones.filter((m) => m.projectId === pid);
  const fieldsOf = (pid) =>
    ordered(s().fields.filter((f) => f.projectId === pid));
  const commentsOf = (tid) =>
    s()
      .comments.filter((c) => c.taskId === tid)
      .sort((a, b) => a.at.localeCompare(b.at));
  const activityOf = (tid) =>
    s()
      .activity.filter((a) => a.taskId === tid)
      .sort((a, b) => b.at.localeCompare(a.at));
  const visibleTasks = () => {
    const ok = new Set(visibleProjects().map((p) => p.id));
    return s().tasks.filter((t) => ok.has(t.projectId));
  };
  const myNotifications = () =>
    s()
      .notifications.filter((n) => n.userId === s().me && task(n.taskId))
      .sort((a, b) => b.at.localeCompare(a.at));
  const reviewersOf = (t) => {
    const p = project(t.projectId);
    return [...new Set([p && p.adminId, t.createdBy].filter(Boolean))];
  };
  const canApprove = (t) => {
    const p = project(t.projectId);
    return isAdmin(p) || (!!t.createdBy && t.createdBy === s().me);
  };
  function statusOf(t) {
    const due = dueDate(t);
    if (t.status === 'done')
      return due && t.doneAt && toDate(t.doneAt) > due ? 'late' : 'done';
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
  const missingRequired = (t) =>
    fieldsOf(t.projectId)
      .filter((f) => f.required && !String((t.custom || {})[f.id] ?? '').trim())
      .map((f) => f.name);
  const blockers = (t) =>
    t.dependsOn.map(task).filter((d) => d && d.status !== 'done');
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
  function myTasks(tab) {
    const id = s().me;
    return visibleTasks().filter((t) =>
      tab === 'following'
        ? t.followerIds.includes(id)
        : tab === 'created'
          ? t.createdBy === id && t.assigneeId !== id
          : t.assigneeId === id,
    );
  }
  const nextOrder = (list) =>
    Math.max(-1, ...list.map((x) => x.order || 0)) + 1;

  // ---------- history and notifications ----------
  function log(t, text) {
    if (!t || !s().me) return;
    s().activity.push({
      id: uid(),
      taskId: t.id,
      userId: s().me,
      text,
      at: stamp(),
    });
  }
  function notify(userIds, kind, t, text = '') {
    const meId = s().me;
    [...new Set(userIds)].forEach((u) => {
      if (!u || u === meId || !user(u)) return;
      s().notifications.push({
        id: uid(),
        userId: u,
        actorId: meId,
        taskId: t.id,
        kind,
        text: String(text).slice(0, 200),
        at: stamp(),
        read: false,
      });
    });
  }

  // ---------- changing tasks ----------
  function newTask(fields, { silent = false } = {}) {
    const t = { ...blankTask(), createdBy: s().me, ...fields };
    t.order = nextOrder(s().tasks);
    s().tasks.push(t);
    if (!silent) {
      log(t, t.parentId ? 'đã tạo việc con' : 'đã tạo công việc');
      if (t.assigneeId) notify([t.assigneeId], 'assign', t);
      const parent = task(t.parentId);
      if (parent) log(parent, `đã thêm việc con “${t.name}”`);
    }
    return t;
  }
  // Change one or more task fields, writing the history and telling the people involved.
  function updateTask(t, patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (same(t[k], v)) continue;
      const old = t[k];
      t[k] = v;
      switch (k) {
        case 'name':
          log(t, `đã đổi tên thành “${v}”`);
          break;
        case 'assigneeId':
          log(t, v ? `đã giao cho ${userName(v)}` : 'đã bỏ người thực hiện');
          if (v) notify([v], 'assign', t);
          break;
        case 'start':
          log(
            t,
            v ? `đã đặt ngày bắt đầu ${fmtDate(v)}` : 'đã bỏ ngày bắt đầu',
          );
          break;
        case 'due':
          log(t, v ? `đã đặt hạn chót ${fmtDate(v)}` : 'đã bỏ hạn chót');
          break;
        case 'tasklistId': {
          const l = tasklist(v);
          log(t, `đã chuyển sang danh sách “${l ? l.name : ''}”`);
          subs(t.id).forEach((x) => (x.tasklistId = v));
          break;
        }
        case 'milestoneId': {
          const m = milestone(v);
          log(t, m ? `đã gắn vào mục tiêu “${m.name}”` : 'đã bỏ gắn mục tiêu');
          break;
        }
        case 'important':
        case 'urgent':
          log(
            t,
            `${v ? 'đã thêm' : 'đã bỏ'} nhãn ${k === 'important' ? 'Quan trọng' : 'Khẩn cấp'}`,
          );
          break;
        case 'desc':
          log(t, 'đã sửa mô tả');
          break;
        case 'result':
          log(t, 'đã cập nhật kết quả');
          break;
        case 'followerIds': {
          const added = v.filter((x) => !old.includes(x));
          const gone = old.filter((x) => !v.includes(x));
          added.forEach((x) =>
            log(t, `đã thêm ${userName(x)} vào người theo dõi`),
          );
          gone.forEach((x) =>
            log(t, `đã bỏ ${userName(x)} khỏi người theo dõi`),
          );
          break;
        }
        case 'custom': {
          const changed = Object.keys({ ...old, ...v }).filter(
            (fid) => (old || {})[fid] !== (v || {})[fid],
          );
          changed.forEach((fid) => {
            const f = field(fid);
            if (f) log(t, `đã cập nhật “${f.name}”`);
          });
          break;
        }
        default:
          break;
      }
    }
  }
  // Every status change goes through here so the review rule and required fields hold everywhere.
  function setStatus(t, to) {
    const from = t.status;
    if (from === to) return { ok: true, msg: '' };
    const p = project(t.projectId);
    if (to === 'done') {
      const miss = missingRequired(t);
      if (miss.length)
        return {
          ok: false,
          msg: `Chưa hoàn thành được: hãy điền ${miss.map((m) => `“${m}”`).join(', ')}.`,
        };
      if (p && p.review && !canApprove(t)) {
        if (from === 'review')
          return {
            ok: false,
            msg: 'Công việc đang chờ người giao việc hoặc quản trị dự án duyệt.',
          };
        t.status = 'review';
        t.submittedAt = stamp();
        t.doneAt = '';
        log(t, 'đã gửi duyệt hoàn thành');
        notify(reviewersOf(t), 'review', t);
        return {
          ok: true,
          msg: 'Đã gửi duyệt cho người giao việc và quản trị dự án.',
        };
      }
      const approving = from === 'review';
      t.status = 'done';
      t.doneAt = approving && t.submittedAt ? t.submittedAt : stamp();
      if (approving) {
        log(t, 'đã duyệt hoàn thành');
        notify([t.assigneeId], 'approved', t);
        return { ok: true, msg: 'Đã duyệt hoàn thành.' };
      }
      log(t, 'đã hoàn thành công việc');
      notify([t.createdBy], 'done', t);
      return { ok: true, msg: 'Đã hoàn thành.' };
    }
    if (to === 'review') {
      t.status = 'review';
      t.submittedAt = stamp();
      t.doneAt = '';
      log(t, 'đã gửi duyệt hoàn thành');
      notify(reviewersOf(t), 'review', t);
      return { ok: true, msg: 'Đã chuyển sang “Chờ duyệt”.' };
    }
    if (from === 'review') {
      if (canApprove(t) && t.assigneeId !== s().me) {
        log(t, 'đã trả lại để làm tiếp');
        notify([t.assigneeId], 'returned', t);
      } else log(t, 'đã rút lại yêu cầu duyệt');
    } else if (from === 'done') log(t, 'đã mở lại công việc');
    else log(t, `đã chuyển sang “${STATUS[to].label}”`);
    t.status = to;
    t.doneAt = '';
    t.submittedAt = '';
    return { ok: true, msg: from === 'done' ? 'Đã mở lại công việc.' : '' };
  }
  function toggleDone(t) {
    if (t.status === 'done') return setStatus(t, 'doing');
    if (t.status === 'review' && !canApprove(t))
      return {
        ok: false,
        msg: 'Công việc đang chờ người giao việc hoặc quản trị dự án duyệt.',
      };
    return setStatus(t, 'done');
  }
  function addComment(t, text) {
    const c = { id: uid(), taskId: t.id, userId: s().me, text, at: stamp() };
    s().comments.push(c);
    // Anyone named with @ (full name or given name) gets their own notice;
    // the others involved hear about the comment.
    const after = text
      .split('@')
      .slice(1)
      .map((x) => norm(x) + ' ');
    // "@Anh", "@Minh Anh" and "@Nguyễn Minh Anh" all name Nguyễn Minh Anh.
    const named = (u) => {
      const words = norm(u.name).split(' ');
      const endings = words.map((_, i) => words.slice(i).join(' '));
      return after.some((x) => endings.some((e) => x.startsWith(e + ' ')));
    };
    const mentioned = s()
      .users.filter((u) => u.id !== s().me && named(u))
      .map((u) => u.id);
    notify(mentioned, 'mention', t, text);
    notify(
      [t.assigneeId, t.createdBy, ...t.followerIds].filter(
        (u) => !mentioned.includes(u),
      ),
      'comment',
      t,
      text,
    );
    return c;
  }
  function removeTasksWhere(test) {
    const gone = new Set(
      s()
        .tasks.filter(test)
        .map((t) => t.id),
    );
    // Subtasks go with their parent.
    let grew = true;
    while (grew) {
      grew = false;
      s().tasks.forEach((t) => {
        if (t.parentId && gone.has(t.parentId) && !gone.has(t.id)) {
          gone.add(t.id);
          grew = true;
        }
      });
    }
    s().tasks = s().tasks.filter((t) => !gone.has(t.id));
    s().tasks.forEach((t) => {
      if (t.dependsOn.some((d) => gone.has(d)))
        t.dependsOn = t.dependsOn.filter((d) => !gone.has(d));
    });
    s().comments = s().comments.filter((c) => !gone.has(c.taskId));
    s().activity = s().activity.filter((a) => !gone.has(a.taskId));
    s().notifications = s().notifications.filter((n) => !gone.has(n.taskId));
    return gone.size;
  }
  const removeTask = (id) => removeTasksWhere((t) => t.id === id);
  function removeTasklist(id) {
    removeTasksWhere((t) => t.tasklistId === id && !t.parentId);
    s().tasklists = s().tasklists.filter((l) => l.id !== id);
    s().repeats.forEach((r) => {
      if (r.tasklistId === id) r.tasklistId = '';
    });
  }
  function removeProject(id) {
    removeTasksWhere((t) => t.projectId === id);
    s().tasklists = s().tasklists.filter((l) => l.projectId !== id);
    s().milestones = s().milestones.filter((m) => m.projectId !== id);
    s().fields = s().fields.filter((f) => f.projectId !== id);
    s().repeats = s().repeats.filter((r) => r.projectId !== id);
    s().projects = s().projects.filter((p) => p.id !== id);
  }
  function removeField(id) {
    s().fields = s().fields.filter((f) => f.id !== id);
    s().tasks.forEach((t) => {
      if (t.custom && id in t.custom) {
        const c = { ...t.custom };
        delete c[id];
        t.custom = c;
      }
    });
  }
  function removeMilestone(id) {
    s().tasks.forEach((t) => {
      if (t.milestoneId === id) t.milestoneId = '';
    });
    s().milestones = s().milestones.filter((m) => m.id !== id);
  }

  // ---------- copies ----------
  // Copy a task (and optionally its subtasks) into a project and tasklist.
  function copyTask(
    src,
    {
      projectId,
      tasklistId,
      subtasks = true,
      checklist = true,
      keepDone = false,
      assigneeId,
      suffix = '',
    },
  ) {
    const sameProject = projectId === src.projectId;
    const make = (from, parentId) =>
      newTask(
        {
          projectId,
          tasklistId,
          parentId,
          name: from.name + (parentId ? '' : suffix),
          desc: from.desc,
          assigneeId:
            assigneeId !== undefined && !parentId
              ? assigneeId
              : from.assigneeId,
          followerIds: [...from.followerIds],
          start: from.start,
          due: from.due,
          important: from.important,
          urgent: from.urgent,
          milestoneId: sameProject ? from.milestoneId : '',
          checklist: checklist
            ? from.checklist.map((c) => ({
                id: uid(),
                text: c.text,
                done: keepDone && c.done,
              }))
            : [],
          custom: sameProject ? { ...(from.custom || {}) } : {},
          status: keepDone ? from.status : 'todo',
          doneAt: keepDone ? from.doneAt : '',
          submittedAt: keepDone ? from.submittedAt : '',
        },
        { silent: true },
      );
    const top = make(src, '');
    log(top, `đã tạo từ bản sao của “${src.name}”`);
    if (top.assigneeId) notify([top.assigneeId], 'assign', top);
    if (subtasks) subs(src.id).forEach((c) => make(c, top.id));
    return top;
  }
  function duplicateProject(
    p,
    { name, tasks = true, keepAssignees = true, keepDone = false },
  ) {
    const np = {
      ...p,
      id: uid(),
      name,
      adminId: s().me,
      memberIds: [...new Set([s().me, ...p.memberIds])],
      stage: 'plan',
    };
    s().projects.push(np);
    const lists = new Map();
    const marks = new Map();
    const flds = new Map();
    listsOf(p.id).forEach((l) => {
      const nl = {
        id: uid(),
        projectId: np.id,
        name: l.name,
        order: nextOrder(s().tasklists),
      };
      s().tasklists.push(nl);
      lists.set(l.id, nl.id);
    });
    milestonesOf(p.id).forEach((m) => {
      const nm = { ...m, id: uid(), projectId: np.id };
      s().milestones.push(nm);
      marks.set(m.id, nm.id);
    });
    fieldsOf(p.id).forEach((f) => {
      const nf = { ...f, id: uid(), projectId: np.id, options: [...f.options] };
      s().fields.push(nf);
      flds.set(f.id, nf.id);
    });
    if (tasks) {
      const map = new Map();
      const all = tasksOf(p.id);
      const copyOne = (t) => {
        const custom = {};
        Object.entries(t.custom || {}).forEach(([k, v]) => {
          if (flds.has(k)) custom[flds.get(k)] = v;
        });
        const nt = newTask(
          {
            projectId: np.id,
            tasklistId: lists.get(t.tasklistId) || '',
            parentId: t.parentId ? map.get(t.parentId) || '' : '',
            name: t.name,
            desc: t.desc,
            assigneeId: keepAssignees ? t.assigneeId : '',
            followerIds: keepAssignees ? [...t.followerIds] : [],
            start: t.start,
            due: t.due,
            important: t.important,
            urgent: t.urgent,
            milestoneId: marks.get(t.milestoneId) || '',
            checklist: t.checklist.map((c) => ({
              id: uid(),
              text: c.text,
              done: keepDone && c.done,
            })),
            custom,
            status: keepDone ? t.status : 'todo',
            doneAt: keepDone ? t.doneAt : '',
            submittedAt: keepDone ? t.submittedAt : '',
          },
          { silent: true },
        );
        map.set(t.id, nt.id);
        return nt;
      };
      all.filter((t) => !t.parentId).forEach(copyOne);
      all.filter((t) => t.parentId).forEach(copyOne);
      s().tasks.forEach((t) => {
        if (t.projectId !== np.id) return;
        const src = all.find((x) => map.get(x.id) === t.id);
        if (src)
          t.dependsOn = src.dependsOn.map((d) => map.get(d)).filter(Boolean);
      });
    }
    return np;
  }

  // ---------- templates ----------
  function templateFromProject(p, name, desc) {
    const base =
      p.start ||
      tasksOf(p.id)
        .map((t) => (t.start || t.due || '').slice(0, 10))
        .filter(Boolean)
        .sort()[0] ||
      today();
    const off = (d) => (d ? dayDiff(base, d) : null);
    return {
      id: uid(),
      name,
      desc,
      kind: p.kind,
      data: {
        days: p.end ? dayDiff(base, p.end) : null,
        lists: listsOf(p.id).map((l) => ({
          name: l.name,
          tasks: topTasks(p.id)
            .filter((t) => t.tasklistId === l.id)
            .map((t) => ({
              name: t.name,
              desc: t.desc || undefined,
              s: off(t.start),
              d: off(t.due),
              time: t.due.length > 10 ? t.due.slice(11, 16) : undefined,
              imp: t.important || undefined,
              urg: t.urgent || undefined,
              checklist: t.checklist.length
                ? t.checklist.map((c) => c.text)
                : undefined,
              subtasks: subs(t.id).length
                ? subs(t.id).map((x) => x.name)
                : undefined,
            })),
        })),
        milestones: milestonesOf(p.id).map((m) => ({
          name: m.name,
          d: off(m.due),
        })),
        fields: fieldsOf(p.id).map((f) => ({
          name: f.name,
          type: f.type,
          options: f.options.length ? [...f.options] : undefined,
          required: f.required || undefined,
        })),
      },
    };
  }
  function projectFromTemplate(tpl, { name, kind, deptId, start }) {
    const d = tpl.data || {};
    const at = (n) => (n == null || !start ? '' : shiftDate(start, n));
    const p = {
      id: uid(),
      kind: kind || tpl.kind || 'project',
      name,
      deptId: deptId || '',
      adminId: s().me,
      memberIds: [s().me],
      type: 'internal',
      review: false,
      private: false,
      start: (kind || tpl.kind) === 'team' ? '' : start || '',
      end: (kind || tpl.kind) === 'team' || d.days == null ? '' : at(d.days),
      stage: 'plan',
      desc: tpl.desc || '',
      color: COLORS[s().projects.length % COLORS.length],
    };
    s().projects.push(p);
    (d.milestones || []).forEach((m) =>
      s().milestones.push({
        id: uid(),
        projectId: p.id,
        name: m.name,
        due: at(m.d),
      }),
    );
    (d.fields || []).forEach((f) =>
      s().fields.push({
        id: uid(),
        projectId: p.id,
        name: f.name,
        type: f.type in FIELD_TYPES ? f.type : 'text',
        options: f.options ? [...f.options] : [],
        required: !!f.required,
        order: nextOrder(s().fields),
      }),
    );
    (d.lists || []).forEach((l) => {
      const nl = {
        id: uid(),
        projectId: p.id,
        name: l.name,
        order: nextOrder(s().tasklists),
      };
      s().tasklists.push(nl);
      (l.tasks || []).forEach((x) => {
        const due = at(x.d);
        const t = newTask(
          {
            projectId: p.id,
            tasklistId: nl.id,
            name: x.name,
            desc: x.desc || '',
            start: at(x.s),
            due: due && x.time ? `${due}T${x.time}` : due,
            important: !!x.imp,
            urgent: !!x.urg,
            checklist: (x.checklist || []).map((text) => ({
              id: uid(),
              text,
              done: false,
            })),
          },
          { silent: true },
        );
        (x.subtasks || []).forEach((name2) =>
          newTask(
            { projectId: p.id, tasklistId: nl.id, parentId: t.id, name: name2 },
            { silent: true },
          ),
        );
      });
    });
    if (!(d.lists || []).length)
      s().tasklists.push({
        id: uid(),
        projectId: p.id,
        name: 'Việc cần làm',
        order: nextOrder(s().tasklists),
      });
    return p;
  }
  const allTemplates = () => [...BUILTIN_TEMPLATES, ...s().templates];

  // ---------- repeating tasks ----------
  function occursOn(r, d) {
    if (!r.start || d < r.start) return false;
    if (r.end && d > r.end) return false;
    const every = Math.max(1, Math.floor(+r.every || 1));
    const date = toDate(d);
    const start = toDate(r.start);
    if (r.freq === 'day') return dayDiff(r.start, d) % every === 0;
    if (r.freq === 'week') {
      const days =
        r.weekdays && r.weekdays.length ? r.weekdays : [isoDow(start)];
      if (!days.includes(isoDow(date))) return false;
      const monday = (x) => addDays(x, 1 - isoDow(x));
      const weeks = Math.round((monday(date) - monday(start)) / (7 * 864e5));
      return weeks % every === 0;
    }
    if (r.freq === 'month') {
      const months =
        (date.getFullYear() - start.getFullYear()) * 12 +
        date.getMonth() -
        start.getMonth();
      if (months % every) return false;
      const last = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
      ).getDate();
      // A day this month does not have (the 31st in a 30-day month) is skipped.
      return r.monthDay === 'last'
        ? date.getDate() === last
        : date.getDate() === +r.monthDay;
    }
    if (r.freq === 'year') {
      if ((date.getFullYear() - start.getFullYear()) % every) return false;
      return d.slice(5) === r.start.slice(5);
    }
    return false;
  }
  function nextOccurrence(r, from = today()) {
    let d = from < r.start ? r.start : from;
    for (let i = 0; i < 800; i++) {
      if (r.end && d > r.end) return '';
      if (occursOn(r, d)) return d;
      d = shiftDate(d, 1);
    }
    return '';
  }
  function describeRepeat(r) {
    const every = Math.max(1, +r.every || 1);
    let text;
    if (r.freq === 'day')
      text = every === 1 ? 'Hằng ngày' : `Cứ ${every} ngày một lần`;
    else if (r.freq === 'week') {
      const days = (
        r.weekdays && r.weekdays.length ? r.weekdays : [isoDow(toDate(r.start))]
      )
        .slice()
        .sort()
        .map((x) => WEEKDAYS[x - 1])
        .join(', ');
      text = `${every === 1 ? 'Hằng tuần' : `Cứ ${every} tuần`} vào ${days}`;
    } else if (r.freq === 'month')
      text = `${r.monthDay === 'last' ? 'Ngày cuối tháng' : `Ngày ${r.monthDay}`}, ${every === 1 ? 'hằng tháng' : `cứ ${every} tháng`}`;
    else
      text = `Ngày ${r.start.slice(8, 10)}/${r.start.slice(5, 7)} ${every === 1 ? 'hằng năm' : `cứ ${every} năm`}`;
    return text + (r.dueTime ? `, hạn ${r.dueTime}` : '');
  }
  // Create the tasks repeat rules owe up to today. Catches up at most two weeks of missed days.
  function runRepeats(day = today()) {
    const made = [];
    for (const r of s().repeats) {
      if (!r.enabled || !project(r.projectId)) continue;
      let from = r.lastRun ? shiftDate(r.lastRun, 1) : r.start;
      const floor = shiftDate(day, -13);
      if (from < floor) from = floor;
      if (from < r.start) from = r.start;
      for (let d = from; d <= day; d = shiftDate(d, 1)) {
        if (!occursOn(r, d)) continue;
        const id = detId(`${r.id}|${d}`);
        if (task(id)) continue;
        const lists = listsOf(r.projectId);
        const tl = tasklist(r.tasklistId)
          ? r.tasklistId
          : lists[0]
            ? lists[0].id
            : '';
        const t = newTask(
          {
            id,
            projectId: r.projectId,
            tasklistId: tl,
            name: r.name,
            desc: r.desc || '',
            assigneeId: user(r.assigneeId) ? r.assigneeId : '',
            followerIds: (r.followerIds || []).filter(user),
            start: d,
            due: r.dueTime ? `${d}T${r.dueTime}` : d,
            important: !!r.important,
            urgent: !!r.urgent,
            checklist: (r.checklist || []).map((text, i) => ({
              id: detId(`${id}|c|${i}`),
              text,
              done: false,
            })),
            createdBy: r.createdBy || s().me,
            repeatId: r.id,
            repeatDate: d,
          },
          { silent: true },
        );
        made.push(t.id);
        s().activity.push({
          id: detId(`${id}|a`),
          taskId: id,
          userId: s().me,
          text: 'đã tạo tự động từ việc lặp lại',
          at: stamp(),
        });
        (r.subtasks || []).forEach((name, i) => {
          const sid = detId(`${id}|s|${i}`);
          newTask(
            {
              id: sid,
              projectId: r.projectId,
              tasklistId: tl,
              parentId: id,
              name,
              assigneeId: t.assigneeId,
              createdBy: t.createdBy,
            },
            { silent: true },
          );
          made.push(sid);
        });
      }
      if (r.lastRun !== day) r.lastRun = day;
    }
    return made;
  }

  // ---------- spreadsheet import / export ----------
  const COLS = [
    [
      'tasklist',
      'Danh sách việc',
      ['danh sach viec', 'danh sach', 'tasklist', 'nhom viec'],
    ],
    [
      'name',
      'Công việc',
      ['cong viec', 'ten cong viec', 'task', 'task name', 'ten viec', 'viec'],
    ],
    [
      'parent',
      'Thuộc công việc',
      ['thuoc cong viec', 'cong viec cha', 'parent', 'viec cha'],
    ],
    [
      'assignee',
      'Người thực hiện',
      ['nguoi thuc hien', 'assignee', 'nguoi lam', 'phu trach'],
    ],
    [
      'followers',
      'Người theo dõi',
      ['nguoi theo doi', 'followers', 'follower', 'theo doi'],
    ],
    ['start', 'Bắt đầu', ['bat dau', 'ngay bat dau', 'start', 'start date']],
    ['due', 'Hạn chót', ['han chot', 'deadline', 'due', 'han', 'ngay het han']],
    ['status', 'Trạng thái', ['trang thai', 'status']],
    ['important', 'Quan trọng', ['quan trong', 'important']],
    ['urgent', 'Khẩn cấp', ['khan cap', 'urgent']],
    ['milestone', 'Mục tiêu', ['muc tieu', 'milestone', 'target', 'cot moc']],
    ['desc', 'Mô tả', ['mo ta', 'description', 'ghi chu']],
    ['result', 'Kết quả', ['ket qua', 'result']],
    [
      'doneAt',
      'Xong lúc',
      ['xong luc', 'ngay hoan thanh', 'actual completion'],
    ],
  ];
  function cellText(v) {
    if (v == null) return '';
    return String(v).trim();
  }
  // Accepts 2026-11-20, 2026-11-20 17:00, 20/11/2026, 20/11/2026 17:00, or an Excel day number.
  function parseDate(v) {
    if (v == null || v === '') return { ok: true, value: '' };
    if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
      const n = +v;
      if (n > 20000 && n < 80000) {
        const ms = Math.round((n - 25569) * 864e5);
        const d = new Date(ms);
        const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        const mins = Math.round((n % 1) * 1440);
        return {
          ok: true,
          value: mins
            ? `${date}T${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`
            : date,
        };
      }
    }
    const t = String(v).trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    let y, mo, d, hh, mm;
    if (m) [, y, mo, d, hh, mm] = m;
    else {
      m = t.match(
        /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/,
      );
      if (!m) return { ok: false, value: '' };
      [, d, mo, y, hh, mm] = m;
    }
    const date = new Date(+y, +mo - 1, +d);
    if (date.getMonth() !== +mo - 1 || date.getDate() !== +d)
      return { ok: false, value: '' };
    const base = `${y}-${pad(+mo)}-${pad(+d)}`;
    return { ok: true, value: hh != null ? `${base}T${pad(+hh)}:${mm}` : base };
  }
  const yes = (v) => ['co', 'x', 'yes', 'true', '1', 'y'].includes(norm(v));
  function statusFromText(v) {
    const n = norm(v);
    if (!n) return '';
    if (n.startsWith('hoan thanh') || n === 'done' || n === 'xong')
      return 'done';
    if (n.startsWith('dang lam') || n === 'doing' || n === 'in progress')
      return 'doing';
    if (n.startsWith('cho duyet') || n === 'review') return 'review';
    return 'todo';
  }
  // Read a table (first row = column names) and work out what would be created, without changing anything.
  function planImport(p, rows) {
    const warnings = [];
    const head = (rows[0] || []).map(norm);
    const col = {};
    COLS.forEach(([key, , names]) => {
      const i = head.findIndex((h) => names.includes(h));
      if (i >= 0) col[key] = i;
    });
    const fieldCols = fieldsOf(p.id)
      .map((f) => ({ f, i: head.indexOf(norm(f.name)) }))
      .filter((x) => x.i >= 0);
    if (col.name == null)
      return {
        items: [],
        warnings: [
          'Không thấy cột “Công việc”. Hãy dùng file mẫu hoặc đặt tên cột đúng như file mẫu.',
        ],
        ok: false,
      };
    const people = new Map(s().users.map((u) => [norm(u.name), u.id]));
    const items = [];
    let lastTop = null;
    let lastList = '';
    rows.slice(1).forEach((r, idx) => {
      const line = idx + 2;
      const get = (k) => (col[k] == null ? '' : r[col[k]]);
      let name = cellText(get('name'));
      if (!name && !cellText(get('tasklist'))) return;
      let listName = cellText(get('tasklist'));
      // A row with only a tasklist name ending in ":" starts a new group, as in some exported sheets.
      if (!name && listName) {
        lastList = listName.replace(/:$/, '');
        return;
      }
      if (listName) lastList = listName.replace(/:$/, '');
      let parentName = cellText(get('parent'));
      if (!parentName && /^#\s*/.test(name)) {
        name = name.replace(/^#+\s*/, '');
        parentName = lastTop ? lastTop.name : '';
        if (!parentName)
          warnings.push(
            `Dòng ${line}: việc con “${name}” không có công việc cha phía trên, sẽ nhập như việc thường.`,
          );
      }
      const who = cellText(get('assignee'));
      let assigneeId = '';
      if (who) {
        assigneeId = people.get(norm(who)) || '';
        if (!assigneeId)
          warnings.push(
            `Dòng ${line}: không tìm thấy thành viên “${who}”, việc này sẽ chưa giao cho ai.`,
          );
      }
      const followerIds = cellText(get('followers'))
        .split(/[,;\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const idf = people.get(norm(x));
          if (!idf)
            warnings.push(
              `Dòng ${line}: không tìm thấy người theo dõi “${x}”.`,
            );
          return idf;
        })
        .filter(Boolean);
      const st = parseDate(get('start'));
      const du = parseDate(get('due'));
      const dn = parseDate(get('doneAt'));
      if (!st.ok)
        warnings.push(
          `Dòng ${line}: không hiểu ngày bắt đầu “${cellText(get('start'))}”, đã bỏ trống.`,
        );
      if (!du.ok)
        warnings.push(
          `Dòng ${line}: không hiểu hạn chót “${cellText(get('due'))}”, đã bỏ trống.`,
        );
      const custom = {};
      fieldCols.forEach(({ f, i }) => {
        let v = cellText(r[i]);
        if (!v) return;
        if (f.type === 'date') {
          const pd = parseDate(r[i]);
          v = pd.ok ? pd.value.slice(0, 10) : '';
          if (!pd.ok)
            warnings.push(`Dòng ${line}: “${f.name}” không phải ngày hợp lệ.`);
        } else if (
          f.type === 'number' &&
          !Number.isFinite(+v.replace(',', '.'))
        ) {
          warnings.push(
            `Dòng ${line}: “${f.name}” không phải số, đã bỏ trống.`,
          );
          v = '';
        } else if (f.type === 'number') v = String(+v.replace(',', '.'));
        if (v) custom[f.id] = v;
      });
      const item = {
        line,
        name,
        listName: lastList || '',
        parentName,
        assigneeId,
        followerIds,
        start: st.value.slice(0, 10),
        due: du.value,
        status: statusFromText(get('status')) || 'todo',
        important: yes(get('important')),
        urgent: yes(get('urgent')),
        milestone: cellText(get('milestone')),
        desc: cellText(get('desc')),
        result: cellText(get('result')),
        doneAt: dn.value,
        custom,
      };
      items.push(item);
      if (!parentName) lastTop = item;
    });
    return { items, warnings, ok: items.length > 0 };
  }
  function runImport(p, plan) {
    const listByName = new Map(listsOf(p.id).map((l) => [norm(l.name), l.id]));
    const markByName = new Map(
      milestonesOf(p.id).map((m) => [norm(m.name), m.id]),
    );
    const topByName = new Map();
    let made = 0;
    const listFor = (name) => {
      const key = norm(name || 'Việc cần làm');
      if (!listByName.has(key)) {
        const l = {
          id: uid(),
          projectId: p.id,
          name: name || 'Việc cần làm',
          order: nextOrder(s().tasklists),
        };
        s().tasklists.push(l);
        listByName.set(key, l.id);
      }
      return listByName.get(key);
    };
    plan.items.forEach((it) => {
      const parent = it.parentName ? topByName.get(norm(it.parentName)) : null;
      let milestoneId = '';
      if (it.milestone) {
        const key = norm(it.milestone);
        if (!markByName.has(key)) {
          const m = { id: uid(), projectId: p.id, name: it.milestone, due: '' };
          s().milestones.push(m);
          markByName.set(key, m.id);
        }
        milestoneId = markByName.get(key);
      }
      const t = newTask(
        {
          projectId: p.id,
          tasklistId: parent ? parent.tasklistId : listFor(it.listName),
          parentId: parent ? parent.id : '',
          name: it.name,
          desc: it.desc,
          assigneeId: it.assigneeId,
          followerIds: it.followerIds,
          start: it.start,
          due: it.due,
          important: it.important,
          urgent: it.urgent,
          milestoneId,
          result: it.result,
          status: it.status,
          doneAt: it.status === 'done' ? it.doneAt || stamp() : '',
          submittedAt: it.status === 'review' ? stamp() : '',
          custom: it.custom,
        },
        { silent: true },
      );
      log(t, 'đã nhập từ file Excel');
      if (t.assigneeId) notify([t.assigneeId], 'assign', t);
      if (!parent) topByName.set(norm(t.name), t);
      made++;
    });
    return made;
  }
  // Rows for a spreadsheet: one header row, then one row per task.
  function exportRows(tasks, { withProject = true, fields = [] } = {}) {
    const name = (x) => (x ? x.name : '');
    const head = COLS.filter(([k]) => k !== 'doneAt').map(([, label]) => label);
    head.push('Xong lúc');
    fields.forEach((f) => head.push(f.name));
    if (withProject) head.unshift('Dự án / Nhóm');
    const rows = [head];
    const order = [];
    const seen = new Set();
    // Keep each subtask right under its parent.
    tasks
      .filter((t) => !t.parentId || !tasks.includes(task(t.parentId)))
      .forEach((t) => {
        order.push(t);
        seen.add(t.id);
        tasks
          .filter((x) => x.parentId === t.id)
          .forEach((x) => {
            order.push(x);
            seen.add(x.id);
          });
      });
    tasks.forEach((t) => !seen.has(t.id) && order.push(t));
    order.forEach((t) => {
      const row = [
        name(tasklist(t.tasklistId)),
        t.name,
        name(task(t.parentId)),
        t.assigneeId ? userName(t.assigneeId) : '',
        t.followerIds.map(userName).join(', '),
        t.start,
        t.due.replace('T', ' '),
        STATUS[statusOf(t)].label,
        t.important ? 'Có' : '',
        t.urgent ? 'Có' : '',
        name(milestone(t.milestoneId)),
        t.desc,
        t.result,
        t.doneAt.replace('T', ' '),
      ];
      fields.forEach((f) => row.push((t.custom || {})[f.id] || ''));
      if (withProject) row.unshift(name(project(t.projectId)));
      rows.push(row);
    });
    return rows;
  }
  function importTemplateRows(p) {
    const fields = fieldsOf(p.id);
    const head = COLS.filter(
      ([k]) => !['doneAt', 'status', 'result'].includes(k),
    ).map(([, l]) => l);
    fields.forEach((f) => head.push(f.name));
    const meName = me().name;
    const ex = (vals) => [...vals, ...fields.map(() => '')];
    return [
      head,
      ex([
        'Chuẩn bị',
        'Họp khởi động',
        '',
        meName,
        '',
        today(),
        today(),
        'Có',
        '',
        '',
        'Ví dụ: xóa dòng này trước khi nhập',
      ]),
      ex([
        'Chuẩn bị',
        'Chuẩn bị tài liệu',
        '',
        meName,
        '',
        '',
        shiftDate(today(), 3) + ' 17:00',
        '',
        'Có',
        '',
        '',
      ]),
      ex([
        'Chuẩn bị',
        'In tài liệu',
        'Chuẩn bị tài liệu',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]),
    ];
  }

  // ---------- local storage backend ----------
  const local = {
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          WB.state = upgrade(JSON.parse(raw));
          return;
        }
      } catch (err) {
        console.warn('Không đọc được dữ liệu đã lưu, dùng dữ liệu mẫu.', err);
      }
      WB.state = seed();
      local.save();
    },
    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(WB.state));
        return true;
      } catch (err) {
        console.warn('Không lưu được dữ liệu vào trình duyệt.', err);
        return false;
      }
    },
    reset() {
      WB.state = seed();
      local.save();
    },
  };

  Object.assign(WB, {
    KEY,
    mode: WB.mode || 'local',
    backend: WB.backend || local,
    localBackend: local,
    uid,
    detId,
    ymd,
    stamp,
    today,
    addDays,
    toDate,
    dueDate,
    dayDiff,
    shiftDate,
    isoDow,
    fmtDate,
    ago,
    esc,
    norm,
    same,
    STATUS,
    STAGES,
    COLORS,
    FIELD_TYPES,
    FREQS,
    WEEKDAYS,
    NOTE,
    COLS,
    BUILTIN_TEMPLATES,
    blankTask,
    blankState,
    upgrade,
    seed,
    save: () => WB.backend.save(),
    load: () => WB.backend.load(),
    user,
    userName,
    project,
    dept,
    tasklist,
    task,
    milestone,
    field,
    repeat,
    me,
    myRole,
    isWorkspaceAdmin,
    isAdmin,
    canSee,
    visibleProjects,
    visibleTasks,
    tasksOf,
    topTasks,
    subs,
    listsOf,
    milestonesOf,
    fieldsOf,
    commentsOf,
    activityOf,
    myNotifications,
    reviewersOf,
    canApprove,
    statusOf,
    counts,
    progress,
    missingRequired,
    blockers,
    wouldCycle,
    myTasks,
    nextOrder,
    log,
    notify,
    newTask,
    updateTask,
    setStatus,
    toggleDone,
    addComment,
    removeTask,
    removeTasklist,
    removeProject,
    removeField,
    removeMilestone,
    copyTask,
    duplicateProject,
    templateFromProject,
    projectFromTemplate,
    allTemplates,
    occursOn,
    nextOccurrence,
    describeRepeat,
    runRepeats,
    parseDate,
    planImport,
    runImport,
    exportRows,
    importTemplateRows,
  });
})();
