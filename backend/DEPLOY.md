# Deploy backend (Google Apps Script)

Backend là 1 Apps Script project gắn với 1 Google Sheet riêng (test only,
không liên quan sheet gốc của repo).

## 1. Tạo Google Sheet + gắn Apps Script

1. Vào https://sheets.google.com → tạo 1 Sheet mới (đặt tên gì cũng được,
   vd `ProAgent Tracking - Test`).
2. Trong Sheet: **Extensions → Apps Script**.
3. Xoá hết code mặc định trong `Code.gs`, copy toàn bộ nội dung file
   [`backend/Code.gs`](./Code.gs) trong repo này paste vào.
4. Đặt tên project (góc trên trái) vd `ProAgent Backend`.
5. **Lưu** (Ctrl+S).

## 2. Chạy setup() 1 lần

1. Ở thanh dropdown chọn function, chọn **setup**.
2. Bấm **Run** (▶).
3. Lần đầu Google sẽ hỏi cấp quyền → **Review permissions** → chọn account
   → **Advanced** → **Go to ProAgent Backend (unsafe)** → **Allow**.
4. Sau khi chạy xong, các sheet `Accounts, Regions, Branches, Checkpoints,
   Checkins, Meetings` sẽ tự được tạo, và có 1 tài khoản admin mặc định:
   - username: `admin`
   - password: `Admin@123`

   → Đổi mật khẩu này trong sheet `Accounts` ngay sau khi đăng nhập lần đầu.

## 3. Deploy thành Web App

1. Góc trên phải → **Deploy → New deployment**.
2. Chọn loại (gear icon) → **Web app**.
3. Cấu hình:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Bấm **Deploy** → cấp quyền lần nữa nếu được hỏi.
5. Copy **Web app URL** (dạng
   `https://script.google.com/macros/s/XXXXX/exec`).

## 4. Trỏ frontend sang URL mới

Mở [`index.html`](../index.html) dòng ~350, thay giá trị `API_URL`:

```js
const API_URL = "https://script.google.com/macros/s/XXXXX/exec";
```

## 5. Mỗi lần sửa Code.gs

Sau khi sửa code trong Apps Script editor, phải tạo deployment mới (hoặc
**Manage deployments → Edit → New version**) thì URL cũ mới nhận code mới —
sửa code không tự động apply cho deployment đang chạy.
