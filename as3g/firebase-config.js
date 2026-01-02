// Firebase Configuration
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyBnIZDQnee_Zt2q23aOvkqlK94Do9VENZ0",
    authDomain: "code-d2d3c.firebaseapp.com",
    projectId: "code-d2d3c",
    storageBucket: "code-d2d3c.firebasestorage.app",
    messagingSenderId: "760981433572",
    appId: "1:760981433572:web:c3af53fcc3e4f2e29dd0f1",
    measurementId: "G-M8EDMFJTGR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);


