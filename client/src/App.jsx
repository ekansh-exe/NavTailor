import Layout from './components/Layout.jsx';
import AuthStatus from './components/AuthStatus.jsx';
import HealthPage from './pages/HealthPage.jsx';

export default function App() {
  return (
    <Layout>
      <div className="mb-6">
        <AuthStatus />
      </div>
      <HealthPage />
    </Layout>
  );
}
