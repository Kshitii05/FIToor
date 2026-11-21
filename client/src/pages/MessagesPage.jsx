import { Link, useParams } from 'react-router-dom';
import { ChatThread } from '../components/chat/ChatThread.jsx';
import { ConversationList } from '../components/chat/ConversationList.jsx';

/** Chats: the list beside the open chat on wide screens, one at a time on phones. */
export default function MessagesPage() {
  const { id } = useParams();
  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1
        className={`font-display text-3xl font-semibold tracking-tight text-ink ${id ? 'hidden md:block' : ''}`}
      >
        Messages
      </h1>
      <div className="mt-5 grid gap-5 md:grid-cols-[18rem_1fr]">
        <div className={`min-w-0 ${id ? 'hidden md:block' : ''}`}>
          <ConversationList activeId={id} />
        </div>
        <div className={`min-w-0 ${id ? '' : 'hidden md:block'}`}>
          {id ? (
            <ChatThread
              key={id}
              conversationId={id}
              back={
                <Link
                  to="/messages"
                  className="text-sm text-accent md:hidden"
                  aria-label="Back to chats"
                >
                  ‹
                </Link>
              }
            />
          ) : (
            <p className="mt-10 text-center text-sm text-muted">Choose a chat to read it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
