// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// 🔽 Firebase 콘솔에서 복사한 설정으로 교체하세요
const firebaseConfig = {
  apiKey: "AIzaSyDDwmaDjpsbfTP4BSvSA3jblVOVK0JK8is",
  authDomain: "appointment-planner-bb7fd.firebaseapp.com",
  projectId: "appointment-planner-bb7fd",
  storageBucket: "appointment-planner-bb7fd.firebasestorage.app",
  messagingSenderId: "1009560675851",
  appId: "1:1009560675851:web:53db0b0168f7406d4e490e"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
const auth = getAuth(app);

// 모든 사용자를 자동으로 익명 로그인 처리
export async function ensureAnonAuth() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) return resolve(user);
      try {
        const cred = await signInAnonymously(auth);
        resolve(cred.user);
      } catch (e) { reject(e); }
    });
  });
}
