import { ChatProvider } from "./context/ChatContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ChatPage from "./pages/ChatPage";
import AuthPage from "./pages/AuthPage";
import ProfileSetup from "./pages/ProfileSetup";

function AppContent() {
  const { user, needsProfile } = useAuth();

  // Not logged in — show auth only, no ChatProvider needed
  if (!user) return <AuthPage />;

  // Profile incomplete — show setup only, no ChatProvider needed
  if (needsProfile) return <ProfileSetup />;

  // Key ChatProvider on the user's _id so React fully unmounts and remounts
  // it (wiping conversations, messages, and all chat state) whenever a
  // different user logs in. Without this, User A's data would persist
  // when User B logs in during the same browser session.
  return (
    <ChatProvider key={user._id}>
      <ChatPage />
    </ChatProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
