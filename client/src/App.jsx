import Layout from './components/Layout.jsx';
import AuthStatus from './components/AuthStatus.jsx';
import HealthPage from './pages/HealthPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import { useAuth } from './context/AuthContext.jsx';

export default function App() {
  const { user } = useAuth();

  return (
    <Layout>
      <div className="mb-6">
        <AuthStatus />
      </div>
      {/* The profile endpoints need a session, so only mount the editor when signed in. */}
      {user && (
        <div className="mb-10">
          <ProfilePage />
        </div>
      )}
      <HealthPage />
    </Layout>
  );
}
