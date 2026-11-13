import { Route, Routes } from 'react-router-dom';
import { GuestOnly, RequireAuth } from './auth/guards.jsx';
import { AppLayout } from './components/layout/AppLayout.jsx';
import EditListingPage from './pages/EditListingPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import HomePage from './pages/HomePage.jsx';
import LikedPage from './pages/LikedPage.jsx';
import ListingDetailPage from './pages/ListingDetailPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import MyListingsPage from './pages/MyListingsPage.jsx';
import NewListingPage from './pages/NewListingPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import PublicProfilePage from './pages/PublicProfilePage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import VerifyPage from './pages/VerifyPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="users/:id" element={<PublicProfilePage />} />
        <Route path="listings/:id" element={<ListingDetailPage />} />
        <Route path="search" element={<SearchPage />} />

        <Route element={<GuestOnly />}>
          <Route path="register" element={<RegisterPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route path="verify" element={<VerifyPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="my-listings" element={<MyListingsPage />} />
          <Route path="liked" element={<LikedPage />} />
          <Route path="listings/new" element={<NewListingPage />} />
          <Route path="listings/:id/edit" element={<EditListingPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
