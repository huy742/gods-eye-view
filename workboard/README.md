# WorkBoard

Ứng dụng web quản lý công việc và dự án.

Cách tổ chức (phòng ban → dự án / nhóm → danh sách việc → công việc → việc con, mục tiêu, báo cáo, việc lặp lại, trường tùy chỉnh) được làm theo tài liệu hướng dẫn công khai của Base Wework. Đây là sản phẩm độc lập: không dùng tên, logo, hình ảnh hay mã nguồn của Base.vn và không kết nối với hệ thống của họ.

Có hai cách dùng, cùng một bộ mã:

|                       | Bản trên máy               | Bản dùng chung (Supabase)                        |
| --------------------- | -------------------------- | ------------------------------------------------ |
| Đăng nhập             | Không                      | Có (email + mật khẩu)                            |
| Dữ liệu nằm ở         | Trình duyệt của bạn        | Cơ sở dữ liệu Supabase                           |
| Nhiều người cùng dùng | Không (chỉ đổi vai để thử) | Có, thấy thay đổi của nhau ngay                  |
| Cần cài gì            | Không                      | Một dự án Supabase (miễn phí) và một chỗ đặt web |

File `config.js` quyết định dùng bản nào: để trống là bản trên máy, điền địa chỉ và khóa Supabase là bản dùng chung.

## Tính năng

- Việc của tôi, dự án và nhóm theo phòng ban, dự án riêng tư.
- 8 cách xem dự án: Danh sách, Bảng, Kanban (kéo thả), Gantt (kéo để đổi ngày), Lịch, Theo kỳ (tuần/tháng, theo từng người), Hoạt động, Mục tiêu.
- Chi tiết công việc: người thực hiện, người theo dõi, ngày bắt đầu, hạn chót có giờ, nhãn Quan trọng / Khẩn cấp, danh sách kiểm tra, việc con, phụ thuộc, kết quả, bình luận (gõ @tên để nhắc), lịch sử thay đổi.
- Duyệt hoàn thành: người giao việc hoặc quản trị dự án duyệt.
- Trường tùy chỉnh (chữ, đoạn văn, số, ngày, chọn một), có thể bắt buộc điền.
- Việc lặp lại: theo ngày, tuần (chọn thứ), tháng (ngày cố định hoặc ngày cuối tháng), năm.
- Mẫu dự án (4 mẫu có sẵn hoặc lưu từ dự án của bạn), nhân bản dự án, sao chép việc sang dự án khác, giao một việc cho nhiều người.
- Nhập công việc từ Excel (.xlsx, .csv) có xem trước; xuất ra Excel (.xlsx).
- Chuông thông báo và nhắc việc; báo cáo tổng hợp và báo cáo từng người.

## Bản trên máy

Mở file `index.html` bằng trình duyệt (Chrome, Edge, Firefox, Safari). Không cần cài gì. Dữ liệu chỉ nằm trong trình duyệt đó; xóa dữ liệu trình duyệt là mất, nên hãy dùng “Xuất ra Excel” để giữ bản sao.

## Bản dùng chung với Supabase

### 1. Tạo dự án Supabase

1. Vào [supabase.com](https://supabase.com), đăng ký (có thể đăng nhập bằng GitHub).
2. Bấm **New project**. Đặt tên (ví dụ `workboard`), đặt mật khẩu cơ sở dữ liệu và giữ lại, chọn vùng **Singapore** cho gần Việt Nam.
3. Chờ khoảng 1–2 phút cho dự án sẵn sàng.

### 2. Tạo bảng dữ liệu

1. Mở **SQL Editor** của dự án (đường link thẳng: [supabase.com/dashboard/project/\_/sql/new](https://supabase.com/dashboard/project/_/sql/new)).
2. Mở file [`supabase/migrations/20261117000000_workboard.sql`](supabase/migrations/20261117000000_workboard.sql), sao chép toàn bộ, dán vào và bấm **Run**.
3. Thấy chữ “Success” là xong. Chỉ chạy một lần cho mỗi dự án.

### 3. Lấy địa chỉ và khóa

1. Bấm nút **Connect** của dự án, hoặc mở **Settings → API Keys**.
2. Chép **Project URL** (dạng `https://xxxx.supabase.co`) và khóa **publishable** (bắt đầu bằng `sb_publishable_`). Dự án cũ có thể chỉ có khóa **anon**; dùng khóa đó cũng được.
3. Điền vào `config.js`:

   ```js
   window.WB_CONFIG = {
     supabaseUrl: 'https://xxxx.supabase.co',
     supabaseKey: 'sb_publishable_...',
   };
   ```

Khóa publishable được phép để công khai trong trang web. **Không bao giờ** dùng khóa **secret** hay **service_role** ở đây: khóa đó bỏ qua mọi quy tắc bảo mật.

### 4. Cài đặt đăng nhập

Hộp thư có sẵn của Supabase chỉ gửi được email cho người trong nhóm quản lý dự án Supabase của bạn, và tối đa khoảng 2 email mỗi giờ ([tài liệu của Supabase](https://supabase.com/docs/guides/auth/auth-smtp)). Vì vậy:

- Cách đơn giản: trong **Authentication → Sign In / Providers**, mở phần **Email** và tắt **Confirm email**. Người dùng đăng ký xong là vào được ngay. Muốn vào một không gian làm việc vẫn cần đường link hoặc mã mời.
- Cách đầy đủ: cài máy chủ gửi email riêng (SMTP, ví dụ Resend, Brevo, Gmail) ở trang [SMTP Settings](https://supabase.com/dashboard/project/_/auth/smtp). Khi đó mới dùng được email xác nhận và “Quên mật khẩu” cho mọi người.

Sau khi có địa chỉ web (bước 5), mở trang [URL Configuration](https://supabase.com/dashboard/project/_/auth/url-configuration): điền địa chỉ đó vào **Site URL** và thêm nó vào **Redirect URLs**. Thiếu bước này thì đường link trong email sẽ dẫn sai chỗ.

### 5. Đưa web lên mạng

Trang web chỉ gồm các file tĩnh trong thư mục này, đặt ở đâu cũng chạy: GitHub Pages, Netlify, Vercel, Cloudflare Pages. Với GitHub Pages của repo này:

1. Gộp (merge) thay đổi vào nhánh `main`.
2. Vào **Settings** → **Pages** → **Source: Deploy from a branch** → chọn `main` và thư mục `/ (root)` → **Save**.
3. Sau vài phút, web nằm ở `https://<tên-tài-khoản>.github.io/<tên-repo>/workboard/`.

### 6. Dùng

1. Người đầu tiên đăng ký, tạo **không gian làm việc** (ví dụ tên công ty). Người này là chủ sở hữu.
2. Bấm **Mời người** (góc dưới bên trái) để lấy đường link mời, gửi cho đồng nghiệp. Họ mở link, đăng ký là vào.
3. Ở trang **Thành viên**, chủ sở hữu và quản trị có thể đổi vai trò hoặc mời người ra.

## Bảo mật (do cơ sở dữ liệu tự kiểm tra)

- Chưa đăng nhập thì không đọc được gì.
- Mỗi người chỉ thấy dữ liệu của không gian làm việc mình đã tham gia; dự án riêng tư chỉ thành viên dự án và quản trị thấy.
- Chỉ quản trị dự án mới đổi cài đặt dự án và trường tùy chỉnh; chỉ chủ sở hữu và quản trị quản lý phòng ban và thành viên.
- Ở dự án có duyệt, chỉ người giao việc hoặc quản trị dự án mới đánh dấu xong được; trường bắt buộc phải điền trước khi xong.
- Bình luận và lịch sử luôn mang đúng tên người viết; thông báo chỉ người nhận đọc được.

## Lưu ý về gói miễn phí của Supabase

Dự án miễn phí bị tạm dừng nếu gần như không có hoạt động trong khoảng một tuần; khi đó vào trang quản lý Supabase bấm **Resume** để chạy lại ([giải thích của Supabase](https://supabase.com/kb/faqs/platform/free-project-pausing)). Các giới hạn khác (dung lượng, số dự án) xem ở trang giá của Supabase.

## Các file

- `index.html` — khung trang.
- `config.js` — địa chỉ và khóa Supabase (để trống = bản trên máy).
- `styles.css` — màu sắc, bố cục, giao diện sáng và tối.
- `js/core.js` — dữ liệu, các quy tắc (quá hạn, duyệt, việc lặp lại, mẫu, nhập/xuất), lưu trên trình duyệt.
- `js/xlsx.js` — đọc và ghi file Excel, CSV (không dùng thư viện ngoài).
- `js/views.js`, `js/views2.js` — vẽ các màn hình.
- `js/app.js` — xử lý bấm chuột, gõ phím, kéo thả.
- `js/cloud.js` — bản dùng chung: đăng nhập, không gian làm việc, lưu lên Supabase, cập nhật trực tiếp.
- `supabase/migrations/…sql` — bảng dữ liệu và quy tắc bảo mật.
- `tools/build-web.mjs` — gộp bản trên máy thành một file để đăng lên nơi chỉ nhận một file:

  ```bash
  node tools/build-web.mjs workboard-web.html
  ```
