// ============================================================
//  CẤU HÌNH FIREBASE — Dự án eduquiz-71b98 của thầy
//  Đoạn config này là địa chỉ công khai của project (không phải
//  mật khẩu). Bảo mật nằm ở firestore.rules
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyB85-IhbrGo2uDVIwDYvBioQKUkDTrhLTg",
  authDomain: "eduquiz-71b98.firebaseapp.com",
  projectId: "eduquiz-71b98",
  storageBucket: "eduquiz-71b98.firebasestorage.app",
  messagingSenderId: "1059135150169",
  appId: "1:1059135150169:web:057d066454aa584ddd3948"
};

export const isConfigured = () =>
  firebaseConfig.apiKey !== "DAN_VAO_DAY" && firebaseConfig.projectId !== "DAN_VAO_DAY";
