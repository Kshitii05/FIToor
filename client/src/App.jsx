import { Route, Routes } from 'react-router-dom';
import { GuestOnly, RequireAuth } from './auth/guards.jsx';
import { AppLayout } from './components/layout/AppLayout.jsx';
import BuyerOrderPage from './pages/BuyerOrderPage.jsx';
import CartPage from './pages/CartPage.jsx';
import DisputePage from './pages/DisputePage.jsx';
import DisputesPage from './pages/DisputesPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import EditListingPage from './pages/EditListingPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import HomePage from './pages/HomePage.jsx';
import LikedPage from './pages/LikedPage.jsx';
import ListingDetailPage from './pages/ListingDetailPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import MessagesPage from './pages/MessagesPage.jsx';
import MyListingsPage from './pages/MyListingsPage.jsx';
import NewListingPage from './pages/NewListingPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import OrdersListPage from './pages/OrdersListPage.jsx';
import OwnerBookingPage from './pages/OwnerBookingPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import PublicProfilePage from './pages/PublicProfilePage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import RentalsListPage from './pages/RentalsListPage.jsx';
import RenterBookingPage from './pages/RenterBookingPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import SellerOrderPage from './pages/SellerOrderPage.jsx';
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
          <Route path="cart" element={<CartPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="disputes" element={<DisputesPage />} />
          <Route path="disputes/:id" element={<DisputePage />} />
          <Route path="messages/:id" element={<MessagesPage />} />
          <Route path="checkout/:id" element={<CheckoutPage />} />
          <Route path="orders" element={<OrdersListPage key="buyer" side="buyer" />} />
          <Route path="orders/:id" element={<BuyerOrderPage />} />
          <Route path="sales" element={<OrdersListPage key="seller" side="seller" />} />
          <Route path="sales/:id" element={<SellerOrderPage />} />
          <Route path="rentals" element={<RentalsListPage key="renter" side="renter" />} />
          <Route path="rentals/:id" element={<RenterBookingPage />} />
          <Route path="rented-out" element={<RentalsListPage key="owner" side="owner" />} />
          <Route path="rented-out/:id" element={<OwnerBookingPage />} />
          <Route path="listings/new" element={<NewListingPage />} />
          <Route path="listings/:id/edit" element={<EditListingPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
