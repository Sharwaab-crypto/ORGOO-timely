@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  min-height: 100dvh;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior-y: none;
}

/* Safe area support for notched phones */
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

/* Improve form input zoom on iOS */
@media (max-width: 768px) {
  input[type="text"],
  input[type="email"],
  input[type="password"],
  input[type="number"],
  input[type="time"],
  input[type="date"],
  textarea,
  select {
    font-size: 16px !important;
  }

  /* Bigger touch targets on mobile */
  button {
    min-height: 44px;
  }

  /* Larger primary buttons specifically */
  .py-3,
  .py-3\.5,
  .py-4 {
    padding-top: 0.875rem !important;
    padding-bottom: 0.875rem !important;
  }
}

/* Better scrolling for modals */
.overflow-y-auto {
  -webkit-overflow-scrolling: touch;
}

/* Disable double-tap zoom on buttons */
button {
  touch-action: manipulation;
}

/* Smoother transitions */
* {
  -webkit-tap-highlight-color: transparent;
}

/* Status bar background for PWA standalone mode */
@media (display-mode: standalone) {
  body {
    overscroll-behavior: none;
  }
}
