import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Service Worker — хуучин cache цэвэрлэх + автомат шинэчлэлт
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      // 1. Хуучин cache бүгдийг устгах (хуучин JS bundle-ийг арилгана)
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
      // 2. Service Worker дахин бүртгэх (шинэчлэлт шалгах)
      const reg = await navigator.serviceWorker.register("/sw.js");
      await reg.update();
      // 3. Шинэ SW идэвхжмэгц хуудсыг автоматаар дахин ачаалах
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (err) {
      console.error("Service Worker register failed:", err);
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
