# EduQuiz — Bản Firebase + GitHub Pages (đồng bộ mọi thiết bị)

Bản này khác bản trong Muse: trang web được đăng công khai trên **GitHub Pages**,
dữ liệu chạy trên **Firebase Firestore** nên giáo viên mở 1 máy, học sinh mở
điện thoại/máy khác, tất cả thấy cùng 1 phòng, cùng điểm, theo thời gian thực.

## Kiến trúc
- GitHub Pages: chỉ chứa trang web (index.html, style.css, app.js) — miễn phí, tĩnh.
- Firebase Firestore: chứa bộ câu hỏi, phòng chơi (mã PIN), người chơi, điểm.
  Đồng bộ bằng `onSnapshot` — có thay đổi là mọi máy tự cập nhật, không cần tải lại trang.
- Cấu trúc dữ liệu:
  - `quizzes/{id}`: { title, subject, questions[] }
  - `sessions/{pin}`: { quizId, title, questions, status: lobby|playing|showing_answer|leaderboard|finished, currentQuestion, questionStartedAt }
  - `sessions/{pin}/players/{playerId}`: { nickname, score, streak, answers{} }

## Bước 1 — Tạo Firebase (khoảng 5 phút, miễn phí)
1. Vào https://console.firebase.google.com → Add project → đặt tên `eduquiz` → Create.
2. Trong project: menu Build → Firestore Database → Create database → Start in test mode → Enable.
   Sau 30 ngày test mode hết hạn thì vào tab Rules, dán nội dung file `firestore.rules` trong thư mục này → Publish.
3. Bấm bánh răng Project settings → General → mục Your apps → bấm biểu tượng Web `</>`
   → App nickname: `EduQuiz Web` → Register app.
4. Firebase hiện đoạn `firebaseConfig = { apiKey: ..., ... }`. Copy 6 giá trị đó
   dán vào file `firebase-config.js` trong thư mục này (thay các chữ DAN_VAO_DAY).

## Bước 2 — Đưa lên GitHub Pages (khoảng 3 phút)
Cách A — để Muse đẩy giúp:
Kết nối GitHub trong cuộc trò chuyện với Muse, tạo 1 repo trống tên `eduquiz`
(public), rồi bảo Muse đẩy thư mục này lên. Sau đó vào repo → Settings → Pages
→ Source: Deploy from a branch → Branch: main / (root) → Save.

Cách B — tự đẩy bằng Git:
```bash
cd eduquiz-firebase
git init && git add . && git commit -m "EduQuiz Firebase"
git branch -M main
git remote add origin https://github.com/<ten-github-cua-thay>/eduquiz.git
git push -u origin main
```
Rồi bật Pages như Cách A.

Địa chỉ trang sẽ là: `https://<ten-github-cua-thay>.github.io/eduquiz/`
Chia sẻ địa chỉ này cho học sinh — ai mở cũng vào được, nhập PIN là chơi chung.

## Bước 3 — Kiểm tra đồng bộ thật
1. Mở trang trên máy tính của thầy → Thư viện → chọn 1 bộ → Tổ chức → hiện mã PIN.
2. Mở trang trên điện thoại (trình duyệt khác, không chung máy) → nhập PIN + tên → Vào chơi.
3. Tên học sinh phải hiện ngay ở phòng chờ trên máy tính. Bấm Bắt đầu trên máy tính,
   câu hỏi hiện trên điện thoại; trả lời trên điện thoại, số bạn đã trả lời và điểm
   cập nhật ngay trên máy tính. Nếu được như vậy là đồng bộ đã xong.

## Lưu ý
- Chưa điền firebase-config.js thì trang tự chạy chế độ demo (chỉ trên 1 máy) và hiện cảnh báo vàng.
- firebaseConfig không phải mật khẩu — trang web nào dùng Firebase cũng công khai nó.
  Bảo mật nằm ở firestore.rules; bản kèm theo mở cho lớp học dùng PIN cho tiện,
  không lưu dữ liệu nhạy cảm.
- GitHub Pages chỉ đăng được trang tĩnh công khai. Không đưa mật khẩu, token GitHub
  hay khóa bí mật nào vào thư mục này.
