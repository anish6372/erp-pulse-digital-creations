import AuthProvider from '../../components/AuthContext';
import Gate from '../../components/Gate';

// The signed-in app: one persistent shell (sidebar + top bar); pages swap inside it.
export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <Gate />
      {children}
    </AuthProvider>
  );
}
