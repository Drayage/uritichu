import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref, set, update, get, onValue, push, remove } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// ⚠️  Firebase 프로젝트 설정값을 여기에 입력하세요
// Firebase 콘솔 → 프로젝트 설정 → 앱 추가 → 웹 → 구성 복사
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(FIREBASE_CONFIG);
const db = getDatabase(app);

export { db, ref, set, update, get, onValue, push, remove };
