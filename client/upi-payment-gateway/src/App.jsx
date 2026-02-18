import './index.css'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom"
import PaymentPage from './pages/PaymentPage'
import AdminLogin from './pages/AdminLogin'
import Dashboard from './pages/Dashboard'

function Layout({ children }) {
  const location = useLocation();
  const isAdmin = location.pathname === '/admin' || location.pathname === '/dashboard';
  const isLoggedIn = localStorage.getItem('payqr-auth') === 'true';

  return (
    <>
      {/* Background Orbs */}
      <div className="bg-orbs">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>

      {/* Header */}
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="logo">
            <div className="logo-icon">💳</div>
            <div className="logo-text">
              <span className="logo-title">PayQR</span>
              <span className="logo-sub">UPI Payment Gateway</span>
            </div>
          </Link>
          <nav className="header-nav">
            <Link to="/" className={`nav-btn ${!isAdmin ? 'active' : ''}`}>
              💰 Pay
            </Link>
            {isLoggedIn ? (
              <Link to="/dashboard" className={`nav-btn ${location.pathname === '/dashboard' ? 'active' : ''}`}>
                📊 Dashboard
              </Link>
            ) : (
              <Link to="/admin" className={`nav-btn ${location.pathname === '/admin' ? 'active' : ''}`}>
                🔐 Admin
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Page Content */}
      {children}

      {/* Footer */}
      <footer className="app-footer">
        <p>Built with 💜 — PayQR UPI Gateway © 2026</p>
      </footer>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route exact path="/" element={<PaymentPage />} />
          <Route exact path="/admin" element={<AdminLogin />} />
          <Route exact path="/dashboard" element={<Dashboard />} />
          <Route path="/*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
