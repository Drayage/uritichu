import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref, set, update, get, onValue, push, remove, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// ⚠️  Firebase 프로젝트 설정값을 여기에 입력하세요
// Firebase 콘솔 → 프로젝트 설정 → 앱 추가 → 웹 → 구성 복사
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyByKyy7PYBIMi2K1jxH6KmzfWbE2_SsB5A",
  authDomain: "deadline-38cdb.firebaseapp.com",
  databaseURL: "https://deadline-38cdb-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "deadline-38cdb",
  storageBucket: "deadline-38cdb.firebasestorage.app",
  messagingSenderId: "768255871086",
  appId: "1:768255871086:web:c40476653f108f009cbe7f",
};

const app = initializeApp(FIREBASE_CONFIG);
const db = getDatabase(app);

export { db, ref, set, update, get, onValue, push, remove, runTransaction };
