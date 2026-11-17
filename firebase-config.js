// ============================================================
//  CẤU HÌNH FIREBASE CỦA THẦY — DÁN THÔNG TIN CỦA THẦY VÀO ĐÂY
// ============================================================
// Cách lấy:
//  1. Vào https://console.firebase.google.com -> Tạo project "eduquiz"
//  2. Trong project: Build -> Firestore Database -> Create database
//     -> Start in test mode -> Enable
//  3. Project settings (bánh răng) -> General -> Your apps -> </> Web
//     -> Đăng ký app tên "EduQuiz Web" -> Firebase sẽ hiện đoạn config
//  4. Copy 6 dòng apiKey...appId đó dán đè vào dưới đây
// Lưu ý: Đoạn config này KHÔNG phải mật khẩu bí mật. Nó là địa chỉ
// công khai của project, mọi trang web dùng Firebase đều để lộ nó.
// Bảo mật thật nằm ở file firestore.rules
// ============================================================
export const firebaseConfig = {
  apiKey: "DAN_VAO_DAY",
  authDomain: "DAN_VAO_DAY",
  projectId: "DAN_VAO_DAY",
  storageBucket: "DAN_VAO_DAY",
  messagingSenderId: "DAN_VAO_DAY",
  appId: "DAN_VAO_DAY"
};

export const isConfigured = () =>
  firebaseConfig.apiKey !== "DAN_VAO_DAY" && firebaseConfig.projectId !== "DAN_VAO_DAY";
