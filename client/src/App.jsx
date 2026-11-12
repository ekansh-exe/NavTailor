import { Route, Routes } from 'react-router';
import Header from './components/Header.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import GuestOnlyRoute from './components/GuestOnlyRoute.jsx';
import AppShell from './components/AppShell.jsx';
import LandingPage from './pages/LandingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import NewTailoringPage from './pages/NewTailoringPage.jsx';
import ResultPage from './pages/ResultPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

// Routes without a `path` are "layout routes": they wrap their children without adding to
// the URL. Each one renders <Outlet />, where the matched child shows up.
export default function App() {
  return (
    <Routes>
      {/* Signed-out only. A signed-in visitor gets redirected to /app. */}
      <Route element={<GuestOnlyRoute />}>
        <Route
          path="/"
          element={
            <div className="min-h-screen">
              <Header />
              <LandingPage />
            </div>
          }
        />
      </Route>

      {/* Signed-in only: guard first, then the shared shell, then the page. */}
      <Route element={<ProtectedRoute />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="new" element={<NewTailoringPage />} />
          <Route path="result/:id" element={<ResultPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
