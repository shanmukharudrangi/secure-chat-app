import { useEffect, useState } from "react";
import { useChat } from "../context/ChatContext";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import SecurityPanel from "../components/SecurityPanel";
import ProfileModal from "../components/ProfileModal";

/*
  ChatPage no longer needs to:
  • Import socket — socket is connected by AuthContext after login
  • Call initSocket(userId) — server derives userId from the JWT,
    no client-supplied join event is needed anymore
*/

export default function ChatPage() {
  const [profileModal, setProfileModal] = useState(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const { activeChat, securityPanel, setActiveChat, setSecurityPanel } = useChat();

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 768);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function openEditProfile() {
    setProfileModal({ editable: true });
  }

  function openUserProfile(userId) {
    if (!userId) return;
    setProfileModal({ editable: false, userId });
  }

  return (
    <div className="app-shell">
      <div className={`app-frame${isMobile ? " app-frame--mobile" : ""}`}>
        {(!isMobile || !activeChat) && (
          <Sidebar isMobile={isMobile} />
        )}
        {(!isMobile || activeChat) && (
          <ChatWindow
            onViewProfile={openUserProfile}
            isMobile={isMobile}
            onBack={() => setActiveChat(null)}
          />
        )}
        {securityPanel && (
          <SecurityPanel
            isMobile={isMobile}
            onClose={() => setSecurityPanel(false)}
          />
        )}
      </div>
      {profileModal && (
        <ProfileModal
          userId={profileModal.userId}
          editable={profileModal.editable}
          onClose={() => setProfileModal(null)}
        />
      )}
    </div>
  );
}
