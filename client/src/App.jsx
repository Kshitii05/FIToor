import { Route, Routes } from 'react-router-dom';
import { GuestOnly, RequireAuth } from './auth/guards.jsx';
import { AppLayout } from './components/layout/AppLayout.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import PublicProfilePage from './pages/PublicProfilePage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import VerifyPage from './pages/VerifyPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="users/:id" element={<PublicProfilePage />} />

        <Route element={<GuestOnly />}>
          <Route path="register" element={<RegisterPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route path="verify" element={<VerifyPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
