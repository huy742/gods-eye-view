# WorkBoard

Ứng dụng web quản lý công việc và dự án, chạy hoàn toàn trên trình duyệt.

Cách tổ chức (phòng ban → dự án / nhóm → danh sách việc → công việc → công việc con, mục tiêu, báo cáo) được làm theo tài liệu hướng dẫn công khai của Base Wework. Đây là sản phẩm độc lập: không dùng tên, logo, hình ảnh hay mã nguồn của Base.vn và không kết nối với hệ thống của họ.

## Cách mở

Mở file `index.html` bằng trình duyệt (Chrome, Edge, Firefox, Safari). Không cần cài đặt gì.

Nếu muốn chạy qua máy chủ nhỏ trên máy:

```bash
python3 -m http.server 8765
```

rồi mở `http://localhost:8765`.

## Đưa lên web

Lệnh dưới đây gộp cả ứng dụng thành một file duy nhất (kiểu chữ, màu và mã lệnh nằm chung), dùng cho nơi đăng web chỉ nhận một file:

```bash
node tools/build-web.mjs workboard-web.html
```

Khi chạy trên web dạng này, ứng dụng tự hỏi xác nhận ngay trong trang (không dùng hộp thoại của trình duyệt) và nhờ trang chủ lưu file khi xuất Excel. Nếu nơi đó không cho lưu file, ứng dụng hiện bảng để sao chép rồi dán vào Excel.

## Dữ liệu nằm ở đâu

Mọi thứ được lưu trong bộ nhớ của trình duyệt (`localStorage`) trên chính máy đang dùng.

- Không có máy chủ, không có đăng nhập, không có phân quyền.
- Người khác mở ứng dụng trên máy khác sẽ không thấy dữ liệu của bạn.
- Xóa dữ liệu trình duyệt là mất hết. Dùng nút “Xuất Excel (CSV)” để giữ bản sao.
- Ô “Bạn đang dùng với tên” ở góc dưới bên trái chỉ để đổi vai giữa các thành viên, không phải đăng nhập thật.

## Các file

- `index.html` — khung trang.
- `styles.css` — màu sắc, bố cục.
- `js/data.js` — dữ liệu mẫu, lưu và đọc dữ liệu, các quy tắc (quá hạn, duyệt, phụ thuộc).
- `js/views.js` — vẽ từng màn hình.
- `js/app.js` — xử lý bấm chuột, gõ phím, kéo thả.
- `tools/build-web.mjs` — gộp ứng dụng thành một file để đưa lên web.
